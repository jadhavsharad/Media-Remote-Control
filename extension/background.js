// import { MEDIA_URL_PATTERNS, SESSION_EVENTS, MEDIA_EVENTS, CONTROL_EVENTS } from "./constants.js";
import { MESSAGE_TYPES, CHANNELS, BASE_DOMAINS } from "./libs/constants.js";
// import { onConnected, setConnectionState } from "./libs/helper.js";
import { log } from "./libs/log.js";

let connected = false;
let sessionIdentity = null;
let hostToken = null;
const remoteContext = new Map();
const offscreenPath = 'offscreen.html';

// Connection management
function setConnectionState(state) {
  connected = state;
  chrome.action.setBadgeText({ text: state ? "ON" : "" });
  chrome.action.setBadgeBackgroundColor({ color: state ? "#16a34a" : "#64748b" });
}

function onConnected(newSessionIdentity, newHostToken) {
  sessionIdentity = newSessionIdentity;
  hostToken = newHostToken;
  setConnectionState()

  chrome.storage.local.set({ sessionIdentity, hostToken, connected });
}

function onDisconnected() {
connected = false;
}

function onDestroy() {
  connected = false;
  sessionIdentity = null;
  hostToken = null;
  remoteContext.clear();
chrome.storage.local.set({ sessionIdentity: null, hostToken: null, connected });
}

// // REPLACE WITH IS VALID MESSAGE TYPE
// function isValidControlAction(action) {
//   return action === "TOGGLE_PLAYBACK" || action === "MUTE_TAB";
// }
// // isValidMessageType(action)

// async function getMediaTabs() {
//   const tabs = await chrome.tabs.query({});
//   return tabs
//     .filter(tab => tab.url && MEDIA_URL_PATTERNS.some(p => tab.url.includes(p)))
//     .map(tab => ({
//       tabId: tab.id,
//       title: tab.title,
//       url: tab.url,
//       favIconUrl: tab.favIconUrl || null,
//       muted: tab.mutedInfo?.muted || false
//     }));
// }

// // validate tab exists
function isValidMessageType(type) {
  return Object.values(MESSAGE_TYPES).includes(type);
}

// // reinject content scripts
// async function reinjectContentScripts() {
//   const mediaTabs = await getMediaTabs();
//   const failedTabs = [];

//   for (const tab of mediaTabs) {
//     try {
//       await chrome.scripting.executeScript({
//         target: { tabId: tab.tabId },
//         files: ["content.js"]
//       });
//     } catch (err) {
//       console.warn(`Failed to reinject into tab ${tab.tabId}:`, err);
//       failedTabs.push(tab);
//     }
//   }

//   // Notify popup if any tabs failed
//   if (failedTabs.length > 0) {
//     chrome.runtime.sendMessage({
//       type: "TO_POPUP",
//       payload: { type: "REINJECTION_FAILED", failedTabs }
//     }).catch(() => { });
//   }
// }


// function DebouncedScheduler(fn, delay = 300) {
//     let timer = null;

//     return () => {
//         if (timer) return;

//         timer = setTimeout(async () => {
//             timer = null;
//             try {
//                 await fn();
//             } catch (e) {
//                 console.warn("Scheduled task failed", e);
      //       }
//         }, delay);
//     };
// }

// async function sendMediaTabsList(extra = {}) {
//     const tabs = await getMediaTabs();
//     sendToServer({
//         type: MEDIA_EVENTS.MEDIA_TABS_LIST,
//         tabs,
//         ...extra,
//     });
// }

// const refreshMediaTabs = DebouncedScheduler(() => sendMediaTabsList());

// // Extension Reload Recovery - listeners
// chrome.runtime.onStartup.addListener(() => {
//     reinjectContentScripts();
// });

// chrome.runtime.onInstalled.addListener(() => {
//     reinjectContentScripts();
// });

// // cleanup on tab removal
// chrome.tabs.onRemoved.addListener((tabId) => {
//     for (const [remoteId, ctx] of remoteContext.entries()) {
//         if (ctx.tabId === tabId) {
      //       ctx.tabId = null;
//     }
//   }
//   refreshMediaTabs()
// });

