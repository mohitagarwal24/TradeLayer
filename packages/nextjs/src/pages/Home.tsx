import { useState } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { Building2, Clock, Loader2, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { useMembership } from "@/hooks/useMembership";
import { useDeployment } from "@/hooks/useDeployment";
import { useWalletWrite } from "@/hooks/useWalletWrite";
import { REGISTRY_ABI, bytes32Of, short } from "@/lib/tradelayer";

/**
 * The front door. What it offers depends entirely on who is connected, because the product has
 * no meaning for a wallet that belongs to no institution.
 */
export default function Home() {
  const { address, isConnected } = useAccount();
  const { deployment, offline } = useDeployment();
  const { membership, role, refetch } = useMembership();
  const wallet = useWalletWrite();

  const [name, setName] = useState("");
  const [joinName, setJoinName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const registry = deployment?.contracts.registry;

  const run = async (label: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(label);
    try {
      await fn();
      toast.success(done);
      await refetch();
    } catch (error) {
      toast.error("That didn't go through", { description: readable(error) });
    } finally {
      setBusy(null);
    }
  };

  const create = () =>
    run(
      "create",
      () =>
        wallet.write({
          address: registry!,
          abi: REGISTRY_ABI,
          functionName: "registerOrg",
          args: [bytes32Of(name.trim())],
        }),
      `${name.trim()} is registered — you're its admin`,
    );

  const join = () =>
    run(
      "join",
      () =>
        wallet.write({
          address: registry!,
          abi: REGISTRY_ABI,
          functionName: "proposeJoin",
          args: [bytes32Of(joinName.trim())],
        }),
      "Request sent — the institution's admin has to approve it",
    );

  return (
    <div className="container mx-auto max-w-5xl px-4 py-16">
      <section className="mb-14 text-center">
        <h1 className="mb-4 font-heading text-4xl font-semibold tracking-tight md:text-5xl">
          Private trading for institutions
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
          Fund a treasury, decide who may trade and how much, and let your team buy real equities —
          without publishing what they trade or what they hold.
        </p>
      </section>

      {offline && (
        <Card className="mx-auto mb-8 max-w-xl border-destructive/40">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Can't reach the TradeLayer service. Start the backend, then reload.
          </CardContent>
        </Card>
      )}

      {!isConnected && (
        <Card className="mx-auto max-w-md">
          <CardContent className="flex flex-col items-center gap-4 pt-6 text-center">
            <Building2 className="h-9 w-9 text-primary" />
            <p className="text-sm text-muted-foreground">
              Connect a wallet to create an institution or join one you've been invited to.
            </p>
            <ConnectWalletButton />
          </CardContent>
        </Card>
      )}

      {isConnected && role === "pending" && (
        <Card className="mx-auto max-w-md">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 font-heading text-lg">
              <Clock className="h-4 w-4 text-primary" /> Waiting to be let in
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              You've asked to join <b className="text-foreground">{membership?.org}</b>. Their admin has to
              approve it before you can trade — both sides have to agree, so nobody can add you to an
              institution without your key, and nobody can join one without being let in.
            </p>
            <p className="text-xs">This page updates itself once they approve.</p>
          </CardContent>
        </Card>
      )}

      {isConnected && (role === "admin" || role === "member") && (
        <Card className="mx-auto max-w-md">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 font-heading text-lg">
              <ShieldCheck className="h-4 w-4 text-primary" /> {membership?.org}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {role === "admin"
                ? "You run this institution — fund it, set the rules, and decide who may trade."
                : "You're a member of this institution and can trade within the rules it sets for you."}
            </p>
            <div className="flex gap-2">
              {role === "admin" && (
                <Button asChild variant="outline" className="flex-1">
                  <Link to="/institution">Institution</Link>
                </Button>
              )}
              <Button asChild className="flex-1">
                <Link to="/trade">Trade</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isConnected && role === "none" && (
        <div className="mx-auto grid max-w-3xl gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="font-heading text-lg">Start an institution</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                You'll be its admin: fund the treasury, set private trading rules, and approve the
                people who trade on its behalf.
              </p>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Name, e.g. Northwind Capital"
                maxLength={31}
              />
              <Button
                className="w-full"
                disabled={!name.trim() || !registry || busy !== null}
                onClick={create}
              >
                {busy === "create" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create institution
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="font-heading text-lg">Join one</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Ask to join an institution by name. Their admin approves it — your wallet's own
                signature is what proves you agreed.
              </p>
              <Input
                value={joinName}
                onChange={e => setJoinName(e.target.value)}
                placeholder="Institution name"
                maxLength={31}
              />
              <Button
                variant="outline"
                className="w-full"
                disabled={!joinName.trim() || !registry || busy !== null}
                onClick={join}
              >
                {busy === "join" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Ask to join
              </Button>
              <p className="text-xs text-muted-foreground">Connected as {short(address, 8)}</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

/** Contract reverts are unreadable by default; surface the part a person can act on. */
function readable(error: unknown): string {
  const message = (error as Error)?.message ?? String(error);
  if (/OrgExists/.test(message)) return "That name is already taken.";
  if (/UnknownOrg/.test(message)) return "No institution by that name.";
  if (/AlreadyBound/.test(message)) return "This wallet already belongs to an institution.";
  if (/User rejected|denied/i.test(message)) return "You cancelled the signature.";
  return message.slice(0, 160);
}
