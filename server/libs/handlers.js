/**
 * handlers.js — Compatibility re-export.
 *
 * Auth and routing concerns have been split into dedicated modules:
 *   - ./auth.handler   → handleAuth, attachRemoteSocket
 *   - ./message.handler → routeMessage
 *
 * This file keeps the old public surface intact for any existing consumers.
 */
const { handleAuth, attachRemoteSocket } = require("./auth.handler");
const { routeMessage } = require("./message.handler");

module.exports = { handleAuth, attachRemoteSocket, routeMessage };