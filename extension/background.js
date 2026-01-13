import { TRIGGERS, MEDIA_URL_PATTERNS, CHANNELS, SESSION_EVENTS, MEDIA_EVENTS, CONTROL_EVENTS } from "./constants.js";

let sessionIdentity = null;
let connected = false;
const remoteContext = new Map();
const offscreenPath = 'offscreen.html';

function setConnectedState(state) {
  connected = state;
  chrome.action.setBadgeText({ text: state ? "ON" : "" });
  chrome.action.setBadgeBackgroundColor({ color: state ? "#16a34a" : "#64748b" });
}

function onConnected(sessionId) {
  sessionIdentity = sessionId;
  setConnectedState(true);
  chrome.storage.local.set({ sessionIdentity, connected: true });
}

function onDisconnected() {
  sessionIdentity = null;
  connected = false;
  setConnectedState(false);
  chrome.storage.local.set({ sessionIdentity: null, connected: false });

}


function isValidControlAction(action) {
  return action === "TOGGLE_PLAYBACK";
}

async function getMediaTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter(tab => tab.url && MEDIA_URL_PATTERNS.some(p => tab.url.includes(p)))
    .map(tab => ({
      tabId: tab.id,
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl || null
    }));
}

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
  if (msg.type === "WS_CLOSED") return;
  switch (msg.type) {
    case SESSION_EVENTS.HOST_REGISTERED: {
      onConnected(msg.SESSION_IDENTITY);
      break;
    }
    case SESSION_EVENTS.REMOTE_JOINED: {
      remoteContext.set(msg.remoteId, { tabId: null });
      const tabs = await getMediaTabs()
      sendToServer({
        type: MEDIA_EVENTS.MEDIA_TABS_LIST,
        remoteId: msg.remoteId,
        tabs
      })
      break;
    }
    case MEDIA_EVENTS.SELECT_ACTIVE_TAB: {
      const ctx = remoteContext.get(msg.remoteId);
      if (!ctx) return;

      const tab = await chrome.tabs.get(msg.tabId).catch(() => null);
      if (!tab) return;

      ctx.tabId = msg.tabId;
      break;
    }
    case CONTROL_EVENTS.CONTROL_EVENT: {
      if (!isValidControlAction(msg.action)) return;

      const ctx = remoteContext.get(msg.remoteId);
      if (!ctx?.tabId) return;

      chrome.tabs.sendMessage(ctx.tabId, {
        type: CONTROL_EVENTS.CONTROL_EVENT,
        action: msg.action
      });
      break;
    }
    case SESSION_EVENTS.PAIR_INVALID: {
      remoteContext.clear();
      onDisconnected();
      break;
    }

  }
}

function handlePopup(req, sendResponse) {
  if (req.type === "POPUP_GET_STATUS") {
    chrome.storage.local.get(["sessionIdentity", "connected"], res => {
      sendResponse(res);
    });
  }

  if (req.type === "POPUP_DISCONNECT") {
    onDisconnected();
    sendToServer({ type: "LEAVE_PAIR" });
    sendResponse({ ok: true });
  }
}

async function sendToServer(payload) {
  chrome.runtime.sendMessage({
    type: CHANNELS.FROM_BACKGROUND,
    payload
  });
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;

  await chrome.offscreen.createDocument({
    url: offscreenPath,
    reasons: ["BLOBS"],
    justification: "Persistent WebSocket connection"
  });
}
ensureOffscreen();