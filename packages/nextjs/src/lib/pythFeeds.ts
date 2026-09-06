/** Chain-agnostic Pyth equity feed ids (same on every network). */
export const STOCKS = ["AAPL", "GOOGL", "TSLA", "MSFT"] as const;
export type StockSymbol = (typeof STOCKS)[number];

export const PYTH_IDS: Record<StockSymbol, `0x${string}`> = {
  AAPL: "0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
  GOOGL: "0x5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6",
  TSLA: "0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
  MSFT: "0xd0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1",
};

export const HERMES_URL = "https://hermes.pyth.network";
