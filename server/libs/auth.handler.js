const { MESSAGE_TYPES, TRUST_TOKEN_TTL_MS } = require("./constants");
const { generateUUID, generatePairCode, now, safeSend, isOpen } = require("./utils");

/**
 * Handles all authentication-phase messages.
 * Returns true if the message was consumed (auth message), false otherwise.
 *
 * @param {WebSocket} ws
 * @param {object} msg
 * @param {SessionStore} store
 * @returns {boolean}
 */
function handleAuth(ws, msg, store) {
  const t = now();

  // --- HOST REGISTRATION ---
  if (msg.type === MESSAGE_TYPES.HOST_REGISTER) {
    if (ws.role === MESSAGE_TYPES.ROLE.REMOTE) {
      ws.terminate();
      return true;
    }

    const { hostToken: existingHostToken, info } = msg;
    let sessionId, session, hostToken;

    if (existingHostToken) {
      session = store.getSessionByHostToken(existingHostToken);
      if (session) {
        sessionId = store.hostTokenMap.get(existingHostToken);
        console.log(`[RECOVERY] Host re-connected to session ${sessionId}`);

        if (session.socket && isOpen(session.socket)) {
          if (session.socket !== ws) {
            console.warn(`[STRICT] Closing ghost host for ${sessionId}`);
            session.socket.close();
          }
        }

        session.socket = ws;
        session.hostDisconnectedAt = null;
        hostToken = existingHostToken;
      }
    }

    if (!session) {
      sessionId = generateUUID();
      hostToken = generateUUID();
      console.log(`[NEW] Created new host session ${sessionId}`);
      session = store.createSession(sessionId, hostToken, ws, info);
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

    const session = store.getSession(ws.sessionId);
    if (!session) return true;

    // Remove old code if exists
    if (session.pairCode) store.pairCodes.delete(session.pairCode);

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
    const session = store.resolvePairCode(code);

    if (!session) {
      safeSend(ws, { type: MESSAGE_TYPES.PAIR_FAILED });
      return true;
    }

    const trustToken = generateUUID();
    const remoteIdentityId = generateUUID();

    const identity = {
      id: remoteIdentityId,
      sessionId: store.hostTokenMap.get(session.hostToken),
      socket: null,
      expiresAt: t + TRUST_TOKEN_TTL_MS,
      revoked: false,
      trustToken,
    };

    store.registerRemote(trustToken, identity);
    attachRemoteSocket(ws, identity, trustToken, store);

    safeSend(ws, {
      type: MESSAGE_TYPES.PAIR_SUCCESS,
      trustToken,
      sessionId: identity.sessionId,
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
    const identity = store.getRemote(trustToken);

    if (!identity || identity.revoked || t > identity.expiresAt) {
      safeSend(ws, { type: MESSAGE_TYPES.SESSION_INVALID });
      return true;
    }

    const session = store.getSession(identity.sessionId);
    if (!session) {
      safeSend(ws, { type: MESSAGE_TYPES.SESSION_INVALID });
      return true;
    }

    attachRemoteSocket(ws, identity, trustToken, store);

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
 *
 * @param {WebSocket} ws
 * @param {object} identity
 * @param {string} trustToken
 * @param {SessionStore} store
 */
function attachRemoteSocket(ws, identity, trustToken, store) {
  if (identity.socket && isOpen(identity.socket)) {
    identity.socket.close();
  }
  identity.socket = ws;

  ws.role = MESSAGE_TYPES.ROLE.REMOTE;
  ws.sessionId = identity.sessionId;
  ws.remoteIdentityId = identity.id;
  ws.trustToken = trustToken;

  const session = store.getSession(identity.sessionId);
  if (session) {
    session.remotes.set(identity.id, identity);
    if (session.socket) {
      safeSend(session.socket, {
        type: MESSAGE_TYPES.REMOTE_JOINED,
        remoteId: identity.id,
      });
    }
  }
}

module.exports = { handleAuth, attachRemoteSocket };
