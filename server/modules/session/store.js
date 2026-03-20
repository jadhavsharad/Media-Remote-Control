const { MESSAGE_TYPES } = require("../../shared/constants");
const { TOKEN_TTL_MS, PAIR_CODE_TTL_MS, CLEANUP_INTERVAL_MS } = require("../../config");
const { now, safeSend } = require("../../shared/utils");

/**
 * Key-pattern helpers.
 * Centralizes Redis key naming so nothing is scattered across the codebase.
 */
const KEYS = {
  session: (id) => `session:${id}`,
  sessionRemotes: (id) => `session:${id}:remotes`,
  hostToken: (token) => `hosttoken:${token}`,
  remote: (token) => `remote:${token}`,
};

/**
 * SessionStore — Redis for persistence, MemoryStore for hot-path.
 *
 * Redis is only read during auth flows (registration, reconnection).
 * All message-routing lookups and integrity checks use the in-memory
 * MemoryStore, which is populated after successful auth.
 */
class SessionStore {
  /**
   * @param {import("@upstash/redis").Redis} redis
   * @param {import("../../lib/memory-store")} memoryStore
   * @param {WebSocket.Server} wss
   */
  constructor(redis, memoryStore, wss) {
    this.redis = redis;
    this.memoryStore = memoryStore;
    this.wss = wss;

    this.startCleanup();
  }

  /* ──────────────── Sessions ──────────────── */

  /**
   * Creates a new host session.
   * Persists to Redis + registers in the in-memory routing map.
   */
  async createSession(id, hostToken, ws, info) {
    const sessionData = {
      hostOS: info?.os || null,
      hostBrowser: info?.browser || null,
      hostExtensionVersion: info?.extensionVersion || null,
      hostToken,
      hostDisconnectedAt: null,
      hostSocketId: ws.socketId,
    };

    const ttlSeconds = Math.ceil(TOKEN_TTL_MS / 1000);

    await Promise.all([
      this.redis.hset(KEYS.session(id), sessionData),
      this.redis.expire(KEYS.session(id), ttlSeconds),
      this.redis.set(KEYS.hostToken(hostToken), id, { ex: ttlSeconds }),
    ]);

    // Populate in-memory routing map
    this.memoryStore.setHost(id, ws.socketId);

    return sessionData;
  }

  /**
   * Fetches a session from Redis.
   * Used only during auth flows (reconnection), NOT on the hot path.
   */
  async getSession(sessionId) {
    const session = await this.redis.hgetall(KEYS.session(sessionId));
    if (!session || Object.keys(session).length === 0) return null;
    return session;
  }

  /**
   * Resolves a host token to a session (Redis lookup).
   * Used only during host reconnection.
   */
  async getSessionByHostToken(token) {
    const sessionId = await this.redis.get(KEYS.hostToken(token));
    if (!sessionId) return null;

    const session = await this.getSession(sessionId);
    if (!session) return null;

    return { sessionId, session };
  }

  /**
   * Updates session fields in Redis (persistence).
   */
  async updateSession(sessionId, fields) {
    await this.redis.hset(KEYS.session(sessionId), fields);
  }

  /* ──────────────── Pair Codes ──────────────── */

  /**
   * Creates a pair code. Pure in-memory — no Redis.
   */
  setPairCode(code, sessionId) {
    this.memoryStore.setPairCode(code, sessionId);
    return PAIR_CODE_TTL_MS;
  }

  /**
   * Resolves a pair code. Pure in-memory — no Redis.
   * Fetches the session from Redis (need host info for response).
   */
  async resolvePairCode(code) {
    const sessionId = this.memoryStore.resolvePairCode(code);
    if (!sessionId) return null;

    const session = await this.getSession(sessionId);
    if (!session) return null;

    return { sessionId, session };
  }

  /**
   * Deletes any active pair code for a session. Pure in-memory.
   */
  deletePairCode(sessionId) {
    this.memoryStore.deleteBySession(sessionId);
  }

  /* ──────────────── Remote Identities ──────────────── */

  /**
   * Persists a remote identity to Redis + registers in routing map.
   */
  async registerRemote(trustToken, identity) {
    const ttlSeconds = Math.ceil(TOKEN_TTL_MS / 1000);

    const storable = {
      id: identity.id,
      sessionId: identity.sessionId,
      expiresAt: identity.expiresAt,
      revoked: identity.revoked,
      trustToken: identity.trustToken,
      socketId: identity.socketId || null,
    };

    await Promise.all([
      this.redis.hset(KEYS.remote(trustToken), storable),
      this.redis.expire(KEYS.remote(trustToken), ttlSeconds),
    ]);
  }

  /**
   * Fetches a remote identity from Redis.
   * Used only during session validation (reconnection), NOT on the hot path.
   */
  async getRemote(trustToken) {
    const identity = await this.redis.hgetall(KEYS.remote(trustToken));
    if (!identity || Object.keys(identity).length === 0) return null;
    return identity;
  }

  /**
   * Updates remote identity fields in Redis (persistence).
   */
  async updateRemote(trustToken, fields) {
    await this.redis.hset(KEYS.remote(trustToken), fields);
  }

  /* ──────────────── Session Remotes ──────────────── */

  /**
   * Adds a remote to the session's remotes set.
   * Persists to Redis + updates in-memory routing map.
   */
  async addRemoteToSession(sessionId, remoteId, trustToken, socketId) {
    // In-memory: add to routing map
    this.memoryStore.addRemote(sessionId, remoteId, socketId);

    // Redis: persist mapping
    await this.redis.hset(KEYS.sessionRemotes(sessionId), {
      [remoteId]: trustToken,
    });
  }

  /* ──────────────── Disconnect Handling ──────────────── */

  /**
   * Handles host disconnection.
   * Persists to Redis + clears in-memory routing + notifies remotes.
   */
  async handleHostDisconnect(ws) {
    const route = this.memoryStore.routes.get(ws.sessionId);
    if (!route) return;

    console.log(`[DISCONNECT] Host disconnected from session ${ws.sessionId}`);

    // Only update if this socket is still the registered host
    if (route.hostSocketId === ws.socketId) {
      // In-memory: clear host
      this.memoryStore.clearHost(ws.sessionId);

      // Redis: persist disconnect
      await this.updateSession(ws.sessionId, {
        hostSocketId: null,
        hostDisconnectedAt: now(),
      });
    }

    // Notify all remotes (pure in-memory socket lookup)
    const remoteSockets = this.memoryStore.getAllRemoteSockets(ws.sessionId);
    for (const remoteWs of remoteSockets.values()) {
      safeSend(remoteWs, { type: MESSAGE_TYPES.HOST_DISCONNECTED });
    }
  }

  /* ──────────────── Cleanup ──────────────── */

  startCleanup() {
    setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
          return ws.terminate();
        }
      });
    }, CLEANUP_INTERVAL_MS);
  }
}

module.exports = SessionStore;
