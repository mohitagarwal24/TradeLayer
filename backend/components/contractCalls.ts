import { contract,usdc } from "./contract";
import { AbiCoder, ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const abi = new AbiCoder();

export async function handleTradeSettlement(orderId, stockName, stockQuantity, side , amountToRefund) {
    console.log("Settlement triggering for:", orderId);

    if(side === "buy"){

        const result = abi.encode(
            ["tuple(string orderId, string stockName, uint256 stockQuantity, uint256 amountToRefund)"],
            [{
              orderId:orderId,
              stockName:stockName,
              stockQuantity:stockQuantity,
              amountToRefund:0
            }]
          );
    
        const tx = await contract.fulfillRequest(orderId,result)
        await tx.wait();
        return tx.hash;
    }
    else if(side === "sell"){

        const result = abi.encode(
            ["tuple(string orderId, string stockName, uint256 stockQuantity, uint256 amountToRefund)"],
            [{
              orderId:orderId,
              stockName:stockName,
              stockQuantity:stockQuantity,
              amountToRefund:amountToRefund
            }]
          );
    
        const tx = await contract.fulfillRequest(orderId,result)
        await tx.wait();
        return tx.hash;

    }
  }