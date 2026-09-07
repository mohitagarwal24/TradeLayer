import express from "express";
import { Events } from "./components/contractListener";
import { listenToOrderEvents } from "./components/alpacaListener";
import { publicKeyHandler, ephemeralKeyHandler } from "./components/keyExchange";
import { requireX402Payment } from "./components/x402Gate";
import {
  orderStatusHandler,
  portfolioHandler,
  validateOrderStatusResource,
  validatePortfolioResource,
} from "./components/paidApi";
import { privatePortfolioHandler } from "./components/privatePortfolio";
import { getSupportedPythBenchmarks } from "./components/pythOracle";

const app = express();
const PORT = Number(process.env.PORT ?? 8000);

app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.FRONTEND_ORIGIN ?? "http://localhost:8080");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, PAYMENT-SIGNATURE, X-PORTFOLIO-TIMESTAMP, X-PORTFOLIO-SIGNATURE",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (_req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// Order-privacy key exchange (free)
app.get("/public-key", publicKeyHandler);
app.post("/ephemeral-key", ephemeralKeyHandler);
app.get("/private-portfolio/:address", privatePortfolioHandler);
app.get("/prices", async (_req, res) => {
  try {
    const benchmarks = await getSupportedPythBenchmarks();
    res.json({
      prices: Object.fromEntries(
        benchmarks.map(({ symbol, price, confidence, publishTime }) => [
          symbol,
          { price, confidence, publishTime },
        ]),
      ),
    });
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

// x402-gated data APIs — Blocky402 facilitator on Hedera testnet
app.get(
  "/order-status/:orderId",
  requireX402Payment("TradeLayer order status (pay-per-call)", validateOrderStatusResource),
  orderStatusHandler,
);
app.get(
  "/portfolio/:address",
  requireX402Payment("TradeLayer aggregate portfolio snapshot (pay-per-call)", validatePortfolioResource),
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
