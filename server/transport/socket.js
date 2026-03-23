/**
 * transport/socket.js — Thin helpers isolating uWS socket API.
 *
 * Every module uses these instead of calling uWS methods directly.
 * If the transport ever changes again, only this file needs updating.
 */

/** @type {import("uWebSockets.js").TemplatedApp} */
let _app = null;

/**
 * Stores the uWS app reference for app-level publish.
 * Called once during boot.
 */
function setApp(app) {
  _app = app;
}

/**
 * Returns the metadata object attached to a uWS socket.
 * Properties (socketId, role, sessionId, etc.) live here.
 *
 * @param {import("uWebSockets.js").WebSocket} ws
 * @returns {object}
 */
function meta(ws) {
  return ws.getUserData();
}

/**
 * Sends a JSON payload over a uWS socket.
 *
 * @param {import("uWebSockets.js").WebSocket} ws
 * @param {object} payload
 */
function send(ws, payload) {
  try {
    ws.send(JSON.stringify(payload), false);
  } catch {
    // Socket already closed — safe to ignore
  }
}

/**
 * Graceful close — sends a WebSocket close frame with code + reason.
 *
 * @param {import("uWebSockets.js").WebSocket} ws
 * @param {number} code
 * @param {string} [reason]
 */
function close(ws, code, reason) {
  try {
    ws.end(code, reason);
  } catch {
    // Already closed
  }
}

/**
 * Force close — no close frame sent, immediate teardown.
 *
 * @param {import("uWebSockets.js").WebSocket} ws
 */
function terminate(ws) {
  try {
    ws.close();
  } catch {
    // Already closed
  }
}

/**
 * Subscribes a socket to a topic (uWS native pub/sub).
 *
 * @param {import("uWebSockets.js").WebSocket} ws
 * @param {string} topic
 */
function subscribe(ws, topic) {
  ws.subscribe(topic);
}

/**
 * Publishes a JSON payload to all subscribers of a topic.
 * Uses app-level publish so it works even when the sender socket is closing.
 *
 * @param {string} topic
 * @param {object} payload
 */
function publish(topic, payload) {
  _app.publish(topic, JSON.stringify(payload), false);
}

module.exports = { setApp, meta, send, close, terminate, subscribe, publish };
