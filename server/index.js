/**
 * index.js — Pure wiring.
 * Imports all modules and connects them. Contains no business logic.
 */
require("dotenv").config();

const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const { PORT } = require("./config");
const redisClient = require("./lib/redis");
const SocketRegistry = require("./lib/socket-registry");
const MemoryStore = require("./lib/memory-store");
const SessionStore = require("./modules/session/store");
const ConnectionManager = require("./modules/connection/connection");
const MessageRouter = require("./modules/messaging/router");
const logger = require("./shared/logger");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

/**
 * Boots the server: connects to Redis, wires dependencies, attaches handlers.
 */
async function boot() {
  // 1. Connect to Upstash Redis
  const redis = await redisClient.connect();

  // 2. Create shared instances
  const socketRegistry = new SocketRegistry();
  const memoryStore = new MemoryStore(socketRegistry);
  const store = new SessionStore(redis, memoryStore, wss);
  const connection = new ConnectionManager(socketRegistry, memoryStore);
  const router = new MessageRouter(memoryStore);

  // 3. Wire WebSocket events
  wss.on("connection", (ws) => {
    connection.attach(ws);
    logger.silent("Client connected");
    ws.on("message", (raw) => {
      router.handle(ws, raw, store);
    });
    ws.on("close", () => {
      connection.onClose(ws, store);
      logger.warn("Client disconnected");
    });
    ws.on("error", () => {
      connection.onClose(ws, store);
      logger.error("Error in client");
    });
  });

  // 4. HTTP routes
  app.get("/ping", (req, res) => res.status(200).send("pong"));

  app.get("/", (_, res) => res.send("Secure Server Running"));

  // 5. Start listening
  server.listen(PORT, () => logger.info(`🚀 Secure server listening on: ${PORT}`));
}

if (require.main === module) {
  boot().catch((err) => {
    console.error("❌ Server failed to start:", err);
    process.exit(1);
  });
}

module.exports = { server, app, wss };
