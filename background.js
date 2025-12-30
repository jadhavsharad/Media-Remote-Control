// =====================
// Pairing
// =====================
const pairCode = Math.random()
  .toString(36)
  .slice(2, 8)
  .toUpperCase();

console.log("🔑 Pair code:", pairCode);

// =====================
// WebSocket
// =====================
let socket = null;

function connectWebSocket() {
  socket = new WebSocket("ws://localhost:3000");

  socket.onopen = () => {
    socket.send(
      JSON.stringify({
        type: "PAIR",
        pairCode
      })
    );
  };

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    forwardToActiveTab(msg);
  };

  socket.onclose = () => {
    console.log("❌ WS closed, reconnecting...");
    socket = null;
    setTimeout(connectWebSocket, 1000);
  };
}

connectWebSocket();

// =====================
// Runtime Messages
// =====================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "STATE_UPDATE") {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }

  if (msg.type === "GET_PAIRING_CODE") {
    sendResponse({ pairCode });
  }
});

// =====================
// Command Forwarding
// =====================
function isAllowed(msg) {
  return msg.action === "TOGGLE_PLAYBACK";
}

function forwardToActiveTab(msg) {
  if (!isAllowed(msg)) return;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs.length) return;
    chrome.tabs.sendMessage(tabs[0].id, msg);
  });
}
