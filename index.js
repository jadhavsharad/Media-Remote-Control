const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });


app.get("/", (req, res) => {
  res.send("Server running");
});

wss.on("connection", (ws) => {
  console.log("✅ WS client connected");

  ws.on("message", (msg) => {
    console.log("📩", msg.toString());

    // broadcast to all connected clients
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg.toString());
      }
    });
  });
});


server.listen(3000, () => {
  console.log("🚀 Server listening on http://localhost:3000");
});
