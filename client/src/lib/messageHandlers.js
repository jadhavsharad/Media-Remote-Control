/**
 * messageHandlers.js
 * Factory that returns a pure message handler for all incoming WebSocket messages.
 * Completely decoupled from React — accepts state setters as arguments.
 */
import { match, P } from "ts-pattern";
import { toast } from "sonner";
import { MESSAGE_TYPES } from "../constants/constants";

/**
 * Creates a message handler bound to the provided state setters.
 * Returns a function that accepts a parsed server message and applies
 * the appropriate state updates and side effects.
 *
 * @param {object} setters
 * @param {Function} setters.setToken       - Persists/clears the trust token
 * @param {Function} setters.setHostInfo    - Updates hostInfo state
 * @param {Function} setters.setStatus      - Updates connection status
 * @param {Function} setters.setTabsById    - Updates the tabs map
 * @returns {Function} handleMessage(msg) => void
 */
export function createMessageHandler({ setToken, setHostInfo, setStatus, setTabsById }) {
  return function handleMessage(msg) {
    if (!msg?.type) return;

    match(msg)
      .with({ type: MESSAGE_TYPES.PAIR_SUCCESS }, (m) => {
        setToken(m.trustToken);
        setHostInfo(m.hostInfo);
        setStatus(MESSAGE_TYPES.PAIR_SUCCESS);
        toast.success("Pairing successful");
      })
      .with({ type: MESSAGE_TYPES.PAIR_FAILED }, () => {
        toast.error("Pairing failed");
        setStatus(MESSAGE_TYPES.DISCONNECTED);
        setToken(null);
      })
      .with({ type: MESSAGE_TYPES.SESSION_VALID }, (m) => {
        setHostInfo(m.hostInfo);
        setStatus(MESSAGE_TYPES.PAIR_SUCCESS);
        toast.success("Session restored");
      })
      .with({ type: MESSAGE_TYPES.SESSION_INVALID }, () => {
        setToken(null);
        setStatus(MESSAGE_TYPES.DISCONNECTED);
        toast.error("Session expired");
      })
      .with({ type: MESSAGE_TYPES.HOST_DISCONNECTED }, () => {
        setStatus(MESSAGE_TYPES.WAITING);
        toast.warning("Host disconnected");
      })
      .with({ type: MESSAGE_TYPES.MEDIA_LIST, tabs: P.array() }, (m) => {
        setTabsById((prev) => {
          const next = {};
          m.tabs.forEach((tab) => {
            next[tab.tabId] = {
              ...prev[tab.tabId],
              ...tab,
              lockedUntil: prev[tab.tabId]?.lockedUntil,
            };
          });
          return next;
        });
      })
      .with({ type: MESSAGE_TYPES.STATE_UPDATE }, (m) => {
        setTabsById((prev) => {
          const tab = prev[m.tabId] || {};
          const now = Date.now();
          if (tab.lockedUntil && now < tab.lockedUntil) return prev;
          return {
            ...prev,
            [m.tabId]: {
              ...tab,
              [m.key]: m.value,
              lastUpdateAt: m.timestamp,
            },
          };
        });
      })
      .otherwise(() => {});
  };
}
