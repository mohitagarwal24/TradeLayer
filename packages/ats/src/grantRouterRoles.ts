/**
 * One-time wiring between the equity diamonds and TradeLayer, signed by the ATS issuer.
 *
 *   yarn ats:grant-router-roles
 *
 * Two contracts need standing on each equity, and it matters that they are different contracts:
 *   OmnibusVault      AGENT_ROLE  — it is the only thing that mints, burns and moves shares
 *   ComplianceRouter  KYC + CONTROL_LIST + FREEZE_MANAGER — it decides who may hold them
 *
 * Institution admins never hold these roles themselves. They ask the router, which refuses unless
 * the registry says the wallet is actually theirs — that is what stops one institution freezing
 * a competitor's employee.
 *
 * The vault must also itself be an eligible holder (KYC'd and control-listed), or the very first
 * mint into the omnibus reverts.
 *
 * Env (packages/ats/.env): PRIVATE_KEY (the ATS issuer), OMNIBUS_VAULT, COMPLIANCE_ROUTER,
 * ATS_F / ATS_TSLA / ATS_VOO, optional RPC_URL.
 */
import "dotenv/config";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { ATS_ROLES, ATS_SECURITY_ABI } from "./config.js";

const RPC = process.env.RPC_URL ?? "https://testnet.hashio.io/api";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Set ${name} in packages/ats/.env`);
  return v;
}

async function main() {
  const provider = new JsonRpcProvider(RPC, { chainId: 296, name: "hedera-testnet" }, { staticNetwork: true, batchMaxCount: 1 });
  const issuer = new Wallet(env("PRIVATE_KEY").replace(/^(?!0x)/, "0x"), provider);
  const vault = env("OMNIBUS_VAULT");
  const router = env("COMPLIANCE_ROUTER");

  const tokens = [
    ["F", process.env.ATS_F],
    ["TSLA", process.env.ATS_TSLA],
    ["VOO", process.env.ATS_VOO],
  ].filter(([, address]) => Boolean(address)) as Array<[string, string]>;

  if (tokens.length === 0) throw new Error("Set at least one of ATS_F / ATS_TSLA / ATS_VOO");

  console.log(`issuer   ${issuer.address}`);
  console.log(`vault    ${vault}`);
  console.log(`router   ${router}\n`);

  const send = async (label: string, fn: () => Promise<{ hash: string; wait: () => Promise<unknown> }>) => {
    process.stdout.write(`  ${label.padEnd(40)}`);
    try {
      const tx = await fn();
      await tx.wait();
      console.log(`ok   ${tx.hash}`);
    } catch (error) {
      console.log(`FAILED  ${(error as Error).message.slice(0, 140)}`);
    }
  };

  for (const [symbol, address] of tokens) {
    console.log(`${symbol}  ${address}`);
    const token = new Contract(address, ATS_SECURITY_ABI, issuer);

    // The most easily missed prerequisite. `grantKyc` validates its `issuer` ARGUMENT against the
    // diamond's SSI issuer list — not the caller — so the router's `atsIssuer` must be on it, or
    // every admission reverts with AccountIsNotIssuer at the worst possible moment.
    if (!(await token.isIssuer(issuer.address))) {
      if (!(await token.hasRole(ATS_ROLES.SSI_MANAGER, issuer.address))) {
        await send("SSI_MANAGER_ROLE → issuer", () => token.grantRole(ATS_ROLES.SSI_MANAGER, issuer.address));
      }
      await send("register issuer on the SSI list", () => token.addIssuer(issuer.address));
    }

    if (!(await token.hasRole(ATS_ROLES.AGENT, vault))) {
      await send("AGENT_ROLE → vault", () => token.grantRole(ATS_ROLES.AGENT, vault));
    }
    for (const role of ["KYC", "CONTROL_LIST", "FREEZE_MANAGER"] as const) {
      if (!(await token.hasRole(ATS_ROLES[role], router))) {
        await send(`${role}_ROLE → router`, () => token.grantRole(ATS_ROLES[role], router));
      }
    }

    // The omnibus has to be allowed to hold the thing it custodies.
    if (!(await token.hasRole(ATS_ROLES.KYC, issuer.address))) {
      await send("KYC_ROLE → issuer (to admit the vault)", () => token.grantRole(ATS_ROLES.KYC, issuer.address));
    }
    if (!(await token.hasRole(ATS_ROLES.CONTROL_LIST, issuer.address))) {
      await send("CONTROL_LIST_ROLE → issuer", () => token.grantRole(ATS_ROLES.CONTROL_LIST, issuer.address));
    }
    if (Number(await token.getKycStatusFor(vault)) !== 1) {
      const now = Math.floor(Date.now() / 1000);
      await send("KYC → vault", () =>
        token.grantKyc(vault, "tradelayer:omnibus", now, now + 365 * 24 * 3600, issuer.address),
      );
    }
    if ((await token.getControlListType()) && !(await token.isInControlList(vault))) {
      await send("control list → vault", () => token.addToControlList(vault));
    }

    console.log(`  decimals=${await token.decimals()}  supply=${await token.totalSupply()}\n`);
  }

  console.log("Done. The vault can mint and move these equities; the router can admit and freeze");
  console.log("holders, but only ones the registry says belong to the institution asking.");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
