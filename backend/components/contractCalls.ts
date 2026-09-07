import { contract } from "./contract";
import { AbiCoder } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const abi = new AbiCoder();

export async function handleTradeSettlement(
  orderId: string,
  dstockUnits: number,
  amountToRefund: bigint,
  executionCommitment: string,
) {
  console.log("Settlement triggering for:", orderId);
  const result = abi.encode(
    ["tuple(uint256 dstockUnits, uint256 amountToRefund, bytes32 executionCommitment)"],
    [{ dstockUnits, amountToRefund, executionCommitment }],
  );

  const tx = await contract.fulfillRequest(orderId, result);
  await tx.wait();
  return tx.hash;
}

export async function handleTradeCancellation(orderId: string) {
  const tx = await contract.cancelRequest(orderId);
  await tx.wait();
  return tx.hash;
}
