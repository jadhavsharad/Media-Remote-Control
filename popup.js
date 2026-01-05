const codeDiv = document.getElementById("PAIRING_CODE");
const qrCanvas = document.getElementById("PAIRING_QR");

chrome.runtime.sendMessage({ type: "GET_PAIRING_CODE" }, (res) => {
  const pairCode = res.pairCode;
  codeDiv.textContent = "Code: " + pairCode;

  const url = `http://192.168.0.107:5173/?pair=${pairCode}`;

  new QRCode(qrCanvas, {
    text: url,
    width: 200,
    height: 200
  });
});
