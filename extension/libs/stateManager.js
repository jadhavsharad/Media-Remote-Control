/**
 * stateManager.js
 * Manages all persistent extension state backed by chrome.storage.local.
 * Also owns the browser action badge.
 */
export class StateManager {
  constructor() {
    this.localState = {
      connected: false,
      sessionIdentity: null,
      hostToken: null,
      // Map<remoteId, { tabId: number | null }>
      // Stored as a plain Object for storage serialization
      remoteContext: {},
    };
  }

  /** Initialize state from storage on startup */
  async init() {
    const stored = await chrome.storage.local.get(null);
    this.localState = { ...this.localState, ...stored };
    this.updateBadge(this.localState.connected);
    return this.localState;
  }

  get(key) {
    return this.localState[key];
  }

  /** Atomic update: writes to memory and chrome.storage in one call */
  async set(updates) {
    this.localState = { ...this.localState, ...updates };

    if ("connected" in updates) {
      this.updateBadge(updates.connected);
    }

    await chrome.storage.local.set(updates);
  }

  updateBadge(isConnected) {
    const text = isConnected ? "ON" : "";
    const color = isConnected ? "#16a34a" : "#64748b";

    if (chrome.action) {
      chrome.action.setBadgeText({ text });
      chrome.action.setBadgeBackgroundColor({ color });
    }
  }

  // --- Remote Context Helpers ---

  getRemoteContext(remoteId) {
    return this.localState.remoteContext[remoteId] || { tabId: null };
  }

  async updateRemoteContext(remoteId, data) {
    const ctx = { ...this.localState.remoteContext };

    if (data === null) {
      delete ctx[remoteId];
    } else {
      ctx[remoteId] = { ...(ctx[remoteId]), ...data };
    }

    await this.set({ remoteContext: ctx });
  }

  async clearAllRemoteContexts() {
    await this.set({ remoteContext: {} });
  }
}
