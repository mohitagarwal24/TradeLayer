import Alpaca from "@alpacahq/alpaca-trade-api";
import dotenv from "dotenv";

dotenv.config();

const { ALPACA_KEY_ID, ALPACA_SECRET_KEY, ALPACA_PAPER } = process.env;

if (!ALPACA_KEY_ID || !ALPACA_SECRET_KEY) {
  throw new Error(
    "Missing ALPACA_KEY_ID / ALPACA_SECRET_KEY. Copy .env.example to .env and fill them in."
  );
}

/// Shared Alpaca client. Credentials come from the environment only — they must
/// never be hardcoded, since this repo previously leaked a key pair into git.
export const alpaca = new Alpaca({
  keyId: ALPACA_KEY_ID,
  secretKey: ALPACA_SECRET_KEY,
  paper: ALPACA_PAPER !== "false", // paper trading unless explicitly disabled
});
