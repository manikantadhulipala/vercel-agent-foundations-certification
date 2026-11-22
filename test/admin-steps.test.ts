import { beforeEach, describe, expect, it, vi } from "vitest";
import { salesAnalyticsStep } from "@/lib/agents/admin/steps";

const getBackOfficeSales = vi.fn();
const writeSandboxFile = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getBackOfficeSales: (...args: unknown[]) => getBackOfficeSales(...args),
}));
vi.mock("@/lib/agents/admin/sandbox", () => ({
  DATA_DIR: "/vercel/data",
  MEMORY_FILE: "/vercel/memory/admin-memory.md",
  writeSandboxFile: (...args: unknown[]) => writeSandboxFile(...args),
  readSandboxFile: vi.fn(),
  runInSandbox: vi.fn(),
}));

const row = (i: number) => ({
  productId: `p_${i}`,
  product: { id: `p_${i}`, name: `Product ${i}`, slug: `p-${i}`, category: "misc", price: 1000 },
  unitsSold: i,
  ordersCount: i,
  revenue: i * 1000,
  currency: "USD",
});
const meta = { count: 0, from: "2026-11-01", to: "2026-11-22", days: 22, currency: "USD", totals: { unitsSold: 0, ordersCount: 0, revenue: 0 } };

beforeEach(() => {
  getBackOfficeSales.mockReset();
  writeSandboxFile.mockReset();
});

describe("back-office dataset previews", () => {
  it("sends catalog-sized datasets (28 products) in full", async () => {
    getBackOfficeSales.mockImplementation(async () => ({ data: Array.from({ length: 28 }, (_, i) => row(i)), meta }));
    const result = await salesAnalyticsStep({ from: "2026-11-01" });
    expect(result).toMatchObject({ ok: true, totalRows: 28, previewOnly: false });
    expect(result.ok && result.rows).toHaveLength(28);
    expect(result.ok && "note" in result && result.note).toBeFalsy();
  });

  it("warns the model when rows are partial, and saves the full set for computing", async () => {
    getBackOfficeSales.mockImplementation(async () => ({ data: Array.from({ length: 60 }, (_, i) => row(i)), meta }));
    const result = await salesAnalyticsStep({});
    expect(result).toMatchObject({ ok: true, totalRows: 60, previewOnly: true });
    expect(result.ok && result.rows).toHaveLength(40);
    expect(result.ok && result.note).toMatch(/NOT zero or absent/);
    const saved = JSON.parse(writeSandboxFile.mock.calls[0][1] as string);
    expect(saved.rows).toHaveLength(60);
    expect(result.ok && result.file).toMatch(/^\/vercel\/data\/sales/);
  });

  it("still answers when the sandbox can't save the dataset", async () => {
    getBackOfficeSales.mockImplementation(async () => ({ data: [row(1)], meta }));
    writeSandboxFile.mockImplementation(async () => {
      throw new Error("sandbox unavailable");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await salesAnalyticsStep({});
    expect(result).toMatchObject({ ok: true, file: null, totalRows: 1 });
  });
});
