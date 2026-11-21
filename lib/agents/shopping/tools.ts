import { tool } from "ai";
import { z } from "zod";
import { settle } from "@/lib/agents/shared";
import {
  getProductDetailsStep,
  listCategoriesStep,
  prepareReturnStep,
  searchProductsStep,
  startReturnStep,
} from "./steps";

/*
 * Customer-facing tools. Inputs are validated with Zod before anything runs;
 * every store call happens in a durable step (see ./steps.ts). These tools are
 * only registered on the shopping agent, never on the admin agent.
 */

export const shoppingTools = {
  getAllCategories: tool({
    description:
      "List the store's current product categories with product counts. Use this to discover valid category filters before filtering a search; never guess category names.",
    inputSchema: z.object({}),
    execute: () => settle(() => listCategoriesStep()),
  }),

  searchProducts: tool({
    description:
      "Search the product catalog by free text and/or category. Call with no arguments to browse the full catalog; use `page` to see more results.",
    inputSchema: z.object({
      query: z
        .string()
        .trim()
        .max(100)
        .optional()
        .describe("Free-text search, e.g. 'black hoodie'. Omit to browse."),
      category: z
        .string()
        .trim()
        .max(50)
        .optional()
        .describe("A category slug from getAllCategories, e.g. 'hoodies'."),
      page: z.number().int().min(1).max(50).optional().describe("1-based page."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(12)
        .optional()
        .describe("Results per page (default 6)."),
    }),
    execute: (input) =>
      settle(() => searchProductsStep({ ...input, limit: input.limit ?? 6 })),
  }),

  getProductDetails: tool({
    description:
      "Get full details for one product: description, price, images, tags and live stock. Accepts a product id or slug from searchProducts.",
    inputSchema: z.object({
      product: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .describe("Product id (e.g. 'hoodie_001') or slug."),
    }),
    execute: ({ product }) => settle(() => getProductDetailsStep(product)),
  }),

  returnOrder: tool({
    description:
      "File a return for a delivered order. Requires the order number and the customer's reason. Optionally limit the return to specific products; by default every item on the order is returned. Only call this after the customer has given both the order number and a reason.",
    inputSchema: z.object({
      orderId: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_-]{1,40}$/, "Order numbers are letters and digits only.")
        .describe("The order number, e.g. '11111'."),
      reason: z
        .string()
        .trim()
        .min(3)
        .max(500)
        .describe("The customer's reason, in their words."),
      items: z
        .array(
          z.object({
            productId: z.string().trim().min(1).max(120),
            quantity: z.number().int().min(1).max(100).optional(),
          }),
        )
        .max(20)
        .optional()
        .describe("Specific products to return. Omit to return the whole order."),
    }),
    execute: ({ orderId, reason, items }) =>
      settle(async () => {
        const prepared = await prepareReturnStep({ orderId, items });
        if (!prepared.ok) return prepared;

        // Kick off the durable return and confirm right away.
        // The run id stays server-side (it's visible in the Workflows
        // dashboard); shoppers only need the order number.
        await startReturnStep({
          orderId: prepared.orderId,
          reason,
          items: prepared.returnLines,
        });
        return {
          ok: true as const,
          status: "filed" as const,
          orderId: prepared.orderId,
          reason,
          items: prepared.returnLines,
          nextSteps:
            "The customer will be notified, the refund is being pre-authorized, and the store will review the return. The decision usually arrives within a few minutes.",
        };
      }),
  }),
};

export type ShoppingTools = typeof shoppingTools;