// // cleanup on navigation
// chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
//     for (const ctx of remoteContext.values()) {
//         if (ctx.tabId === tabId) {
//             ctx.tabId = null;
    //     }
//     }

//     refreshMediaTabs()
// });

// chrome.tabs.onCreated.addListener(refreshMediaTabs);

receiveMessage(CHANNELS.FROM_SERVER, (payload) => {
      handleServerMessage(payload);
      })
receiveMessage(CHANNELS.FROM_CONTENT_SCRIPT:
      sendToServer(msg.update);
      break;

    case CHANNELS.FROM_POPUP:
      handlePopup(msg.popup, sendResponse);
      return true;
  }
});

async function handleServerMessage(msg) {
  if (!msg?.type) return;

  if (msg.type === "WS_CLOSED") {
    setConnectionState(false);
    return;
  }


  switch (msg.type) {
    case "WS_OPEN": {

      // Rediscover and notify all content scripts of reconnection
      getMediaTabs().then(tabs => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.tabId, {
            type: SESSION_EVENTS.HOST_RECONNECTED
          }).catch(async () => {
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tab.tabId },
                files: ["content.js"]
              });
            } catch {
              log("Failed to reinject into tab " + tab.tabId)
            }
          });
        });
      });

      const os = await getOS();
      const browser = getBrowser();

      // Reuse existing hostToken for reconnection
      chrome.storage.local.get(["hostToken"], (res) => {
        const hostToken = res.hostToken;
        sendToServer({
          type: MESSAGE_TYPES.HOST_REGISTER,
          hostToken: hostToken,
          info: {
            os,
            browser
          }
        });
      });
      break;
    }

    case MESSAGE_TYPES.HOST_REGISTERED: {
      onConnected(msg.SESSION_IDENTITY, msg.hostToken);
// log("[BACKGROUND REGISTERED]: ", msg)
      sendMediaList();
      break;
    }

    case MESSAGE_TYPES.PAIR_CODE: {
      chrome.runtime.sendMessage({
        type: "TO_POPUP",
        payload: { type: "PAIR_CODE_RECEIVED", code: msg.code, ttl: msg.ttl }
      }).catch(() => { });
      break;
    }

    case MESSAGE_TYPES.REMOTE_JOINED: {
      remoteContext.delete(msg.remoteId);
      remoteContext.set(msg.remoteId, { tabId: null });
      sendMediaList({ remoteId: msg.remoteId });
      break;
    }

    case MESSAGE_TYPES.SELECT_ACTIVE_TAB: {
      const ctx = remoteContext.get(msg.remoteId);
      if (!ctx) return;

      const tab = isValidMessageType(msg.tabId);
      if (!tab) return;

      ctx.tabId = msg.tabId;

      break;
    }
    case MESSAGE_TYPES.CONTROL_EVENT: {
      if (!isValidControlAction(msg.type)) return;

      const ctx = remoteContext.get(msg.remoteId);
      if (!ctx?.tabId) return;

      // validate before sending
      const isValid = isValidMessageType(ctx.tabId);
      if (!isValid) {
        console.warn(`Tab ${ctx.tabId} no longer exists, clearing context`);
        ctx.tabId = null;
        return;
      }


      try {
        handleControlEvent(ctx, msg);

      } catch (err) {
        console.warn(`Failed to send message to tab ${ctx.tabId}:`, err);
        ctx.tabId = null; // Clear stale reference
      }
      break;
    }
    case MESSAGE_TYPES.HOST_DISCONNECTED: {
      resetSession("host_disconnected");
      break;
    }

    case MESSAGE_TYPES.PAIRING_KEY_VALID: {
      remoteContext.clear();
      break;
    }
  }
}

