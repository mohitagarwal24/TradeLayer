import { useQuery } from "@tanstack/react-query";
import { BACKEND_API } from "@/lib/tradelayer";

export type Deployment = {
  ok: boolean;
  chainId: number;
  relayer: `0x${string}`;
  contracts: {
    escrow: `0x${string}`;
    ledger: `0x${string}`;
    vault: `0x${string}`;
    registry: `0x${string}`;
    router: `0x${string}`;
  };
  symbols: string[];
};

/**
 * Where the contracts live. Asking the backend rather than importing a generated file means one
 * place to configure a deployment, and the app fails loudly if that place is wrong instead of
 * silently reading stale addresses.
 */
export function useDeployment() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["deployment"],
    queryFn: async (): Promise<Deployment> => {
      const res = await fetch(`${BACKEND_API}/health`);
      if (!res.ok) throw new Error(`backend returned ${res.status}`);
      return res.json();
    },
    staleTime: Infinity,
    retry: 1,
  });
  return { deployment: data, loading: isLoading, offline: Boolean(error) };
}
