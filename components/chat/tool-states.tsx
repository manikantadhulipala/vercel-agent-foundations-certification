import { AlertCircle, SearchX } from "lucide-react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { cn } from "@/lib/utils";

/*
 * Shared presentation for tool progress and problems, so both chats explain
 * what's happening in plain language instead of exposing tool internals.
 */

export function ToolPending({ label }: { label: string }) {
  return (
    <div role="status" className="py-1 text-sm">
      <Shimmer>{label}</Shimmer>
    </div>
  );
}

const reasonTitle: Record<string, string> = {
  not_found: "Not found",
  invalid_request: "Couldn't do that",
  not_allowed: "Not possible",
  unavailable: "Temporarily unavailable",
};

export function ToolProblem({
  reason,
  message,
  className,
}: {
  reason?: string;
  message: string;
  className?: string;
}) {
  const Icon = reason === "not_found" ? SearchX : AlertCircle;
  return (
    <div
      role="status"
      className={cn(
        "flex gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm",
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div>
        <p className="font-medium">{reasonTitle[reason ?? ""] ?? "Something went wrong"}</p>
        <p className="text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
