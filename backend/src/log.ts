/**
 * Narration for a live demo. Every line is timestamped and tagged with the component that
 * produced it, so `tail -f` reads as the story of one order: intake → enclave → relayer → chain.
 *
 * Nothing here may print order contents. The backend only ever holds ciphertext and signed
 * authorizations; logging a symbol or a quantity would mean something upstream leaked.
 */
const TAGS = {
  org: "\x1b[34m", // blue    — institutions, membership, compliance
  intake: "\x1b[36m", // cyan  — sealed things arriving
  enclave: "\x1b[35m", // magenta — the TEE
  broker: "\x1b[90m", // grey  — the outside market
  relay: "\x1b[33m", // yellow — authorizations
  chain: "\x1b[32m", // green  — confirmed state
  warn: "\x1b[31m", // red
} as const;

export type Tag = keyof typeof TAGS;

const RESET = "\x1b[0m";
const useColour = process.stdout.isTTY || process.env.FORCE_COLOR === "1";

function paint(tag: Tag, text: string) {
  return useColour ? `${TAGS[tag]}${text}${RESET}` : text;
}

export function log(tag: Tag, message: string, fields?: Record<string, unknown>) {
  const time = new Date().toISOString().slice(11, 23);
  const extra = fields
    ? " " +
      Object.entries(fields)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(" ")
    : "";
  console.log(`${time} ${paint(tag, tag.padEnd(7))} ${message}${extra}`);
}

/** Short form of a 0x id, for logs that should stay scannable. */
export const short = (hex: string, n = 10) => (hex.length > n ? `${hex.slice(0, n)}…` : hex);
