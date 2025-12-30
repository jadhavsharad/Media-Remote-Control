let currentVideo = null;

function sendState(video) {
  chrome.runtime.sendMessage({
    type: "STATE_UPDATE",
    state: video.paused ? "PAUSED" : "PLAYING"
  });
}

function attachVideo(video) {
  if (currentVideo === video) return;
  if (currentVideo) {
    currentVideo.removeEventListener("play", onPlay);
    currentVideo.removeEventListener("pause", onPause);
  }
  currentVideo = video;
  video.addEventListener("play", () => sendState(video));
  video.addEventListener("pause", () => sendState(video));
}

function observeVideoElement() {
  const observer = new MutationObserver(() => {
    const video = document.querySelector("video");
    if (video) attachVideo(video), observer.disconnect();;
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

observeVideoElement();


chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action !== "TOGGLE_PLAYBACK") return;
  if (!currentVideo) return;
  currentVideo.paused ? currentVideo.play() : currentVideo.pause();
});
