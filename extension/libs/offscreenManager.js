/**
 * offscreenManager.js
 * Manages creation and lifecycle of the Offscreen Document used for WebSocket connections.
 * Chrome Service Workers cannot hold WebSocket connections directly, so we delegate to an
 * offscreen document that persists in the background.
 */

const OFFSCREEN_PATH = "offscreen.html";

let creating = null;

/**
 * Ensures the offscreen document is open.
 * Safe to call multiple times — de-duplicates concurrent creation requests.
 */
export async function ensureOffscreen() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);

  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl],
  });

  if (contexts.length > 0) return;

  if (creating) {
    await creating;
    return;
  }

  creating = (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ["BLOBS"],
        justification: "WebSocket background connection",
      });
    } catch (e) {
      if (!e.message.includes("Only a single offscreen")) {
        throw e;
      }
    }
  })();

  await creating;
  creating = null;
}
