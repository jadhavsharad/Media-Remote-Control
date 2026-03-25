/**
 * tabManager.js
 * All Chrome tab management: discovery, injection, validation, and media list building.
 */
import { MESSAGE_TYPES, MEDIA_STATE, BASE_DOMAINS } from "./constants.js";

// ---- Media Discovery -------------------------------------------------------

/**
 * Returns all browser tabs that match a known media domain.
 * @returns {Promise<Array<{tabId, title, url, favIconUrl, muted}>>}
 */
export async function getMediaList() {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter((tab) => isMediaUrl(tab.url))
    .map((tab) => ({
      tabId: tab.id,
      title: tab.title || "Untitled",
      url: tab.url,
      favIconUrl: tab.favIconUrl || "",
      muted: tab.mutedInfo?.muted ?? false,
    }));
}

/**
 * Builds an enriched media list (with playback/volume state) and forwards it
 * to the server via the provided sendToServer function.
 *
 * @param {Function} sendToServer
 * @param {MediaStateStore} mediaStore
 * @param {object} extra - Extra fields to merge into the payload (e.g. remoteId)
 * @returns {Promise<Array>} The enriched tab list
 */
export async function sendMediaList(sendToServer, mediaStore, extra = {}) {
  const tabs = await getMediaList();
  const mediaState = mediaStore.getAll();

  const enriched = tabs.map((tab) => ({
    ...tab,
    playback: mediaState[tab.tabId]?.playback || "IDLE",
    volume: mediaState[tab.tabId]?.volume ?? 1,
    currentTime: mediaState[tab.tabId]?.currentTime || 0,
    duration: mediaState[tab.tabId]?.duration || 0,
  }));

  const payload = { type: MESSAGE_TYPES.MEDIA_LIST, tabs: enriched, ...extra };
  sendToServer(payload);
  return enriched;
}

// ---- Tab Validation --------------------------------------------------------

/**
 * Returns true if the tab with the given ID still exists.
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
export async function validateTab(tabId) {
  if (!tabId) return false;
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

// ---- Content Script Injection ----------------------------------------------

/**
 * Injects content.js into a single tab.
 * First pings the tab — if the script is already running, skips injection.
 * @param {number} tabId
 */
export async function injectContentScriptSingle(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: MESSAGE_TYPES.HOST_RECONNECT });
    return; // already injected
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
    } catch { }
  }
}

/**
 * Injects content.js into all currently detected media tabs.
 */
export async function injectContentScript() {
  const mediaTabs = await getMediaList();
  for (const tab of mediaTabs) {
    await injectContentScriptSingle(tab.tabId);
  }
}

/**
 * Safely sends a message to a content script.
 * On failure, attempts a re-injection and retries once.
 *
 * @param {number} tabId
 * @param {object} message
 * @returns {Promise<any>}
 */
export async function sendToTabSafe(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    console.warn(`Tab ${tabId} unreachable. Attempting reinjection...`, error);
    try {
      await injectContentScriptSingle(tabId);
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (retryError) {
      console.error(`Failed to recover tab ${tabId}:`, retryError);
      return null;
    }
  }
}

// ---- URL Classification ----------------------------------------------------

/**
 * Returns true if the URL belongs to a known media streaming domain.
 * @param {string} url
 * @returns {boolean}
 */
export function isMediaUrl(url) {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return BASE_DOMAINS.some((domain) => {
      const escaped = domain.replace(/\./g, "\\.");
      return new RegExp(
        `(^|\\.)${escaped}\\.[a-z]{2,}(\\.[a-z]{2,})?$`,
        "i"
      ).test(hostname);
    });
  } catch {
    return false;
  }
}
