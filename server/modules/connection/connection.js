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

    ws.socketId = socketId;
    ws.isAlive = true;
    ws.role = null;
    ws.sessionId = null;
    ws.remoteIdentityId = null;
    ws.lastSeenAt = Date.now();
    ws.trustToken = null;

    this.socketRegistry.register(socketId, ws);
  }

  /**
   * Handles disconnection (called on both 'close' and 'error' events).
   * Cleans up SocketRegistry + MemoryStore + delegates to SessionStore for persistence.
   */
  async onClose(ws, store) {
    // Remove from socket registry
    this.socketRegistry.remove(ws.socketId);

    if (ws.role === MESSAGE_TYPES.ROLE.HOST) {
      await store.handleHostDisconnect(ws);
    }

    if (ws.role === MESSAGE_TYPES.ROLE.REMOTE) {
      this.memoryStore.removeRemote(ws.sessionId, ws.remoteIdentityId);
    }
  }
}

module.exports = ConnectionManager;
