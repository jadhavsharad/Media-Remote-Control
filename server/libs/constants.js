/* -------------------- MESSAGE TYPES -------------------- */
const MESSAGE_TYPES = {
  // init / pairing
  HOST_REGISTER: "init.host_register",
  HOST_REGISTERED: "init.host_registered",
  PAIRING_KEY_REQUEST: "init.pairing_key_request",
  PAIRING_KEY: "init.pairing_key",
  PAIRING_KEY_VALID: "init.pairing_key_valid",
  EXCHANGE_PAIR_KEY: "init.exchange_pair_key",
  PAIR_SUCCESS: "init.pair_success",
  PAIR_FAILED: "init.pair_failed",

  // session
  VALIDATE_SESSION: "session.validate",
  SESSION_VALID: "session.valid",
  SESSION_INVALID: "session.invalid",
  REMOTE_JOINED: "session.remote_joined",
  HOST_DISCONNECTED: "session.host_disconnected",
  HOST_DISCONNECT: "session.host_disconnect",
  HOST_RECONNECTED: "session.host_reconnected",
  HOST_RECONNECT: "session.host_reconnect",
  NEW_TAB: "session.new_tab",

  // connection
  WS_OPEN: "connection.ws_open",
  WS_CLOSED: "connection.ws_closed",
  CONNECT_WS: "connection.connect_ws",
  DISCONNECT_WS: "connection.disconnect_ws",

  // media
  MEDIA_LIST: "media.list",
  SELECT_ACTIVE_TAB: "media.select_tab",

  // controls
  STATE_UPDATE: "control.state_update",
  INTENT: {
    SET: "control.set",
    REPORT: "control.report"
  },

  ROLE: {
    HOST: "HOST",
    REMOTE: "REMOTE",
  }
};

const MEDIA_STATE = {
  PLAYBACK: "playback",
  MUTE: "muted",
  TIME: "currentTime",
  DURATION: "duration",
  TITLE: "title",
};

/* -------------------- TTL CONSTANTS -------------------- */
const PAIR_CODE_TTL_MS = 60 * 1000;                    // 1 minute
const TRUST_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;            // 24 hours
const CLEANUP_INTERVAL_MS = 30_000;                     // 30 seconds

module.exports = {
  MESSAGE_TYPES,
  MEDIA_STATE,
  PAIR_CODE_TTL_MS,
  TRUST_TOKEN_TTL_MS,
  SESSION_TTL_MS,
  CLEANUP_INTERVAL_MS,
};