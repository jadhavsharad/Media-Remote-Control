const crypto = require("crypto");
const { MESSAGE_TYPES, MEDIA_STATE } = require("./constants");
const { RATE_LIMIT_MS } = require("../config");

function generateUUID() {
  return crypto.randomUUID();
}

function generatePairCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function now() {
  return Date.now();
}

function isValidMessage(msg) {
  if (!msg || typeof msg !== "object") return false;
  // Basic validation that type exists in our protocol
  const allTypes = [...Object.values(MESSAGE_TYPES), ...Object.values(MEDIA_STATE)].filter(v => typeof v === 'string');
  return allTypes.includes(msg.type);
}

/**
 * Rate limiter — operates on a metadata object (from meta(ws)).
 *
 * @param {object} data - The socket metadata object
 * @returns {boolean} true if rate-limited
 */
function isRateLimited(data) {
  const t = now();
  if (t - (data.lastSeenAt || 0) < RATE_LIMIT_MS) return true;
  data.lastSeenAt = t;
  return false;
}

module.exports = {
  generateUUID,
  generatePairCode,
  now,
  isValidMessage,
  isRateLimited
};
