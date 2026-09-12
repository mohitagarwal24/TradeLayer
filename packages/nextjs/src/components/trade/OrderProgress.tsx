import { Check, Circle, Clock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type Stage = "received" | "opened" | "placed" | "filled" | "settled" | "declined";

const FLOW: Array<{ key: Stage; label: string; note: string }> = [
  { key: "received", label: "Order sealed", note: "Encrypted in your browser" },
  { key: "opened", label: "Opened privately", note: "Checked against your firm's rules" },
  { key: "placed", label: "Sent to the market", note: "One real broker order" },
  { key: "filled", label: "Filled", note: "Shares bought" },
  { key: "settled", label: "Settled", note: "Position recorded, balance returned" },
];

/**
 * What is happening to an order, in the user's terms.
 *
 * `queued` is a resting state, not a stalled one. Outside market hours the broker really does hold
 * the order until the next session, and showing a spinner for it reads as a system that has hung —
 * which is the opposite of what is true. It gets a clock, and says so.
 */
export function OrderProgress({
  stage,
  declinedReason,
  queued,
  slow,
}: {
  stage: Stage;
  declinedReason?: string;
  queued?: boolean;
  slow?: boolean;
}) {
  if (stage === "declined") {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
        <p className="text-sm font-medium">Order declined</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {declinedReason ?? "Your firm's rules didn't allow it."} Your firm's money has already been
          returned.
        </p>
      </div>
    );
  }

  const reached = FLOW.findIndex(s => s.key === stage);
  // At "Sent to the market" with the market shut, the next step is genuinely waiting on the
  // opening bell rather than on us.
  const waiting = queued && stage === "placed";

  return (
    <ol className="space-y-2.5">
      {FLOW.map((step, i) => {
        const done = i < reached;
        const active = i === reached;
        const isQueuedStep = waiting && step.key === "filled";
        return (
          <li key={step.key} className="flex items-start gap-2.5">
            <span className="mt-0.5">
              {done ? (
                <Check className="h-4 w-4 text-success" />
              ) : isQueuedStep ? (
                <Clock className="h-4 w-4 text-muted-foreground" />
              ) : active ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground/40" />
              )}
            </span>
            <div>
              <div
                className={cn(
                  "text-sm",
                  done || active || isQueuedStep ? "text-foreground" : "text-muted-foreground/60",
                )}
              >
                {isQueuedStep ? "Queued at the broker" : step.label}
              </div>
              <div className="text-xs text-muted-foreground">
                {isQueuedStep
                  ? "The market is closed. It fills at the next session."
                  : active && slow
                    ? `${step.note} — this takes about half a minute`
                    : step.note}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
