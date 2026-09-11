import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { Loader2, Lock } from "lucide-react";
import { keccak256, toBytes, type Hex } from "viem";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { OrderProgress, type Stage } from "@/components/trade/OrderProgress";
import { useMembership } from "@/hooks/useMembership";
import { useDeployment } from "@/hooks/useDeployment";
import { useMarket, useMarketClock } from "@/hooks/useMarket";
import { useWalletWrite } from "@/hooks/useWalletWrite";
import { usePortfolioKey } from "@/hooks/usePortfolioKey";
import { intentTypedData, sealIntent, type Intent } from "@/lib/seal";
import { BACKEND_API, ESCROW_ABI, SYMBOL_NAMES, money, parseUsd } from "@/lib/tradelayer";
import { cn } from "@/lib/utils";

export default function Trade() {
  const { address, isConnected } = useAccount();
  const { membership, role, loading } = useMembership();
  const { deployment } = useDeployment();
  const market = useMarket();
  const clock = useMarketClock();
  const wallet = useWalletWrite();
  const { publicKey, derive } = usePortfolioKey();

  const [symbol, setSymbol] = useState<string>("");
  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState(false);
  const [orderId, setOrderId] = useState<Hex | null>(null);
  const [stage, setStage] = useState<Stage>("received");
  const [declined, setDeclined] = useState<string | undefined>();

  const symbols = useMemo(() => deployment?.symbols ?? [], [deployment?.symbols]);
  useEffect(() => {
    if (!symbol && symbols.length) setSymbol(symbols[0]);
  }, [symbols, symbol]);

  const price = symbol ? market?.prices?.[symbol]?.price : undefined;
  const spend = /^\d+(\.\d{1,2})?$/.test(amount.trim()) ? Number(amount) : undefined;
  // Orders are placed by amount, so the share count is an estimate until the fill comes back.
  const estimatedShares = price !== undefined && spend !== undefined && price > 0 ? spend / price : undefined;

  // Poll the order until it leaves OPEN, translating chain status into something readable.
  useEffect(() => {
    if (!orderId) return;
    const tick = async () => {
      try {
        const res = await fetch(`${BACKEND_API}/orders/${orderId}`).then(r => r.json());
        const status = res.onChain?.status as string;
        if (status === "SETTLED") setStage("settled");
        else if (status === "CANCELLED") {
          setStage("declined");
          setDeclined(undefined);
        } else if (status === "REFUNDED") {
          setStage("declined");
          setDeclined("The order expired before it could fill.");
        } else if (res.triggers?.length) setStage(clock?.isOpen === false ? "placed" : "placed");
      } catch {
        /* keep the last state */
      }
    };
    void tick();
    const t = setInterval(tick, 5_000);
    return () => clearInterval(t);
  }, [orderId, clock?.isOpen]);

  if (!isConnected) return <Navigate to="/" replace />;
  if (loading) return <div className="container mx-auto px-4 py-16 text-sm text-muted-foreground">Loading…</div>;
  if ((role !== "member" && role !== "admin") || !membership || !deployment) return <Navigate to="/" replace />;

  const placeOrder = async () => {
    if (!address || !symbol) return;
    setBusy(true);
    setDeclined(undefined);
    try {
      const userPubKey = publicKey ?? (await derive()).publicKey;

      // The amount *is* the order — a notional buy. Nothing to pad over a moving price, because
      // the broker spends exactly this and decides how many shares it buys.
      const maxSpend = parseUsd(amount);
      if (maxSpend < 1_000_000n) throw new Error("The broker's minimum is $1.");
      const nonce = Math.floor(Date.now() / 1000);
      const id = keccak256(toBytes(`${address}:${nonce}:${Math.random()}`));
      const expiry = nonce + 2 * 60 * 60;

      const unsigned: Omit<Intent, "sig"> = {
        v: 1,
        orderId: id,
        account: address,
        orgId: membership.org!,
        side: "BUY",
        symbol,
        maxSpend: maxSpend.toString(),
        expiry,
        nonce,
        userPubKey,
      };
      const sig = (await wallet.signTypedData(
        intentTypedData(unsigned, deployment.chainId, deployment.contracts.escrow),
      )) as Hex;

      const enclave = (await (await fetch(`${BACKEND_API}/enclave-key`)).json()) as { intentPublicKey: Hex };
      const { envelope, commit } = sealIntent({ ...unsigned, sig }, enclave.intentPublicKey);

      setOrderId(id);
      setStage("received");

      await wallet.write({
        address: deployment.contracts.escrow,
        abi: ESCROW_ABI,
        functionName: "openBuy",
        args: [id, maxSpend, commit, BigInt(expiry)],
      });
      setStage("opened");

      const res = await fetch(`${BACKEND_API}/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: id, envelope }),
      });
      if (!res.ok) throw new Error(`the service rejected the order (${res.status})`);
      toast.success("Order placed", { description: "The chain shows an amount and a deadline. Nothing else." });
    } catch (error) {
      setOrderId(null);
      toast.error("Order not placed", { description: ((error as Error).message ?? "").slice(0, 180) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container mx-auto max-w-xl space-y-5 px-4 py-10">
      {clock?.isOpen === false && (
        <div className="rounded-lg border border-border/60 bg-secondary/40 p-3 text-xs text-muted-foreground">
          The US market is closed. Orders are still placed for real — the broker queues them and they
          fill when it next opens.
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between font-heading text-lg">
            <span>Buy</span>
            <Badge variant="secondary" className="font-normal">
              {membership.org}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            {symbols.map(s => (
              <button
                key={s}
                onClick={() => setSymbol(s)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  symbol === s ? "border-primary bg-secondary" : "border-border/60 hover:border-border",
                )}
              >
                <div className="font-heading text-sm font-semibold">{s}</div>
                <div className="truncate text-xs text-muted-foreground">{SYMBOL_NAMES[s] ?? "Equity"}</div>
                <div className="mt-1 text-xs tabular-nums text-muted-foreground">
                  {market?.prices?.[s] ? money(market.prices[s].price) : "—"}
                </div>
              </button>
            ))}
          </div>

          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">Amount to spend</span>
            <div className="flex items-center gap-2">
              <Input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" />
              <span className="text-sm text-muted-foreground">USDC</span>
            </div>
          </label>

          <div className="flex items-center justify-between rounded-lg border border-border/60 p-3 text-sm">
            <span className="text-muted-foreground">Roughly</span>
            <span className="font-heading font-semibold tabular-nums">
              {estimatedShares !== undefined ? `${estimatedShares.toFixed(6)} ${symbol}` : "—"}
            </span>
          </div>

          <Button className="w-full" size="lg" onClick={placeOrder} disabled={busy || !symbol || !wallet.ready}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
            {busy ? "Sealing…" : "Place sealed order"}
          </Button>

          <p className="text-xs text-muted-foreground">
            You're buying by amount, so you can own a fraction of a share. Your institution's
            treasury funds it — you never hold its money — and what the public sees is an amount and
            a deadline, never the ticker.
          </p>
        </CardContent>
      </Card>

      {orderId && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-heading text-base">Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <OrderProgress stage={stage} declinedReason={declined} queued={clock?.isOpen === false} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
