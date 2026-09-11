import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { toast } from "sonner";
import { Loader2, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWalletWrite } from "@/hooks/useWalletWrite";
import { useDeployment } from "@/hooks/useDeployment";
import { ERC20_ABI, VAULT_ABI, parseUsd, usd } from "@/lib/tradelayer";

const USDC = "0x0000000000000000000000000000000000068cDa" as const;

/**
 * Funding the institution. The USDC joins one shared pool — there is deliberately no
 * per-institution balance on-chain, because a labelled balance would publish exactly how much
 * capital a firm has on the platform. The real figure lives encrypted in the ledger.
 */
export function CapitalCard({ onFunded }: { onFunded: () => void }) {
  const { address } = useAccount();
  const { deployment } = useDeployment();
  const wallet = useWalletWrite();
  const [amount, setAmount] = useState("25");
  const [busy, setBusy] = useState(false);

  const vault = deployment?.contracts.vault;

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: USDC,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 12_000 },
  });
  const { data: available, refetch: refetchPool } = useReadContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: "available",
    query: { enabled: Boolean(vault), refetchInterval: 12_000 },
  });

  const fund = async () => {
    if (!vault) return;
    setBusy(true);
    try {
      const value = parseUsd(amount);
      if ((balance ?? 0n) < value) throw new Error("You don't hold that much USDC.");
      await wallet.write({ address: USDC, abi: ERC20_ABI, functionName: "approve", args: [vault, value] });
      await wallet.write({ address: vault, abi: VAULT_ABI, functionName: "deposit", args: [value] });
      toast.success(`Treasury funded with ${amount} USDC`);
      await Promise.all([refetchBalance(), refetchPool()]);
      onFunded();
    } catch (error) {
      toast.error("Couldn't fund the treasury", { description: ((error as Error).message ?? "").slice(0, 160) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 font-heading text-lg">
          <Wallet className="h-4 w-4 text-primary" /> Capital
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Figure label="Your USDC" value={`${usd(balance as bigint | undefined)}`} />
          <Figure label="Ready to trade" value={`${usd(available as bigint | undefined)}`} />
        </div>
        <div className="flex gap-2">
          <Input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" aria-label="Amount in USDC" />
          <Button onClick={fund} disabled={busy || !vault}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Fund
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Your people never hold this money. When someone places an order the treasury funds it
          directly, and whatever isn't spent comes straight back.
        </p>
      </CardContent>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-heading text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
