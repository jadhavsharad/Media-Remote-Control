/**
 * index.js — Pure wiring.
 * Imports all modules and connects them. Contains no business logic.
 */
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const SessionStore = require("./libs/store");
const connection = require("./libs/connection");
const router = require("./libs/router");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

// Initialize store
const store = new SessionStore(wss);

wss.on("connection", (ws) => {
  connection.attach(ws);

  ws.on("message", (raw) => router.handle(ws, raw, store));

  ws.on("close", () => connection.onClose(ws, store));

  ws.on("error", () => connection.onClose(ws, store));
});

app.get("/ping", (req, res) => res.status(200).send("pong"));

app.get("/", (_, res) => res.send("Secure Server Running"));

if (require.main === module) {
  server.listen(PORT, () => console.log("🚀 Secure server listening on: ", PORT));
}

module.exports = { server, app, wss };
