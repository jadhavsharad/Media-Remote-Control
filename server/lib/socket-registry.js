/**
 * SocketRegistry — In-memory WebSocket reference store.
 *
 * WebSocket objects cannot be serialized to Redis, so this registry
 * maintains a live mapping of socketId → WebSocket instance.
 * All persistent data (sessions, identities) lives in Redis and
 * references sockets via socketId.
 */
class SocketRegistry {
  constructor() {
    this.sockets = new Map(); // socketId → WebSocket
  }

  /**
   * Registers a WebSocket under the given socketId.
   *
   * @param {string} socketId
   * @param {WebSocket} ws
   */
  register(socketId, ws) {
    this.sockets.set(socketId, ws);
  }

  /**
   * Retrieves a WebSocket by its socketId.
   *
   * @param {string} socketId
   * @returns {WebSocket|undefined}
   */
  get(socketId) {
    return this.sockets.get(socketId);
  }

  /**
   * Removes a WebSocket from the registry.
   *
   * @param {string} socketId
   */
  remove(socketId) {
    this.sockets.delete(socketId);
  }

  /**
   * Returns the number of registered sockets.
   *
   * @returns {number}
   */
  get size() {
    return this.sockets.size;
  }
}

module.exports = SocketRegistry;
