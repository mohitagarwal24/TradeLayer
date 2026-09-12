import { useState } from "react";
import { readable } from "@/lib/errors";
import { Navigate } from "react-router-dom";
import { useAccount, useReadContract } from "wagmi";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMembership } from "@/hooks/useMembership";
import { useDeployment } from "@/hooks/useDeployment";
import { useMarket } from "@/hooks/useMarket";
import { usePortfolioKey } from "@/hooks/usePortfolioKey";
import { accountIdOf, decryptUserBlob, unitsToShares, ONE_SHARE, type Portfolio } from "@/lib/seal";
import { SYMBOL_NAMES, money, usd } from "@/lib/tradelayer";

const LEDGER_ABI = [
  {
    type: "function",
    name: "entry",
    stateMutability: "view",
    inputs: [{ name: "accountId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "enclaveBlob", type: "bytes" },
          { name: "userBlob", type: "bytes" },
          { name: "version", type: "uint64" },
          { name: "blobHash", type: "bytes32" },
        ],
      },
    ],
  },
] as const;

/**
 * Your positions. They are not readable from the chain — the page holds ciphertext until you
 * sign once, which derives the key that opens your own copy. That reveal is the product.
 */
export default function Positions() {
  const { address, isConnected } = useAccount();
  const { membership, role, loading } = useMembership();
  const { deployment } = useDeployment();
  const market = useMarket();
  const { privateKey, derive } = usePortfolioKey();
  const accountId = address ? accountIdOf(address) : undefined;

  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [revealedBlob, setRevealedBlob] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: entry } = useReadContract({
    address: deployment?.contracts.ledger,
    abi: LEDGER_ABI,
    functionName: "entry",
    args: accountId ? [accountId] : undefined,
    query: { enabled: Boolean(deployment?.contracts.ledger && accountId), refetchInterval: 10_000 },
  });

  if (!isConnected) return <Navigate to="/" replace />;
  if (loading) return <div className="container mx-auto px-4 py-16 text-sm text-muted-foreground">Loading…</div>;
  if ((role !== "member" && role !== "admin") || !membership) return <Navigate to="/" replace />;

  const blob = (entry as { userBlob?: `0x${string}` } | undefined)?.userBlob;
  const hasRecord = Boolean(blob && blob !== "0x");

  const reveal = async () => {
    setBusy(true);
    try {
      const key = privateKey ?? (await derive()).privateKey;
      if (!hasRecord) {
        setRevealed(true);
        setPortfolio(null);
        return;
      }
      setPortfolio(decryptUserBlob(key, blob as `0x${string}`));
      setRevealed(true);
      setRevealedBlob(blob as string);
    } catch (error) {
      toast.error("Couldn't open your positions", { description: readable(error) });
    } finally {
      setBusy(false);
    }
  };

  const hide = () => {
    setRevealed(false);
    setPortfolio(null);
  };

  const positions = Object.entries(portfolio?.positions ?? {}).filter(([, p]) => BigInt(p.qty) > 0n);

  return (
    <div className="container mx-auto max-w-3xl space-y-5 px-4 py-10">
      <header className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Positions</h1>
        <Badge variant="secondary" className="font-normal">
          {membership.org}
        </Badge>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between gap-2 font-heading text-base">
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" /> Only you can read this
            </span>
            {/* Re-hidable: a demo needs a second take, and "revealed" should not be a one-way
                door for the rest of the session. */}
            <Button size="sm" variant={revealed ? "ghost" : "default"} onClick={revealed ? hide : reveal} disabled={busy}>
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : revealed ? (
                <EyeOff className="mr-2 h-4 w-4" />
              ) : (
                <Eye className="mr-2 h-4 w-4" />
              )}
              {revealed ? "Hide" : "Reveal"}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* The encrypted record refetches every 10s, but plaintext is only produced on reveal.
              If a settlement lands while the page is open, say so instead of showing stale rows. */}
          {revealed && revealedBlob && blob && blob !== revealedBlob && (
            <p className="mb-3 rounded-md border border-border/60 bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
              This has changed since you opened it.{" "}
              <button className="underline underline-offset-2" onClick={reveal}>
                Open the latest
              </button>
            </p>
          )}
          {!revealed ? (
            <p className="text-sm text-muted-foreground">
              {hasRecord
                ? "Your positions are stored encrypted. Sign once and this page will open your own copy — nobody else, including us, can."
                : "Nothing recorded yet. Your first order will appear here once it settles."}
            </p>
          ) : !portfolio || positions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No shares yet.</p>
          ) : (
            <div className="space-y-2">
              {positions.map(([symbol, p]) => {
                const price = market?.prices?.[symbol]?.price;
                const shares = unitsToShares(BigInt(p.qty));
                const value = price !== undefined ? (price * Number(BigInt(p.qty))) / Number(ONE_SHARE) : undefined;
                return (
                  <div
                    key={symbol}
                    className="flex items-center justify-between rounded-lg border border-border/60 p-3"
                  >
                    <div>
                      <div className="font-heading text-sm font-semibold">{symbol}</div>
                      <div className="text-xs text-muted-foreground">{SYMBOL_NAMES[symbol] ?? "Equity"}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-heading text-sm font-semibold tabular-nums">
                        {shares} {shares === "1" ? "share" : "shares"}
                      </div>
                      <div className="text-xs tabular-nums text-muted-foreground">{money(value)}</div>
                    </div>
                  </div>
                );
              })}
              {portfolio.cash && BigInt(portfolio.cash) > 0n && (
                <div className="flex items-center justify-between rounded-lg border border-border/60 p-3 text-sm">
                  <span className="text-muted-foreground">Uninvested</span>
                  <span className="font-heading font-semibold tabular-nums">{usd(BigInt(portfolio.cash))} USDC</span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="px-1 text-xs text-muted-foreground">
        Your shares sit in a pooled account, backed one-for-one by real shares at the broker.
        Nothing public says which of them are yours.
      </p>
    </div>
  );
}
