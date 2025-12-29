chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "TOGGLE_PLAYBACK") {
    const video = document.querySelector("video");
    if (!video) return;
    video.paused ? video.play() : video.pause();
  }
});
