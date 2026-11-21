"use client";

import { Brain, CheckCircle2, Database, XCircle } from "lucide-react";
import {
  Terminal,
  TerminalActions,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalStatus,
  TerminalTitle,
} from "@/components/ai-elements/terminal";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { formatPrice } from "@/lib/format";

/*
 * Presentation for the admin agent's tool activity: what data was read,
 * which commands ran in the sandbox (with running/failed states), and what
 * was saved to memory. Labels describe the work, not the tool names.
 */

type Row = Record<string, unknown>;

interface Column {
  label: string;
  value: (row: Row) => string;
  numeric?: boolean;
}

const get = (row: Row, path: string): unknown =>
  path.split(".").reduce<unknown>(
    (acc, key) => (acc && typeof acc === "object" ? (acc as Row)[key] : undefined),
    row,
  );
const text = (row: Row, path: string) => {
  const v = get(row, path);
  return v === null || v === undefined || v === "" ? "—" : String(v);
};
const money = (row: Row, path: string) => {
  const v = get(row, path);
  return typeof v === "number" ? formatPrice(v, (get(row, "currency") as string) ?? "USD") : "—";
};
const day = (row: Row, path: string) => text(row, path).slice(0, 10);

const DATASETS: Record<string, { title: string; columns: Column[] }> = {
  "support-tickets": {
    title: "Support tickets",
    columns: [
      { label: "Subject", value: (r) => text(r, "subject") },
      { label: "Status", value: (r) => text(r, "status") },
      { label: "Priority", value: (r) => text(r, "priority") },
      { label: "Assignee", value: (r) => text(r, "assignee") },
      { label: "Created", value: (r) => day(r, "createdAt") },
    ],
  },
  returns: {
    title: "Returns history",
    columns: [
      { label: "Order", value: (r) => text(r, "orderId") },
      { label: "Status", value: (r) => text(r, "status") },
      { label: "Decision", value: (r) => text(r, "decision") },
      { label: "Refund", value: (r) => money(r, "refundAmount"), numeric: true },
      { label: "Created", value: (r) => day(r, "createdAt") },
    ],
  },
  inventory: {
    title: "Inventory",
    columns: [
      { label: "Product", value: (r) => text(r, "product.name") },
      { label: "Stock", value: (r) => text(r, "stock"), numeric: true },
      { label: "Status", value: (r) => (get(r, "inStock") ? (get(r, "lowStock") ? "Low" : "In stock") : "Sold out") },
    ],
  },
  sales: {
    title: "Sales",
    columns: [
      { label: "Product", value: (r) => text(r, "product.name") },
      { label: "Units", value: (r) => text(r, "unitsSold"), numeric: true },
      { label: "Orders", value: (r) => text(r, "ordersCount"), numeric: true },
      { label: "Revenue", value: (r) => money(r, "revenue"), numeric: true },
    ],
  },
};

const PREVIEW_ROWS = 5;

export function DataLookup({
  dataset,
  filters,
  totalRows,
  rows,
  meta,
}: {
  dataset: string;
  filters: Record<string, string | number | boolean>;
  totalRows: number;
  /** Any of the back-office row shapes; columns read fields by path. */
  rows: readonly object[];
  meta: Record<string, unknown>;
}) {
  const previewRows = rows.slice(0, PREVIEW_ROWS) as Row[];
  const config = DATASETS[dataset] ?? { title: dataset, columns: [] };
  const filterText = Object.entries(filters)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
  const totals = meta.totals as { revenue?: number; unitsSold?: number } | undefined;
  const range =
    typeof meta.from === "string" && typeof meta.to === "string"
      ? `${meta.from.slice(0, 10)} → ${meta.to.slice(0, 10)}`
      : null;

  return (
    <Collapsible className="rounded-md border border-border bg-card text-sm">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex min-w-0 items-center gap-2">
          <Database className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">{config.title}</span>
          <span className="truncate text-xs text-muted-foreground">
            {totalRows} {totalRows === 1 ? "row" : "rows"}
            {range ? ` · ${range}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">Details</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 border-t px-3 py-2">
        {filterText && <p className="text-xs text-muted-foreground">Filters: {filterText}</p>}
        {totals?.revenue !== undefined && (
          <p className="text-xs">
            Total revenue {formatPrice(totals.revenue, (meta.currency as string) ?? "USD")}
            {totals.unitsSold !== undefined ? ` · ${totals.unitsSold} units` : ""}
          </p>
        )}
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No rows matched.</p>
        ) : config.columns.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">{config.title} preview</caption>
              <thead>
                <tr className="text-left text-muted-foreground">
                  {config.columns.map((c) => (
                    <th key={c.label} scope="col" className={`py-1 pr-3 font-medium ${c.numeric ? "text-right" : ""}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr key={String(row.id ?? row.productId ?? i)} className="border-t border-border/60">
                    {config.columns.map((c) => (
                      <td key={c.label} className={`max-w-[14rem] truncate py-1 pr-3 ${c.numeric ? "text-right tabular-nums" : ""}`}>
                        {c.value(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {totalRows > PREVIEW_ROWS && (
              <p className="pt-1 text-xs text-muted-foreground">
                Showing {PREVIEW_ROWS} of {totalRows}. The full dataset is saved in the sandbox for analysis.
              </p>
            )}
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Command activity in the isolated sandbox, with running and failure states. */
export function SandboxCommand({
  command,
  running,
  result,
}: {
  command: string;
  running: boolean;
  result?: { exitCode: number; stdout: string; stderr: string; truncated: boolean };
}) {
  const failed = result !== undefined && result.exitCode !== 0;
  const output = [
    `$ ${command}`,
    result?.stdout?.trimEnd(),
    // Shown in red (ANSI) so failures stand out.
    result?.stderr?.trim() ? `\u001b[31m${result.stderr.trimEnd()}\u001b[0m` : undefined,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <Terminal output={output} isStreaming={running} className="text-xs">
      <TerminalHeader>
        <TerminalTitle>Sandbox</TerminalTitle>
        <div className="flex items-center gap-2">
          {running ? (
            <TerminalStatus role="status">
              <span className="size-2 animate-pulse rounded-full bg-amber-400" aria-hidden="true" />
              Running…
            </TerminalStatus>
          ) : result ? (
            <span
              className={`flex items-center gap-1 text-xs ${failed ? "text-red-400" : "text-emerald-400"}`}
              role="status"
            >
              {failed ? <XCircle className="size-3.5" aria-hidden="true" /> : <CheckCircle2 className="size-3.5" aria-hidden="true" />}
              {failed ? `Failed (exit ${result.exitCode})` : "Done"}
            </span>
          ) : null}
          <TerminalActions>
            <TerminalCopyButton />
          </TerminalActions>
        </div>
      </TerminalHeader>
      <TerminalContent className="max-h-64" />
    </Terminal>
  );
}

export function MemorySaved({ note }: { note: string }) {
  return (
    <p role="status" className="flex items-start gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs">
      <Brain className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span>
        <span className="font-medium">Saved to memory:</span> {note}
      </span>
    </p>
  );
}
