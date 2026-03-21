/**
 * useRemoteConnection.js — Thin orchestrator
 * Wires useWebSocket, createMessageHandler, sessionStorage, and user actions together.
 * Contains no transport or persistence logic directly.
 */
import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { MESSAGE_TYPES } from "../constants/constants";
import { useWebSocket } from "./useWebSocket";
import { createMessageHandler } from "../lib/messageHandlers";
import { getToken, setToken } from "../lib/sessionStorage";

const WS_URL = import.meta.env.VITE_WS_URL;
const OPTIMISTIC_LOCK_DURATION = 1000; // ms to ignore server updates after user interaction

export const useRemoteConnection = () => {
    const [status, setStatus] = useState(MESSAGE_TYPES.DISCONNECTED);
    const [tabsById, setTabsById] = useState({});
    const [activeTabId, setActiveTabId] = useState(null);
    const [hostInfo, setHostInfo] = useState(null);

    useEffect(() => {
        if (activeTabId && !tabsById[activeTabId]) {
            setActiveTabId(null);
        }
    }, [tabsById, activeTabId]);


    // --- Message Handler ---
    const handleMessage = useCallback(
        createMessageHandler({ setToken, setHostInfo, setStatus, setTabsById }),
        [setToken, setHostInfo, setStatus, setTabsById]
    );

    // --- WS Lifecycle Callbacks ---
    const handleOpen = useCallback((ws) => {
        const token = getToken();
        if (token) {
            setStatus(MESSAGE_TYPES.VERIFYING);
            ws.send(JSON.stringify({ type: MESSAGE_TYPES.VALIDATE_SESSION, trustToken: token }));
        } else {
            setStatus(MESSAGE_TYPES.CONNECTED);
        }
    }, []);

    const handleClose = useCallback(() => {
        setStatus(MESSAGE_TYPES.DISCONNECTED);
    }, []);

    // --- Transport Layer ---
    const { send, isOpen } = useWebSocket(WS_URL, {
        onOpen: handleOpen,
        onMessage: handleMessage,
        onClose: handleClose,
    });

    // --- User Actions ---

    const pair = useCallback((code) => {
        if (!isOpen()) return;
        send({ type: MESSAGE_TYPES.EXCHANGE_PAIR_KEY, code });
        setStatus(MESSAGE_TYPES.VERIFYING);
    }, [send, isOpen]);

    const updateTabState = useCallback((tabId, key, value) => {
        if (!isOpen()) {
            toast.error("Not connected to host");
            return;
        }
        setTabsById((prev) => {
            const tab = prev[tabId];
            if (!tab) return prev;
            return {
                ...prev,
                [tabId]: { ...tab, [key]: value, lockedUntil: Date.now() + OPTIMISTIC_LOCK_DURATION },
            };
        });
        send({ type: MESSAGE_TYPES.STATE_UPDATE, intent: MESSAGE_TYPES.INTENT.SET, key, value, tabId });
    }, [send, isOpen]);

    const selectTab = useCallback((tabId) => {
        setActiveTabId(tabId);
        send({ type: MESSAGE_TYPES.SELECT_ACTIVE_TAB, tabId });
    }, [send]);

    const disconnect = useCallback(() => {
        setToken(null);
        setStatus(MESSAGE_TYPES.DISCONNECTED);
        globalThis.location.reload();
    }, []);

    const openNewTab = useCallback((url) => {
        send({ type: MESSAGE_TYPES.NEW_TAB, url });
    }, [send]);

    return {
        status,
        hostInfo,
        tabsById,
        activeTabId,
        activeTab: activeTabId ? tabsById[activeTabId] : null,
        pair,
        updateTabState,
        selectTab,
        disconnect,
        openNewTab,
    };
};