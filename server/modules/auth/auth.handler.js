const logger = require("../../shared/logger");
const { MESSAGE_TYPES } = require("../../shared/constants");
const { TOKEN_TTL_MS } = require("../../config");
const { generateUUID, generatePairCode, now, safeSend, isOpen } = require("../../shared/utils");

/**
 * Handles all authentication-phase messages.
 * Returns true if the message was consumed (auth message), false otherwise.
 *
 * Auth flows read Redis for security validation, then populate the
 * in-memory routing map so the hot path never touches Redis.
 */
async function handleAuth(ws, msg, store) {
  const t = now();

  // --- HOST REGISTRATION ---
  if (msg.type === MESSAGE_TYPES.HOST_REGISTER) {
    if (ws.role === MESSAGE_TYPES.ROLE.REMOTE) {
      ws.terminate();
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
        if (existingHostWs && isOpen(existingHostWs) && existingHostWs !== ws) {
          existingHostWs.close(4000, "Session superseded");
          logger.warn(`Closed ghost host for ${sessionId}`);
        }

        // Redis write: persist new socketId
        await store.updateSession(sessionId, {
          hostSocketId: ws.socketId,
          hostDisconnectedAt: null,
        });

        // In-memory: rebuild routing entry
        store.memoryStore.setHost(sessionId, ws.socketId);
        hostToken = existingHostToken;
      }
    }

    if (!session && !existingHostToken) {
      sessionId = generateUUID();
      hostToken = generateUUID();
      // Redis write + in-memory routing (handled inside createSession)
      session = await store.createSession(sessionId, hostToken, ws, info);
    }

    ws.role = MESSAGE_TYPES.ROLE.HOST;
    ws.sessionId = sessionId;

    safeSend(ws, {
      type: MESSAGE_TYPES.HOST_REGISTERED,
      SESSION_IDENTITY: sessionId,
      hostToken,
    });
    return true;
  }

  // --- PAIRING CODE REQUEST ---
  if (msg.type === MESSAGE_TYPES.PAIRING_KEY_REQUEST) {
    if (ws.role !== MESSAGE_TYPES.ROLE.HOST) return true;

    // In-memory: delete old code + set new code (no Redis)
    store.deletePairCode(ws.sessionId);

    const code = generatePairCode();
    const ttl = store.setPairCode(code, ws.sessionId);

    safeSend(ws, {
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
      safeSend(ws, { type: MESSAGE_TYPES.PAIR_FAILED });
      return true;
    }

    const { sessionId: pairedSessionId, session } = result;
    const trustToken = generateUUID();
    const remoteIdentityId = generateUUID();

    const identity = {
      id: remoteIdentityId,
      sessionId: pairedSessionId,
      socketId: ws.socketId,
      expiresAt: t + TOKEN_TTL_MS,
      revoked: false,
      trustToken,
    };

    // Redis write: persist remote identity
    await store.registerRemote(trustToken, identity);

    // Attach socket + populate routing map + persist membership
    await attachRemoteSocket(ws, identity, trustToken, pairedSessionId, session, store);

    safeSend(ws, {
      type: MESSAGE_TYPES.PAIR_SUCCESS,
      trustToken,
      sessionId: pairedSessionId,
      hostInfo: {
        os: session.hostOS,
        browser: session.hostBrowser,
        extensionVersion: session.hostExtensionVersion,
      },
    });
    return true;
  }

  // --- SESSION VALIDATION (Remote reconnecting) ---
  if (msg.type === MESSAGE_TYPES.VALIDATE_SESSION) {
    const { trustToken } = msg;

    // Redis read: validate remote identity (security)
    const identity = await store.getRemote(trustToken);

    if (!identity || identity.revoked || t > identity.expiresAt) {
      safeSend(ws, { type: MESSAGE_TYPES.SESSION_INVALID });
      return true;
    }

    // Redis read: validate session exists + get host info
    const session = await store.getSession(identity.sessionId);
    if (!session) {
      safeSend(ws, { type: MESSAGE_TYPES.SESSION_INVALID });
      return true;
    }

    // Redis write: update socketId + persist membership
    await store.updateRemote(trustToken, { socketId: ws.socketId });

    // Attach socket + populate routing map
    await attachRemoteSocket(ws, identity, trustToken, identity.sessionId, session, store);

    safeSend(ws, {
      type: MESSAGE_TYPES.SESSION_VALID,
      sessionId: identity.sessionId,
      hostInfo: {
        os: session.hostOS,
        browser: session.hostBrowser,
        extensionVersion: session.hostExtensionVersion,
      },
    });
    return true;
  }

  return false;
}

/**
 * Attaches a WebSocket to a known remote identity and notifies the host.
 * Session is passed in to avoid a redundant Redis fetch.
 */
async function attachRemoteSocket(ws, identity, trustToken, sessionId, session, store) {
  // Close old socket if still connected
  const existingWs = store.memoryStore.getRemoteSocket(sessionId, identity.id);
  if (existingWs && isOpen(existingWs)) {
    existingWs.close(4000, "Session superseded");
    logger.warn(`Closed ghost remote for ${sessionId} with remoteId ${identity.id}`);
  }

  ws.role = MESSAGE_TYPES.ROLE.REMOTE;
  ws.sessionId = sessionId;
  ws.remoteIdentityId = identity.id;
  ws.trustToken = trustToken;

  // In-memory routing + Redis persistence
  await store.addRemoteToSession(sessionId, identity.id, trustToken, ws.socketId);

  // Notify host (pure in-memory socket lookup)
  const hostWs = store.memoryStore.getHostSocket(sessionId);
  if (hostWs) {
    safeSend(hostWs, {
      type: MESSAGE_TYPES.REMOTE_JOINED,
      remoteId: identity.id,
    });
  }
}

module.exports = { handleAuth, attachRemoteSocket };
