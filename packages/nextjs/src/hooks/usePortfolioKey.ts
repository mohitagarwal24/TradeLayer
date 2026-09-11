import { create } from "zustand";
import { useAccount, useSignMessage } from "wagmi";
import { toast } from "sonner";
import { PORTFOLIO_KEY_MESSAGE, portfolioKeyFromSignature, type Hex } from "@/lib/seal";

/**
 * The employee's portfolio encryption key, derived once per session from a wallet signature over a
 * fixed message. Lives only in memory: closing the tab forgets it, re-signing recovers it.
 */
type State = {
  address?: Hex;
  privateKey?: Uint8Array;
  publicKey?: Hex;
  set: (address: Hex, privateKey: Uint8Array, publicKey: Hex) => void;
  clear: () => void;
};

const useStore = create<State>()(set => ({
  set: (address, privateKey, publicKey) => set({ address, privateKey, publicKey }),
  clear: () => set({ address: undefined, privateKey: undefined, publicKey: undefined }),
}));

export function usePortfolioKey() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const store = useStore();
  const ready = Boolean(store.privateKey && store.address && address && store.address.toLowerCase() === address.toLowerCase());

  async function derive(): Promise<{ privateKey: Uint8Array; publicKey: Hex }> {
    if (!address) throw new Error("connect a wallet first");
    if (ready && store.privateKey && store.publicKey) return { privateKey: store.privateKey, publicKey: store.publicKey };
    const signature = await signMessageAsync({ account: address, message: PORTFOLIO_KEY_MESSAGE });
    const key = portfolioKeyFromSignature(signature as Hex);
    store.set(address, key.privateKey, key.publicKey);
    toast.success("Portfolio key derived", { description: "Held in memory for this session only." });
    return key;
  }

  return { ready, publicKey: ready ? store.publicKey : undefined, privateKey: ready ? store.privateKey : undefined, derive, clear: store.clear };
}
