import { MEDIA_URL_PATTERNS, CHANNELS, SESSION_EVENTS, MEDIA_EVENTS, CONTROL_EVENTS } from "./constants.js";

let sessionIdentity = null;
let connected = false;
const remoteContext = new Map();
const offscreenPath = 'offscreen.html';

function log(log) {
  console.log(log)
}

function setConnectedState(state) {
  connected = state;
  chrome.action.setBadgeText({ text: state ? "ON" : "" });
  chrome.action.setBadgeBackgroundColor({ color: state ? "#16a34a" : "#64748b" });
}

function onConnected(sessionId, hostToken) {
  sessionIdentity = sessionId;
  setConnectedState(true);
  chrome.storage.local.set({ sessionIdentity, hostToken, connected: true });
}

function onDisconnected() {
  sessionIdentity = null;
  connected = false;
  setConnectedState(false);
  chrome.storage.local.set({ sessionIdentity: null, connected: false });
  remoteContext.clear();
}


function isValidControlAction(action) {
  return action === "TOGGLE_PLAYBACK" || action === "MUTE_TAB";
}

async function getMediaTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter(tab => tab.url && MEDIA_URL_PATTERNS.some(p => tab.url.includes(p)))
    .map(tab => ({
      tabId: tab.id,
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl || null,
      muted: tab.mutedInfo?.muted || false
    }));
}

// validate tab exists
async function validateTab(tabId) {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

// reinject content scripts
async function reinjectContentScripts() {
  const mediaTabs = await getMediaTabs();
  const failedTabs = [];

  for (const tab of mediaTabs) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.tabId },
        files: ["content.js"]
      });
    } catch (err) {
      console.warn(`Failed to reinject into tab ${tab.tabId}:`, err);
      failedTabs.push(tab);
    }
  }

  // Notify popup if any tabs failed
  if (failedTabs.length > 0) {
    chrome.runtime.sendMessage({
      type: "TO_POPUP",
      payload: { type: "REINJECTION_FAILED", failedTabs }
    }).catch(() => { });
  }
}


function DebouncedScheduler(fn, delay = 300) {
  let timer = null;

  return () => {
    if (timer) return;

    timer = setTimeout(async () => {
      timer = null;
      try {
        await fn();
      } catch (e) {
        console.warn("Scheduled task failed", e);
      }
    }, delay);
  };
}

async function sendMediaTabsList(extra = {}) {
  const tabs = await getMediaTabs();
  sendToServer({
    type: MEDIA_EVENTS.MEDIA_TABS_LIST,
    tabs,
    ...extra,
  });
}

const refreshMediaTabs = DebouncedScheduler(() => sendMediaTabsList());

// Extension Reload Recovery - listeners
chrome.runtime.onStartup.addListener(() => {
  reinjectContentScripts();
});

chrome.runtime.onInstalled.addListener(() => {
  reinjectContentScripts();
});

// cleanup on tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [remoteId, ctx] of remoteContext.entries()) {
    if (ctx.tabId === tabId) {
      ctx.tabId = null;
    }
  }
  refreshMediaTabs()
});

// cleanup on navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  for (const ctx of remoteContext.values()) {
    if (ctx.tabId === tabId) {
      ctx.tabId = null;
    }
  }

  refreshMediaTabs()
});

chrome.tabs.onCreated.addListener(refreshMediaTabs);

chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
  switch (msg.type) {
    case CHANNELS.FROM_SERVER:
      handleServerMessage(msg.payload);
      break;

    case CHANNELS.FROM_CONTENT_SCRIPT:
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
    setConnectedState(false);
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
          type: SESSION_EVENTS.REGISTER_HOST,
          hostToken: hostToken,
          info: {
            os,
            browser
          }
        });
      });
      break;
    }

    case SESSION_EVENTS.HOST_REGISTERED: {
      onConnected(msg.SESSION_IDENTITY, msg.hostToken);
      sendMediaTabsList();
      break;
    }

    case SESSION_EVENTS.PAIR_CODE: {
      chrome.runtime.sendMessage({
        type: "TO_POPUP",
        payload: { type: "PAIR_CODE_RECEIVED", code: msg.code, ttl: msg.ttl }
      }).catch(() => { });
      break;
    }

    case SESSION_EVENTS.REMOTE_JOINED: {
      remoteContext.delete(msg.remoteId);
      remoteContext.set(msg.remoteId, { tabId: null });
      sendMediaTabsList({ remoteId: msg.remoteId });
      break;
    }

    case MEDIA_EVENTS.SELECT_ACTIVE_TAB: {
      const ctx = remoteContext.get(msg.remoteId);
      if (!ctx) return;

      const tab = await validateTab(msg.tabId);
      if (!tab) return;

      ctx.tabId = msg.tabId;

      break;
    }
    case CONTROL_EVENTS.CONTROL_EVENT: {
      if (!isValidControlAction(msg.action)) return;

      const ctx = remoteContext.get(msg.remoteId);
      if (!ctx?.tabId) return;

      // validate before sending
      const isValid = await validateTab(ctx.tabId);
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
    case SESSION_EVENTS.HOST_DISCONNECTED: {
      resetSession("host_disconnected");
      break;
    }

    case SESSION_EVENTS.PAIR_INVALID: {
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

    setConnectedState(false);
    sendResponse({ ok: true });
    return;
  }
}

async function sendToServer(payload) {
  await ensureOffscreen();
  chrome.runtime.sendMessage({
    type: CHANNELS.FROM_BACKGROUND,
    payload
  }).catch(console.warn);
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;

  await chrome.offscreen.createDocument({
    url: offscreenPath,
    reasons: ["BLOBS"],
    justification: "Persistent WebSocket connection"
  });
}

function resetSession(reason = "unknown") {
  console.warn("Session reset:", reason);
  onDisconnected();
  remoteContext.clear();
}

function getBrowser() {
  if (navigator.userAgentData?.brands) {
    const brands = navigator.userAgentData.brands.map(b => b.brand);
    if (brands.includes("Microsoft Edge")) return "Edge";
    if (brands.includes("Brave")) return "Brave";
    if (brands.includes("Google Chrome")) return "Chrome";
    if (brands.includes("Chromium")) return "Chromium";
  }
  return "Unknown";
}

function getOS() {
  return new Promise((resolve) => {
    chrome.runtime.getPlatformInfo((info) => {
      resolve(
        {
          mac: "macOS",
          win: "Windows",
          linux: "Linux",
          cros: "ChromeOS",
          android: "Android",
          openbsd: "OpenBSD",
        }[info.os] ?? "Unknown"
      );
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
      finally{
        sendToServer({type: CONTROL_EVENTS.STATE_UPDATE, muted: await chrome.tabs.get(ctx.tabId)})
      }
      break;
    }

    default:
      // forward other actions to content script
      await chrome.tabs.sendMessage(ctx.tabId, {
        type: CONTROL_EVENTS.CONTROL_EVENT,
        action: msg.action
      });
  }
}

ensureOffscreen();