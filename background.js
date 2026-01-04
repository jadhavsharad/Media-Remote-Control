import TRIGGERS from "./constants.js"

const hostId = chrome.runtime.id;
let socket = null;
let SESSION_IDENTITY = null

function GENERATE_SESSION_IDENTITY() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function GET_SESSION_IDENTITY() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["SESSION_IDENTITY"], (result) => {
      if (result.SESSION_IDENTITY) {
        resolve(result.SESSION_IDENTITY);
      } else {
        const newCode = GENERATE_SESSION_IDENTITY();
        chrome.storage.local.set({ SESSION_IDENTITY: newCode }, () => {
          resolve(newCode);
        });
      }
    });
  });
}


async function connectWebSocket() {
  // implement error catch if server does not work it will show error and then only session identity generation
  socket = new WebSocket("ws://localhost:3000"); 
  SESSION_IDENTITY =  await GET_SESSION_IDENTITY();

  socket.onopen = () => {
    socket.send(JSON.stringify({
      type: TRIGGERS.REGISTER_HOST,
      SESSION_IDENTITY,
      hostId: hostId
    })
    );
  };

  socket.onmessage = (event) => {
    let response;
    try {
      response = JSON.parse(event.data);
    } catch {
      return;
    }
    
    if (!response?.type) return;
    
    if (response.type === TRIGGERS.HOST_REGISTERED) {
      console.log("Pair with the key: ", SESSION_IDENTITY)
    }
    if (response.type === TRIGGERS.REMOTE_JOIN_REQUEST) {
      console.log(response.deviceId)
      socket.send(JSON.stringify({
        type: TRIGGERS.REMOTE_APPROVED,
        deviceId: response.deviceId
      }))
    }
    if (response.type === TRIGGERS.CONTROL_EVENT) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs.length) return;
        chrome.tabs.sendMessage(tabs[0].id, response);
      });
    }
    if (response.type === TRIGGERS.PAIR_INVALID) {
      console.warn("Pair invalid:", response.reason);
    }
  }

  socket.onclose = () => {
    socket = null;
    setTimeout(connectWebSocket, 1000);
  };
}

connectWebSocket();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === TRIGGERS.STATE_UPDATE) {
    console.log("State update:", msg.state);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }

  // if (msg.type === "GET_PAIRING_CODE") {
  //   sendResponse({ SESSION_IDENTITY });
  //   return true;
  // }
});

function isAllowed(msg) {
  return msg.action === "TOGGLE_PLAYBACK";
}

function forwardToActiveTab(msg) {
  if (!isAllowed(msg)) return;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs.length) return;

    chrome.tabs.sendMessage(tabs[0].id, msg).catch((err) => {
      console.error("Failed to send message to content script:", err);
    });
  });
}

chrome.tabs.onCreated.addListener(tab => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "TAB_CREATED",
      tabId: tab.id,
      url: tab.url || "",
      title: tab.title || "",
      status: tab.status || ""
    }));
  }
  console.log("🆕 Created:", tab.id);
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "TAB_CLOSED",
      tabId: tabId
    }));
  }
  console.log("❌ Removed:", tabId);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, tab => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: "TAB_ACTIVATED",
        tabId: tab.id,
        url: tab.url || "",
        title: tab.title || ""
      }));
    }
    console.log("🎯 Active:", tab.id, tab.url);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    console.log("✅ Loaded:", tab.id, tab.url);
  }
});


function listAllTabs() {
  chrome.tabs.query({}, (tabs) => {
    console.log("All open tabs:", tabs);
  });
}

// listAllTabs();

function getDeviceInfo() {
  const info = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    isOnline: navigator.onLine,
    deviceMemory: navigator.deviceMemory || 'N/A',
    isMobile: navigator.userAgentData ? navigator.userAgentData.mobile : undefined,
    appName: navigator.appName,
    appVersion: navigator.appVersion,
    vendor: navigator.vendor,
    hardwareConcurrency: navigator.hardwareConcurrency || 'N/A',
    appCodeName: navigator.appCodeName,
    product: navigator.product,
    productSub: navigator.productSub,
    buildID: navigator.buildID || 'N/A',
    cookieEnabled: navigator.cookieEnabled,
    doNotTrack: navigator.doNotTrack || 'N/A',
    platform: navigator.platform,
    extensionID: chrome.runtime.id




  };
  console.log("Device Information:", info);
  return info;
}

// getDeviceInfo()