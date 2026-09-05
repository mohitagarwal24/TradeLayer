import dotenv from 'dotenv';
import { v4 as uuidv4 } from "uuid";

dotenv.config();

export async function importKeyFromEnv(base64Key, isPrivate = false) {
    const jwk = JSON.parse(atob(base64Key));
  
    return crypto.subtle.importKey(
      "jwk",
      jwk,
      {
        name: "ECDH",
        namedCurve: "P-256",
      },
      true,
      isPrivate ? ["deriveKey", "deriveBits"] : []
    );
  }

export async function deriveAESKey(privateKey, peerPublicKey) {
    return crypto.subtle.deriveKey(
      {
        name: "ECDH",
        public: peerPublicKey,
      },
      privateKey,
      {
        name: "AES-GCM",
        length: 256,
      },
      true,
      ["encrypt", "decrypt"]
    );
  }  

export async function encrypt(sharedKey, message) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      sharedKey,
      new TextEncoder().encode(message)
    );
  
    return {
      ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))), 
      iv: btoa(String.fromCharCode(...iv)),
    };
  }

/*
  (async () => {

    const userPrivateKey = process.env.USER_PRIVATE_KEY;
    console.log("user private key",userPrivateKey)

    const userPrivate = await importKeyFromEnv(userPrivateKey, true);
    const backendPublic = await importKeyFromEnv(process.env.BACKEND_PUBLIC_KEY, false);

    const sharedA = await deriveAESKey(userPrivate, backendPublic);

    const order = {
        stock: "GNLN",
        qty: 1,
        orderType: "market"
      };

      const msg = JSON.stringify(order);
      const { ciphertext, iv } = await encrypt(sharedA, msg);
  
    console.log("\nEncrypted Payload:");
    console.log({ ciphertext, iv });
 
  })();

  */
