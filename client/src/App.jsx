import { useEffect, useRef, useState, useCallback } from "react";

const WS_URL = "ws://localhost:3001";
const RECONNECT_DELAY = 2000;

// Protocol Constants (matching extension/constants.js)
const MSG = {
  JOIN_PAIR: 'JOIN_PAIR',
  PAIR_JOINED: 'PAIR_JOINED',
  PAIR_INVALID: 'PAIR_INVALID',
  MEDIA_TABS_LIST: 'MEDIA_TABS_LIST',
  STATE_UPDATE: 'STATE_UPDATE',
  SELECT_ACTIVE_TAB: 'SELECT_ACTIVE_TAB',
  CONTROL_EVENT: 'CONTROL_EVENT',
  TOGGLE_PLAYBACK: 'TOGGLE_PLAYBACK'
};

export default function App() {
  // -- State: Persistence & Connection --
  const [sessionIdentity, setSessionIdentity] = useState(() => {
    return localStorage.getItem("last_session_id") || "";
  });
  const [connectionStatus, setConnectionStatus] = useState("Disconnected"); // Disconnected, Connecting, Connected, Paired
  
  // -- State: Remote Context --
  const [remoteId, setRemoteId] = useState(null);
  const [mediaTabs, setMediaTabs] = useState([]);
  const [selectedTabId, setSelectedTabId] = useState(null);
  const [playbackState, setPlaybackState] = useState("Play");
  
  // -- Refs --
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const isMounted = useRef(true);

  // -- Helper: Send Message Securely --
  const send = useCallback((msg) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    } else {
      console.warn("⚠️ Cannot send, WS not open");
    }
  }, []);

  // -- WebSocket Lifecycle & Auto-Reconnect --
  useEffect(() => {
    isMounted.current = true;

    const connect = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      setConnectionStatus((prev) => prev === "Paired" ? prev : "Connecting...");
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMounted.current) return;
        console.log("🟢 WS Connected");
        setConnectionStatus("Connected");
      };

      ws.onclose = () => {
        if (!isMounted.current) return;
        console.log("🔴 WS Closed");
        setConnectionStatus("Disconnected");
        setRemoteId(null);
        // Clear paired state but keep sessionIdentity
        setMediaTabs([]);
        
        // Auto-reconnect
        reconnectTimeoutRef.current = setTimeout(connect, RECONNECT_DELAY);
      };

      ws.onerror = (err) => {
        console.error("⚠️ WS Error:", err);
        ws.close(); // Trigger onclose to reconnect
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleMessage(msg);
        } catch (e) {
          console.error("❌ Failed to parse message", e);
        }
      };
    };

    connect();

    return () => {
      isMounted.current = false;
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, []);

  // -- Message Handler --
  const handleMessage = (msg) => {
    if (!msg?.type) return;

    switch (msg.type) {
      case MSG.PAIR_JOINED:
        setRemoteId(msg.remoteId);
        setConnectionStatus("Paired");
        // Save valid session ID for future
        localStorage.setItem("last_session_id", sessionIdentity);
        break;

      case MSG.PAIR_INVALID:
        setConnectionStatus("Invalid Session");
        setRemoteId(null);
        setTimeout(() => setConnectionStatus("Connected"), 2000);
        break;

      case MSG.MEDIA_TABS_LIST:
        if (Array.isArray(msg.tabs)) {
          setMediaTabs(msg.tabs);
          // Invariant: If selected tab is no longer in list, deselect it
          if (selectedTabId && !msg.tabs.find(t => t.tabId === selectedTabId)) {
            setSelectedTabId(null);
          }
        }
        break;

      case MSG.STATE_UPDATE:
        setPlaybackState(msg.state === "PLAYING" ? "Pause" : "Play");
        break;

      default:
        break;
    }
  };

  // -- User Actions --

  const handleJoin = () => {
    if (!sessionIdentity.trim()) return;
    
    // Security: Basic alphanumeric check
    if (!/^[a-zA-Z0-9-_]+$/.test(sessionIdentity)) {
        setConnectionStatus("Invalid Chars");
        setTimeout(() => setConnectionStatus("Connected"), 1500);
        return;
    }

    send({
      type: MSG.JOIN_PAIR,
      SESSION_IDENTITY: sessionIdentity
    });
    setConnectionStatus("Joining...");
  };

  const handleDisconnect = () => {
    setRemoteId(null);
    setMediaTabs([]);
    setSelectedTabId(null);
    setConnectionStatus("Connected");
    setPlaybackState("Play");
    // Optionally notify server if protocol supports explicit leave
  };

  const handleSelectTab = (tabId) => {
    if (!remoteId) return;
    setSelectedTabId(tabId);
    send({
      type: MSG.SELECT_ACTIVE_TAB,
      remoteId,
      tabId
    });
  };

  const handleTogglePlayback = () => {
    if (!remoteId || !selectedTabId) return;
    send({
      type: MSG.CONTROL_EVENT,
      remoteId,
      action: MSG.TOGGLE_PLAYBACK
    });
  };

  // -- Render Helpers --
  const isPaired = connectionStatus === "Paired";
  const isSocketOpen = connectionStatus !== "Disconnected" && connectionStatus !== "Connecting...";

  return (
    <div className="bg-zinc-950 min-h-screen text-white flex flex-col items-center justify-center p-4 font-sans">
      
      {/* Main Card */}
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl flex flex-col gap-6">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
          <h1 className="text-xl font-bold tracking-tight text-zinc-100">
            Remote Control
          </h1>
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${
              connectionStatus === "Paired" ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" : 
              connectionStatus === "Connected" ? "bg-yellow-500" : "bg-red-500"
            }`} />
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
              {connectionStatus}
            </span>
          </div>
        </div>

        {/* View: Join Session */}
        {!isPaired && (
          <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="space-y-1">
              <label className="text-xs text-zinc-500 font-bold ml-4">SESSION IDENTITY</label>
              <input
                className="w-full text-center tracking-widest"
                placeholder="ENTER ID"
                value={sessionIdentity}
                onChange={(e) => setSessionIdentity(e.target.value)}
                disabled={!isSocketOpen}
              />
            </div>
            <button
              onClick={handleJoin}
              disabled={!isSocketOpen || !sessionIdentity}
              className="elegant-button w-full hover:bg-zinc-700 active:scale-95 disabled:opacity-50"
            >
              {isSocketOpen ? "Connect to Device" : "Connecting..."}
            </button>
          </div>
        )}

        {/* View: Remote Controls */}
        {isPaired && (
          <div className="flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-300">
            
            {/* Session Info & Disconnect */}
            <div className="bg-zinc-950/50 rounded-2xl p-4 border border-zinc-800 flex justify-between items-center">
              <div className="flex flex-col">
                <span className="text-[10px] text-zinc-500 font-bold uppercase">Linked to</span>
                <span className="text-sm font-mono text-zinc-300 truncate max-w-30">
                  {sessionIdentity}
                </span>
              </div>
              <button 
                onClick={handleDisconnect}
                className="text-xs bg-red-500/10 text-red-500 px-3 py-1.5 rounded-full font-bold hover:bg-red-500/20 transition-colors"
              >
                Disconnect
              </button>
            </div>

            {/* Media Tabs List */}
            <div className="flex flex-col gap-3">
              <div className="text-xs text-zinc-500 font-bold ml-2 flex justify-between">
                <span>AVAILABLE MEDIA</span>
                <span>{mediaTabs.length} FOUND</span>
              </div>
              
              <div className="flex flex-col gap-2 max-h-50 overflow-y-auto pr-1 custom-scrollbar">
                {mediaTabs.length === 0 && (
                  <div className="text-center py-6 text-zinc-600 text-sm italic">
                    No media tabs found on device.
                  </div>
                )}
                
                {mediaTabs.map(tab => (
                  <button
                    key={tab.tabId}
                    onClick={() => handleSelectTab(tab.tabId)}
                    className={`
                      w-full p-4 rounded-2xl text-left transition-all duration-200 border-2
                      flex items-center gap-3 group
                      ${selectedTabId === tab.tabId 
                        ? "bg-zinc-100 text-black border-white shadow-lg scale-[1.02]" 
                        : "bg-zinc-800/50 border-transparent text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                      }
                    `}
                  >
                    <div className={`w-2 h-2 rounded-full ${selectedTabId === tab.tabId ? "bg-green-500" : "bg-zinc-600"}`} />
                    <span className="truncate text-sm font-semibold">{tab.title}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Playback Control */}
            <button
              disabled={!selectedTabId}
              onClick={handleTogglePlayback}
              className={`
                elegant-button w-full h-16 text-lg tracking-widest uppercase
                flex items-center justify-center gap-3
                ${!selectedTabId ? "opacity-30 cursor-not-allowed" : "hover:bg-zinc-700 shadow-xl"}
              `}
            >
              {playbackState === "Play" ? "▶ Play" : "⏸ Pause"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}