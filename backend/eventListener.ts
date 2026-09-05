import Alpaca from "@alpacahq/alpaca-trade-api";

const alpaca = new Alpaca({
  keyId: "REDACTED_ALPACA_KEY_ID",
  secretKey: "REDACTED_ALPACA_SECRET",
  paper: true // set false for live trading
});

// Connect to WebSocket
const socket = alpaca.trade_ws;

socket.onConnect(() => {
  console.log("🔌 Connected to Alpaca WebSocket");

  // Subscribe to updates
  socket.subscribe([
    'trade_updates' // <-- this is the event stream you need
  ]);
});

socket.onStateChange((state) => {
  console.log("Socket state:", state);
});

// Listen to order update messages:
socket.onOrderUpdate((update) => {
  console.log("📢 ORDER UPDATE RECEIVED:");
  console.log(JSON.stringify(update, null, 2));
});

// Error handling
socket.onError((err) => {
  console.error("❌ WebSocket Error:", err);
});

// Start streaming
socket.connect();
