import dotenv from 'dotenv';

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

export async function decrypt(sharedKey, ciphertextBase64, ivBase64) {
    const ciphertext = Uint8Array.from(atob(ciphertextBase64), c => c.charCodeAt(0));
    const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
  
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      sharedKey,
      ciphertext
    );
  
    return new TextDecoder().decode(decrypted);
  }
/*
  (async () => {

    console.log("backend private key ", process.env.BACKEND_PRIVATE_KEY);

    const backendPrivate = await importKeyFromEnv(process.env.BACKEND_PRIVATE_KEY, true);
    const userPublic = await importKeyFromEnv(process.env.USER_PUBLIC_KEY, false);
  
  
    const sharedB = await deriveAESKey(backendPrivate, userPublic);

    const ciphertext = 'ymbRv9z/vT2s9hANlOYq5zbQqDGT9ZAaHpkrX82syAT+EME='
    const iv = 'aCub0kJi36sq6ww8'
    // Decrypt
    const decrypted = await decrypt(sharedB, ciphertext, iv);
    console.log("\nDecrypted:", decrypted);
  
  })();

  */