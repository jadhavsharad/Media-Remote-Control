const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");
const PROTOCOL = require("./constants.js");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PAIR_CODE_TTL_MS = 60 * 1000; // 60s
const TRUST_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RATE_LIMIT_MS = 400;
const CLEANUP_INTERVAL_MS = 30_000;

const hostSessions = new Map();
const pairCodes = new Map();
const trustTokens = new Map();

function generateUUID() {
  return crypto.randomUUID();
}

function generatePairCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function now() {
  return Date.now();
}

function isOpen(ws) {
  return ws.readyState === WebSocket.OPEN;
}

function isValidMessage(msg) {
  if (!msg || typeof msg !== "object") return false;

  const ALL_TYPES = [
    ...Object.values(PROTOCOL.SESSION),
    ...Object.values(PROTOCOL.CONTROL),
    ...Object.values(PROTOCOL.MEDIA),
  ];

  return ALL_TYPES.includes(msg.type);
}

setInterval(() => {
  const t = now();
  for (const [code, sessionId] of pairCodes.entries()) {
    const session = hostSessions.get(sessionId);
    if (!session || (session.pairCode === code && t > session.pairCodeExpiresAt)) {
      pairCodes.delete(code);
      if (session && session.pairCode === code) {
        session.pairCode = null;
        session.pairCodeExpiresAt = 0;
      }
    }
  }

  for (const [token, data] of trustTokens.entries()) {
    if (t > data.expiresAt) {
      trustTokens.delete(token);
    } else {
      if (!hostSessions.has(data.sessionId)) {
        trustTokens.delete(token);
      }
    }
  }

  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      cleanupSocket(ws);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, CLEANUP_INTERVAL_MS);

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.role = null;
  ws.sessionId = null;
  ws.remoteId = null;
  ws.deviceId = null;
  ws.lastSeenAt = 0;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!isValidMessage(msg)) return;
    if (handleAuth(ws, msg)) return;
    if (ws.sessionId && isRateLimited(ws)) return;

    routeMessage(ws, msg);
  });

  ws.on("close", () => cleanupSocket(ws));
  ws.on("error", () => cleanupSocket(ws));
  ws.on("pong", () => ws.isAlive = true);
});

function isRateLimited(ws) {
  const t = now();
  if (t - ws.lastSeenAt < RATE_LIMIT_MS) return true;
  ws.lastSeenAt = t;
  return false;
}

