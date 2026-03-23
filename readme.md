# Media Remote Control — Developer Documentation

---

## 1. Overview

**Media Remote Control** is a three-part system that lets a mobile device (or any browser tab) remotely control media playback in a desktop Chrome browser.

### Why it exists

Controlling YouTube, Netflix, or Spotify from your phone without installing a native app is surprisingly hard. This project solves it by pairing a Chrome extension (the "host") with a lightweight web UI (the "remote") through a WebSocket relay server. No local network tricks, no mDNS — it works across networks.

### Architecture at a glance

```
┌─────────────────┐        WebSocket         ┌──────────────────┐
│  Remote UI      │ ◄──── relay server ────► │ Chrome Extension │
│  (React, Vite)  │    (Node.js, WS)          │  (MV3)           │
└─────────────────┘                           └────────┬─────────┘
                                                       │ chrome.tabs / scripting
                                                       ▼
                                              ┌──────────────────┐
                                              │  Content Script  │
                                              │  (per media tab) │
                                              └──────────────────┘
```

### Three components

| Component | Location | Role |
|-----------|----------|------|
| **Server** | `server/` | Session registry + WebSocket message router |
| **Extension** | `extension/` | Chrome MV3 extension; owns browser state |
| **Client** | `client/` | React remote-control UI; runs on phone/browser |

### Data flow (simplified)

1. Extension registers with the server and gets a `SESSION_IDENTITY`.
2. Extension generates a short pairing code; shows it as a QR code in its popup.
3. Client scans QR → sends `EXCHANGE_PAIR_KEY` → server issues a `trustToken` valid for **30 days**.
4. All subsequent commands travel: **Client → Server → Extension → Content Script → `<video>` / `<audio>` element**.
5. State changes (play, pause, volume) travel back the same path in reverse.

---

## 2. Quick Start

### Prerequisites

- Node.js ≥ 20
- Chrome / Chromium (for the extension)
- A second device or browser tab for the remote UI

### Step 1 — Start the server

```bash
cd server
npm install
npm run dev          # nodemon index.js, port 3000
```

The server exposes one HTTP endpoint: `GET /ping → "pong"`. Everything else is WebSocket traffic.

### Step 2 — Load the extension

1. Open `chrome://extensions` → enable **Developer mode**.
2. Click **Load unpacked** → select the `extension/` folder.
3. The extension icon appears in the toolbar. Click it to see the popup.

> **Before loading**, set the WebSocket URL in `extension/offscreen.js`:
> ```js
> const WS_URL = globalThis.WS_URL || "ws://localhost:3000/";
> ```

### Step 3 — Open the remote UI and pair

```bash
cd client
npm install
# Create a .env file:
echo "VITE_WS_URL=ws://localhost:3000
VITE_REMOTE_VERSION=1.0.0
VITE_LEAST_EXTENSION_VERSION=1.5" > .env

npm run dev          # Vite dev server on :5173
```

Open `http://localhost:5173` on your phone (or another tab). Click **Pair Device** in the extension popup, then scan the QR code in the client UI. You're connected.

---

## 3. API Reference

### 3.1 Server — WebSocket message protocol

All messages are JSON. The server **never initiates** — it only routes. Unrecognised message types are dropped by `isValidMessage()`.

#### `handleAuth(ws, msg, store)` — `server/libs/handlers.js`

Handles all authentication flows. Returns `true` when it consumed the message (so `routeMessage` is skipped).

| Message type | Sender | Effect |
|---|---|---|
| `init.host_register` | Extension | Creates or recovers a session; replies `init.host_registered` with `SESSION_IDENTITY` + `hostToken` |
| `init.pairing_key_request` | Extension | Generates a 6-char code (TTL 60 s); replies `init.pairing_key` |
| `init.exchange_pair_key` | Client | Validates code, creates `trustToken` (TTL 30 days); replies `init.pair_success` |
| `session.validate` | Client | Validates an existing `trustToken`; replies `session.valid` or `session.invalid` |

**`HOST_REGISTER` payload**
```json
{
  "type": "init.host_register",
  "hostToken": "<uuid or null on first connect>",
  "info": { "os": "mac", "browser": "Chrome", "extensionVersion": "1.5" }
}
```

