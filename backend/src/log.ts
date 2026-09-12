/**
 * Narration for a live demo. Every line is timestamped and tagged with the component that
 * produced it, so `tail -f` reads as the story of one order: intake → enclave → relayer → chain.
 *
 * **This process cannot print order contents even if it wanted to.** It holds ciphertext and
 * signed authorizations, never a decryption key — the intent key lives in the Vault DON and is
 * released only to an attested enclave. So a symbol or a quantity appearing in a `log()` call
 * here would not be a policy slip, it would mean something upstream genuinely leaked.
 *
 * The enclave is the one place plaintext exists, and it narrates through its own `runtime.log`
 * (see `cre/tradelayer/src/handlers.ts`), which CRE does not surface outside the TEE in a
 * deployed run.
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
const DIM = "\x1b[2m";
const useColour = process.stdout.isTTY || process.env.FORCE_COLOR === "1";

function paint(tag: Tag, text: string) {
  return useColour ? `${TAGS[tag]}${text}${RESET}` : text;
}

/** Local time, not UTC: on a recording the terminal clock should match the wall clock. */
function stamp() {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Width of `HH:MM:SS.mmm ` plus the padded tag, so continuation lines sit under the message. */
const GUTTER = " ".repeat(12 + 1 + 7 + 1);

export function log(tag: Tag, message: string, fields?: Record<string, unknown>) {
  const entries = fields
    ? Object.entries(fields).filter(([, v]) => v !== undefined && v !== null)
    : [];
  // `fields = {}` is truthy; without this an empty object left a trailing space on the line.
  const extra = entries.length
    ? ` ${entries.map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ")}`
    : "";
  console.log(`${stamp()} ${paint(tag, tag.padEnd(7))} ${message}${extra}`);
}

/**
 * Continuation lines under the previous `log()`, aligned to the message column.
 *
 * For the moments where one line is not enough to be convincing: the sealed envelope's actual
 * structure, or the broker's response. A judge should be able to read these without knowing the
 * codebase, so they are plain text rather than `k=v` pairs.
 */
export function detail(lines: Array<string | false | undefined>) {
  for (const line of lines) {
    if (!line) continue;
    console.log(`${GUTTER}${useColour ? `${DIM}${line}${RESET}` : line}`);
  }
}

/** Short form of a 0x id, for logs that should stay scannable. */
export const short = (hex: string, n = 10) => (hex.length > n ? `${hex.slice(0, n)}…` : hex);
