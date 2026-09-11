import { useQuery } from "@tanstack/react-query";
import { BACKEND_API } from "@/lib/tradelayer";

export type Market = { symbols: string[]; prices: Record<string, { price: number; at: string }>; note?: string };
export type Clock = { isOpen: boolean | null; next_open?: string; next_close?: string };

/** Live last-trade prices for the tickers the platform can actually settle. */
export function useMarket() {
  const { data } = useQuery({
    queryKey: ["market"],
    queryFn: async (): Promise<Market> => (await fetch(`${BACKEND_API}/market`)).json(),
    refetchInterval: 30_000,
  });
  return data;
}

/**
 * Whether the US market is open. Outside hours a real order is accepted and queued rather than
 * filled, so the UI says so plainly instead of looking broken.
 */
export function useMarketClock() {
  const { data } = useQuery({
    queryKey: ["market-clock"],
    queryFn: async (): Promise<Clock> => (await fetch(`${BACKEND_API}/market/clock`)).json(),
    refetchInterval: 60_000,
  });
  return data;
}
