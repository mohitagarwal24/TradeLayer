import express from "express";
import { Events } from "./components/contractListener";
import { listenToOrderEvents } from "./components/alpacaListener";
import { publicKeyHandler, ephemeralKeyHandler } from "./components/keyExchange";
import { requireX402Payment } from "./components/x402Gate";
import { orderStatusHandler, portfolioHandler } from "./components/paidApi";

const app = express();
const PORT = Number(process.env.PORT ?? 8000);

app.use(express.json());

// Order-privacy key exchange (free)
app.get("/public-key", publicKeyHandler);
app.post("/ephemeral-key", ephemeralKeyHandler);

// x402-gated data APIs — Blocky402 facilitator on Hedera testnet
app.get(
  "/order-status/:orderId",
  requireX402Payment("TradeLayer order status (pay-per-call)"),
  orderStatusHandler,
);
app.get(
  "/portfolio/:address",
  requireX402Payment("TradeLayer portfolio snapshot (pay-per-call)"),
  portfolioHandler,
);

async function startServer() {
  app.listen(PORT, async () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log("x402 gates: GET /order-status/:orderId , GET /portfolio/:address");
    try {
      Events();
      await listenToOrderEvents();
    } catch (err) {
      console.warn("Settlement listeners deferred (missing contract/Alpaca env?):", (err as Error).message);
    }
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});

export { app };