**`PAIR_SUCCESS` response to client**
```json
{
  "type": "init.pair_success",
  "trustToken": "<uuid>",
  "sessionId": "<uuid>",
  "hostInfo": { "os": "mac", "browser": "Chrome", "extensionVersion": "1.5" }
}
```

---

#### `routeMessage(ws, msg, store)` — `server/libs/handlers.js`

Routes messages between registered participants. Called only after `handleAuth` returns `false`.

- **Remote → Host**: message is forwarded verbatim with `remoteId` injected.
- **Host → specific remote**: set `msg.remoteId` to target one remote.
- **Host → all remotes**: omit `remoteId` to broadcast.

---

#### `SessionStore` — `server/libs/store.js`

In-memory store (no database). Cleans itself every 30 seconds.

| Method | Signature | Description |
|--------|-----------|-------------|
| `createSession` | `(id, hostToken, ws, info) → session` | Creates a new host session |
| `getSession` | `(sessionId) → session \| undefined` | Looks up by session ID |
| `getSessionByHostToken` | `(token) → session \| undefined` | Looks up by the extension's token |
| `setPairCode` | `(code, sessionId) → ttlMs` | Registers a pairing code; returns TTL |
| `resolvePairCode` | `(code) → session \| null` | Validates and **invalidates** a code in one step |
| `registerRemote` | `(trustToken, identity) → void` | Stores remote identity |
| `getRemote` | `(trustToken) → identity \| undefined` | Looks up a remote |
| `handleHostDisconnect` | `(ws) → void` | Nulls the host socket; notifies all connected remotes |

---

#### `isValidMessage(msg)` — `server/libs/utils.js`

```js
isValidMessage({ type: "media.list" })   // true
isValidMessage({ type: "hack" })          // false
isValidMessage(null)                      // false
```

Returns `true` only if `msg.type` exists in `MESSAGE_TYPES` or `MEDIA_STATE` constants.

---

#### `isRateLimited(ws)` — `server/libs/utils.js`

Enforces a 200 ms per-socket rate limit. Returns `true` if the message should be dropped. Updates `ws.lastSeenAt`.

---

#### `generatePairCode()` — `server/libs/utils.js`

Returns a 6-character alphanumeric string using an unambiguous charset (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — no `0`, `O`, `I`, `1`).

---

### 3.2 Extension — Background script API

#### `COMMAND_REGISTRY` — `extension/background.js`

Maps `MEDIA_STATE` keys to async handlers. Extend this object to add new controls.

```js
COMMAND_REGISTRY[MEDIA_STATE.PLAYBACK] = async (tabId, value) => { ... }
COMMAND_REGISTRY[MEDIA_STATE.MUTE]     = async (tabId, value) => { ... }
COMMAND_REGISTRY[MEDIA_STATE.VOLUME]   = async (tabId, value) => { ... }
COMMAND_REGISTRY[MEDIA_STATE.TIME]     = async (tabId, value) => { ... }
```

Each handler receives `(tabId: number, value: any)` and should return the confirmed value (or `undefined` if no confirmation is needed).

---

#### `StateManager` — `extension/background.js`

Chrome service workers are terminated after ~30 s of inactivity. `StateManager` mirrors everything to `chrome.storage.local` automatically.

| Method | Description |
|--------|-------------|
| `init()` | Rehydrates from storage on SW boot |
| `get(key)` | Synchronous in-memory read |
| `set(updates)` | Writes memory + storage atomically; updates badge |
| `getRemoteContext(remoteId)` | Returns `{ tabId }` for a remote |
| `updateRemoteContext(remoteId, data)` | Pass `null` to remove |
| `clearAllRemoteContexts()` | Clears all remote → tab mappings |

---

#### `MediaStateStore` — `extension/libs/mediaStateStore.js`

Wraps `StateManager` to track per-tab media state.

| Method | Signature | Description |
|--------|-----------|-------------|
| `load()` | `async () → void` | Must be called once on startup |
| `get` | `(tabId) → object \| undefined` | Returns state for one tab |
| `getAll` | `() → Record<number, object>` | Returns full state map |
| `set` | `async (tabId, partial) → void` | Merges partial state |
| `remove` | `async (tabId) → void` | Removes a tab's state |

