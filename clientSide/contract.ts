import {WebSocketProvider, Wallet, Contract} from "ethers";
import dotenv from "dotenv";
import {abi} from "./abi"

dotenv.config();

// Connect to blockchain
const provider = new WebSocketProvider(process.env.alchemy_rpc_url || "");
export const wallet = new Wallet(process.env.private_key!, provider);

console.log("wallet:",wallet)

const contractAddress = process.env.contract || "";
export const contract = new Contract(contractAddress, abi, wallet);

console.log("contract:", contract);

const usdcAddress = "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8";

export const usdc = new Contract(usdcAddress,
  [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address) external view returns (uint256)",
    "function allowance(address owner, address spender) external view returns (uint256)",
  ], wallet);