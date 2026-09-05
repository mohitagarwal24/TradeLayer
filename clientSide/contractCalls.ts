import { contract,usdc } from "./contract";
import { AbiCoder, ethers } from "ethers";
import dotenv from "dotenv";
import { importKeyFromEnv,deriveAESKey,encrypt } from "./encrypt";
import {v4} from "uuid";

dotenv.config();

export async function buyOrder(stockSymbol: string, stockQuantity: string, amount:string, orderType:string ) {

  const userPrivateKey = process.env.USER_PRIVATE_KEY;
    console.log("user private key",userPrivateKey)

    const userPrivate = await importKeyFromEnv(userPrivateKey, true);
    const backendPublic = await importKeyFromEnv(process.env.BACKEND_PUBLIC_KEY, false);

    const sharedA = await deriveAESKey(userPrivate, backendPublic);

    const order = {
        stock: stockSymbol,
        qty: stockQuantity,
        side:"buy",
        orderType: orderType
      };

      const msg = JSON.stringify(order);
      const { ciphertext, iv } = await encrypt(sharedA, msg);
  
    console.log("\nEncrypted Payload:");
    console.log({ ciphertext, iv });
  
  try {
    const abi = new AbiCoder();

    const encoded = abi.encode(
      ["tuple(string cipherText, string iv)"],
      [{
        cipherText:ciphertext,
        iv:iv
      }]
    );

    console.log("encoded data", encoded);

    const orderId = v4();

    const scaledValue = ethers.parseUnits(amount, 6);

    // Approve the deposit contract to spend tokens
    console.log(`Approving ${amount} USDC`);
    
    const approveTx = await usdc.approve(contract.target, scaledValue);
    await approveTx.wait();
    console.log("Approval successful:", approveTx.hash);

    const tx = await contract.buyStock(orderId,encoded,scaledValue);
    await tx.wait();
    return {orderId:orderId, tx:tx.hash};

  } catch (err: any) {
    console.error("❌ Failed to submit order:", err);
    throw err;
  }
}

export async function sellOrder(stockSymbol: string, stockQuantity: string, amount:string, orderType:string) {

  const userPrivateKey = process.env.USER_PRIVATE_KEY;
    console.log("user private key",userPrivateKey)

    const userPrivate = await importKeyFromEnv(userPrivateKey, true);
    const backendPublic = await importKeyFromEnv(process.env.BACKEND_PUBLIC_KEY, false);

    const sharedA = await deriveAESKey(userPrivate, backendPublic);

    const order = {
        stock: stockSymbol,
        qty: stockQuantity,
        side:"sell",
        orderType: orderType
      };

      const msg = JSON.stringify(order);
      const { ciphertext, iv } = await encrypt(sharedA, msg);
  
    console.log("\nEncrypted Payload:");
    console.log({ ciphertext, iv });
  
  try {
    const abi = new AbiCoder();

    const encoded = abi.encode(
      ["tuple(string cipherText, string iv)"],
      [{
        cipherText:ciphertext,
        iv:iv
      }]
    );

    console.log("encoded data", encoded);

    const orderId = v4();

    // Approve the deposit contract to spend tokens
    console.log(`Approving ${amount} DSTOCK`);
    
    const approveTx = await contract.approve(contract.target, amount);
    await approveTx.wait();
    console.log("Approval successful:", approveTx.hash);

    const tx = await contract.redeemStock(orderId,encoded,amount);
    await tx.wait();
    return {orderId:orderId, tx:tx.hash};

  } catch (err: any) {
    console.error("❌ Failed to submit order:", err);
    throw err;
  }
}


