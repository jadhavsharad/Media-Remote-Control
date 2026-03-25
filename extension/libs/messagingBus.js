/**
 * messagingBus.js
 * Thin wrappers over chrome.runtime.sendMessage / onMessage.
 * Centralizes channel routing, security checks, and message formatting.
 */
import { CHANNELS, MESSAGE_TYPES } from "./constants.js";
import { ensureOffscreen } from "./offscreenManager.js";

/**
 * Sends a message on the given internal channel.
 * Fire-and-forget — errors (e.g. popup not open) are silently swallowed.
 *
 * @param {string} channel
 * @param {object} payload
 */
export function sendMessage(channel, payload) {
  chrome.runtime.sendMessage({ type: channel, payload }).catch(() => {
    // Expected if no listener is open (e.g. popup closed)
  });
}

/**
 * Registers a handler for messages arriving on a specific channel.
 * Enforces extension-only message origin and content-script tab validation.
 *
 * @param {string} channel
 * @param {Function} handler - (payload, sender, sendResponse) => void | boolean
 */
export function receiveMessage(channel, handler) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Security: only accept messages from our own extension
    if (sender.id !== chrome.runtime.id) return false;

    if (!msg || msg.type !== channel) return false;

    // Content Script: sender must be a real tab
    if (
      channel === CHANNELS.FROM_CONTENT_SCRIPT &&
      (!sender.tab || !sender.tab.id)
    ) {
      return false;
    }

    return handler(msg.payload, sender, sendResponse);
  });
}

/**
 * Forwards a message to the server via the offscreen document.
 * Blocks non-registration messages when the host is not yet connected.
 *
 * @param {object} payload
 * @param {StateManager} state
 */
export async function sendToServer(payload, state) {
  const connected = state.get("connected");
  if (!connected && payload.type !== MESSAGE_TYPES.HOST_REGISTER) return;

  await ensureOffscreen();
  sendMessage(CHANNELS.FROM_BACKGROUND, payload);
}
