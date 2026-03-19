/**
 * useWebSocket.js
 * Pure WebSocket transport hook. Manages connection lifecycle and reconnection.
 * Has no domain knowledge — accepts an onMessage callback for message handling.
 */
import { useEffect, useRef, useCallback } from "react";
import { MESSAGE_TYPES } from "../constants/constants";

const RECONNECT_DELAY = 2000;

/**
 * Manages a WebSocket connection with automatic reconnection.
 *
 * @param {string} url - WebSocket server URL
 * @param {Function} onOpen   - Called when the connection opens; receives the WebSocket instance
 * @param {Function} onMessage - Called with each parsed incoming message
 * @param {Function} onClose  - Called when the connection closes
 * @returns {{ send: Function, isOpen: Function, wsRef: React.MutableRefObject }}
 */
export function useWebSocket(url, { onOpen, onMessage, onClose }) {
  const wsRef = useRef(null);
  const isMounted = useRef(true);
  const reconnectTimeoutRef = useRef(null);

  // Stable callbacks via refs to avoid reconnecting on every render
  const onOpenRef = useRef(onOpen);
  const onMessageRef = useRef(onMessage);
  const onCloseRef = useRef(onClose);

  useEffect(() => { onOpenRef.current = onOpen; }, [onOpen]);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const isOpen = useCallback(() => {
    return wsRef.current?.readyState === WebSocket.OPEN;
  }, []);

  const send = useCallback((msg) => {
    if (!isOpen()) return;
    wsRef.current.send(JSON.stringify(msg));
  }, [isOpen]);

  useEffect(() => {
    isMounted.current = true;

    const connect = () => {
      if (isOpen() || wsRef.current?.readyState === WebSocket.CONNECTING) return;

      const ws = new WebSocket(url);

      ws.onopen = () => {
        if (!isMounted.current) return;
        onOpenRef.current?.(ws);
      };

      ws.onclose = () => {
        if (!isMounted.current) return;
        onCloseRef.current?.();
        reconnectTimeoutRef.current = setTimeout(connect, RECONNECT_DELAY);
      };

      ws.onmessage = (event) => {
        try {
          onMessageRef.current?.(JSON.parse(event.data));
        } catch (e) {
          console.error("[useWebSocket] Parse error", e);
        }
      };

      wsRef.current = ws;
    };

    connect();

    return () => {
      isMounted.current = false;
      wsRef.current?.close();
      clearTimeout(reconnectTimeoutRef.current);
    };
    // url is intentionally the only dependency — reconnect if the URL changes
  }, [url, isOpen]);

  return { send, isOpen, wsRef };
}
