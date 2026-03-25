/**
 * index.js — Pure wiring.
 * Imports all modules and connects them. Contains no business logic.
 */
require("dotenv").config();

const uWS = require("uWebSockets.js");

const { PORT } = require("./config");
const { setApp } = require("./transport/socket");
const redisClient = require("./lib/redis");
const SocketRegistry = require("./lib/socket-registry");
const MemoryStore = require("./lib/memory-store");
const SessionStore = require("./modules/session/store");
const ConnectionManager = require("./modules/connection/connection");
const MessageRouter = require("./modules/messaging/router");
const logger = require("./shared/logger");

/**
 * Boots the server: connects to Redis, wires dependencies, starts uWS.
 */
async function boot() {
  // 1. Connect to Upstash Redis
  const redis = await redisClient.connect();

  // 2. Create shared instances
  const socketRegistry = new SocketRegistry();
  const memoryStore = new MemoryStore(socketRegistry);
  const store = new SessionStore(redis, memoryStore);
  const connection = new ConnectionManager(socketRegistry, memoryStore);
  const router = new MessageRouter(memoryStore);

  // 3. Create uWS app with WebSocket + HTTP routes
  const app = uWS.App();
  setApp(app);

  app.ws("/*", {
    idleTimeout: 60,
    maxPayloadLength: 64 * 1024,

    open: (ws) => {
      connection.attach(ws);
      logger.debug("Client connected");
    },

    message: (ws, message) => {
      const raw = Buffer.from(message).toString();
      router.handle(ws, raw, store);
    },

    close: (ws) => {
      connection.onClose(ws, store);
      logger.warn("Client disconnected");
    },
  })
    .get("/ping", (res) => {
      logger.info("Ping");
      res.end("pong");
    })
    .get("/", (res) => {
      res.end("Secure Server Running");
    })
    .listen(PORT, (listenSocket) => {
      if (listenSocket) {
        logger.info(`🚀 Secure server listening on: ${PORT}`);
      } else {
        logger.error(`❌ Failed to listen on port ${PORT}`);
        process.exit(1);
      }
    });
}

if (require.main === module) {
  boot().catch((err) => {
    console.error("❌ Server failed to start:", err);
    process.exit(1);
  });
}

module.exports = { boot };