function handlePopup(req, sendResponse) {
  if (req.type === "POPUP_GET_STATUS") {
    chrome.storage.local.get(["sessionIdentity", "connected"], res => {
      sendResponse(res);
    });
    return;
  }

  if (req.type === "POPUP_REQUEST_CODE") {
    sendToServer({ type: SESSION_EVENTS.REQUEST_PAIR_CODE });
    sendResponse({ ok: true });
    return;
  }

  if (req.type === "POPUP_DISCONNECT") {
    // Disconnect - notify server about force-close WS
    sendToServer({ type: SESSION_EVENTS.HOST_DISCONNECT });

    // Force-close WebSocket in offscreen
    chrome.runtime.sendMessage({ type: CHANNELS.DISCONNECT_WS }).catch(() => { });

    onDisconnected();
    sendResponse({ ok: true });
    return;
  }

  if (req.type === "POPUP_RECONNECT") {
    // Force-connect WebSocket in offscreen
    chrome.runtime.sendMessage({ type: CHANNELS.CONNECT_WS }).catch(() => { });
    sendResponse({ ok: true });
    return;
  }
}


// Offscreen document
async function startOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: offscreenPath,
    reasons: ["BLOBS"],
    justification: "Persistent WebSocket connection",
  });
}

function resetSession(reason = "unknown") {
  console.warn("Session reset:", reason);
  onDisconnected();
  remoteContext.clear();
}

// Browser Detection
export function getBrowser() {
      const brands = navigator.userAgentData?.brands?.map(b => b.brand) ?? [];
    if (brands.includes("Microsoft Edge")) return "Edge";
    if (brands.includes("Brave")) return "Brave";
    if (brands.includes("Google Chrome")) return "Chrome";
    if (brands.includes("Chromium")) return "Chromium";
    return "Unknown";
}

// OS Detection
export function getOS() {
  return new Promise((resolve) => {
    chrome.runtime.getPlatformInfo((info) => {
      const osMap =         {
          mac: "macOS",
          win: "Windows",
          linux: "Linux",
          cros: "ChromeOS",
          android: "Android",
          openbsd: "OpenBSD",
        };
      resolve(osMap[info.os] ?? "Unknown"      );
    });
  });
}

async function handleControlEvent(ctx, msg) {
  if (!ctx.tabId) return;

  switch (msg.action) {
    case CONTROL_EVENTS.MUTE_TAB: {
      try {
        const tab = await chrome.tabs.get(ctx.tabId);

        await chrome.tabs.update(ctx.tabId, {
          muted: !tab.mutedInfo?.muted
        });
      } catch (err) {
        console.warn(`Failed to mute tab ${ctx.tabId}`, err);
        ctx.tabId = null;
      }
      finally {
        sendToServer({ type: CONTROL_EVENTS.STATE_UPDATE, muted: await chrome.tabs.get(ctx.tabId) })
      }
      break;
    }

    default:
      // forward other actions to content script
      await chrome.tabs.sendMessage(ctx.tabId, {
        type: CONTROL_EVENTS.CONTROL_EVENT,
        //         action: msg.action
//       });
//   }
// }

startOffscreen();

async function sendToServer(payload) {
  await startOffscreen();
  await sendMessage(CHANNELS.FROM_BACKGROUND, payload);
}

// Messaging
async function sendMessage(channel, payload) {
  try {
    await chrome.runtime.sendMessage({ type: channel, payload });
  } catch (e) {
    log("[BACKGROUND SENDING ERROR]: ", e)
  }
}

function receiveMessage(channel, handler) {
  chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
    if (!msg || msg.type !== channel) return;
    return handler(msg.payload, sendResponse);
  });
}



// Tabs & media
function isMediaUrl(url) {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return BASE_DOMAINS.some(domain => hostname === domain || hostname.includes(`.${domain}`));
  } catch {
    return false;
  }
}

async function getMediaList() {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter(tab => isMediaUrl(tab.url))
    .map(tab => ({
      tabId: tab.id,
      title: tab.title ?? "",
      url: tab.url,
      favIconUrl: tab.favIconUrl ?? null,
      muted: tab.mutedInfo?.muted ?? false,
    }));
}

async function sendMediaList(extra = {}) {
  const tabs = await getMediaList();
  const payload = { type: MESSAGE_TYPES.MEDIA_LIST, tabs, ...extra }
  sendMessage(CHANNELS.FROM_BACKGROUND, payload)
}

// Debounce
export function debouncedScheduler(fn, delay = 300) {
  let timer = null;
  return () => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      fn().catch(e => console.warn("Scheduled task failed", e));
    }, delay);
  };
}

const refreshMediaList = debouncedScheduler(() => sendMediaList());

