import { afterEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { asSchema } from "ai";
import { trimHistory } from "@/components/chat/use-durable-chat";
import { adminTools } from "@/lib/agents/admin/tools";
import { shoppingTools } from "@/lib/agents/shopping/tools";
import { publicCallbackUrl } from "@/lib/workflows/return-flow";

// vi.mock calls are hoisted above the imports by Vitest.
vi.mock("workflow/api", () => ({ start: vi.fn() }));
vi.mock("@vercel/sandbox", () => ({ Sandbox: {} }));

const message = (i: number, size = 10): UIMessage => ({
  id: String(i),
  role: i % 2 === 0 ? "user" : "assistant",
  parts: [{ type: "text", text: "x".repeat(size) }],
});
const conversation = (n: number, size?: number) =>
  Array.from({ length: n }, (_, i) => message(i, size));

describe("trimHistory", () => {
  it("sends short conversations unchanged", () => {
    const messages = conversation(6);
    expect(trimHistory(messages)).toEqual(messages);
  });

  it("keeps at most the newest 40 messages, starting at a user message", () => {
    const trimmed = trimHistory(conversation(81));
    expect(trimmed.length).toBeLessThanOrEqual(40);
    expect(trimmed[0].role).toBe("user");
    expect(trimmed.at(-1)?.id).toBe("80");
  });

  it("drops the oldest messages to stay under the size limit", () => {
    const trimmed = trimHistory(conversation(31, 30_000));
    expect(JSON.stringify(trimmed).length).toBeLessThanOrEqual(400_000);
    expect(trimmed[0].role).toBe("user");
  });
});

/** Runs a tool's Zod input schema the way the AI SDK does before execution. */
async function validates(schema: unknown, input: unknown): Promise<boolean> {
  const result = await asSchema(schema as Parameters<typeof asSchema>[0]).validate?.(input);
  return result?.success ?? false;
}

describe("tool input validation", () => {
  it("accepts well-formed returns and rejects bad order numbers or reasons", async () => {
    const schema = shoppingTools.returnOrder.inputSchema;
    expect(await validates(schema, { orderId: "11111", reason: "too small" })).toBe(true);
    expect(await validates(schema, { orderId: "11111; DROP TABLE", reason: "too small" })).toBe(false);
    expect(await validates(schema, { orderId: "11111", reason: "x" })).toBe(false);
  });

  it("limits search page sizes", async () => {
    const schema = shoppingTools.searchProducts.inputSchema;
    expect(await validates(schema, { query: "mug", limit: 6 })).toBe(true);
    expect(await validates(schema, { limit: 500 })).toBe(false);
  });

  it("only accepts real dates and known enum values for back-office filters", async () => {
    const schema = adminTools.getSupportTickets.inputSchema;
    expect(await validates(schema, { from: "2026-11-01", status: "open" })).toBe(true);
    expect(await validates(schema, { from: "last tuesday" })).toBe(false);
    expect(await validates(schema, { status: "deleted" })).toBe(false);
  });
});

describe("admin date ranges", () => {
  it("explains an inverted range instead of calling the store", async () => {
    const execute = adminTools.getSalesAnalytics.execute!;
    const result = await execute(
      { from: "2026-11-20", to: "2026-11-01" },
      { toolCallId: "t", messages: [] } as never,
    );
    expect(result).toMatchObject({ ok: false, reason: "invalid_request" });
  });
});

describe("publicCallbackUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const webhook = "https://app-abc123-team.vercel.app/.well-known/workflow/v1/webhook/tok_1";

  it("uses the public production domain in production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "shop.example.com");
    expect(publicCallbackUrl(webhook)).toBe(
      "https://shop.example.com/.well-known/workflow/v1/webhook/tok_1",
    );
  });

  it("keeps the original URL elsewhere", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "shop.example.com");
    expect(publicCallbackUrl(webhook)).toBe(webhook);
  });
});
