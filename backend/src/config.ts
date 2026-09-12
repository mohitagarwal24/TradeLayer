import "dotenv/config";
import path from "node:path";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in backend/.env`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(optional("PORT", "8000")),
  frontendOrigin: optional("FRONTEND_ORIGIN", "http://localhost:8080"),
  dataDir: path.resolve(optional("DATA_DIR", ".data")),

  hedera: {
    chainId: Number(optional("CHAIN_ID", "296")),
    rpcUrl: optional("RPC_URL", "https://testnet.hashio.io/api"),
  },

  /// Tickers the platform has issued an ATS equity for. The UI reads this so it never offers a
  /// symbol the vault cannot actually settle.
  symbols: optional("SYMBOLS", "F,TSLA,VOO")
    .split(",")
    .map(s => s.trim().toUpperCase())
    .filter(Boolean),

  contracts: {
    escrow: required("ORDER_ESCROW"),
    ledger: required("CONFIDENTIAL_LEDGER"),
    vault: required("OMNIBUS_VAULT"),
    registry: required("ORG_WALLET_REGISTRY"),
    router: required("COMPLIANCE_ROUTER"),
  },

  /// Read-only Alpaca market-data credentials, used only to show live prices in the UI. These
  /// are deliberately NOT the trading credentials — those are Vault DON secrets that exist only
  /// inside the enclave. Quotes are public information; the ability to place an order is not.
  marketData: {
    baseUrl: optional("ALPACA_DATA_URL", "https://data.alpaca.markets"),
    keyId: process.env.ALPACA_DATA_KEY_ID ?? "",
    secret: process.env.ALPACA_DATA_SECRET ?? "",
  },

  /// Shared secret the enclave sends with every relay call. Empty means the endpoint is open,
  /// which is acceptable on localhost and never in a deployment.
  relayAuthToken: optional("RELAY_AUTH_TOKEN", ""),

  /// Address the enclave signs with. The relayer refuses anything else before spending gas.
  enclaveSigner: required("ENCLAVE_SIGNER"),
  /// Hot key that pays for transactions. It can only relay enclave-signed authorizations.
  relayerPrivateKey: required("RELAYER_PRIVATE_KEY"),
  /// Hedera's eth_estimateGas under-estimates calls that touch several contracts in one
  /// transaction — a settlement writes the ledger and unwinds the escrow together, estimates
  /// low, then reverts having consumed the whole limit. Send an explicit floor instead.
  /// 0 disables the floor.
  relayGasLimit: Number(optional("RELAY_GAS_LIMIT", "0")),
  /// Uncompressed or compressed secp256k1 public key clients seal intents to (0x-hex).
  intentPublicKey: required("INTENT_PUBKEY"),

  /// How sealed envelopes reach the enclave.
  ///   simulate  — spawn `cre workflow simulate` with the envelope as the HTTP trigger payload
  ///   gateway   — POST to the CRE HTTP trigger gateway (live deployment)
  ///   none      — persist only (tests)
  trigger: {
    mode: optional("TRIGGER_MODE", "simulate") as "simulate" | "gateway" | "none",
    creProjectDir: path.resolve(optional("CRE_PROJECT_DIR", "../cre")),
    creWorkflowDir: optional("CRE_WORKFLOW_DIR", "tradelayer"),
    creTarget: optional("CRE_TARGET", "testnet-settings"),
    creBin: optional("CRE_BIN", "cre"),
    /// Env file the simulator loads the enclave secrets from, relative to the CRE project dir.
    creEnvFile: optional("CRE_ENV_FILE", ".env"),
    /// The CLI shells out to `bun` to compile TypeScript workflows; a service started from a
    /// login-less shell usually has neither bun nor cre on PATH.
    extraPath: optional("CRE_EXTRA_PATH", `${process.env.HOME ?? ""}/.bun/bin:${process.env.HOME ?? ""}/.cre/bin`),
    /// The local relayer is plain http; the simulator refuses that without this.
    allowInsecureRpc: optional("CRE_ALLOW_INSECURE_RPC", "true") === "true",
    gatewayUrl: optional("CRE_GATEWAY_URL", ""),
    /// 64-hex workflow id printed by `cre workflow deploy`. The gateway routes on this.
    workflowId: optional("CRE_WORKFLOW_ID", "").replace(/^0x/, ""),
    /// Key that signs the gateway JWT. Its address must appear in the workflow's
    /// `authorizedKeys`. Defaults to the relayer key so a deployment needs no extra secret;
    /// set it separately if you would rather the trigger identity could not also spend gas.
    gatewaySigningKey: optional("GATEWAY_SIGNING_KEY", "") || optional("RELAYER_PRIVATE_KEY", ""),
  },
} as const;
