const { meta } = require("../../transport/socket");
const { close: closeSocket } = require("../../transport/socket");
const { MESSAGE_TYPES } = require("../../shared/constants");
const { isValidMessage, isRateLimited } = require("../../shared/utils");
const { handleAuth } = require("../auth/auth.handler");
const { routeMessage } = require("./message.handler");
const logger = require("../../shared/logger");

/**
 * MessageRouter — Central message router.
 *
 * Pipeline: parse → validate → auth check → session integrity → rate limit → route.
 *
 * Session integrity and message routing are pure in-memory operations.
 * Auth messages are the only path that touches Redis.
 */
class MessageRouter {
  /**
   * @param {import("../../lib/memory-store")} memoryStore
   */
  constructor(memoryStore) {
    this.memoryStore = memoryStore;
  }

  /**
   * Processes a raw incoming WebSocket message string.
   */
  async handle(ws, raw, store) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    
    if (!isValidMessage(msg)) {
      logger.fatal("Invalid message", msg);
      return;
    }
    
    // Auth messages hit Redis (security) and short-circuit
    if (await handleAuth(ws, msg, store)) return;
    
    // Session integrity — pure in-memory
    if (!this._verifySession(ws)) {
      logger.fatal("Session integrity check failed");
      return;
    }
    
    // Rate limiting
    const data = meta(ws);
    if (data.sessionId && isRateLimited(data)) {
      logger.warn("Rate limiting");
      logger.fatal(msg.type + " - Dropped")
      return;
    }

    // Route to recipient — pure in-memory
    routeMessage(ws, msg, this.memoryStore);
  }

  /**
   * Ensures the socket is correctly bound to a valid session.
   * Pure in-memory check — 0 Redis ops.
   */
  _verifySession(ws) {
    const data = meta(ws);

    if (data.role === MESSAGE_TYPES.ROLE.HOST) {
      if (!this.memoryStore.isHostValid(data.sessionId, data.socketId)) {
        logger.warn("[Host Desync] Killing Socket");
        closeSocket(ws, 4000, "Session desync");
        return false;
      }
    }

    if (data.role === MESSAGE_TYPES.ROLE.REMOTE) {
      if (!this.memoryStore.isRemoteValid(data.sessionId, data.remoteIdentityId, data.socketId)) {
        logger.warn("[Remote Desync] Killing Socket");
        closeSocket(ws, 4000, "Session desync");
        return false;
      }
    }

    return true;
  }
}

module.exports = MessageRouter;
