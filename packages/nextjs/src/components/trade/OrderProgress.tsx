import { Check, Circle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type Stage = "received" | "opened" | "placed" | "queued" | "filled" | "settled" | "declined";

const FLOW: Array<{ key: Stage; label: string; note: string }> = [
  { key: "received", label: "Order sealed", note: "Encrypted in your browser" },
  { key: "opened", label: "Opened privately", note: "Inside the enclave, nowhere else" },
  { key: "placed", label: "Sent to the market", note: "One real broker order" },
  { key: "filled", label: "Filled", note: "Shares bought" },
  { key: "settled", label: "Settled", note: "Position recorded, balance returned" },
];

/**
 * What is happening to an order, in the user's terms. The previous version of this surfaced a
 * count of workflow invocations, which told a user nothing.
 */
export function OrderProgress({ stage, declinedReason, queued }: { stage: Stage; declinedReason?: string; queued?: boolean }) {
  if (stage === "declined") {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
        <p className="text-sm font-medium">Order declined</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {declinedReason ?? "Your institution's rules didn't allow it."} Your institution's money has
          already been returned.
        </p>
      </div>
    );
  }

  const reached = FLOW.findIndex(s => s.key === stage);
  return (
    <ol className="space-y-2.5">
      {FLOW.map((step, i) => {
        const done = i < reached;
        const active = i === reached;
        return (
          <li key={step.key} className="flex items-start gap-2.5">
            <span className="mt-0.5">
              {done ? (
                <Check className="h-4 w-4 text-success" />
              ) : active ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground/40" />
              )}
            </span>
            <div>
              <div className={cn("text-sm", done || active ? "text-foreground" : "text-muted-foreground/60")}>
                {step.label}
              </div>
              <div className="text-xs text-muted-foreground">
                {active && step.key === "placed" && queued
                  ? "Waiting for the market to open — it will fill at the next session"
                  : step.note}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
