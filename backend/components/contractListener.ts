import { contract } from "./contract";
import dotenv from "dotenv";
import { importKeyFromEnv,deriveAESKey, decrypt } from "../decrypt";
import { AbiCoder } from "ethers";
import { createOrder } from "./alpaca";

dotenv.config();

const abi = new AbiCoder();

export function Events() {
  contract.on("RequestCreated", async (orderId,encryptedOrder) => {
    console.log("📥 Request detected:");
    console.log("orderId",orderId)
    console.log("encryptedOrder", encryptedOrder)

    const decoded = abi.decode(
        ["tuple(string cipherText,string iv)"],
        encryptedOrder
    );

    console.log("decoded order", decoded);

    const {cipherText,iv} = decoded[0];

    const backendPrivate = await importKeyFromEnv(process.env.BACKEND_PRIVATE_KEY, true);
    const userPublic = await importKeyFromEnv(process.env.USER_PUBLIC_KEY, false);
  
    const sharedB = await deriveAESKey(backendPrivate, userPublic);

    // Decrypt
    const decrypted = await decrypt(sharedB, cipherText, iv);
    console.log("\nDecrypted:", decrypted);

    const parsed = JSON.parse(decrypted);
    
    console.log(parsed.stock); 
    console.log(parsed.qty); 
    console.log(parsed.side);
    console.log(parsed.orderType)   

    const order = await createOrder(orderId,parsed.stock,parsed.qty,parsed.side,parsed.orderType)
    console.log("order executed with order id",order)

  });
}

