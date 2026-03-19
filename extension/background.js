/**
 * background.js — Orchestrator (wiring only)
 * Imports all modules and connects them via event listeners.
 * Contains no business logic — all concerns live in libs/.
 */
import { CHANNELS, MESSAGE_TYPES, MEDIA_STATE } from "./libs/constants.js";
import { StateManager } from "./libs/stateManager.js";
import { MediaStateStore } from "./libs/mediaStateStore.js";
import { ensureOffscreen } from "./libs/offscreenManager.js";
import { sendMessage, receiveMessage, sendToServer } from "./libs/messagingBus.js";
import {
  getMediaList,
  sendMediaList,
  validateTab,
  injectContentScript,
  injectContentScriptSingle,
} from "./libs/tabManager.js";
import { executeRemoteCommand } from "./libs/commandRegistry.js";

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

const state = new StateManager();
const mediaStore = new MediaStateStore(state);

// Thin wrapper so modules don't need to hold a reference to `state`
const _sendToServer = (payload) => sendToServer(payload, state);
const _sendMediaList = (extra) => sendMediaList(_sendToServer, mediaStore, extra);

// ---------------------------------------------------------------------------
// Lifecycle & Initialization
// ---------------------------------------------------------------------------

(async () => {
  await state.init();
  await mediaStore.load();
  await ensureOffscreen();
  refreshMediaList();
})();

chrome.runtime.onStartup.addListener(async () => {
  await state.init();
  await ensureOffscreen();
  injectContentScript();
});

chrome.runtime.onInstalled.addListener(async () => {
  await state.init();
  await ensureOffscreen();
  injectContentScript();
});

// ---------------------------------------------------------------------------
// Tab Events (debounced)
// ---------------------------------------------------------------------------

const refreshMediaList = debouncedScheduler(async () => {
  const tabs = await _sendMediaList();
  const validTabIds = new Set(tabs.map((t) => t.tabId));

  const mediaState = mediaStore.getAll();
  const remoteContext = state.get("remoteContext");
  let mediaDirty = false, contextDirty = false;

  for (const tabId in mediaState) {
    if (!validTabIds.has(Number(tabId))) {
      delete mediaState[tabId];
      mediaDirty = true;
    }
  }

  for (const remoteId in remoteContext) {
    const ctx = remoteContext[remoteId];
    if (ctx.tabId && !validTabIds.has(ctx.tabId)) {
      ctx.tabId = null;
      contextDirty = true;
    }
  }

  if (mediaDirty) await state.set({ mediaStateByTab: mediaState });
  if (contextDirty) await state.set({ remoteContext });
});

chrome.tabs.onRemoved.addListener(() => refreshMediaList());
chrome.tabs.onUpdated.addListener(() => refreshMediaList());
chrome.tabs.onCreated.addListener(() => refreshMediaList());

// ---------------------------------------------------------------------------
// Message Routing
// ---------------------------------------------------------------------------

// Server → Background
receiveMessage(CHANNELS.FROM_SERVER, async (payload) => {
  await handleServerMessage(payload);
});

// Content Script → Background
receiveMessage(CHANNELS.FROM_CONTENT_SCRIPT, async (payload, sender) => {
  if (!isValidMessageType(payload.type)) return;

  if (
    payload.type === MESSAGE_TYPES.STATE_UPDATE &&
    payload.intent === MESSAGE_TYPES.INTENT.REPORT
  ) {
    if (sender?.tab) {
      const tabId = sender.tab.id;
      const { key, value } = payload;
      if (key) await mediaStore.set(tabId, { [key]: value });
      _sendToServer({ ...payload, tabId, timestamp: Date.now() });
    }
  }
});

// Popup → Background
receiveMessage(CHANNELS.FROM_POPUP, (payload, _, sendResponse) => {
  handlePopup(payload, sendResponse);
  return true;
});

// ---------------------------------------------------------------------------
// Server Message Handler
// ---------------------------------------------------------------------------

