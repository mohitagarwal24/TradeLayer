/**
 * Contract reverts, RPC failures and viem's own messages are written for developers. Left alone
 * they reach the user as things like `SomeCustomError(0xabc…)` or a 500-line simulation dump.
 *
 * Every branch here maps a real failure this app can produce onto the thing a person can actually
 * do about it. The fallback is deliberately short: a truncated technical string is better than a
 * wall of hex, but neither should be the common case.
 */
export function readable(error: unknown): string {
  const message = (error as Error)?.message ?? String(error);

  // The user is in control of these.
  if (/User rejected|denied transaction|User denied/i.test(message)) return "You cancelled the signature.";
  if (/insufficient funds/i.test(message)) return "Not enough HBAR in this wallet to pay the network fee.";

  // Membership and institutions.
  if (/OrgExists/.test(message)) return "That name is already taken.";
  if (/UnknownOrg/.test(message)) return "No institution by that name.";
  if (/AlreadyBound/.test(message)) return "This wallet already belongs to an institution.";
  if (/NotOrgAdmin/.test(message)) return "Only this institution's admin can do that.";
  if (/NotYourWallet/.test(message)) return "That wallet belongs to a different institution.";
  if (/NoProposalFrom/.test(message)) return "That wallet hasn't asked to join yet.";

  // Trading.
  if (/InsufficientAvailable|escrow below/i.test(message)) return "The treasury doesn't have that much free right now.";
  if (/OrderNotOpen/.test(message)) return "This order has already been dealt with.";
  if (/ExpiryTooSoon/.test(message)) return "The deadline is too close — give it a little longer.";
  if (/VersionMismatch/.test(message)) return "Something changed while this was in flight. Try once more.";

  // Transport.
  if (/Failed to fetch|NetworkError|ERR_CONNECTION/i.test(message)) return "Can't reach the trading service.";
  if (/bad user blob/.test(message)) return "This record was written for a different wallet.";

  return message.slice(0, 160);
}