---

#### `sendMediaList(extra?)` — `extension/background.js`

Builds an enriched tab list and sends it to the server (which fans it out to remotes). Called automatically when tabs open/close/update.

```js
// Shape of each tab in the list:
{
  tabId: 123,
  title: "Rick Astley - Never Gonna Give You Up",
  url: "https://www.youtube.com/watch?v=...",
  favIconUrl: "...",
  muted: false,
  playback: "PLAYING",   // from MediaStateStore
  volume: 0.8,
  currentTime: 42,
  duration: 213
}
```

---

#### `isMediaUrl(url)` — `extension/background.js`

Returns `true` if the URL's hostname matches one of the supported `BASE_DOMAINS`.

```js
isMediaUrl("https://www.youtube.com/watch?v=abc")  // true
isMediaUrl("https://example.com")                   // false
```

---

### 3.3 Content Script — `extension/content.js`

Injected into media tabs. Discovers and attaches to the best `<video>` or `<audio>` element on the page.

#### `COMMAND_HANDLERS`

```js
COMMAND_HANDLERS[MEDIA_STATE.PLAYBACK] = (media, value) => { ... }
COMMAND_HANDLERS[MEDIA_STATE.VOLUME]   = (media, value) => { ... }
COMMAND_HANDLERS[MEDIA_STATE.TIME]     = (media, value) => { ... }
```

Invoked by the `chrome.runtime.onMessage` listener when the background sends a `control.state_update` with `intent: "control.set"`.

#### `reportMediaState(key, value)`

Sends a state update to the background **only if the value changed** (diff-checked against `lastReportedState`). Prevents event storms on fast-changing properties.

#### `discoverMedia()`

Scans the DOM every 2 seconds. Prefers a playing element with `currentTime > 0`; falls back to the first valid element. Calls `attachMedia()` on the winner.

---

### 3.4 Client — React hooks & components

#### `useRemoteConnection()` — `client/src/hooks/useRemoteConnection.js`

The single hook that drives the entire client UI.

**Returns**

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | One of: `Connecting`, `Connected`, `Verifying`, `init.pair_success`, `Waiting`, `Disconnected` |
| `hostInfo` | `object \| null` | `{ os, browser, extensionVersion }` |
| `tabsById` | `Record<string, Tab>` | All open media tabs |
| `activeTabId` | `string \| null` | Currently selected tab ID |
| `activeTab` | `Tab \| null` | Shorthand for `tabsById[activeTabId]` |
| `pair(code)` | `fn` | Submit a pairing code scanned from QR |
| `updateTabState(tabId, key, value)` | `fn` | Optimistically update + send to host |
| `selectTab(tabId)` | `fn` | Tell the host which tab to control |
| `disconnect()` | `fn` | Wipe token and reload |
| `openNewTab(url)` | `fn` | Ask the host to open a new tab |

**Optimistic locking**: `updateTabState` sets `lockedUntil = now + 1000ms` so rapid server echo-backs don't revert the UI before the user's intent is confirmed.

---

#### `Html5QrcodePlugin` — `client/src/components/Html5QrcodePlugin.jsx`

Wrapper around the `html5-qrcode` library.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `fps` | number | `10` | Scanner frames per second |
| `qrbox` | number | `250` | Scanner box size (px) |
| `disableFlip` | boolean | `false` | Disable horizontal flip |
| `qrCodeSuccessCallback` | fn | — | Called with `(decodedText, result)` |
| `qrCodeErrorCallback` | fn | — | Called with `(errorMessage)` |

Supports both camera scanning and static image file upload.

---

#### `VolumeControl` — `client/src/components/ui/VolumeControl.jsx`

Five-step volume bar (0.2, 0.4, 0.6, 0.8, 1.0).

| Prop | Type | Description |
|------|------|-------------|
| `activeTab` | `Tab \| null` | Source of `volume` value; disables control if null |
| `onVolumeChange` | `(value: number) → void` | Called with the chosen level |

---

