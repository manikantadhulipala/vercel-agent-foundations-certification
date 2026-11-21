/*
 * Serializable shapes returned by the shopping tools. They cross workflow step
 * boundaries and are rendered by the chat's generative UI, so they hold plain
 * data only.
 */

export interface SearchProductsInput {
  query?: string;
  category?: string;
  page?: number;
  limit?: number;
}

export interface CategorySummary {
  slug: string;
  name: string;
  productCount: number;
}

export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  /** Integer cents, as returned by the store API. */
  price: number;
  currency: string;
  category: string;
  image: string | null;
  /** Link to the existing storefront product page. */
  url: string;
}

export interface ProductDetails extends ProductSummary {
  description: string;
  images: string[];
  tags: string[];
  /** `null` when live stock couldn't be fetched. */
  stock: { quantity: number; inStock: boolean; lowStock: boolean } | null;
}

export interface OrderLine {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface ReturnLine {
  productId: string;
  name: string;
  quantity: number;
}

export interface ReturnRequest {
  orderId: string;
  reason: string;
  items: { productId: string; quantity: number }[];
}
