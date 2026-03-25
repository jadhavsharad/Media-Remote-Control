/**
 * commandRegistry.js
 * Defines and executes media control commands received from the remote.
 *
 * To add a new control (e.g. subtitle toggle), just add a handler to COMMAND_REGISTRY.
 */
import { MEDIA_STATE, MESSAGE_TYPES } from "./constants.js";
import { sendToTabSafe } from "./tabManager.js";

/**
 * Map of MEDIA_STATE keys to their executor functions.
 * Each handler receives (tabId, value) and returns the confirmed value (or undefined).
 */
export const COMMAND_REGISTRY = {
  /** Mute: handled via the chrome.tabs API (bypasses content script) */
  [MEDIA_STATE.MUTE]: async (tabId, value) => {
    await chrome.tabs.update(tabId, { muted: value });
    const updatedTab = await chrome.tabs.get(tabId);
    return updatedTab.mutedInfo?.muted ?? value;
  },

  /** Playback: delegated to the content script */
  [MEDIA_STATE.PLAYBACK]: async (tabId, value) =>
    sendToTabSafe(tabId, {
      type: MESSAGE_TYPES.STATE_UPDATE,
      intent: MESSAGE_TYPES.INTENT.SET,
      key: MEDIA_STATE.PLAYBACK,
      value,
    }),

  /** Seek: delegated to the content script */
  [MEDIA_STATE.TIME]: async (tabId, value) =>
    sendToTabSafe(tabId, {
      type: MESSAGE_TYPES.STATE_UPDATE,
      intent: MESSAGE_TYPES.INTENT.SET,
      key: MEDIA_STATE.TIME,
      value,
    }),

  /** Volume: delegated to the content script */
  [MEDIA_STATE.VOLUME]: async (tabId, value) =>
    sendToTabSafe(tabId, {
      type: MESSAGE_TYPES.STATE_UPDATE,
      intent: MESSAGE_TYPES.INTENT.SET,
      key: MEDIA_STATE.VOLUME,
      value,
    }),
};

/**
 * Validates context and dispatches a command from the registry.
 * Handles missing remoteId context, stale tabIds, and unknown keys gracefully.
 *
 * @param {object} msg - The incoming server message ({ remoteId, key, value })
 * @param {StateManager} state
 * @param {Function} validateTab
 */
export async function executeRemoteCommand(msg, state, validateTab) {
  const { remoteId, key, value } = msg;

  // 1. Validate that the remote has an active tab context
  const ctx = state.getRemoteContext(remoteId);
  if (!ctx || !ctx.tabId) {
    console.warn(`Command ignored: No active tab for remote ${remoteId}`);
    return;
  }

  // 2. Validate that the tab still exists
  if (!(await validateTab(ctx.tabId))) {
    console.warn(`Command ignored: Tab ${ctx.tabId} is gone.`);
    await state.updateRemoteContext(remoteId, { tabId: null });
    return;
  }

  // 3. Dispatch to the registered handler
  const handler = COMMAND_REGISTRY[key];
  if (handler) {
    try {
      await handler(ctx.tabId, value);
    } catch (err) {
      console.error("Command execution failed:", err);
    }
  } else {
    console.warn(`Unknown command key: ${key}`);
  }
}
