import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { BACKEND_API } from "@/lib/tradelayer";

export type Membership = {
  address: `0x${string}`;
  /** Both halves of the mutual consent are done: this wallet belongs to an institution. */
  member: boolean;
  /** The wallet asked to join but the admin has not approved yet. */
  pending: boolean;
  orgId: `0x${string}` | null;
  org: string | null;
  isAdmin: boolean;
};

/**
 * Who the connected wallet is, in the product's terms. This decides which screens exist for
 * them: found an institution, wait to be let in, or trade.
 */
export function useMembership() {
  const { address } = useAccount();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["membership", address],
    enabled: Boolean(address),
    refetchInterval: 8_000,
    queryFn: async (): Promise<Membership> => {
      const res = await fetch(`${BACKEND_API}/wallet/${address}`);
      if (!res.ok) throw new Error(`membership lookup failed (${res.status})`);
      return res.json();
    },
  });
  return {
    membership: data,
    loading: isLoading && Boolean(address),
    role: !address ? "disconnected" : !data ? "unknown" : data.isAdmin ? "admin" : data.member ? "member" : data.pending ? "pending" : "none",
    refetch,
  } as const;
}
