
let webSocket = null;

function connect() {
  webSocket = new WebSocket('ws://localhost:3000');

  webSocket.onopen = (event) => {
    console.log('websocket open');
  };

  webSocket.onmessage = (event) => {
    console.log(`websocket received message: ${event.data}`);
    forwardToTab(JSON.parse(event.data));
  };

  webSocket.onclose = (event) => {
    console.log('websocket connection closed');
    webSocket = null;
  };
}

function disconnect() {
  if (webSocket == null) {
    return;
  }
  webSocket.close();
}

connect();

const forwardToTab = (msg) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    console.log(tabs)
    chrome.tabs.sendMessage(tabs[0].id, msg, () => {
      if (chrome.runtime.lastError) {
        console.log("❌ No content script to notify about tab update");
      }
    })
  });
}