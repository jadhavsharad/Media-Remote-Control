const ws = new WebSocket("ws://localhost:3000");

ws.onopen = () => {
  console.log("Popup WS connected");
};

document.getElementById("btn").onclick = () => {
  ws.send(
    JSON.stringify({
      action: "TOGGLE_PLAYBACK"
    })
  );
};
