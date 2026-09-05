import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, FlaskConical } from "lucide-react";
import { encodeAbiParameters, parseAbiParameter } from "viem";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useScaffoldEventHistory } from "~~/hooks/scaffold-eth/useScaffoldEventHistory";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth/useScaffoldReadContract";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth/useScaffoldWriteContract";
import { useTransactor } from "~~/hooks/scaffold-eth/useTransactor";
import { fmtUsdc, fmtShares, shortOrderId, shortAddress } from "@/lib/format";

const STOCKS = ["AAPL", "GOOGL", "TSLA", "MSFT"] as const;

/** ABI encoding of TradeLayer.Result — must match the contract's struct exactly. */
function encodeResult(orderId: string, stockName: string, stockQuantity: bigint, amountToRefund: bigint): `0x${string}` {
  return encodeAbiParameters(
    [parseAbiParameter("string orderId"), parseAbiParameter("string stockName"), parseAbiParameter("uint256 stockQuantity"), parseAbiParameter("uint256 amountToRefund")],
    [orderId, stockName, stockQuantity, amountToRefund],
  );
}

function parseUsdcLoose(input: string): bigint {
  const n = Number(input || "0");
  if (!isFinite(n)) return 0n;
  return BigInt(Math.round(n * 1e6));
}

type RequestTuple = readonly [string, bigint, bigint, boolean];
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function PendingRow({ orderId, refetchAll }: { orderId: string; refetchAll: () => void }) {
  const writeTx = useTransactor();
  const { writeContractAsync: writeTradeLayer } = useScaffoldWriteContract({ contractName: "TradeLayer" });
  const [symbol, setSymbol] = useState<string>("AAPL");
  const [proceeds, setProceeds] = useState("");
  const [open, setOpen] = useState(false);

  const { data: request } = useScaffoldReadContract({
    contractName: "TradeLayer",
    functionName: "requests",
    args: [orderId],
    watch: true,
  });

  const { data: processed } = useScaffoldReadContract({
    contractName: "TradeLayer",
    functionName: "orderProcessed",
    args: [orderId],
    watch: true,
  });

  if (!request) return null;
  const tuple = request as unknown as RequestTuple;
  const requester = tuple[0];
  if (requester === ZERO_ADDRESS || requester === undefined) return null;

  const usdcBalance = tuple[1] ?? 0n;
  const tokenBalance = tuple[2] ?? 0n;
  const isRedeem = tuple[3] ?? false;

  async function settle() {
    try {
      await writeTx(async () =>
        writeTradeLayer({
          functionName: "fulfillRequest",
          args: [
            orderId,
            // Buys fill at the reported quantity with no change (full escrow spent).
            encodeResult(orderId, symbol, tokenBalance, isRedeem ? parseUsdcLoose(proceeds) : 0n),
          ],
        }),
      );
      toast.success(`Order ${shortOrderId(orderId)} settled`);
      refetchAll();
    } catch {
      /* revert surfaced by transactor */
    }
  }

  return (
    <>
      <TableRow>
        <TableCell className="font-mono text-xs">{shortOrderId(orderId)}</TableCell>
        <TableCell className="text-xs">{shortAddress(requester)}</TableCell>
        <TableCell>
          {isRedeem ? (
            <Badge variant="outline" className="rounded-full border-warning/50 text-warning">
              REDEEM
            </Badge>
          ) : (
            <Badge variant="outline" className="rounded-full border-success/50 text-success">
              BUY
            </Badge>
          )}
        </TableCell>
        <TableCell className="text-right font-mono text-xs tabular-nums">
          {isRedeem ? `${fmtShares(tokenBalance)} DSTOCK` : `${fmtUsdc(usdcBalance)} USDC`}
        </TableCell>
        <TableCell className="text-right">
          {processed ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" /> settled
            </span>
          ) : (
            <Button size="sm" variant="outline" className="gap-1 rounded-full" onClick={() => setOpen(!open)}>
              Settle {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          )}
        </TableCell>
      </TableRow>
      {open && !processed && (
        <TableRow className="bg-secondary/30 hover:bg-secondary/30">
          <TableCell colSpan={5}>
            <div className="flex flex-wrap items-end gap-3 py-1">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Stock</label>
                <div className="flex gap-1">
                  {STOCKS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setSymbol(s)}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                        symbol === s
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/60 text-muted-foreground hover:bg-secondary"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {isRedeem && (
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Proceeds (USDC)</label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={proceeds}
                    onChange={(e) => setProceeds(e.target.value)}
                    className="h-8 w-28 rounded-lg text-xs"
                  />
                </div>
              )}

              <Button size="sm" className="h-8 gap-1.5 rounded-full" onClick={() => settle()}>
                <FlaskConical className="h-3.5 w-3.5" /> Fulfill
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {isRedeem
                ? "Payout must not exceed the contract's free (unescrowed) USDC — oversized payouts revert."
                : "Buys mint the broker-reported quantity; refunds beyond this order's escrow revert."}
            </p>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function SettlementConsole() {
  const { data: events, isLoading, refetch } = useScaffoldEventHistory({
    contractName: "TradeLayer",
    eventName: "RequestCreated",
    watch: true,
    blocksBatchSize: 500,
  });

  // Newest first.
  const ordered = [...(events ?? [])].reverse();

  return (
    <Card className="glass-card border-border/60">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2 font-heading text-lg">
            Backend settlement console
            <Badge variant="secondary" className="rounded-full text-[10px]">
              demo
            </Badge>
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            In production only the backend wallet settles orders. Here your wallet plays that role so the full
            lifecycle is visible live.
          </p>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && ordered.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading orders…</div>
        ) : ordered.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No orders yet. Place one from the Trade page and it will appear here.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Side</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordered.map((event) => (
                <PendingRow
                  key={`${event.logIndex}-${event.transactionHash}`}
                  orderId={String(event.args.orderId)}
                  refetchAll={refetch}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
