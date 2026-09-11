import "dotenv/config";

const HERMES_URL = process.env.PYTH_HERMES_URL ?? "https://pyth.dourolabs.app/hermes";
const MAX_AGE_SECONDS = Number(process.env.PYTH_MAX_AGE_SECONDS ?? "90");
const MAX_CONFIDENCE_BPS = Number(process.env.PYTH_MAX_CONFIDENCE_BPS ?? "100");
const MAX_FILL_DEVIATION_BPS = Number(process.env.PYTH_MAX_FILL_DEVIATION_BPS ?? "500");

const PRICE_IDS: Record<string, string> = {
  TSLA: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
  VOO: "236b30dd09a9c00dfeec156c7b1efd646c0f01825a1758e3e4a0679e3bdff179",
  QQQ: "9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d",
};
const CACHE_MS = 15_000;
const cache = new Map<string, { benchmark: PythBenchmark; receivedAt: number }>();

export type PythBenchmark = {
  symbol: string;
  price: number;
  confidence: number;
  publishTime: number;
  priceId: string;
};

export async function getPythBenchmark(symbolInput: string): Promise<PythBenchmark> {
  const symbol = symbolInput.toUpperCase();
  const priceId = PRICE_IDS[symbol];
  if (!priceId) throw new Error(`Unsupported Pyth equity feed: ${symbol}`);
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.receivedAt < CACHE_MS) return cached.benchmark;

  const apiKey = process.env.PYTH_API_KEY;
  if (!apiKey) throw new Error("Set PYTH_API_KEY for authenticated Hermes access");

  const query = new URLSearchParams();
  query.append("ids[]", priceId);
  const response = await fetch(`${HERMES_URL}/v2/updates/price/latest?${query}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Hermes price request failed: ${response.status}${detail ? ` (${detail})` : ""}`);
  }

  const body = (await response.json()) as {
    parsed?: Array<{
      id: string;
      price: { price: string; conf: string; expo: number; publish_time: number };
    }>;
  };
  const parsed = body.parsed?.find(item => item.id.toLowerCase() === priceId);
  if (!parsed) throw new Error(`Hermes returned no ${symbol} price`);

  const scale = 10 ** parsed.price.expo;
  const price = Number(parsed.price.price) * scale;
  const confidence = Number(parsed.price.conf) * scale;
  const age = Math.floor(Date.now() / 1000) - parsed.price.publish_time;

  if (!Number.isFinite(price) || price <= 0) throw new Error(`Invalid Pyth ${symbol} price`);
  if (age < 0 || age > MAX_AGE_SECONDS) {
    throw new Error(`Stale Pyth ${symbol} price (${age}s old)`);
  }
  if ((confidence * 10_000) / price > MAX_CONFIDENCE_BPS) {
    throw new Error(`Pyth ${symbol} confidence interval is too wide`);
  }

  const benchmark = { symbol, price, confidence, publishTime: parsed.price.publish_time, priceId: `0x${priceId}` };
  cache.set(symbol, { benchmark, receivedAt: Date.now() });
  return benchmark;
}

export async function getSupportedPythBenchmarks() {
  return Promise.all(Object.keys(PRICE_IDS).map(getPythBenchmark));
}

export function assertFillNearBenchmark(fillPrice: number, benchmark: PythBenchmark) {
  if (!Number.isFinite(fillPrice) || fillPrice <= 0) throw new Error("Invalid Alpaca fill price");
  const deviationBps = (Math.abs(fillPrice - benchmark.price) * 10_000) / benchmark.price;
  if (deviationBps > MAX_FILL_DEVIATION_BPS) {
    throw new Error(
      `Alpaca ${benchmark.symbol} fill deviates ${deviationBps.toFixed(1)} bps from Pyth (max ${MAX_FILL_DEVIATION_BPS})`,
    );
  }
  return deviationBps;
}
