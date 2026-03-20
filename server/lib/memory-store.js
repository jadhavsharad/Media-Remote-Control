const { PAIR_CODE_TTL_MS } = require("../config");

/**
 * MemoryStore — In-memory data structures for hot-path operations.
 *
 * Two responsibilities:
 *   1. Pair codes — short-lived (60s), auto-expiring, no Redis needed.
 *   2. Routing map — tracks which sockets belong to which session
 *      so message routing and integrity checks are pure in-memory.
 *
 * The routing map is a "post-auth cache": entries are only created
 * after a client passes Redis-backed authentication. On server restart,
 * all entries are lost and rebuilt organically as clients reconnect.
 */
class MemoryStore {
  /**
   * @param {import("./socket-registry")} socketRegistry
   */
  constructor(socketRegistry) {
    this.socketRegistry = socketRegistry;

    /**
     * Pair codes: code → { sessionId, timer }
     * Also tracks sessionId → code for reverse lookup (delete by session).
     */
    this.pairCodes = new Map();
    this.sessionToPairCode = new Map();

    /**
     * Routing map: sessionId → { hostSocketId, remotes: Map<remoteId, socketId> }
     */
    this.routes = new Map();
  }

  /* ──────────────── Pair Codes ──────────────── */

  /**
   * Stores a pair code with auto-expiry.
   *
   * @param {string} code
   * @param {string} sessionId
   */
  setPairCode(code, sessionId) {
    // Clear any existing code for this session
    this.deleteBySession(sessionId);

    const timer = setTimeout(() => {
      this.pairCodes.delete(code);
      this.sessionToPairCode.delete(sessionId);
    }, PAIR_CODE_TTL_MS);

    this.pairCodes.set(code, { sessionId, timer });
    this.sessionToPairCode.set(sessionId, code);
  }

  /**
   * Resolves a pair code: returns the sessionId and deletes the entry.
   * Returns null if the code doesn't exist or has expired.
   *
   * @param {string} code
   * @returns {string|null} sessionId
   */
  resolvePairCode(code) {
    const entry = this.pairCodes.get(code);
    if (!entry) return null;

    clearTimeout(entry.timer);
    this.pairCodes.delete(code);
    this.sessionToPairCode.delete(entry.sessionId);

    return entry.sessionId;
  }

  /**
   * Deletes any active pair code for a session.
   *
   * @param {string} sessionId
   */
  deleteBySession(sessionId) {
    const code = this.sessionToPairCode.get(sessionId);
    if (!code) return;

    const entry = this.pairCodes.get(code);
    if (entry) clearTimeout(entry.timer);

    this.pairCodes.delete(code);
    this.sessionToPairCode.delete(sessionId);
  }

  /* ──────────────── Routing Map ──────────────── */

  /**
   * Ensures a routing entry exists for a session.
   *
   * @param {string} sessionId
   * @returns {object} The route entry
   */
  _ensureRoute(sessionId) {
    if (!this.routes.has(sessionId)) {
      this.routes.set(sessionId, {
        hostSocketId: null,
        remotes: new Map(),
      });
    }
    return this.routes.get(sessionId);
  }

  /**
   * Records the host socket for a session.
   *
   * @param {string} sessionId
   * @param {string} socketId
   */
  setHost(sessionId, socketId) {
    const route = this._ensureRoute(sessionId);
    route.hostSocketId = socketId;
  }

  /**
   * Clears the host socket (on disconnect).
   *
   * @param {string} sessionId
   */
  clearHost(sessionId) {
    const route = this.routes.get(sessionId);
    if (route) route.hostSocketId = null;
  }

  /**
   * Returns the live host WebSocket for a session.
   *
   * @param {string} sessionId
   * @returns {WebSocket|null}
   */
  getHostSocket(sessionId) {
    const route = this.routes.get(sessionId);
    if (!route || !route.hostSocketId) return null;
    return this.socketRegistry.get(route.hostSocketId) || null;
  }

  /**
   * Adds a remote socket to a session's routing entry.
   *
   * @param {string} sessionId
   * @param {string} remoteId
   * @param {string} socketId
   */
  addRemote(sessionId, remoteId, socketId) {
    const route = this._ensureRoute(sessionId);
    route.remotes.set(remoteId, socketId);
  }

  /**
   * Removes a remote from the routing map (on disconnect).
   *
   * @param {string} sessionId
   * @param {string} remoteId
   */
  removeRemote(sessionId, remoteId) {
    const route = this.routes.get(sessionId);
    if (route) route.remotes.delete(remoteId);
  }

  /**
   * Returns the live WebSocket for a specific remote.
   *
   * @param {string} sessionId
   * @param {string} remoteId
   * @returns {WebSocket|null}
   */
  getRemoteSocket(sessionId, remoteId) {
    const route = this.routes.get(sessionId);
    if (!route) return null;

    const socketId = route.remotes.get(remoteId);
    if (!socketId) return null;

    return this.socketRegistry.get(socketId) || null;
  }

  /**
   * Returns all live remote WebSockets for a session.
   *
   * @param {string} sessionId
   * @returns {Map<string, WebSocket>} remoteId → WebSocket
   */
  getAllRemoteSockets(sessionId) {
    const result = new Map();
    const route = this.routes.get(sessionId);
    if (!route) return result;

    for (const [remoteId, socketId] of route.remotes) {
      const ws = this.socketRegistry.get(socketId);
      if (ws) result.set(remoteId, ws);
    }
    return result;
  }

  /* ──────────────── Integrity Checks ──────────────── */

  /**
   * Validates that a socket is the registered host for a session.
   *
   * @param {string} sessionId
   * @param {string} socketId
   * @returns {boolean}
   */
  isHostValid(sessionId, socketId) {
    const route = this.routes.get(sessionId);
    if (!route) return false;
    return route.hostSocketId === socketId;
  }

  /**
   * Validates that a socket is a registered remote for a session.
   *
   * @param {string} sessionId
   * @param {string} remoteId
   * @param {string} socketId
   * @returns {boolean}
   */
  isRemoteValid(sessionId, remoteId, socketId) {
    const route = this.routes.get(sessionId);
    if (!route) return false;
    return route.remotes.get(remoteId) === socketId;
  }
}

module.exports = MemoryStore;
