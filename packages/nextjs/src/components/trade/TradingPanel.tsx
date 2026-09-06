import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { formatUnits } from "viem";
import { toast } from "sonner";
import { ArrowDownUp, ShieldCheck, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useTransactor } from "~~/hooks/scaffold-eth/useTransactor";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth/useScaffoldReadContract";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth/useScaffoldWriteContract";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth/useDeployedContractInfo";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { fmtShares, fmtUsdc, parseUsdc } from "@/lib/format";
import { sealOrder } from "@/lib/sealOrder";
import { HERMES_URL, PYTH_IDS, STOCKS, type StockSymbol } from "@/lib/pythFeeds";

// Backend key-exchange API (order privacy). Set in .env for production.
const BACKEND_API = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8000";

type LivePrice = { price: number };

/** Fetches fresh prices from Pyth's Hermes API so the UI shows market truth even before settlement. */
function useLivePrices() {
  const [prices, setPrices] = useState<Partial<Record<StockSymbol, LivePrice>>>({});

  useEffect(() => {
    let cancelled = false;

    const fetchOnce = async () => {
      try {
        const ids = Object.values(PYTH_IDS).join("&ids[]=");
        const res = await fetch(`${HERMES_URL}/v2/updates/price/latest?${ids}`);
        const json = await res.json();
        if (cancelled) return;

        const next: Partial<Record<StockSymbol, LivePrice>> = {};
        for (const parsed of json.parsed ?? []) {
          const symbol = (Object.keys(PYTH_IDS) as StockSymbol[]).find(
            (s) => PYTH_IDS[s].toLowerCase() === `0x${parsed.id}`.toLowerCase(),
          );
          if (!symbol) continue;
          next[symbol] = { price: Number(parsed.price.price) * 10 ** parsed.price.expo };
        }
        setPrices(next);
      } catch {
        // Hermes unreachable (offline dev) — fall back to on-chain values.
      }
    };

    fetchOnce();
    const interval = setInterval(fetchOnce, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return prices;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export function TradingPanel() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { targetNetwork } = useTargetNetwork();
  const writeTx = useTransactor();

  const [mode, setMode] = useState<"buy" | "redeem">("buy");
  const [symbol, setSymbol] = useState<StockSymbol>("AAPL");
  const [usdcAmount, setUsdcAmount] = useState("");
  const [shareAmount, setShareAmount] = useState("");

  // --- contract reads -------------------------------------------------------

  const { data: deployed } = useDeployedContractInfo({ contractName: "TradeLayer" });
  const tradeLayerAddress = deployed?.address;

  const { data: price18 } = useScaffoldReadContract({
    contractName: "TradeLayer",
    functionName: "getStockPriceUnsafe",
    args: [symbol],
  });

  // Real USDC on Hedera testnet comes via externalContracts under the same
  // display name; on local chains it resolves to the deployed MockUSDC.
  const { data: usdcBalance } = useScaffoldReadContract({
    contractName: "MockUSDC",
    functionName: "balanceOf",
    args: [address ?? ZERO_ADDRESS],
    watch: true,
  });

  const { data: dstockBalance } = useScaffoldReadContract({
    contractName: "TradeLayer",
    functionName: "balanceOf",
    args: [address ?? ZERO_ADDRESS],
    watch: true,
  });

  const { data: lockedForRedeem } = useScaffoldReadContract({
    contractName: "TradeLayer",
    functionName: "lockedForRedeem",
    args: [address ?? ZERO_ADDRESS],
    watch: true,
  });

  const { data: usdcAllowance } = useScaffoldReadContract({
    contractName: "MockUSDC",
    functionName: "allowance",
    args: [address ?? ZERO_ADDRESS, tradeLayerAddress ?? ZERO_ADDRESS],
    watch: true,
  });

  // --- writes ---------------------------------------------------------------

  const { writeContractAsync: writeUsdc } = useScaffoldWriteContract({ contractName: "MockUSDC" });
  const { writeContractAsync: writeTradeLayer } = useScaffoldWriteContract({ contractName: "TradeLayer" });

  const livePrices = useLivePrices();

  const amountWei = useMemo(() => parseUsdc(usdcAmount || "0"), [usdcAmount]);

  const needsApproval =
    mode === "buy" && !!tradeLayerAddress && usdcAllowance !== undefined && usdcAllowance < amountWei && amountWei > 0n;

  async function handleApprove() {
    if (!tradeLayerAddress) return;
    try {
      await writeTx(async () => writeUsdc({ functionName: "approve", args: [tradeLayerAddress, amountWei] }));
      toast.success("USDC approved");
    } catch {
      /* surfaced by transactor */
    }
  }

  /** Seal intent E2E and register the ephemeral pubkey with the backend. */
  async function buildEncryptedOrder(orderId: string, side: "buy" | "sell"): Promise<`0x${string}` | null> {
    try {
      const pubRes = await fetch(`${BACKEND_API}/public-key`);
      if (!pubRes.ok) throw new Error(`backend /public-key ${pubRes.status}`);
      const { publicKey } = (await pubRes.json()) as { publicKey: string };

      const qty = side === "sell" ? Number(shareAmount || "0") : Math.round(Number(usdcAmount || "0"));
      const sealed = await sealOrder(
        { stock: symbol, qty, side, orderType: "market" },
        publicKey,
      );

      await fetch(`${BACKEND_API}/ephemeral-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, publicKey: sealed.ephemeralPublicKeyB64 }),
      });

      return sealed.encryptedOrder;
    } catch (err) {
      console.error(err);
      toast.error("Could not reach the settlement backend", {
        description: "Orders are encrypted end-to-end; the backend must be online to place one.",
      });
      return null;
    }
  }

  async function handleBuy() {
    if (!address) return;
    const orderId = crypto.randomUUID();
    const encryptedOrder = await buildEncryptedOrder(orderId, "buy");
    if (!encryptedOrder) return;
    try {
      await writeTx(async () =>
        writeTradeLayer({
          functionName: "buyStock",
          args: [orderId, encryptedOrder, amountWei],
        }),
      );
      setUsdcAmount("");
      toast.success(`Buy order placed (${orderId.slice(0, 8)})`, {
        description: "Escrowed on-chain, encrypted end-to-end. The backend will settle it.",
      });
    } catch {
      /* surfaced by transactor */
    }
  }

  async function handleRedeem() {
    if (!address || !shareAmount) return;
    const orderId = crypto.randomUUID();
    const encryptedOrder = await buildEncryptedOrder(orderId, "sell");
    if (!encryptedOrder) return;
    try {
      await writeTx(async () =>
        writeTradeLayer({
          functionName: "redeemStock",
          args: [orderId, encryptedOrder, BigInt(Math.round(Number(shareAmount)))],
        }),
      );
      setShareAmount("");
      toast.success(`Redeem request placed (${orderId.slice(0, 8)})`, {
        description: "Locked on-chain, encrypted end-to-end. The backend will settle it.",
      });
    } catch {
      /* surfaced by transactor */
    }
  }

  // --- derived --------------------------------------------------------------

  const onChainPrice = price18 !== undefined ? Number(formatUnits(price18, 18)) : undefined;
  const displayPrice = livePrices[symbol]?.price ?? onChainPrice;

  const estimatedShares =
    mode === "buy" && displayPrice && displayPrice > 0 && Number(usdcAmount) > 0
      ? Number(usdcAmount) / displayPrice
      : undefined;

  const unlockedDstock =
    dstockBalance !== undefined && lockedForRedeem !== undefined ? dstockBalance - lockedForRedeem : undefined;

  const wrongChainOrDisconnected = !isConnected || chainId !== targetNetwork.id;

  // --------------------------------------------------------------------------

  return (
    <Card className="glass-card border-border/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-heading">Place order</CardTitle>
          <Tabs value={mode} onValueChange={(v) => setMode(v as "buy" | "redeem")}>
            <TabsList className="rounded-full bg-secondary/60">
              <TabsTrigger value="buy" className="rounded-full px-5">
                Buy
              </TabsTrigger>
              <TabsTrigger value="redeem" className="rounded-full px-5">
                Redeem
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Stock selector */}
        <div className="grid grid-cols-4 gap-2">
          {STOCKS.map((s) => (
            <button
              key={s}
              onClick={() => setSymbol(s)}
              className={`rounded-xl border px-2 py-2.5 text-center transition-all ${
                symbol === s
                  ? "border-primary bg-primary/10 shadow-[0_0_16px_-4px] shadow-primary/40"
                  : "border-border/60 hover:border-border hover:bg-secondary/40"
              }`}
            >
              <div className="text-sm font-semibold">{s}</div>
              <div className="text-[11px] text-muted-foreground tabular-nums">
                {s === symbol && displayPrice ? `$${displayPrice.toFixed(2)}` : livePrices[s]?.price ? `$${livePrices[s]!.price.toFixed(2)}` : ""}
              </div>
            </button>
          ))}
        </div>

        {/* Amount input */}
        {mode === "buy" ? (
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Amount (USDC)</label>
            <div className="relative">
              <Input
                type="number"
                min="0"
                placeholder="100.00"
                value={usdcAmount}
                onChange={(e) => setUsdcAmount(e.target.value)}
                className="h-14 rounded-xl pr-20 text-lg"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                USDC
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Balance: <span className="tabular-nums">{fmtUsdc(usdcBalance)}</span> USDC
              </span>
              {estimatedShares !== undefined && (
                <span className="flex items-center gap-1 text-success">
                  ≈ {estimatedShares.toFixed(0)} {symbol}
                  <TrendingUp className="h-3 w-3" />
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Shares to redeem</label>
            <div className="relative">
              <Input
                type="number"
                min="1"
                placeholder="0"
                value={shareAmount}
                onChange={(e) => setShareAmount(e.target.value)}
                className="h-14 rounded-xl pr-24 text-lg"
              />
              <button
                onClick={() => unlockedDstock !== undefined && setShareAmount(String(unlockedDstock))}
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
              >
                MAX
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                Unlocked DSTOCK: <span className="tabular-nums">{fmtShares(unlockedDstock)}</span>
              </span>
              {(lockedForRedeem ?? 0n) > 0n && (
                <Badge variant="outline" className="border-warning/40 text-warning">
                  {fmtShares(lockedForRedeem)} locked pending settlement
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Price line */}
        <div className="flex items-center justify-between rounded-xl bg-secondary/40 px-4 py-3 text-sm">
          <span className="text-muted-foreground">{symbol} reference price</span>
          <span className="font-mono tabular-nums">{displayPrice ? `$${displayPrice.toFixed(2)}` : "—"}</span>
        </div>

        {/* Actions */}
        {wrongChainOrDisconnected ? (
          <Button disabled className="h-12 w-full rounded-xl text-base">
            <Wallet className="mr-2 h-4 w-4" /> Connect wallet on {targetNetwork.name}
          </Button>
        ) : needsApproval ? (
          <Button onClick={handleApprove} className="h-12 w-full rounded-xl text-base gap-2">
            <ShieldCheck className="h-4 w-4" /> Approve {usdcAmount || "0"} USDC
          </Button>
        ) : mode === "buy" ? (
          <Button
            onClick={handleBuy}
            disabled={!usdcAmount || Number(usdcAmount) <= 0}
            className="h-12 w-full rounded-xl text-base font-semibold gap-2"
          >
            <ArrowDownUp className="h-4 w-4" /> Buy {symbol}
          </Button>
        ) : (
          <Button
            onClick={handleRedeem}
            disabled={!shareAmount || BigInt(Math.round(Number(shareAmount || "0"))) <= 0n}
            className="h-12 w-full rounded-xl text-base font-semibold gap-2"
          >
            <ArrowDownUp className="h-4 w-4" /> Redeem {symbol}
          </Button>
        )}

        <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mr-1 inline h-3 w-3" />
          Orders are encrypted end-to-end (ECDH + AES-GCM), escrowed on-chain, and settled by the backend against the
          Pyth oracle price.
        </p>
      </CardContent>
    </Card>
  );
}
