/** Chain-agnostic Pyth equity feed ids (trial-entitled: TSLA, VOO, QQQ). */
export const STOCKS = ["TSLA", "VOO", "QQQ"] as const;
export type StockSymbol = (typeof STOCKS)[number];

export const PYTH_IDS: Record<StockSymbol, `0x${string}`> = {
  TSLA: "0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
  VOO: "0x236b30dd09a9c00dfeec156c7b1efd646c0f01825a1758e3e4a0679e3bdff179",
  QQQ: "0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d",
};
