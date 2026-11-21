import { start } from "workflow/api";
import {
  getCategories,
  getOrder,
  getProductById,
  getProductStock,
  getProductsPage,
} from "@/lib/api";
import {
  failure,
  isTransient,
  toFailure,
  type ToolResult,
} from "@/lib/agents/shared";
import { returnOrderWorkflow } from "@/lib/workflows/return-flow";
import type {
  CategorySummary,
  OrderLine,
  ProductDetails,
  ProductSummary,
  ReturnLine,
  SearchProductsInput,
} from "./types";
import type { Product } from "@/lib/types";

/*
 * Durable steps behind the shopping tools. Each one:
 *  - throws on transient failures (network, 429, 5xx) so the Workflow runtime
 *    retries it with backoff, and
 *  - returns a typed `{ ok: false }` result for permanent problems (404,
 *    validation) so the agent can explain them instead of inventing data.
 */

function toSummary(product: Product): ProductSummary {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    price: product.price,
    currency: product.currency,
    category: product.category,
    image: product.images[0] ?? null,
    url: `/products/${product.slug}`,
  };
}

export async function listCategoriesStep(): Promise<
  ToolResult<{ categories: CategorySummary[] }>
> {
  "use step";
  try {
    const categories = await getCategories();
    return {
      ok: true,
      categories: categories.map((c) => ({
        slug: c.slug,
        name: c.name,
        productCount: c.productCount,
      })),
    };
  } catch (error) {
    if (isTransient(error)) throw error;
    return toFailure(error, "No categories are available right now.");
  }
}

export async function searchProductsStep(
  input: SearchProductsInput,
): Promise<
  ToolResult<{
    query: string | null;
    category: string | null;
    products: ProductSummary[];
    pagination: {
      page: number;
      totalPages: number;
      total: number;
      hasNextPage: boolean;
    };
  }>
> {
  "use step";
  const query = input.query?.trim() || undefined;
  const category = input.category?.trim().toLowerCase() || undefined;
  try {
    // Validate the category against live store data rather than a fixed list.
    if (category) {
      const categories = await getCategories();
      if (!categories.some((c) => c.slug === category)) {
        return failure(
          "invalid_request",
          `"${category}" isn't a store category. Valid categories: ${categories
            .map((c) => c.slug)
            .join(", ")}.`,
        );
      }
    }

    const { data, meta } = await getProductsPage({
      search: query,
      category,
      page: input.page,
      limit: input.limit,
    });
    return {
      ok: true,
      query: query ?? null,
      category: category ?? null,
      products: data.map(toSummary),
      pagination: {
        page: meta.pagination.page,
        totalPages: meta.pagination.totalPages,
        total: meta.pagination.total,
        hasNextPage: meta.pagination.hasNextPage,
      },
    };
  } catch (error) {
    if (isTransient(error)) throw error;
    return toFailure(error, "No products matched that search.");
  }
}

export async function getProductDetailsStep(
  idOrSlug: string,
): Promise<ToolResult<{ product: ProductDetails }>> {
  "use step";
  try {
    const product = await getProductById(idOrSlug);
    // Stock is a separate live call; a stock outage shouldn't hide the product.
    const stock = await getProductStock(product.id).catch((error) => {
      if (isTransient(error)) return null;
      throw error;
    });
    return {
      ok: true,
      product: {
        ...toSummary(product),
        description: product.description,
        images: product.images,
        tags: product.tags,
        stock: stock
          ? {
              quantity: stock.stock,
              inStock: stock.inStock,
              lowStock: stock.lowStock,
            }
          : null,
      },
    };
  } catch (error) {
    if (isTransient(error)) throw error;
    return toFailure(
      error,
      `No product matches "${idOrSlug}". Try searching the catalog first.`,
    );
  }
}

/**
 * Looks up the order and decides exactly what can be returned. Runs before the
 * return workflow starts, so a shopper gets an immediate, accurate answer for
 * unknown orders, non-returnable statuses or items that weren't purchased.
 */
export async function prepareReturnStep(input: {
  orderId: string;
  items?: { productId: string; quantity?: number }[];
}): Promise<
  ToolResult<{
    orderId: string;
    currency: string;
    orderTotal: number;
    lines: OrderLine[];
    returnLines: ReturnLine[];
  }>
> {
  "use step";
  try {
    const order = await getOrder(input.orderId);

    if (order.status !== "fulfilled") {
      return failure(
        "not_allowed",
        order.status === "cancelled"
          ? `Order ${order.id} was cancelled, so there is nothing to return.`
          : `Order ${order.id} is "${order.status}". Only delivered (fulfilled) orders can be returned.`,
      );
    }

    const lines: OrderLine[] = order.items.map((item) => ({
      productId: item.productId,
      name: item.product?.name ?? item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    }));

    let returnLines: ReturnLine[];
    if (!input.items || input.items.length === 0) {
      returnLines = lines.map(({ productId, name, quantity }) => ({
        productId,
        name,
        quantity,
      }));
    } else {
      returnLines = [];
      for (const requested of input.items) {
        const line = lines.find(
          (l) =>
            l.productId === requested.productId ||
            l.name.toLowerCase() === requested.productId.toLowerCase(),
        );
        if (!line) {
          return failure(
            "invalid_request",
            `Order ${order.id} doesn't include "${requested.productId}". It contains: ${lines
              .map((l) => `${l.name} (${l.productId})`)
              .join(", ")}.`,
          );
        }
        const quantity = requested.quantity ?? line.quantity;
        if (quantity > line.quantity) {
          return failure(
            "invalid_request",
            `Only ${line.quantity} × ${line.name} was purchased on order ${order.id}.`,
          );
        }
        returnLines.push({ productId: line.productId, name: line.name, quantity });
      }
    }

    return {
      ok: true,
      orderId: order.id,
      currency: order.currency,
      orderTotal: order.total,
      lines,
      returnLines,
    };
  } catch (error) {
    if (isTransient(error)) throw error;
    return toFailure(
      error,
      `We couldn't find order ${input.orderId}. Please check the order number.`,
    );
  }
}

/**
 * Starts the durable return workflow and returns immediately, so the chat
 * confirms the return as soon as it's filed instead of waiting for the
 * store's decision (which can take minutes).
 */
export async function startReturnStep(input: {
  orderId: string;
  reason: string;
  items: ReturnLine[];
}): Promise<{ runId: string }> {
  "use step";
  const run = await start(returnOrderWorkflow, [
    {
      orderId: input.orderId,
      reason: input.reason,
      items: input.items.map(({ productId, quantity }) => ({
        productId,
        quantity,
      })),
    },
  ]);
  return { runId: run.runId };
}
