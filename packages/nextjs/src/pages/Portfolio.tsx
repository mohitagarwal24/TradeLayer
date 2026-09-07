import { useState } from "react";
import { useAccount, useBalance, useSignMessage } from "wagmi";
import { formatUnits, getAddress } from "viem";
import { toast } from "sonner";
import { Wallet, ArrowRightLeft, Package, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth/useScaffoldReadContract";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { fmtReceiptUnits, fmtReceiptValue, fmtUsdc } from "@/lib/format";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const BACKEND_API = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8000";

type PrivatePosition = {
  symbol: string;
  shares: number;
  receiptUnits: number;
  depositedUsdc: number;
};

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

function PrivateHoldings({ address }: { address: `0x${string}` }) {
  const { signMessageAsync } = useSignMessage();
  const [positions, setPositions] = useState<PrivatePosition[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function reveal() {
    setLoading(true);
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
      setPositions(body.positions);
    } catch (error) {
      toast.error("Could not reveal private portfolio", { description: (error as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-start gap-3 py-6">
      <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
      <div className="w-full">
        <p className="font-medium">Individual stock positions are private</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The chain exposes only your aggregate deposited value (DSTOCK). Fractional shares and per-asset receipt units
          stay in TradeLayer&apos;s private settlement ledger.
        </p>
        {positions === null ? (
          <Button className="mt-4" variant="secondary" onClick={reveal} disabled={loading}>
            {loading ? "Verifying wallet…" : "Sign to reveal your positions"}
          </Button>
        ) : positions.length === 0 ? (
          <p className="mt-4 text-sm">No settled positions yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Asset</th>
                  <th className="pb-2 font-medium">Fractional shares</th>
                  <th className="pb-2 font-medium">Receipt units</th>
                  <th className="pb-2 font-medium">Deposited value</th>
                </tr>
              </thead>
              <tbody>
                {positions.map(position => (
                  <tr key={position.symbol} className="border-t border-border/40">
                    <td className="py-2 font-medium">{position.symbol}</td>
                    <td className="py-2 font-mono tabular-nums">{position.shares.toFixed(6)}</td>
                    <td className="py-2 font-mono tabular-nums">{fmtReceiptUnits(position.receiptUnits)}</td>
                    <td className="py-2 font-mono tabular-nums">{fmtReceiptValue(position.receiptUnits)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
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
                {nativeBalance
                  ? `${Number(formatUnits(nativeBalance.value, 18)).toFixed(3)} ${nativeBalance.symbol}`
                  : ""}
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card border-border/60">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Package className="h-4 w-4" /> Deposited value
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-2xl font-semibold tabular-nums">{fmtReceiptValue(dstockBalance)}</div>
              <div className="text-xs text-muted-foreground">
                {fmtReceiptUnits(dstockBalance)} DSTOCK units · $0.01 each
              </div>
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

        <Card className="glass-card border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-heading">Private equity positions</CardTitle>
          </CardHeader>
          <CardContent>
            <PrivateHoldings address={address} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
