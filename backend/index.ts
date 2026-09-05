import express from "express";
import { Events } from "./components/contractListener";
import {listenToOrderEvents} from "./components/alpacaListener";

const app = express();
const PORT = 8000;

app.use(express.json());

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