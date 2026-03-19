const { MESSAGE_TYPES } = require("./constants");
const { isValidMessage, isRateLimited } = require("./utils");
const { handleAuth } = require("./auth.handler");
const { routeMessage } = require("./message.handler");

/**
 * Central message router.
 * Pipeline: parse → validate → auth check → session integrity → rate limit → route.
 */
class MessageRouter {
  /**
   * Processes a raw incoming WebSocket message buffer.
   *
   * @param {WebSocket} ws
   * @param {Buffer|string} raw
   * @param {SessionStore} store
   */
  handle(ws, raw, store) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // Ignore malformed messages
    }

    if (!isValidMessage(msg)) return;

    // Auth messages are handled first and short-circuit the pipeline
    if (handleAuth(ws, msg, store)) return;

    // Session integrity check
    if (!this._verifySession(ws, store)) return;

    // Rate limiting
    if (ws.sessionId && isRateLimited(ws)) return;

    // Route to the correct recipient
    routeMessage(ws, msg, store);
  }

  /**
   * Ensures the socket is correctly bound to a valid, consistent session.
   * Kills the socket if a desync is detected.
   *
   * @param {WebSocket} ws
   * @param {SessionStore} store
   * @returns {boolean} true if the session is valid
   */
  _verifySession(ws, store) {
    const session = store.getSession(ws.sessionId);

    if (!session || (session.socket !== ws && ws.role === MESSAGE_TYPES.ROLE.HOST)) {
      console.warn("[Host Desync] Killing Socket");
      ws.close();
      return false;
    }

    if (ws.role === MESSAGE_TYPES.ROLE.REMOTE) {
      const identity = store.getRemote(ws.trustToken);
      if (!identity || identity.socket !== ws) {
        console.warn("[Remote Desync] Killing Socket");
        ws.close();
        return false;
      }
    }

    return true;
  }
}

module.exports = new MessageRouter();