function handleAuth(ws, msg) {
  const t = now();

  if (msg.type === PROTOCOL.SESSION.REGISTER_HOST) {
    const sessionId = generateUUID();
    ws.role = PROTOCOL.ROLE.HOST;
    ws.sessionId = sessionId;

    hostSessions.set(sessionId, {
      socket: ws,
      remotes: new Set(),
      pairCode: null,
      pairCodeExpiresAt: 0
    });

    ws.send(JSON.stringify({
      type: PROTOCOL.SESSION.HOST_REGISTERED,
      SESSION_IDENTITY: sessionId
    }));
    return true;
  }

  if (msg.type === PROTOCOL.SESSION.REQUEST_PAIR_CODE) {
    if (ws.role !== PROTOCOL.ROLE.HOST || !ws.sessionId) return true;

    const session = hostSessions.get(ws.sessionId);
    if (!session) return true;

    if (session.pairCode && pairCodes.has(session.pairCode)) {
      pairCodes.delete(session.pairCode);
    }

    const code = generatePairCode();
    session.pairCode = code;
    session.pairCodeExpiresAt = t + PAIR_CODE_TTL_MS;
    pairCodes.set(code, ws.sessionId);

    ws.send(JSON.stringify({
      type: PROTOCOL.SESSION.PAIR_CODE,
      code,
      ttl: PAIR_CODE_TTL_MS
    }));
    return true;
  }

  if (msg.type === PROTOCOL.SESSION.EXCHANGE_PAIR_CODE) {
    const { code, deviceId } = msg;
    const sessionId = pairCodes.get(code);
    if (!sessionId) {
      ws.send(JSON.stringify({
        type: PROTOCOL.SESSION.PAIR_FAILED,
        reason: "INVALID_CODE"
      }));
      return true;
    }

    pairCodes.delete(code);

    const session = hostSessions.get(sessionId);
    if (!session) {
      ws.send(JSON.stringify({
        type: PROTOCOL.SESSION.PAIR_FAILED,
        reason: "HOST_NOT_FOUND"
      }));
      return true;
    }


    session.pairCode = null;
    session.pairCodeExpiresAt = 0;

    const trustToken = generateUUID();
    trustTokens.set(trustToken, {
      sessionId,
      deviceId,
      expiresAt: t + TRUST_TOKEN_TTL_MS
    });

    registerRemote(ws, sessionId, deviceId);

    ws.send(JSON.stringify({
      type: PROTOCOL.SESSION.PAIR_SUCCESS,
      trustToken,
      sessionId
    }));

    return true;
  }

  if (msg.type === PROTOCOL.SESSION.VALIDATE_SESSION) {
    const { trustToken, deviceId } = msg;

    const tokenData = trustTokens.get(trustToken);

    if (!tokenData) {
      ws.send(JSON.stringify({ type: PROTOCOL.SESSION.SESSION_INVALID, reason: "TOKEN_NOT_FOUND" }));
      return true;
    }

    if (t > tokenData.expiresAt) {
      trustTokens.delete(trustToken);
      ws.send(JSON.stringify({ type: PROTOCOL.SESSION.SESSION_INVALID, reason: "TOKEN_EXPIRED" }));
      return true;
    }

    if (!hostSessions.has(tokenData.sessionId)) {
      trustTokens.delete(trustToken);
      ws.send(JSON.stringify({ type: PROTOCOL.SESSION.SESSION_INVALID, reason: "HOST_NOT_FOUND" }));
      return true;
    }

    // Optional: Device ID mismatch check
    // if (tokenData.deviceId !== deviceId) ... 

    registerRemote(ws, tokenData.sessionId, deviceId);

    ws.send(JSON.stringify({
      type: PROTOCOL.SESSION.SESSION_VALID,
      sessionId: tokenData.sessionId
    }));
    return true;
  }

  return false;
}

function registerRemote(ws, sessionId, deviceId) {
  const session = hostSessions.get(sessionId);
  if (!session) return;

  const remoteId = generateUUID();
  ws.role = PROTOCOL.ROLE.REMOTE;
  ws.sessionId = sessionId;
  ws.remoteId = remoteId;
  ws.deviceId = deviceId;

  session.remotes.add(ws);

  if (isOpen(session.socket)) {
    session.socket.send(JSON.stringify({
      type: PROTOCOL.SESSION.REMOTE_JOINED,
      remoteId,
      deviceId
    }));
  }
}

function routeMessage(ws, msg) {
  const session = hostSessions.get(ws.sessionId);
  if (!session) return;

  if (ws.role === PROTOCOL.ROLE.REMOTE) {
    if (isOpen(session.socket)) {
      session.socket.send(JSON.stringify({
        ...msg,
        remoteId: ws.remoteId
      }));
    }
  }

  if (ws.role === PROTOCOL.ROLE.HOST) {
    if (msg.remoteId) {
      for (const remote of session.remotes) {
        if (remote.remoteId === msg.remoteId && isOpen(remote)) {
          remote.send(JSON.stringify(msg));
          break;
        }
      }
    } else {
      for (const remote of session.remotes) {
        if (isOpen(remote)) {
          remote.send(JSON.stringify(msg));
        }
      }
    }
  }
}

function cleanupSocket(ws) {
  if (ws.role === PROTOCOL.ROLE.HOST) {
    const session = hostSessions.get(ws.sessionId);
    if (session) {
      for (const remote of session.remotes) {
        if (isOpen(remote)) {
          remote.send(JSON.stringify({ type: PROTOCOL.SESSION.HOST_DISCONNECTED }));
          remote.close();
        }
      }

      for (const [token, data] of trustTokens.entries()) {
        if (data.sessionId === ws.sessionId) {
          trustTokens.delete(token);
        }
      }

      hostSessions.delete(ws.sessionId);
    }
  }


  if (ws.role === PROTOCOL.ROLE.REMOTE) {
    if (ws.sessionId) {
      const session = hostSessions.get(ws.sessionId);
      if (session) {
        session.remotes.delete(ws);
      }
    }
  }
}

app.get("/", (_, res) => res.send("Secure Server Running"));

server.listen(3001, () => {
  console.log("🚀 Secure server listening on :3001");
});
