const { MESSAGE_TYPES } = require("../../shared/constants");
const { safeSend } = require("../../shared/utils");

/**
 * Routes a post-auth message to the correct recipient.
 * Pure in-memory — 0 Redis ops.
 *
 * Remote → Host: forwards the message with the remoteId stamped on it.
 * Host → Remote(s): sends to a specific remote or broadcasts to all.
 *
 * @param {WebSocket} ws
 * @param {object} msg
 * @param {import("../../lib/memory-store")} memoryStore
 */
function routeMessage(ws, msg, memoryStore) {
  // Remote -> Host
  if (ws.role === MESSAGE_TYPES.ROLE.REMOTE) {
    const hostWs = memoryStore.getHostSocket(ws.sessionId);
    if (hostWs) {
      safeSend(hostWs, {
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
      const remoteWs = memoryStore.getRemoteSocket(ws.sessionId, msg.remoteId);
      if (remoteWs) {
        safeSend(remoteWs, msg);
      }
    } else {
      // Broadcast to all remotes
      const remoteSockets = memoryStore.getAllRemoteSockets(ws.sessionId);
      for (const remoteWs of remoteSockets.values()) {
        safeSend(remoteWs, msg);
      }
    }
  }
}

module.exports = { routeMessage };
