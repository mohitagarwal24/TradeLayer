import { formatUnits, type Contract, type Log } from "ethers";
import { config } from "./config";
import { escrow, ledger, provider, registry, router, vault } from "./hedera";
import { detail, log, short } from "./log";

/**
 * Chain narration.
 *
 * Most of what a user does happens between their wallet and Hedera — registering an institution,
 * joining one, funding the treasury, admitting a colleague. None of it passes through this
 * process, so the only way the terminal can tell the story is to watch the chain and say what it
 * sees. That is also exactly what an outside observer would see, which makes this log an honest
 * demonstration of how little that is: an amount and a deadline, never a symbol or a position.
 *
 * Polled rather than subscribed: Hashio is unreliable with persistent log filters, and a poll is
 * good enough for narration.
 */

const POLL_MS = Number(process.env.WATCH_POLL_MS ?? 4_000);
const usdc = (v: bigint) => `${formatUnits(v, 6)} USDC`;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
/** A deadline is only meaningful on camera as a clock time. */
const when = (unix: bigint) => new Date(Number(unix) * 1000).toLocaleTimeString();
const text = (b32: string) => Buffer.from(b32.slice(2), "hex").toString("utf8").replace(/\0+$/, "") || b32.slice(0, 10);

type Narrator = { contract: Contract; events: Record<string, (args: readonly unknown[]) => void> };

function narrators(): Narrator[] {
  return [
    {
      contract: registry,
      events: {
        OrgRegistered: ([orgId, admin]) =>
          log("org", `institution "${text(orgId as string)}" registered`, { admin: short(admin as string, 12) }),
        JoinProposed: ([orgId, wallet]) =>
          log("org", `${short(wallet as string, 12)} asked to join "${text(orgId as string)}" — awaiting the admin`, {}),
        JoinApproved: ([orgId, wallet]) =>
          log("org", `admin approved ${short(wallet as string, 12)} into "${text(orgId as string)}" — both sides have now consented`, {}),
        MembershipRevoked: ([orgId, wallet]) =>
          log("org", `${short(wallet as string, 12)} removed from "${text(orgId as string)}"`, {}),
      },
    },
    {
      contract: router,
      events: {
        MemberAdmitted: ([orgId, wallet, symbol]) =>
          log("org", `${short(wallet as string, 12)} admitted on ${text(symbol as string)}-t — the token itself now permits them`, {}),
        MemberFrozen: ([orgId, wallet, frozen]) =>
          log("org", `${short(wallet as string, 12)} ${frozen ? "FROZEN" : "unfrozen"} across every equity`, {}),
      },
    },
    {
      contract: vault,
      events: {
        Deposited: ([orgId, from, amount]) =>
          log("chain", `treasury funded with ${usdc(amount as bigint)}`, {
            org: text(orgId as string),
            by: short(from as string, 12),
          }),
      },
    },
    {
      contract: escrow,
      events: {
        OrderOpened: ([orderId, requester, orgId, amount, , expiry, schedule]) => {
          log("chain", `order opened — ${usdc(amount as bigint)} reserved from the institution's pool`, {
            order: short(orderId as string),
            org: text(orgId as string),
          });
          // Spell out what an observer actually gets. The claim "amount and deadline only" is
          // worth more when the line prints the deadline rather than asserting it exists.
          detail([
            `everything public about this order: amount ${usdc(amount as bigint)} · deadline ${when(expiry as bigint)}`,
            `not the symbol, not the share count, not the price, not who benefits`,
            (schedule as string) !== ZERO_ADDRESS
              ? `self-refund scheduled on-chain at the deadline — no keeper, no operator`
              : `no refund schedule attached — expiry would need a manual refund`,
          ]);
        },
        OrderSettled: ([orderId, spent, returned]) =>
          log("chain", `order SETTLED — ${usdc(spent as bigint)} spent, ${usdc(returned as bigint)} returned to the pool`, {
            order: short(orderId as string),
          }),
        OrderCancelled: ([orderId, returned]) =>
          log("chain", `order CANCELLED by the enclave — ${usdc(returned as bigint)} returned`, {
            order: short(orderId as string),
          }),
        OrderRefunded: ([orderId, returned]) =>
          log("chain", `order REFUNDED at expiry — ${usdc(returned as bigint)} returned, no keeper involved`, {
            order: short(orderId as string),
          }),
        ScheduleFailed: ([orderId, code]) =>
          log("warn", `the self-refund could NOT be scheduled — this order will not refund itself at expiry`, {
            order: short(orderId as string),
            hts: String(code),
          }),
      },
    },
    {
      contract: ledger,
      events: {
        // What the world sees of a position: a counter moving and a hash. Narrated because this is
        // the privacy claim in its most literal form.
        EntryUpdated: ([accountId, version, blobHash]) => {
          log("chain", `encrypted position written — version ${String(version)}`, { account: short(accountId as string, 12) });
          detail([`blob hash ${short(blobHash as string, 18)} — the ciphertext itself is on-chain and only its owner holds the key`]);
        },
        PolicyUpdated: ([orgId, version]) =>
          log("chain", `rulebook published for "${text(orgId as string)}" — version ${String(version)}, stored as ciphertext`, {}),
      },
    },
  ];
}

let timer: NodeJS.Timeout | undefined;
let stopped = false;

export async function startChainNarration() {
  const feeds = narrators();
  let from = await provider.getBlockNumber();
  log("chain", `watching ${feeds.length} contracts from block ${from}`);

  const tick = async () => {
    try {
      const head = await provider.getBlockNumber();
      if (head < from) return; // a reorg or a restarted node; wait for it to catch up
      for (const { contract, events } of feeds) {
        for (const [name, say] of Object.entries(events)) {
          const found: Log[] = await contract.queryFilter(contract.filters[name](), from, head);
          for (const entry of found) {
            const parsed = contract.interface.parseLog({ topics: [...entry.topics], data: entry.data });
            if (parsed) say(parsed.args);
          }
        }
      }
      from = head + 1;
    } catch (error) {
      // Narration is best-effort: a flaky RPC must never take the API down with it.
      log("warn", "chain narration hiccup", { reason: (error as Error).message.slice(0, 100) });
    }
  };

  // Self-scheduling rather than setInterval: a tick that outruns the poll interval would
  // otherwise overlap the next one, and both would read the same block range from the same
  // `from` — narrating every event twice. Hashio is slow enough that this happens routinely.
  const loop = async () => {
    if (stopped) return;
    await tick();
    if (!stopped) timer = setTimeout(loop, POLL_MS);
  };
  void loop();
}

export function stopChainNarration() {
  stopped = true;
  if (timer) clearTimeout(timer);
}

export { config };
