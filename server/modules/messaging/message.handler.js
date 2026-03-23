const { meta, send, publish } = require("../../transport/socket");
const { MESSAGE_TYPES } = require("../../shared/constants");

/**
 * Routes a post-auth message to the correct recipient.
 * Pure in-memory — 0 Redis ops.
 *
 * Remote → Host: forwards the message with the remoteId stamped on it.
 * Host → Remote(s): sends to a specific remote or broadcasts to all.
 *
 * @param {import("uWebSockets.js").WebSocket} ws
 * @param {object} msg
 * @param {import("../../lib/memory-store")} memoryStore
 */
function routeMessage(ws, msg, memoryStore) {
  const data = meta(ws);

  // Remote -> Host
  if (data.role === MESSAGE_TYPES.ROLE.REMOTE) {
    const hostWs = memoryStore.getHostSocket(data.sessionId);
    if (hostWs) {
      send(hostWs, {
        ...msg,
        remoteId: data.remoteIdentityId,
      });
    }
    return;
  }

  // Host -> Remote(s)
  if (data.role === MESSAGE_TYPES.ROLE.HOST) {
    if (msg.remoteId) {
      // Target a specific remote
      const remoteWs = memoryStore.getRemoteSocket(data.sessionId, msg.remoteId);
      if (remoteWs) {
        send(remoteWs, msg);
      }
    } else {
      // Broadcast to all remotes via uWS pub/sub
      publish(`session:${data.sessionId}`, msg);
    }
  }
}

module.exports = { routeMessage };
