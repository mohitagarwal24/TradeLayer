import { useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { toast } from "sonner";
import { Check, Loader2, Snowflake, UserPlus, Users } from "lucide-react";
import { isAddress, parseAbiItem, type Address } from "viem";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useWalletWrite } from "@/hooks/useWalletWrite";
import { useDeployment } from "@/hooks/useDeployment";
import { BACKEND_API, REGISTRY_ABI, ROUTER_ABI, short } from "@/lib/tradelayer";
import type { Membership } from "@/hooks/useMembership";

type Person = { address: Address; admitted: boolean; frozen: boolean };

/**
 * The people screen. Two distinct things happen here and it matters that they read as distinct:
 * approving someone into the institution (they asked; you agree), and admitting them on the
 * equity tokens so they can actually take delivery of shares. The second is enforced by the
 * token itself — a competitor cannot do it to your staff, and you cannot do it to theirs.
 */
export function PeopleCard({ membership }: { membership: Membership }) {
  const { address } = useAccount();
  const client = usePublicClient();
  const { deployment } = useDeployment();
  const wallet = useWalletWrite();

  const [requests, setRequests] = useState<Address[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const registry = deployment?.contracts.registry;
  const router = deployment?.contracts.router;

  const load = async () => {
    if (!client || !registry || !membership.orgId) return;
    try {
      const head = await client.getBlockNumber();
      const logs = await client.getLogs({
        address: registry,
        event: parseAbiItem("event JoinProposed(bytes32 indexed orgId, address indexed wallet)"),
        args: { orgId: membership.orgId },
        fromBlock: head > 45_000n ? head - 45_000n : 0n,
        toBlock: head,
      });

      const seen = [...new Set(logs.map(l => l.args.wallet as Address))];
      const pending: Address[] = [];
      const members: Person[] = [];
      for (const who of seen) {
        const org = (await client.readContract({
          address: registry,
          abi: REGISTRY_ABI,
          functionName: "orgOf",
          args: [who],
        } as never)) as string;
        if (org === membership.orgId) {
          const res = await fetch(`${BACKEND_API}/compliance/${who}`).then(r => r.json());
          const first = Object.values(res.admitted ?? {})[0] as { kyc: boolean; frozen: boolean } | undefined;
          members.push({ address: who, admitted: Boolean(first?.kyc), frozen: Boolean(first?.frozen) });
        } else {
          pending.push(who);
        }
      }
      setRequests(pending);
      setPeople(members);
    } catch {
      // A flaky RPC shouldn't blank the screen; keep whatever we last showed.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, registry, membership.orgId]);

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(done);
      await load();
    } catch (error) {
      toast.error("That didn't go through", { description: ((error as Error).message ?? "").slice(0, 160) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 font-heading text-lg">
          <Users className="h-4 w-4 text-primary" /> People
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Requests to join
          </h3>
          {loading ? (
            <Skeleton />
          ) : requests.length === 0 ? (
            <Empty>Nobody is waiting. Share your institution's name for someone to request access.</Empty>
          ) : (
            requests.map(who => (
              <Row key={who} address={who}>
                <Button
                  size="sm"
                  disabled={busy !== null || !registry}
                  onClick={() =>
                    act(
                      `approve-${who}`,
                      () => wallet.write({ address: registry!, abi: REGISTRY_ABI, functionName: "approveJoin", args: [who] }),
                      "Approved — they're in",
                    )
                  }
                >
                  {busy === `approve-${who}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  <span className="ml-1.5">Approve</span>
                </Button>
              </Row>
            ))
          )}
        </section>

        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Members
          </h3>
          {loading ? (
            <Skeleton />
          ) : people.length === 0 ? (
            <Empty>No members yet.</Empty>
          ) : (
            people.map(p => (
              <Row key={p.address} address={p.address}>
                {p.address.toLowerCase() === address?.toLowerCase() && <Badge variant="secondary">you</Badge>}
                {p.frozen ? (
                  <Badge variant="destructive">suspended</Badge>
                ) : p.admitted ? (
                  <Badge variant="secondary">can hold shares</Badge>
                ) : null}
                {!p.admitted && !p.frozen && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null || !router}
                    onClick={() =>
                      act(
                        `admit-${p.address}`,
                        () => wallet.write({ address: router!, abi: ROUTER_ABI, functionName: "admitMember", args: [p.address] }),
                        "Admitted — the equity tokens now permit them",
                      )
                    }
                  >
                    {busy === `admit-${p.address}` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <UserPlus className="h-3.5 w-3.5" />
                    )}
                    <span className="ml-1.5">Admit</span>
                  </Button>
                )}
                {p.address.toLowerCase() !== address?.toLowerCase() && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null || !router}
                    onClick={() =>
                      act(
                        `freeze-${p.address}`,
                        () =>
                          wallet.write({
                            address: router!,
                            abi: ROUTER_ABI,
                            functionName: "setMemberFrozen",
                            args: [p.address, !p.frozen],
                          }),
                        p.frozen ? "Reinstated" : "Suspended across every equity",
                      )
                    }
                    title={p.frozen ? "Reinstate" : "Suspend"}
                  >
                    <Snowflake className="h-3.5 w-3.5" />
                  </Button>
                )}
              </Row>
            ))
          )}
        </section>

        <p className="text-xs text-muted-foreground">
          Suspending someone is enforced by the equity token itself, not by this app — and only you
          can do it to your own people. Another institution's admin cannot touch them.
        </p>
      </CardContent>
    </Card>
  );
}

function Row({ address, children }: { address: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/40 py-2 last:border-0">
      <span className="font-mono text-xs text-muted-foreground">{short(address, 10)}</span>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border/60 p-3 text-xs text-muted-foreground">{children}</p>;
}

function Skeleton() {
  return <div className="h-10 animate-pulse rounded-lg bg-secondary/60" />;
}
