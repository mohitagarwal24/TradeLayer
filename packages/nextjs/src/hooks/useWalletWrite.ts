import type { Abi, Address, Hash, SignTypedDataParameters } from "viem";
import { useWalletClient } from "wagmi";
import { useTransactor } from "~~/hooks/scaffold-eth/useTransactor";

type WriteParams = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint };

/**
 * Writes and signatures against contracts whose address is only known at runtime (the company
 * token, ATS tokens). Goes through viem's wallet client with an explicit account + chain, which is
 * what wagmi 3 requires; the scaffold hooks make the same cast for their fixed contracts.
 */
export function useWalletWrite() {
  const { data: walletClient } = useWalletClient();
  const writeTx = useTransactor();

  async function write(params: WriteParams): Promise<Hash | undefined> {
    if (!walletClient) throw new Error("Connect a wallet first");
    return writeTx(() =>
      walletClient.writeContract({ ...params, account: walletClient.account, chain: walletClient.chain } as never),
    );
  }

  async function signTypedData(params: Omit<SignTypedDataParameters, "account">): Promise<Hash> {
    if (!walletClient) throw new Error("Connect a wallet first");
    return walletClient.signTypedData({ ...params, account: walletClient.account } as SignTypedDataParameters);
  }

  return { write, signTypedData, ready: Boolean(walletClient) };
}
