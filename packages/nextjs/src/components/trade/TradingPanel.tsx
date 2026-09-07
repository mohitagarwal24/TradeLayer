import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, useSignMessage } from "wagmi";
import { formatUnits, getAddress } from "viem";
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
import {
  fmtReceiptUnits,
  fmtReceiptValue,
  fmtUsdc,
  MIN_BUY_USDC,
  parseReceiptUnits,
  parseUsdc,
} from "@/lib/format";
import { sealOrder } from "@/lib/sealOrder";
import { STOCKS, type StockSymbol } from "@/lib/pythFeeds";

const BACKEND_API = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8000";

type LivePrice = { price: number };
type PrivatePosition = {
  symbol: string;
  shares: number;
  receiptUnits: number;
  depositedUsdc: number;
};

function useLivePrices() {
  const [prices, setPrices] = useState<Partial<Record<StockSymbol, LivePrice>>>({});

  useEffect(() => {
    let cancelled = false;

    const fetchOnce = async () => {
      try {
        const res = await fetch(`${BACKEND_API}/prices`);
        if (!res.ok) throw new Error(`backend price request failed: ${res.status}`);
        const json = (await res.json()) as {
          prices?: Partial<Record<StockSymbol, LivePrice>>;
        };
        if (cancelled) return;
        setPrices(json.prices ?? {});
      } catch {
        // Backend unreachable — fall back to on-chain values.
      }
    };

    fetchOnce();
    const interval = setInterval(fetchOnce, 30_000);
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
  const { signMessageAsync } = useSignMessage();

  const [mode, setMode] = useState<"buy" | "redeem">("buy");
  const [symbol, setSymbol] = useState<StockSymbol>("TSLA");
  const [usdcAmount, setUsdcAmount] = useState("");
  const [redeemUnitsInput, setRedeemUnitsInput] = useState("");
  const [privatePosition, setPrivatePosition] = useState<PrivatePosition | null>(null);

  const { data: deployed } = useDeployedContractInfo({ contractName: "TradeLayer" });
  const tradeLayerAddress = deployed?.address;

  const { data: price18 } = useScaffoldReadContract({
    contractName: "TradeLayer",
    functionName: "getStockPriceUnsafe",
    args: [symbol],
  });

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

  const { writeContractAsync: writeUsdc } = useScaffoldWriteContract({ contractName: "MockUSDC" });
  const { writeContractAsync: writeTradeLayer } = useScaffoldWriteContract({ contractName: "TradeLayer" });

  const livePrices = useLivePrices();

  const amountWei = useMemo(() => parseUsdc(usdcAmount || "0"), [usdcAmount]);
  const redeemUnits = useMemo(() => parseReceiptUnits(redeemUnitsInput), [redeemUnitsInput]);

  const needsApproval =
    mode === "buy" && !!tradeLayerAddress && usdcAllowance !== undefined && usdcAllowance < amountWei && amountWei > 0n;

  useEffect(() => {
    setPrivatePosition(null);
  }, [symbol, address]);

  async function loadPrivatePosition() {
    if (!address) return;
    try {
      const normalized = getAddress(address);
      const timestamp = Date.now().toString();
      const message = `TradeLayer private portfolio\nAddress: ${normalized}\nTimestamp: ${timestamp}`;
      const signature = await signMessageAsync({ account: normalized, message });
      const response = await fetch(`${BACKEND_API}/private-portfolio/${normalized}`, {
        headers: {
          "X-PORTFOLIO-TIMESTAMP": timestamp,
          "X-PORTFOLIO-SIGNATURE": signature,
        },
      });
      if (!response.ok) throw new Error((await response.json()).error ?? `backend ${response.status}`);
      const body = (await response.json()) as { positions: PrivatePosition[] };
      const match = body.positions.find(p => p.symbol === symbol) ?? null;
      setPrivatePosition(match);
      if (match) {
        toast.success(`${symbol}: ${match.receiptUnits} units deposited (${fmtReceiptValue(match.receiptUnits)})`);
      } else {
        toast.message(`No private ${symbol} position`);
      }
    } catch (error) {
      toast.error("Could not load private position", { description: (error as Error).message });
    }
  }

  async function handleApprove() {
    if (!tradeLayerAddress) return;
    try {
      await writeTx(async () => writeUsdc({ functionName: "approve", args: [tradeLayerAddress, amountWei] }));
      toast.success("USDC approved");
    } catch {
      /* surfaced by transactor */
    }
  }

  async function buildEncryptedOrder(orderId: string, side: "buy" | "sell"): Promise<`0x${string}` | null> {
    try {
      const pubRes = await fetch(`${BACKEND_API}/public-key`);
      if (!pubRes.ok) throw new Error(`backend /public-key ${pubRes.status}`);
      const { publicKey } = (await pubRes.json()) as { publicKey: string };

      if (side === "buy") {
        if (amountWei < 1_000_000n) {
          toast.error("Minimum buy is $1.00 USDC");
          return null;
        }
      } else if (redeemUnits <= 0n) {
        toast.error("Enter deposited value to redeem (e.g. 2.50 for $2.50)");
        return null;
      }

      const qty = side === "sell" ? Number(redeemUnits) : 0;
      const sealed = await sealOrder({ stock: symbol, qty, side, orderType: "market" }, publicKey);

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
    if (amountWei < 1_000_000n) {
      toast.error("Minimum buy is $1.00 USDC (whole cents only)");
      return;
    }
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
        description: `Escrowed $${usdcAmount} — Alpaca will fill a $${Number(usdcAmount).toFixed(2)} notional order.`,
      });
    } catch {
      /* surfaced by transactor */
    }
  }

  async function handleRedeem() {
    if (!address || redeemUnits <= 0n) return;
    const orderId = crypto.randomUUID();
    const encryptedOrder = await buildEncryptedOrder(orderId, "sell");
    if (!encryptedOrder) return;
    try {
      await writeTx(async () =>
        writeTradeLayer({
          functionName: "redeemStock",
          args: [orderId, encryptedOrder, redeemUnits],
        }),
      );
      setRedeemUnitsInput("");
      toast.success(`Redeem request placed (${orderId.slice(0, 8)})`, {
        description: "Locked receipt units on-chain. Backend sells proportional private shares.",
      });
    } catch {
      /* surfaced by transactor */
    }
  }

  const onChainPrice = price18 !== undefined ? Number(formatUnits(price18, 18)) : undefined;
  const displayPrice = livePrices[symbol]?.price ?? onChainPrice;

  const estimatedShares =
    mode === "buy" && displayPrice && displayPrice > 0 && Number(usdcAmount) > 0
      ? Number(usdcAmount) / displayPrice
      : undefined;

  const unlockedDstock =
    dstockBalance !== undefined && lockedForRedeem !== undefined ? dstockBalance - lockedForRedeem : undefined;

  const maxRedeemForSymbol =
    privatePosition !== undefined && privatePosition !== null
      ? Math.min(Number(unlockedDstock ?? 0n), privatePosition.receiptUnits)
      : unlockedDstock !== undefined
        ? Number(unlockedDstock)
        : undefined;

  const wrongChainOrDisconnected = !isConnected || chainId !== targetNetwork.id;

  return (
    <Card className="glass-card border-border/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-heading">Place order</CardTitle>
          <Tabs value={mode} onValueChange={v => setMode(v as "buy" | "redeem")}>
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
        <div className="grid grid-cols-3 gap-2">
          {STOCKS.map(s => (
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
                {s === symbol && displayPrice
                  ? `$${displayPrice.toFixed(2)}`
                  : livePrices[s]?.price
                    ? `$${livePrices[s]!.price.toFixed(2)}`
                    : ""}
              </div>
            </button>
          ))}
        </div>

        {mode === "buy" ? (
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Exact USDC spend (min ${MIN_BUY_USDC})</label>
            <div className="relative">
              <Input
                type="number"
                min={MIN_BUY_USDC}
                step="0.01"
                placeholder="5.00"
                value={usdcAmount}
                onChange={e => setUsdcAmount(e.target.value)}
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
                  ≈ {estimatedShares.toFixed(6)} {symbol}
                  <TrendingUp className="h-3 w-3" />
                </span>
              )}
            </div>
            {usdcAmount && amountWei === 0n && (
              <p className="text-xs text-destructive">Enter a whole-cent amount (e.g. 5.00), at least $1.00.</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">
                Deposited value to redeem ({symbol})
              </label>
              <button
                type="button"
                onClick={loadPrivatePosition}
                className="text-[11px] text-primary hover:underline"
              >
                Sign to load {symbol} units
              </button>
            </div>
            <div className="relative">
              <Input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="2.50"
                value={redeemUnitsInput}
                onChange={e => setRedeemUnitsInput(e.target.value)}
                className="h-14 rounded-xl pr-24 text-lg"
              />
              <button
                onClick={() =>
                  maxRedeemForSymbol !== undefined && setRedeemUnitsInput((maxRedeemForSymbol / 100).toFixed(2))
                }
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
              >
                MAX
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                Aggregate deposited: <span className="tabular-nums">{fmtReceiptValue(unlockedDstock)}</span>
                {unlockedDstock !== undefined && (
                  <span className="ml-1">({fmtReceiptUnits(unlockedDstock)} units)</span>
                )}
              </span>
              {privatePosition && (
                <span>
                  {symbol}: {privatePosition.receiptUnits} units · {privatePosition.shares.toFixed(6)} sh
                </span>
              )}
              {(lockedForRedeem ?? 0n) > 0n && (
                <Badge variant="outline" className="border-warning/40 text-warning">
                  {fmtReceiptValue(lockedForRedeem)} locked
                </Badge>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between rounded-xl bg-secondary/40 px-4 py-3 text-sm">
          <span className="text-muted-foreground">{symbol} reference price</span>
          <span className="font-mono tabular-nums">{displayPrice ? `$${displayPrice.toFixed(2)}` : "—"}</span>
        </div>

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
            disabled={!usdcAmount || amountWei < 1_000_000n}
            className="h-12 w-full rounded-xl text-base font-semibold gap-2"
          >
            <ArrowDownUp className="h-4 w-4" /> Buy ${usdcAmount || "0"} of {symbol}
          </Button>
        ) : (
          <Button
            onClick={handleRedeem}
            disabled={!redeemUnitsInput || redeemUnits <= 0n}
            className="h-12 w-full rounded-xl text-base font-semibold gap-2"
          >
            <ArrowDownUp className="h-4 w-4" /> Redeem {fmtReceiptValue(redeemUnits)} {symbol}
          </Button>
        )}

        <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mr-1 inline h-3 w-3" />
          Exact USDC notional buys mint 1 DSTOCK unit per $0.01 deposited. Redemptions burn those units and sell
          proportional private fractional shares; payout follows the actual fill.
        </p>
      </CardContent>
    </Card>
  );
}
