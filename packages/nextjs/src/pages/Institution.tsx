import { Navigate } from "react-router-dom";
import { useAccount } from "wagmi";
import { CapitalCard } from "@/components/institution/CapitalCard";
import { PeopleCard } from "@/components/institution/PeopleCard";
import { RulesCard } from "@/components/institution/RulesCard";
import { useMembership } from "@/hooks/useMembership";

export default function Institution() {
  const { isConnected } = useAccount();
  const { membership, role, loading, refetch } = useMembership();

  if (!isConnected) return <Navigate to="/" replace />;
  if (loading) return <div className="container mx-auto px-4 py-16 text-sm text-muted-foreground">Loading…</div>;
  if (role !== "admin" || !membership) return <Navigate to="/" replace />;

  return (
    <div className="container mx-auto max-w-3xl space-y-5 px-4 py-10">
      <header>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{membership.org}</h1>
        <p className="text-sm text-muted-foreground">You're the admin of this institution.</p>
      </header>
      <CapitalCard onFunded={() => void refetch()} />
      <PeopleCard membership={membership} />
      <RulesCard membership={membership} />
    </div>
  );
}
