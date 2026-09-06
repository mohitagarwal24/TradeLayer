import { JsonRpcProvider, WebSocketProvider, Wallet, Contract } from "ethers";
import dotenv from "dotenv";
import { abi } from "./abi";

dotenv.config();

// Hedera testnet via Hashio. JSON-RPC is used for writes; WS is optional and
// only used when HEDERA_WS_URL is provided (Hashio may rate-limit sockets).
const RPC_URL = process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api";
const WS_URL = process.env.HEDERA_WS_URL || "";

export const provider = WS_URL
  ? new WebSocketProvider(WS_URL)
  : new JsonRpcProvider(RPC_URL, { chainId: 296, name: "hedera-testnet" }, { staticNetwork: true });

const pk = process.env.private_key;
if (!pk) throw new Error("Missing private_key in backend/.env (the settle wallet's key)");
export const wallet = new Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, provider);

console.log("backend settle wallet:", await wallet.getAddress());

const contractAddress = process.env.contract || "";
if (!contractAddress) throw new Error("Missing contract address in backend/.env");
export const contract = new Contract(contractAddress, abi, wallet);

// Circle's native USDC on Hedera testnet: HTS token 0.0.429274 surfaced at its
// long-zero EVM address by the JSON-RPC relay.
export const HEDERA_TESTNET_USDC = "0x0000000000000000000000000000000000068cDa";

export const usdc = new Contract(
  HEDERA_TESTNET_USDC,
  [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address) external view returns (uint256)",
    "function allowance(address owner, address spender) external view returns (uint256)",
  ],
  wallet,
);
