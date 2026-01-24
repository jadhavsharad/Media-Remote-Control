/* -------------------- MESSAGE TYPES -------------------- */
export const MESSAGE_TYPES = {
  // init / pairing
  PAIRING_KEY: "init.pairing_key",
  EXCHANGE_PAIR_KEY: "init.exchange_pair_key",
  PAIR_SUCCESS: "init.pair_success",
  PAIR_FAILED: "init.pair_failed",

  // session
  VALIDATE_SESSION: "session.validate",
  SESSION_VALID: "session.valid",
  SESSION_INVALID: "session.invalid",
  REMOTE_JOINED: "session.remote_joined",
  HOST_DISCONNECTED: "session.host_disconnected",
  HOST_RECONNECTED: "session.host_reconnected",

  // connection
  BLOCKED: "Blocked",
  CONNECTING: "Connecting",
  DISCONNECTED: "Disconnected",
  CONNECTED: "Connected",
  VERIFYING: "Verifying",
  WAITING: "Waiting",

  // media
  MEDIA_LIST: "media.list",
  SELECT_ACTIVE_TAB: "media.select_tab",

  // controls
  STATE_UPDATE: "control.state_update",
  INTENT: {
    SET: "control.set",
    REPORT: "control.report"
  },

  // script
  SCRIPT_INJECTION_FAIL: "script.injection.failed",
  REINJECTION_FAILED: "script.reinjection.failed" // For popup
};


export const MEDIA_STATE = {
  PLAYBACK: "playback",       // values: "PLAYING", "PAUSED"
  MUTE: "muted",              // values: true, false
  TIME: "currentTime",        // values: number (seconds)
  DURATION: "duration",       // values: number (seconds)
  TITLE: "title",             // values: string
};
