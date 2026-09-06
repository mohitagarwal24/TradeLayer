import { Request, Response } from "express";
import { getBackendEcdhJwk } from "./backendKeys";

/** Ephemeral public keys for orders, keyed by orderId. In-memory is fine for
 * the demo horizon; a real deployment would persist these. */
const ephemeralPubKeys = new Map<string, string>();

export function registerEphemeralKey(orderId: string, pubKeyB64: string) {
  ephemeralPubKeys.set(orderId, pubKeyB64);
}

export function getEphemeralKey(orderId: string): string | undefined {
  return ephemeralPubKeys.get(orderId);
}

/** Serves the backend's static public JWK so clients can seal orders to us. */
export async function publicKeyHandler(_req: Request, res: Response) {
  const { publicKeyJwkB64 } = await getBackendEcdhJwk();
  res.json({ publicKey: publicKeyJwkB64 });
}

/** Clients post their per-order ephemeral public key here right after (or before)
 * placing the on-chain order so we can derive the shared secret at settlement time. */
export function ephemeralKeyHandler(req: Request, res: Response) {
  const { orderId, publicKey } = req.body ?? {};
  if (!orderId || !publicKey) {
    res.status(400).json({ error: "orderId and publicKey are required" });
    return;
  }
  registerEphemeralKey(String(orderId), String(publicKey));
  res.json({ ok: true });
}
