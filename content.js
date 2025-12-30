console.log("🎬 Content script active");

// =====================
// Playback State
// =====================
let currentVideo = null;

// =====================
// State Reporting
// =====================
function sendState(video) {
  chrome.runtime.sendMessage({
    type: "STATE_UPDATE",
    state: video.paused ? "PAUSED" : "PLAYING"
  });
}

// =====================
// Video Attachment
// =====================
function attachVideo(video) {
  if (currentVideo === video) return;

  currentVideo = video;
  console.log("🎥 Attached video element");

  video.addEventListener("play", () => sendState(video));
  video.addEventListener("pause", () => sendState(video));
}

// =====================
// SPA Observer (YouTube-safe)
// =====================
function observeVideoElement() {
  const observer = new MutationObserver(() => {
    const video = document.querySelector("video");
    if (video) attachVideo(video);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

observeVideoElement();

// =====================
// Command Handler
// =====================
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action !== "TOGGLE_PLAYBACK") return;
  if (!currentVideo) return;

  currentVideo.paused
    ? currentVideo.play()
    : currentVideo.pause();
});
