import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { Loader2, Lock, Plus, X } from "lucide-react";
import type { Hex } from "viem";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useWalletWrite } from "@/hooks/useWalletWrite";
import { useDeployment } from "@/hooks/useDeployment";
import { policyTypedData, sealPolicy, type Policy, type PolicyRule } from "@/lib/seal";
import { BACKEND_API, parseUsd } from "@/lib/tradelayer";
import type { Membership } from "@/hooks/useMembership";

type Draft = { address: string; canTrade: boolean; restricted: string[] };
const blank = (): Draft => ({ address: "", canTrade: true, restricted: [] });

/**
 * The institution's private rulebook — who may trade, how much per order, and what they may not
 * touch. These rules never appear on-chain in the clear: they are sealed in this browser and can
 * only be opened inside the enclave, which checks every order against them before it reaches the
 * market. The chain stores ciphertext and a version number.
 */
export function RulesCard({ membership }: { membership: Membership }) {
  const { address } = useAccount();
  const { deployment } = useDeployment();
  const wallet = useWalletWrite();

  const [version, setVersion] = useState<number | null>(null);
  const [maxOrder, setMaxOrder] = useState("100");
  const [rules, setRules] = useState<Draft[]>([blank()]);
  const [busy, setBusy] = useState(false);

  const symbols = deployment?.symbols ?? [];

  const loadVersion = async () => {
    if (!membership.org) return;
    try {
      const res = await fetch(`${BACKEND_API}/org/${encodeURIComponent(membership.org)}`).then(r => r.json());
      setVersion(typeof res.rulesVersion === "number" ? res.rulesVersion : null);
    } catch {
      setVersion(null);
    }
  };

  useEffect(() => {
    void loadVersion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membership.org]);

  const update = (i: number, patch: Partial<Draft>) => setRules(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const publish = async () => {
    if (!deployment || !address || !membership.org || version === null) return;
    setBusy(true);
    try {
      const employees: Record<string, PolicyRule> = {};
      for (const r of rules) {
        const who = r.address.trim().toLowerCase();
        if (!who) continue;
        if (!/^0x[0-9a-f]{40}$/.test(who)) throw new Error(`"${r.address}" is not a wallet address`);
        // dailyCap "0" means no limit — see the Policy type; it is not enforced yet either way.
        employees[who] = { canBuy: r.canTrade, canSell: r.canTrade, dailyCap: "0", restricted: r.restricted };
      }
      if (Object.keys(employees).length === 0) throw new Error("Add at least one person.");

      const policy: Policy = {
        v: 1,
        employees,
        maxOrderNotional: parseUsd(maxOrder).toString(),
        allowWithdrawShares: false,
      };
      // Must exceed the on-chain version so an older rulebook can never be replayed over a newer one.
      const unsigned = { v: 1 as const, orgId: membership.org, admin: address as Hex, policy, nonce: version + 1 };
      const sig = (await wallet.signTypedData(
        policyTypedData(unsigned, deployment.chainId, deployment.contracts.vault),
      )) as Hex;

      const enclave = (await (await fetch(`${BACKEND_API}/enclave-key`)).json()) as { intentPublicKey: Hex };
      const envelope = sealPolicy({ ...unsigned, sig }, enclave.intentPublicKey);

      const res = await fetch(`${BACKEND_API}/policy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId: membership.org, envelope }),
      });
      const body = (await res.json()) as { applied?: boolean; note?: string };
      if (!res.ok || !body.applied) throw new Error(body.note?.slice(-180) ?? `service returned ${res.status}`);

      toast.success("Rules published", { description: "Stored encrypted. Only the enclave can read them." });
      await loadVersion();
    } catch (error) {
      toast.error("Couldn't publish the rules", { description: ((error as Error).message ?? "").slice(0, 180) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 font-heading text-lg">
          <span className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" /> Trading rules
          </span>
          {version !== null && (
            <Badge variant="secondary">{version === 0 ? "none set" : `version ${version}`}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Sealed in your browser and readable only inside the enclave — every order is checked
          against them before it reaches the market.
          {version === 0 && " Until you publish rules, any member may trade freely."}
        </p>

        <label className="flex items-center gap-2 text-sm">
          <span className="whitespace-nowrap text-muted-foreground">Most one order may spend</span>
          <Input value={maxOrder} onChange={e => setMaxOrder(e.target.value)} inputMode="decimal" className="max-w-[120px]" />
          <span className="text-muted-foreground">USDC</span>
        </label>

        <div className="space-y-2">
          {rules.map((rule, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-border/60 p-3">
              <div className="flex gap-2">
                <Input
                  value={rule.address}
                  onChange={e => update(i, { address: e.target.value })}
                  placeholder="Member's wallet address"
                  className="font-mono text-xs"
                />
                <Button variant="ghost" size="icon" onClick={() => setRules(rs => rs.filter((_, j) => j !== i))} aria-label="Remove">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={rule.canTrade ? "default" : "outline"}
                  onClick={() => update(i, { canTrade: !rule.canTrade })}
                >
                  {rule.canTrade ? "May trade" : "Blocked"}
                </Button>
                {symbols.length > 0 && <span className="ml-1 text-xs text-muted-foreground">Can't buy:</span>}
                {symbols.map(symbol => (
                  <Button
                    key={symbol}
                    size="sm"
                    variant={rule.restricted.includes(symbol) ? "destructive" : "outline"}
                    onClick={() =>
                      update(i, {
                        restricted: rule.restricted.includes(symbol)
                          ? rule.restricted.filter(s => s !== symbol)
                          : [...rule.restricted, symbol],
                      })
                    }
                  >
                    {symbol}
                  </Button>
                ))}
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setRules(rs => [...rs, blank()])}>
            <Plus className="mr-1 h-4 w-4" /> Add a person
          </Button>
        </div>

        <Button className="w-full" onClick={publish} disabled={busy || version === null || !wallet.ready}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
          {busy ? "Sealing and publishing…" : "Seal and publish"}
        </Button>
      </CardContent>
    </Card>
  );
}
