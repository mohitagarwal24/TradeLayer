import { TransactionBase } from "viem";
import { decodeFunctionData } from "viem";
import { contracts } from "~~/utils/scaffold-eth/contract";

// viem's Transaction union narrowed harder than what callers hold; decoding
// only needs `input`.
export const decodeTransactionData = (tx: any) => {
  const input: `0x${string}` | undefined = tx?.input;

  if (!input) return;

  const allContracts = Object.entries(contracts ?? {});
  const decodedInput = allContracts.reduce((result, [_contractName, contract]) => {
    const abi = Object.values(contract)[0]?.abi;
    try {
      const { functionName, args } = decodeFunctionData({
        abi,
        data: input,
      });

      result.decodedData = {
        args,
        functionName,
      };
      return result;
    } catch (e) {
      return result;
    }
  }, {} as any);

  tx.functionData = decodedInput;
};
