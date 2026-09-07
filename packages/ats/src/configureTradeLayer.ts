import "dotenv/config";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { ATS_ROLES, ATS_SECURITY_ABI } from "./config.js";

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  const tokenAddress = process.env.ATS_DSTOCK;
  const tradeLayerAddress = process.env.TRADELAYER_ADDRESS;
  const rpc = process.env.RPC_URL ?? "https://testnet.hashio.io/api";
  if (!privateKey || !tokenAddress || !tradeLayerAddress) {
    throw new Error("Set PRIVATE_KEY, ATS_DSTOCK and TRADELAYER_ADDRESS");
  }

  const provider = new JsonRpcProvider(rpc, { chainId: 296, name: "hedera-testnet" }, { staticNetwork: true });
  const wallet = new Wallet(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`, provider);
  const token = new Contract(tokenAddress, ATS_SECURITY_ABI, wallet);

  for (const [label, role] of [
    ["AGENT_ROLE", ATS_ROLES.AGENT],
    ["ISSUER_ROLE", ATS_ROLES.ISSUER],
    ["KYC_ROLE", ATS_ROLES.KYC],
    ["FREEZE_MANAGER_ROLE", ATS_ROLES.FREEZE_MANAGER],
    ["CONTROL_LIST_ROLE", ATS_ROLES.CONTROL_LIST],
    ["NOMINAL_VALUE_ROLE", ATS_ROLES.NOMINAL_VALUE],
  ] as const) {
    if (!(await token.hasRole(role, wallet.address))) {
      console.log(`Granting ATS ${label} to issuer ${wallet.address}`);
      await (await token.grantRole(role, wallet.address)).wait();
    }
  }

  if (!(await token.hasRole(ATS_ROLES.AGENT, tradeLayerAddress))) {
    console.log(`Granting ATS AGENT_ROLE to TradeLayer ${tradeLayerAddress}`);
    const transaction = await token.grantRole(ATS_ROLES.AGENT, tradeLayerAddress);
    await transaction.wait();
    console.log("role transaction:", transaction.hash);
  }

  if (!(await token.hasRole(ATS_ROLES.AGENT, tradeLayerAddress))) {
    throw new Error("TradeLayer did not receive ATS AGENT_ROLE");
  }
  console.log("TradeLayer ATS AGENT_ROLE verified");

  // This ATS token was issued in whitelist mode. KYC and control-list access
  // are separate checks; mint/burn reverts with AccountIsBlocked unless the
  // investor is present in both.
  if (await token.getControlListType()) {
    const investors = [wallet.address, process.env.DEMO_RECIPIENT].filter(
      (address): address is string => Boolean(address),
    );
    for (const investor of investors) {
      if (!(await token.isInControlList(investor))) {
        console.log(`Adding ATS-whitelisted investor ${investor}`);
        await (await token.addToControlList(investor)).wait();
      }
    }
  }

  // One DSTOCK unit = $0.01 deposited value (nominalValue=1, decimals=2).
  const currentNominal = BigInt(await token.getNominalValue());
  const currentDecimals = Number(await token.getNominalValueDecimals());
  if (currentNominal !== 1n || currentDecimals !== 2) {
    console.log(`Updating ATS nominal value from ${currentNominal}@${currentDecimals} to 1@2 ($0.01)`);
    const tx = await token.setNominalValue(1, 2);
    await tx.wait();
    console.log("nominal value transaction:", tx.hash);
  }
  console.log(
    "ATS nominal value:",
    (await token.getNominalValue()).toString(),
    "decimals:",
    (await token.getNominalValueDecimals()).toString(),
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
