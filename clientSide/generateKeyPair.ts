/////////////////////////
// 1. Key Generation  //
/////////////////////////
/*
async function generateKeyPair() {
    return crypto.subtle.generateKey(
      {
        name: "ECDH",
        namedCurve: "P-256",
      },
      true,
      ["deriveKey", "deriveBits"]
    );
  }
  
  ////////////////////////////
  // 2. Export to Base64   //
  ////////////////////////////
  
  async function exportKeyToEnv(key) {
    const jwk = await crypto.subtle.exportKey("jwk", key);
    return btoa(JSON.stringify(jwk)); // base64 to store in .env
  }
  
  ////////////////////////////
  // 3. Import from Base64 //
  ////////////////////////////
  
  async function importKeyFromEnv(base64Key, isPrivate = false) {
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
  
  
  ////////////////////////////////////////////
  // 4. Derive Shared AES Key (AES-256-GCM) //
  ////////////////////////////////////////////
  
  async function deriveAESKey(privateKey, peerPublicKey) {
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
  
  /////////////////////////
  // 5. Encrypt / Decrypt
  /////////////////////////
  
  async function encrypt(sharedKey, message) {
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
  
  async function decrypt(sharedKey, ciphertextBase64, ivBase64) {
    const ciphertext = Uint8Array.from(atob(ciphertextBase64), c => c.charCodeAt(0));
    const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
  
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      sharedKey,
      ciphertext
    );
  
    return new TextDecoder().decode(decrypted);
  }
  
  
  /////////////////////////
  // 6. DEMO
  /////////////////////////
  
  (async () => {
  
    // STEP A: First time only → Generate + store in .env
    const userKeys = await generateKeyPair();
    const backendKeys = await generateKeyPair();
  
    const envValues = {
      USER_PUBLIC_KEY: await exportKeyToEnv(userKeys.publicKey),
      USER_PRIVATE_KEY: await exportKeyToEnv(userKeys.privateKey),
      BACKEND_PUBLIC_KEY: await exportKeyToEnv(backendKeys.publicKey),
      BACKEND_PRIVATE_KEY: await exportKeyToEnv(backendKeys.privateKey),
    };
  
    console.log("COPY THESE TO .env:\n", envValues);
  
  
    // ----- Pretend .env loaded -----
    const ENV = { ...envValues };
  
    // STEP B: Restore keys from .env
    const userPrivate = await importKeyFromEnv(ENV.USER_PRIVATE_KEY, true);
    const backendPublic = await importKeyFromEnv(ENV.BACKEND_PUBLIC_KEY, false);
    const backendPrivate = await importKeyFromEnv(ENV.BACKEND_PRIVATE_KEY, true);
    const userPublic = await importKeyFromEnv(ENV.USER_PUBLIC_KEY, false);
  
  
    // Derive matching shared secret on both sides
    const sharedA = await deriveAESKey(userPrivate, backendPublic);
    const sharedB = await deriveAESKey(backendPrivate, userPublic);
  
    console.log("Shared keys equal:", sharedA.algorithm.name === sharedB.algorithm.name);
  
  
    // Encrypt
    const msg = "BUY TSLA LIMIT $250";
    const { ciphertext, iv } = await encrypt(sharedA, msg);
  
    console.log("\nEncrypted Payload:");
    console.log({ ciphertext, iv });
  
  
    // Decrypt
    const decrypted = await decrypt(sharedB, ciphertext, iv);
    console.log("\nDecrypted:", decrypted);
  
  })();
  */