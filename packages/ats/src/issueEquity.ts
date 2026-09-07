/**
 * Issue DSTOCK as an ATS equity on Hedera testnet (ERC-3643 path).
 *
 * Requires an interactive wallet connect (MetaMask / Hedera WalletConnect)
 * because the published ATS SDK signs through those adapters. After the equity
 * diamond deploys, copy `evmDiamondAddress` into packages/foundry/.env as
 * ATS_DSTOCK=0x... then run `yarn deploy:hedera-testnet`.
 *
 * Usage:
 *   cd packages/ats && yarn issue-equity
 */
import "reflect-metadata";
import {
  Network,
  Equity,
  CreateEquityRequest,
  SupportedWallets,
  InitializationRequest,
  ConnectRequest,
} from "@hashgraph/asset-tokenization-sdk";
import { HEDERA_TESTNET } from "./config.js";

async function main() {
  console.log("Initialising ATS SDK against Hedera testnet…");
  console.log("  factory:", HEDERA_TESTNET.factory);
  console.log("  resolver:", HEDERA_TESTNET.resolver);

  await Network.init(
    new InitializationRequest({
      network: HEDERA_TESTNET.network,
      mirrorNode: { name: "hedera-testnet-mirror", baseUrl: HEDERA_TESTNET.mirrorNode },
      rpcNode: { name: "hashio", baseUrl: HEDERA_TESTNET.rpcNode },
      configuration: {
        factoryAddress: HEDERA_TESTNET.factory,
        resolverAddress: HEDERA_TESTNET.resolver,
      },
    }),
  );

  console.log("\nConnect MetaMask (Hedera testnet profile) when prompted…");
  await Network.connect(
    new ConnectRequest({
      network: HEDERA_TESTNET.network,
      mirrorNode: { name: "hedera-testnet-mirror", baseUrl: HEDERA_TESTNET.mirrorNode },
      rpcNode: { name: "hashio", baseUrl: HEDERA_TESTNET.rpcNode },
      wallet: SupportedWallets.METAMASK,
    }),
  );

  // ISO 4217 numeric code for USD as hex ("USD" → 0x555344)
  const usdCurrency = "0x555344";

  const req = new CreateEquityRequest({
    name: "TradeLayer Equity",
    symbol: "DSTOCK",
    isin: "US000000TL01",
    decimals: 0,
    isWhiteList: true,
    erc20VotesActivated: false,
    isControllable: true,
    arePartitionsProtected: false,
    isMultiPartition: false,
    clearingActive: false,
    internalKycActivated: true,
    votingRight: true,
    informationRight: true,
    liquidationRight: true,
    subscriptionRight: false,
    conversionRight: false,
    redemptionRight: true,
    putRight: false,
    dividendRight: 0,
    currency: usdCurrency,
    numberOfShares: "1000000000",
    nominalValue: "1",
    nominalValueDecimals: 0,
    regulationType: 0,
    regulationSubType: 0,
    isCountryControlListWhiteList: false,
    countries: "",
    // Published ATS equity business-logic config — override via env if your
    // factory version expects different keys (see ATS web .env.example).
    configId: process.env.ATS_CONFIG_ID ?? "0x0000000000000000000000000000000000000000000000000000000000000001",
    configVersion: Number(process.env.ATS_CONFIG_VERSION ?? "1"),
  });

  console.log("\nCreating ERC-3643 equity via ATS factory…");
  const result = await Equity.create(req);

  console.log("\n=== ATS equity issued ===");
  console.log("Hedera diamond id :", result.security?.diamondAddress ?? result);
  console.log("EVM diamond addr  :", result.security?.evmDiamondAddress);
  console.log("Tx id             :", result.transactionId);
  console.log("\nNext steps:");
  console.log("  1. ATS_DSTOCK=<evmDiamondAddress> in packages/foundry/.env");
  console.log("  2. yarn deploy:hedera-testnet");
  console.log("  3. Grant TradeLayer the ATS Minter/Agent role (Role.applyRoles)");
  console.log("  4. yarn workspace @tradelayer/ats lifecycle");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
