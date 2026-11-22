import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api";
import type { Order } from "@/lib/types";
import { prepareReturnStep } from "@/lib/agents/shopping/steps";

const getOrder = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getOrder: (...args: unknown[]) => getOrder(...args),
}));
vi.mock("workflow/api", () => ({ start: vi.fn() }));


function order(status: Order["status"]): Order {
  return {
    id: "11111",
    status,
    items: [
      {
        productId: "hoodie_001",
        quantity: 1,
        unitPrice: 6000,
        lineTotal: 6000,
        product: { id: "hoodie_001", name: "Black Pullover Hoodie", slug: "h", images: [], category: "hoodies" },
      },
      {
        productId: "tshirt_001",
        quantity: 2,
        unitPrice: 3000,
        lineTotal: 6000,
        product: { id: "tshirt_001", name: "Black Crewneck T-Shirt", slug: "t", images: [], category: "t-shirts" },
      },
    ],
    subtotal: 12000,
    tax: 0,
    total: 12000,
    currency: "USD",
    email: "customer@example.com",
    createdAt: "2026-11-01T00:00:00Z",
  };
}

beforeEach(() => {
  getOrder.mockReset();
});

describe("prepareReturnStep", () => {
  it("returns every item of a fulfilled order by default", async () => {
    getOrder.mockResolvedValue(order("fulfilled"));
    const result = await prepareReturnStep({ orderId: "11111" });
    expect(result).toMatchObject({
      ok: true,
      returnLines: [
        { productId: "hoodie_001", name: "Black Pullover Hoodie", quantity: 1 },
        { productId: "tshirt_001", name: "Black Crewneck T-Shirt", quantity: 2 },
      ],
    });
  });

  it("returns only the requested items, matched by id or name", async () => {
    getOrder.mockResolvedValue(order("fulfilled"));
    const result = await prepareReturnStep({
      orderId: "11111",
      items: [{ productId: "Black Crewneck T-Shirt", quantity: 1 }],
    });
    expect(result).toMatchObject({
      ok: true,
      returnLines: [{ productId: "tshirt_001", quantity: 1 }],
    });
  });

  it.each([
    ["paid", /Only delivered/],
    ["cancelled", /was cancelled/],
  ] as const)("refuses %s orders", async (status, message) => {
    getOrder.mockResolvedValue(order(status));
    const result = await prepareReturnStep({ orderId: "11111" });
    expect(result).toMatchObject({ ok: false, reason: "not_allowed" });
    expect(result.ok === false && result.message).toMatch(message);
  });

  it("refuses items that weren't purchased", async () => {
    getOrder.mockResolvedValue(order("fulfilled"));
    const result = await prepareReturnStep({ orderId: "11111", items: [{ productId: "mug_001" }] });
    expect(result).toMatchObject({ ok: false, reason: "invalid_request" });
  });

  it("refuses returning more units than were bought", async () => {
    getOrder.mockResolvedValue(order("fulfilled"));
    const result = await prepareReturnStep({
      orderId: "11111",
      items: [{ productId: "hoodie_001", quantity: 3 }],
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid_request" });
  });

  it("reports unknown orders as not found", async () => {
    getOrder.mockImplementation(async () => {
      throw new ApiRequestError(404, "NOT_FOUND", "Order not found");
    });
    const result = await prepareReturnStep({ orderId: "99999" });
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("rethrows transient errors so the workflow retries the step", async () => {
    getOrder.mockImplementation(async () => {
      throw new ApiRequestError(503, undefined, "unavailable");
    });
    await expect(prepareReturnStep({ orderId: "11111" })).rejects.toThrow("unavailable");
  });
});
