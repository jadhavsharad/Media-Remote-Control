const { MESSAGE_TYPES } = require("./constants");

/**
 * Manages WebSocket connection lifecycle.
 * Responsible for initializing socket metadata and handling disconnect/error events.
 */
class ConnectionManager {
  /**
   * Initializes all metadata on a freshly opened WebSocket.
   * @param {WebSocket} ws
   */
  attach(ws) {
    ws.isAlive = true;
    ws.role = null;
    ws.sessionId = null;
    ws.remoteIdentityId = null;
    ws.lastSeenAt = Date.now();
    ws.trustToken = null;
  }

  /**
   * Handles host disconnection (called on both 'close' and 'error' events).
   * @param {WebSocket} ws
   * @param {SessionStore} store
   */
  onClose(ws, store) {
    if (ws.role === MESSAGE_TYPES.ROLE.HOST) {
      store.handleHostDisconnect(ws);
    }
  }
}

module.exports = new ConnectionManager();
