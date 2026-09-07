import { useScaffoldReadContract } from "~~/hooks/scaffold-eth/useScaffoldReadContract";
import { formatUnits } from "viem";
import { TrendingUp, TrendingDown } from "lucide-react";
import { STOCK_META } from "@/lib/format";
import { STOCKS } from "@/lib/pythFeeds";

export function MarketTicker() {
  const { data: tsla } = useScaffoldReadContract({
    contractName: "TradeLayer",
    functionName: "getStockPriceUnsafe",
    args: ["TSLA"],
  });
  const { data: voo } = useScaffoldReadContract({
    contractName: "TradeLayer",
    functionName: "getStockPriceUnsafe",
    args: ["VOO"],
  });
  const { data: qqq } = useScaffoldReadContract({
    contractName: "TradeLayer",
    functionName: "getStockPriceUnsafe",
    args: ["QQQ"],
  });

  const prices: Record<string, bigint | undefined> = { TSLA: tsla, VOO: voo, QQQ: qqq };

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {STOCKS.map(s => {
        const p = prices[s];
        const value = p !== undefined ? Number(formatUnits(p, 18)) : undefined;
        return (
          <div key={s} className="glass-card flex items-center gap-2 rounded-full px-4 py-1.5 text-sm">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STOCK_META[s]?.color }} />
            <span className="font-medium">{s}</span>
            <span className="font-mono tabular-nums text-muted-foreground">
              {value !== undefined ? `$${value.toFixed(2)}` : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Small inline price display with trend arrow (used in portfolio rows). */
export function PriceTag({ symbol, price }: { symbol: string; price?: number }) {
  if (price === undefined) return <span className="text-muted-foreground">—</span>;
  const up = price >= 0;
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums ${up ? "text-success" : "text-destructive"}`}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}${price.toFixed(2)}
    </span>
  );
}
