import { useMemo } from "react";
import { useAccount, useBalance } from "wagmi";
import { formatUnits } from "viem";
import { Wallet, ArrowRightLeft, Package, History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth/useScaffoldReadContract";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { fmtShares, fmtUsdc, shortOrderId, stockMeta } from "@/lib/format";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
type Address = `0x${string}`;

function ConnectPrompt() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <div className="glass-card p-8 max-w-md w-full">
        <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-6">
          <Wallet className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-2xl font-heading font-bold mb-2">Connect your wallet</h2>
        <p className="text-muted-foreground mb-6">Connect your wallet to view your TradeLayer portfolio.</p>
        <ConnectWalletButton />
      </div>
    </div>
  );
}

function HoldingsTable({ address }: { address: Address }) {
  const { data: stockList } = useScaffoldReadContract({
    contractName: "TradeLayer",
    functionName: "getStockHoldings",
    args: [address],
    watch: true,
  });

  const { data: lockedForRedeem } = useScaffoldReadContract({
    contractName: "TradeLayer",
    functionName: "lockedForRedeem",
    args: [address],
    watch: true,
  });

  // Read each holding's quantity (hooks must be top-level; four known symbols).
  const aaplQty = useScaffoldReadContract({
    contractName: "TradeLayer",
    functionName: "totalHoldings",
    args: [address, "AAPL"],
    watch: true,
  }).data;
  const googlQty = useScaffoldReadContract({
    contractName: "TradeLayer",
    functionName: "totalHoldings",
    args: [address, "GOOGL"],
    watch: true,
  }).data;
  const tslaQty = useScaffoldReadContract({
    contractName: "TradeLayer",
    functionName: "totalHoldings",
    args: [address, "TSLA"],
    watch: true,
  }).data;
  const msftQty = useScaffoldReadContract({
    contractName: "TradeLayer",
    functionName: "totalHoldings",
    args: [address, "MSFT"],
    watch: true,
  }).data;

  const quantities = useMemo<Record<string, bigint | undefined>>(
    () => ({
      AAPL: aaplQty,
      GOOGL: googlQty,
      TSLA: tslaQty,
      MSFT: msftQty,
    }),
    [aaplQty, googlQty, tslaQty, msftQty],
  );

  const rows = useMemo(() => {
    const holdings = ((stockList ?? []) as unknown as readonly string[]) ?? [];
    return holdings.map((symbol) => ({
      symbol,
      qty: quantities[symbol] ?? 0n,
      meta: stockMeta(symbol),
    }));
  }, [stockList, quantities]);

  if (rows.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        No positions yet. Head to <span className="font-medium text-foreground">Trade</span> to place your first order.
      </div>
    );
  }

  const totalLocked = lockedForRedeem ?? 0n;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Stock</TableHead>
          <TableHead className="text-right">Quantity</TableHead>
          <TableHead className="text-right hidden sm:table-cell">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.symbol}>
            <TableCell>
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-bold" style={{ backgroundColor: `${row.meta.color}22`, color: row.meta.color }}>
                  {row.symbol.slice(0, 2)}
                </span>
                <div>
                  <div className="font-medium">{row.symbol}</div>
                  <div className="text-xs text-muted-foreground">{row.meta.name}</div>
                </div>
              </div>
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">{fmtShares(row.qty)}</TableCell>
            <TableCell className="text-right hidden sm:table-cell">
              <Badge variant="secondary" className="rounded-full">Held</Badge>
            </TableCell>
          </TableRow>
        ))}
        {totalLocked > 0n && (
          <TableRow className="opacity-70">
            <TableCell colSpan={3} className="text-xs text-warning">
              {fmtShares(totalLocked)} DSTOCK locked across pending redemptions
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

export default function Portfolio() {
  const { address, isConnected } = useAccount();
  const { targetNetwork } = useTargetNetwork();

  const { data: nativeBalance } = useBalance({ address });
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

  if (!isConnected || !address) {
    return (
      <main className="min-h-screen pt-24 pb-16">
        <div className="container mx-auto px-4">
          <ConnectPrompt />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen pt-24 pb-16">
      <div className="container mx-auto px-4 space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card className="glass-card border-border/60">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Wallet className="h-4 w-4" /> USDC balance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-2xl font-semibold tabular-nums">{fmtUsdc(usdcBalance)}</div>
              <div className="text-xs text-muted-foreground">
                {nativeBalance ? `${Number(formatUnits(nativeBalance.value, 18)).toFixed(3)} ${nativeBalance.symbol}` : ""}
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card border-border/60">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Package className="h-4 w-4" /> DSTOCK position
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-2xl font-semibold tabular-nums">{fmtShares(dstockBalance)}</div>
              <div className="text-xs text-muted-foreground">soulbound equity tokens</div>
            </CardContent>
          </Card>

          <Card className="glass-card border-border/60">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <ArrowRightLeft className="h-4 w-4" /> Network
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-semibold">{targetNetwork.name}</div>
              <div className="text-xs text-muted-foreground">chain id {targetNetwork.id}</div>
            </CardContent>
          </Card>
        </div>

        {/* Holdings */}
        <Card className="glass-card border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-heading">Your equity positions</CardTitle>
          </CardHeader>
          <CardContent>{address && <HoldingsTable address={address} />}</CardContent>
        </Card>
      </div>
    </main>
  );
}
