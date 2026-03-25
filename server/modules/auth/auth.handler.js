const logger = require("../../shared/logger");
const { meta, send, close: closeSocket, terminate, subscribe } = require("../../transport/socket");
const { MESSAGE_TYPES } = require("../../shared/constants");
const { TOKEN_TTL_MS } = require("../../config");
const { generateUUID, generatePairCode, now } = require("../../shared/utils");

/**
 * Handles all authentication-phase messages.
 * Returns true if the message was consumed (auth message), false otherwise.
 *
 * Auth flows read Redis for security validation, then populate the
 * in-memory routing map so the hot path never touches Redis.
 */
async function handleAuth(ws, msg, store) {
  const t = now();
  const data = meta(ws);

  // --- HOST REGISTRATION ---
  if (msg.type === MESSAGE_TYPES.HOST_REGISTER) {
    if (data.role === MESSAGE_TYPES.ROLE.REMOTE) {
      terminate(ws);
      logger.fatal("Remote trying to register as host");
      return true;
    }

    const { hostToken: existingHostToken, info } = msg;
    let sessionId, session, hostToken;

    if (existingHostToken) {
      // Redis read: validate host token (security)
      const result = await store.getSessionByHostToken(existingHostToken);
      if (result) {
        sessionId = result.sessionId;
        session = result.session;

        // Close ghost host if still connected
        const existingHostWs = store.memoryStore.getHostSocket(sessionId);
        if (existingHostWs && existingHostWs !== ws) {
          closeSocket(existingHostWs, 4000, "Session superseded");
          logger.warn(`Closed ghost host for ${sessionId}`);
        }

        // Redis write: persist new socketId
        await store.updateSession(sessionId, {
          hostSocketId: data.socketId,
          hostDisconnectedAt: null,
        });

        // In-memory: rebuild routing entry
        store.memoryStore.setHost(sessionId, data.socketId);
        hostToken = existingHostToken;
      }
    }

    if (!session && !existingHostToken) {
      sessionId = generateUUID();
      hostToken = generateUUID();
      // Redis write + in-memory routing (handled inside createSession)
      session = await store.createSession(sessionId, hostToken, ws, info);
    }

    data.role = MESSAGE_TYPES.ROLE.HOST;
    data.sessionId = sessionId;

    logger.debug("Host registered", sessionId);

    send(ws, {
      type: MESSAGE_TYPES.HOST_REGISTERED,
      SESSION_IDENTITY: sessionId,
      hostToken,
    });
    return true;
  }

  // --- PAIRING CODE REQUEST ---
  if (msg.type === MESSAGE_TYPES.PAIRING_KEY_REQUEST) {
    if (data.role !== MESSAGE_TYPES.ROLE.HOST) return true;

    // In-memory: delete old code + set new code (no Redis)
    store.deletePairCode(data.sessionId);

    const code = generatePairCode();
    const ttl = store.setPairCode(code, data.sessionId);

    logger.debug("Pairing key generated", code);
    
    send(ws, {
      type: MESSAGE_TYPES.PAIRING_KEY,
      code,
      ttl,
    });
    return true;
  }

  // --- PAIRING EXCHANGE (Remote entering code) ---
  if (msg.type === MESSAGE_TYPES.EXCHANGE_PAIR_KEY) {
    const { code } = msg;

    // In-memory resolve + Redis read for session data
    const result = await store.resolvePairCode(code);

    if (!result) {
      send(ws, { type: MESSAGE_TYPES.PAIR_FAILED });
      return true;
    }

    const { sessionId: pairedSessionId, session } = result;
    const trustToken = generateUUID();
    const remoteIdentityId = generateUUID();

    const identity = {
      id: remoteIdentityId,
      sessionId: pairedSessionId,
      socketId: data.socketId,
      expiresAt: t + TOKEN_TTL_MS,
      revoked: false,
      trustToken,
    };

    // Redis write: persist remote identity
    await store.registerRemote(trustToken, identity);

    // Attach socket + populate routing map + persist membership
    await attachRemoteSocket(ws, identity, trustToken, pairedSessionId, session, store);
    send(ws, {
      type: MESSAGE_TYPES.PAIR_SUCCESS,
      trustToken,
      sessionId: pairedSessionId,
      hostInfo: {
        os: session.hostOS,
        browser: session.hostBrowser,
        extensionVersion: session.hostExtensionVersion,
      },
    });
    logger.debug("Remote paired", pairedSessionId);
    return true;
  }

  // --- SESSION VALIDATION (Remote reconnecting) ---
  if (msg.type === MESSAGE_TYPES.VALIDATE_SESSION) {
    const { trustToken } = msg;

    // Redis read: validate remote identity (security)
    const identity = await store.getRemote(trustToken);

    if (!identity || identity.revoked || t > identity.expiresAt) {
      send(ws, { type: MESSAGE_TYPES.SESSION_INVALID });
      logger.warn("Session invalid", identity.sessionId);
      return true;
    }

    // Redis read: validate session exists + get host info
    const session = await store.getSession(identity.sessionId);
    if (!session) {
      send(ws, { type: MESSAGE_TYPES.SESSION_INVALID });
      logger.warn("Session invalid", identity.sessionId);
      return true;
    }

    // Redis write: update socketId + persist membership
    await store.updateRemote(trustToken, { socketId: data.socketId });

    // Attach socket + populate routing map
    await attachRemoteSocket(ws, identity, trustToken, identity.sessionId, session, store);

    send(ws, {
      type: MESSAGE_TYPES.SESSION_VALID,
      sessionId: identity.sessionId,
      hostInfo: {
        os: session.hostOS,
        browser: session.hostBrowser,
        extensionVersion: session.hostExtensionVersion,
      },
    });
    logger.debug("Session validated", identity.sessionId);
    return true;
  }

  return false;
}

/**
 * Attaches a WebSocket to a known remote identity and notifies the host.
 * Session is passed in to avoid a redundant Redis fetch.
 */
async function attachRemoteSocket(ws, identity, trustToken, sessionId, session, store) {
  const data = meta(ws);

  // Close old socket if still connected
  const existingWs = store.memoryStore.getRemoteSocket(sessionId, identity.id);
  if (existingWs && existingWs !== ws) {
    closeSocket(existingWs, 4000, "Session superseded");
    logger.warn(`Closed ghost remote for ${sessionId} with remoteId ${identity.id}`);
  }

  data.role = MESSAGE_TYPES.ROLE.REMOTE;
  data.sessionId = sessionId;
  data.remoteIdentityId = identity.id;
  data.trustToken = trustToken;

  // Subscribe to session topic for broadcasts (uWS auto-unsubscribes on close)
  subscribe(ws, `session:${sessionId}`);

  // In-memory routing + Redis persistence
  await store.addRemoteToSession(sessionId, identity.id, trustToken, data.socketId);

  // Notify host (pure in-memory socket lookup)
  const hostWs = store.memoryStore.getHostSocket(sessionId);
  if (hostWs) {
    send(hostWs, {
      type: MESSAGE_TYPES.REMOTE_JOINED,
      remoteId: identity.id,
    });
    logger.debug("Remote joined", sessionId);
  }
}

module.exports = { handleAuth, attachRemoteSocket };