## 4. Common Patterns

### Pattern 1 — Adding a new media control command

Say you want to add **loop toggle**.

**Step 1**: Add the key to both constants files.

```js
// extension/libs/constants.js  AND  client/src/constants/constants.js
MEDIA_STATE = {
  // ... existing keys
  LOOP: "loop",
};
```

**Step 2**: Handle it in the content script.

```js
// extension/content.js
COMMAND_HANDLERS[MEDIA_STATE.LOOP] = (media, value) => {
  media.loop = Boolean(value);
};
```

**Step 3**: Register it in the background command registry.

```js
// extension/background.js
COMMAND_REGISTRY[MEDIA_STATE.LOOP] = async (tabId, value) => {
  return await sendToTabSafe(tabId, {
    type: MESSAGE_TYPES.STATE_UPDATE,
    intent: MESSAGE_TYPES.INTENT.SET,
    key: MEDIA_STATE.LOOP,
    value
  });
};
```

**Step 4**: Call it from the client.

```jsx
<button onClick={() => updateTabState(activeTabId, MEDIA_STATE.LOOP, !activeTab.loop)}>
  Toggle Loop
</button>
```

---

### Pattern 2 — Adding a supported streaming site

Edit two files:

```js
// extension/libs/constants.js
export const BASE_DOMAINS = [
  // ...existing
  "peacocktv",   // matches peacocktv.com, www.peacocktv.com, etc.
];
```

```js
// client/src/constants/constants.js
export const SUPPORTED_SITES = {
  // ...existing
  PEACOCK: {
    name: "Peacock",
    url: "https://www.peacocktv.com",
    supported: true,
  },
};
```

Then add the host permission to `extension/manifest.json`:

```json
"host_permissions": [
  "*://*.peacocktv.com/*"
]
```

The content script is already generic — it targets `<video>` / `<audio>` elements and will work on any site without additional changes.

---

### Pattern 3 — Handling session recovery after service worker restart

The `StateManager` handles this automatically, but here's what happens under the hood so you can debug it:

```js
// On SW boot (extension/background.js):
await state.init();           // loads from chrome.storage.local
await mediaStore.load();      // ensures mediaStateByTab exists
await ensureOffscreen();      // recreates WS connection if needed

// offscreen.js WS onopen fires → background gets "WS_OPEN"
// handleWSOpen() reads the saved hostToken and re-registers:
sendToServer({
  type: MESSAGE_TYPES.HOST_REGISTER,
  hostToken: state.get("hostToken"),   // server recognizes this and recovers the session
  info: { os, browser, extensionVersion }
});
```

If you see the badge flicker between "ON" and off, the SW is restarting. This is expected in MV3 — the system is designed to survive it.

---

## 5. Related Modules

| Module / File | Works With | Relationship |
|---|---|---|
| `server/libs/handlers.js` | `server/libs/store.js`, `server/libs/utils.js` | Auth + routing logic; depends on store for session data and utils for ID generation |
| `server/libs/store.js` | `server/index.js`, `server/libs/handlers.js` | Source of truth for all sessions and identities; passed by reference to handlers |
| `extension/background.js` | `extension/offscreen.js`, `extension/content.js`, `extension/libs/mediaStateStore.js` | Orchestrator; routes messages between all extension layers |
| `extension/offscreen.js` | `extension/background.js`, WebSocket server | Owns the WS connection; decoupled from SW lifecycle |
| `extension/content.js` | `extension/background.js` | Injected into media tabs; controlled exclusively by background via `chrome.tabs.sendMessage` |
| `extension/libs/mediaStateStore.js` | `extension/background.js` | Persists per-tab media state across SW restarts via `StateManager` |
| `client/src/hooks/useRemoteConnection.js` | `client/src/App.jsx`, WebSocket server | Single source of truth for all WebSocket state in the client |
| `client/src/constants/constants.js` | All client components, `extension/libs/constants.js` | Must stay in sync with the extension constants — message type strings are the wire protocol |
| `client/src/components/Html5QrcodePlugin.jsx` | `useRemoteConnection` (via `pair()` callback) | Decodes QR code → hands off to hook for pairing |
