const { MESSAGE_TYPES } = require("./constants");
const { safeSend } = require("./utils");

/**
 * Routes a post-auth message to the correct recipient.
 *
 * Remote → Host: forwards the message with the remoteId stamped on it.
 * Host → Remote(s): sends to a specific remote (if msg.remoteId) or broadcasts to all.
 *
 * @param {WebSocket} ws
 * @param {object} msg
 * @param {SessionStore} store
 */
function routeMessage(ws, msg, store) {
  const session = store.getSession(ws.sessionId);
  if (!session) return;

  // Remote -> Host
  if (ws.role === MESSAGE_TYPES.ROLE.REMOTE) {
    if (session.socket) {
      safeSend(session.socket, {
        ...msg,
        remoteId: ws.remoteIdentityId,
      });
    }
    return;
  }

  // Host -> Remote(s)
  if (ws.role === MESSAGE_TYPES.ROLE.HOST) {
    if (msg.remoteId) {
      // Target a specific remote
      const identity = session.remotes.get(msg.remoteId);
      if (identity && identity.socket) {
        safeSend(identity.socket, msg);
      }
    } else {
      // Broadcast to all remotes
      for (const identity of session.remotes.values()) {
        if (identity.socket) safeSend(identity.socket, msg);
      }
    }
  }
}

module.exports = { routeMessage };
