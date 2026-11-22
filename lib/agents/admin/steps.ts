import {
  getBackOfficeReturns,
  getBackOfficeSales,
  getBackOfficeStock,
  getBackOfficeSupportTickets,
  type GetBackOfficeReturnsParams,
  type GetBackOfficeSalesParams,
  type GetBackOfficeStockParams,
  type GetBackOfficeSupportTicketsParams,
} from "@/lib/api";
import { failure, isTransient, toFailure, type ToolResult } from "@/lib/agents/shared";
import {
  DATA_DIR,
  MEMORY_FILE,
  readSandboxFile,
  runInSandbox,
  writeSandboxFile,
  type CommandResult,
} from "./sandbox";

/*
 * Durable, read-only back-office steps for the admin agent.
 *
 * Each data step returns a compact preview for the model plus the path of
 * the full dataset saved in the admin sandbox, so aggregates and joins are
 * computed there (see the bash tool) instead of by the model.
 */

/**
 * Rows shown to the model inline; the full dataset lives in the sandbox.
 * 40 covers catalog-sized datasets (every product) in full.
 */
const PREVIEW_ROWS = 40;

export interface DatasetResult<Row> {
  dataset: string;
  /** Path inside the sandbox, or null if it couldn't be saved. */
  file: string | null;
  /** Field paths in each row, so analysis scripts read the file correctly first time. */
  fields: string[];
  filters: Record<string, string | number | boolean>;
  meta: Record<string, unknown>;
  totalRows: number;
  rows: Row[];
  previewOnly: boolean;
  /** Present when rows are partial, so the model never treats missing rows as zero. */
  note?: string;
}

function cleanFilters(params: object): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0),
    ).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v]),
  ) as Record<string, string | number | boolean>;
}

/** Flattens a sample row into field paths, e.g. ["id", "items[].productId"]. */
function describeFields(sample: unknown, prefix = ""): string[] {
  if (Array.isArray(sample)) {
    return sample.length > 0 ? describeFields(sample[0], `${prefix}[]`) : [`${prefix}[]`];
  }
  if (sample && typeof sample === "object") {
    return Object.entries(sample).flatMap(([key, value]) =>
      describeFields(value, prefix ? `${prefix}.${key}` : key),
    );
  }
  return prefix ? [prefix] : [];
}

function datasetFile(dataset: string, filters: Record<string, unknown>): string {
  const suffix = Object.entries(filters)
    .map(([k, v]) => `${k}-${String(v)}`)
    .join("_")
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .slice(0, 80);
  return `${DATA_DIR}/${dataset}${suffix ? `__${suffix}` : ""}.json`;
}

async function saveDataset(
  dataset: string,
  filters: Record<string, unknown>,
  payload: { meta: unknown; rows: unknown[] },
): Promise<string | null> {
  try {
    const file = datasetFile(dataset, filters);
    await writeSandboxFile(
      file,
      JSON.stringify({ dataset, filters, fetchedAt: new Date().toISOString(), ...payload }, null, 2),
    );
    return file;
  } catch (error) {
    console.error(`[admin] could not save ${dataset} to sandbox`, error);
    return null;
  }
}

async function fetchDataset<Row, Meta>(
  dataset: string,
  params: object,
  fetcher: () => Promise<{ data: Row[]; meta: Meta }>,
  notFoundMessage: string,
): Promise<ToolResult<DatasetResult<Row>>> {
  const filters = cleanFilters(params);
  try {
    const { data, meta } = await fetcher();
    // Saved under the same "rows" key the model sees in the tool result.
    const file = await saveDataset(dataset, filters, { meta, rows: data });
    return {
      ok: true,
      dataset,
      file,
      fields: describeFields(data[0] ?? {}),
      filters,
      meta: meta as Record<string, unknown>,
      totalRows: data.length,
      rows: data.slice(0, PREVIEW_ROWS),
      previewOnly: data.length > PREVIEW_ROWS,
      ...(data.length > PREVIEW_ROWS && {
        note: `Only the first ${PREVIEW_ROWS} of ${data.length} rows are shown here. A product or record missing from these rows is NOT zero or absent: compute from the full file with the bash tool.`,
      }),
    };
  } catch (error) {
    if (isTransient(error)) throw error;
    return toFailure(error, notFoundMessage);
  }
}

export async function supportTicketsStep(params: GetBackOfficeSupportTicketsParams) {
  "use step";
  return fetchDataset("support-tickets", params, () => getBackOfficeSupportTickets(params), "No support tickets matched those filters.");
}

export async function returnsHistoryStep(params: GetBackOfficeReturnsParams) {
  "use step";
  return fetchDataset("returns", params, () => getBackOfficeReturns(params), "No returns matched those filters.");
}

export async function inventoryStockStep(params: GetBackOfficeStockParams) {
  "use step";
  return fetchDataset("inventory", params, () => getBackOfficeStock(params), "One or more of those products doesn't exist.");
}

export async function salesAnalyticsStep(params: GetBackOfficeSalesParams) {
  "use step";
  return fetchDataset("sales", params, () => getBackOfficeSales(params), "That product doesn't exist, so there are no sales to report.");
}

/** Runs an analysis command in the isolated admin sandbox. */
export async function bashStep(
  command: string,
): Promise<ToolResult<CommandResult & { command: string }>> {
  "use step";
  try {
    const result = await runInSandbox(command, { timeoutMs: 60_000 });
    return { ok: true, command, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/timed? ?out|timeout|abort/i.test(message)) {
      return failure("invalid_request", "The command took longer than 60 seconds and was stopped.");
    }
    throw error; // Sandbox/infra problem: let the workflow retry.
  }
}
// A failed command is still a result; only retry infrastructure errors once.
bashStep.maxRetries = 1;

const MAX_MEMORY_CHARS = 6_000;

/** Reads saved admin memory at the start of each conversation. */
export async function loadMemoryStep(): Promise<{ notes: string; available: boolean }> {
  "use step";
  try {
    const notes = (await readSandboxFile(MEMORY_FILE)) ?? "";
    // Keep the most recent notes if the file has grown large.
    return { notes: notes.length > MAX_MEMORY_CHARS ? notes.slice(-MAX_MEMORY_CHARS) : notes, available: true };
  } catch (error) {
    console.error("[admin] memory unavailable", error);
    return { notes: "", available: false };
  }
}
loadMemoryStep.maxRetries = 2;

export async function saveMemoryStep(input: {
  kind: "preference" | "correction" | "business_context";
  note: string;
}): Promise<ToolResult<{ saved: string }>> {
  "use step";
  const note = input.note.replace(/\s+/g, " ").trim();
  const line = `- [${input.kind}] ${note} (saved ${new Date().toISOString().slice(0, 10)})`;
  // Passed through an env var, never interpolated into the shell command.
  const result = await runInSandbox(
    `mkdir -p "$(dirname "$MEMORY_FILE")" && touch "$MEMORY_FILE" && ` +
      `if grep -qF -- "] $NOTE (" "$MEMORY_FILE"; then echo duplicate; else printf '%s\\n' "$LINE" >> "$MEMORY_FILE" && echo saved; fi`,
    { env: { MEMORY_FILE, NOTE: note, LINE: line } },
  );
  if (result.exitCode !== 0) {
    throw new Error(`memory write failed: ${result.stderr.slice(0, 200)}`);
  }
  return { ok: true, saved: result.stdout.trim() === "duplicate" ? `Already saved: ${note}` : note };
}
