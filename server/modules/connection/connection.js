const { meta } = require("../../transport/socket");
const { MESSAGE_TYPES } = require("../../shared/constants");
const { generateUUID } = require("../../shared/utils");

/**
 * ConnectionManager — Manages WebSocket connection lifecycle.
 *
 * Responsible for initializing socket metadata, registering sockets
 * in the SocketRegistry, and handling disconnect/error events.
 */
class ConnectionManager {
  /**
   * @param {import("../../lib/socket-registry")} socketRegistry
   * @param {import("../../lib/memory-store")} memoryStore
   */
  constructor(socketRegistry, memoryStore) {
    this.socketRegistry = socketRegistry;
    this.memoryStore = memoryStore;
  }

  /**
   * Initializes all metadata on a freshly opened WebSocket
   * and registers it in the SocketRegistry.
   */
  attach(ws) {
    const socketId = generateUUID();
    const data = meta(ws);

    data.socketId = socketId;
    data.role = null;
    data.sessionId = null;
    data.remoteIdentityId = null;
    data.lastSeenAt = Date.now();
    data.trustToken = null;

    this.socketRegistry.register(socketId, ws);
  }

  /**
   * Handles disconnection (called on 'close' event).
   * Cleans up SocketRegistry + MemoryStore + delegates to SessionStore for persistence.
   */
  async onClose(ws, store) {
    const data = meta(ws);

    // Remove from socket registry
    this.socketRegistry.remove(data.socketId);

    if (data.role === MESSAGE_TYPES.ROLE.HOST) {
      await store.handleHostDisconnect(ws);
    }

    if (data.role === MESSAGE_TYPES.ROLE.REMOTE) {
      this.memoryStore.removeRemote(data.sessionId, data.remoteIdentityId);
      await store.removeRemoteFromSession(data.sessionId, data.remoteIdentityId);
    }
  }
}

module.exports = ConnectionManager;
