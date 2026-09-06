import express from "express";
import { Events } from "./components/contractListener";
import { listenToOrderEvents } from "./components/alpacaListener";
import { publicKeyHandler, ephemeralKeyHandler } from "./components/keyExchange";

const app = express();
const PORT = 8000;

app.use(express.json());

// Order-privacy key exchange
app.get("/public-key", publicKeyHandler);
app.post("/ephemeral-key", ephemeralKeyHandler);

async function startServer() {
  // Start server
  app.listen(PORT, async () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
    Events();
    await listenToOrderEvents();
  });
}

// Start the async initialization
startServer().catch((err) => {
  console.error("❌ Failed to start server:", err);
});

export { app };