async function handleServerMessage(msg) {
  if (!msg?.type) return;

  switch (msg.type) {
    case "WS_CLOSED":
      await state.set({ connected: false });
      break;

    case "WS_OPEN":
      await handleWSOpen();
      break;

    case MESSAGE_TYPES.HOST_REGISTERED:
      await state.set({
        connected: true,
        sessionIdentity: msg.SESSION_IDENTITY,
        hostToken: msg.hostToken,
      });
      _sendMediaList();
      break;

    case MESSAGE_TYPES.PAIRING_KEY:
      sendMessage(CHANNELS.TO_POPUP, {
        type: MESSAGE_TYPES.PAIRING_KEY,
        code: msg.code,
        ttl: msg.ttl,
      });
      break;

    case MESSAGE_TYPES.REMOTE_JOINED:
      await state.updateRemoteContext(msg.remoteId, { tabId: null });
      _sendMediaList({ remoteId: msg.remoteId });
      break;

    case MESSAGE_TYPES.SELECT_ACTIVE_TAB:
      await handleSelectTab(msg.remoteId, msg.tabId);
      break;

    case MESSAGE_TYPES.STATE_UPDATE:
      if (msg.intent === MESSAGE_TYPES.INTENT.SET) {
        await executeRemoteCommand(msg, state, validateTab);
      }
      break;

    case MESSAGE_TYPES.HOST_DISCONNECTED:
      await state.set({ connected: false });
      break;

    case MESSAGE_TYPES.NEW_TAB:
      await handleNewTab(msg.url);
      break;
  }
}

// ---------------------------------------------------------------------------
// Action Handlers
// ---------------------------------------------------------------------------

async function handleWSOpen() {
  const hostToken = state.get("hostToken");
  const os = await getOS();
  const browser = getBrowser();
  const extensionVersion = getExtensionVersion();

  const tabs = await getMediaList();
  tabs.forEach((t) => injectContentScriptSingle(t.tabId));

  _sendToServer({
    type: MESSAGE_TYPES.HOST_REGISTER,
    hostToken,
    info: { os, browser, extensionVersion },
  });
}

async function handleSelectTab(remoteId, tabId) {
  const isValid = await validateTab(tabId);
  if (!isValid) return;
  await state.updateRemoteContext(remoteId, { tabId });
}

async function handleNewTab(url) {
  if (!url) return;
  let targetUrl = url;
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    targetUrl = "https://" + url;
  }
  try {
    await chrome.tabs.create({ url: targetUrl, active: true });
  } catch (err) {
    console.error("Failed to open new tab:", err);
  }
}

function handlePopup(req, sendResponse) {
  const connected = state.get("connected");
  const sessionIdentity = state.get("sessionIdentity");

  switch (req.type) {
    case "POPUP_GET_STATUS":
      sendResponse({ connected, sessionIdentity });
      break;

    case MESSAGE_TYPES.PAIRING_KEY_REQUEST:
      _sendToServer({ type: MESSAGE_TYPES.PAIRING_KEY_REQUEST });
      sendResponse({ ok: true });
      break;

    case MESSAGE_TYPES.HOST_DISCONNECT:
      _sendToServer({ type: MESSAGE_TYPES.HOST_DISCONNECT });
      state.set({ connected: false, sessionIdentity: null }).then(() => {
        sendResponse({ ok: true });
      });
      break;

    case MESSAGE_TYPES.HOST_RECONNECT:
      _sendToServer({ type: MESSAGE_TYPES.HOST_RECONNECT });
      break;

    default:
      sendResponse({ error: "Unknown request" });
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function debouncedScheduler(fn, delay = 300) {
  let timer = null;
  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn().catch((e) => console.warn("Scheduled task failed", e));
    }, delay);
  };
}

function isValidMessageType(type) {
  return Object.values(MESSAGE_TYPES).includes(type);
}

function getBrowser() {
  if (navigator.userAgentData?.brands) {
    const brands = navigator.userAgentData.brands.map((b) => b.brand);
    if (brands.includes("Brave")) return "Brave";
    if (brands.includes("Microsoft Edge")) return "Edge";
    return "Chrome";
  }
  return "Chrome";
}

function getOS() {
  return new Promise((resolve) => {
    chrome.runtime.getPlatformInfo((info) => {
      resolve(info.os || "Unknown");
    });
  });
}

function getExtensionVersion() {
  return chrome.runtime.getVersion();
}