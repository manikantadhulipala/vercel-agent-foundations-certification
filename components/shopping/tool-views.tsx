"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, PackageCheck, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  CategorySummary,
  ProductDetails,
  ProductSummary,
  ReturnLine,
} from "@/lib/agents/shopping/types";

/*
 * Generative UI for the shopping agent's tool results. Product data renders
 * as browsable components (images, names, formatted prices, links to the
 * existing product pages) rather than raw JSON or text.
 */

export function ProductResults({
  products,
  query,
  category,
  pagination,
}: {
  products: ProductSummary[];
  query: string | null;
  category: string | null;
  pagination: { page: number; totalPages: number; total: number };
}) {
  const label = [query && `“${query}”`, category && `in ${category}`]
    .filter(Boolean)
    .join(" ");

  if (products.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
        No products found{label ? ` for ${label}` : ""}.
      </p>
    );
  }

  return (
    <section aria-label={`Product results${label ? ` for ${label}` : ""}`} className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {pagination.total} {pagination.total === 1 ? "product" : "products"}
        {label ? ` ${label}` : ""}
        {pagination.totalPages > 1 && ` · page ${pagination.page} of ${pagination.totalPages}`}
      </p>
      <ul className="grid grid-cols-2 gap-2">
        {products.map((product) => (
          <li key={product.id}>
            <ProductTile product={product} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProductTile({ product }: { product: ProductSummary }) {
  return (
    <Link
      href={product.url}
      className="group block overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative aspect-square overflow-hidden bg-secondary">
        {product.image && (
          <Image
            src={product.image}
            alt=""
            fill
            sizes="(min-width: 768px) 160px, 45vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        )}
      </div>
      <div className="p-2">
        <p className="line-clamp-2 text-xs font-medium text-foreground">{product.name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatPrice(product.price, product.currency)}
        </p>
      </div>
    </Link>
  );
}

function StockBadge({ stock }: { stock: ProductDetails["stock"] }) {
  if (!stock) return <Badge variant="outline">Stock unavailable</Badge>;
  if (!stock.inStock) return <Badge variant="destructive">Out of stock</Badge>;
  if (stock.lowStock) {
    return <Badge variant="secondary">Only {stock.quantity} left</Badge>;
  }
  return <Badge variant="secondary">In stock</Badge>;
}

export function ProductDetailCard({ product }: { product: ProductDetails }) {
  const [active, setActive] = useState(0);
  const image = product.images[active] ?? product.image;

  return (
    <article
      aria-label={product.name}
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="relative aspect-[4/3] bg-secondary">
        {image && (
          <Image
            src={image}
            alt={product.name}
            fill
            sizes="(min-width: 768px) 360px, 90vw"
            className="object-cover"
          />
        )}
      </div>
      {product.images.length > 1 && (
        <div className="flex gap-1.5 px-3 pt-3" role="group" aria-label="Product images">
          {product.images.slice(0, 5).map((src, index) => (
            <button
              key={src}
              type="button"
              onClick={() => setActive(index)}
              aria-label={`Show image ${index + 1} of ${product.images.length}`}
              aria-pressed={index === active}
              className={cn(
                "relative size-10 overflow-hidden rounded border",
                index === active ? "border-foreground" : "border-border",
              )}
            >
              <Image src={src} alt="" fill sizes="40px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
      <div className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold">{product.name}</h3>
          <p className="shrink-0 text-sm font-medium">
            {formatPrice(product.price, product.currency)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StockBadge stock={product.stock} />
          <Badge variant="outline" className="capitalize">
            {product.category.replace(/-/g, " ")}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{product.description}</p>
        {product.tags.length > 0 && (
          <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <Tag className="size-3" aria-hidden="true" />
            <span className="sr-only">Tags:</span>
            {product.tags.join(" · ")}
          </p>
        )}
        <Link
          href={product.url}
          className="inline-flex text-sm font-medium underline underline-offset-4 hover:text-foreground/80"
        >
          View product page
        </Link>
      </div>
    </article>
  );
}

export function CategoryList({ categories }: { categories: CategorySummary[] }) {
  if (categories.length === 0) {
    return <p className="text-sm text-muted-foreground">No categories are available.</p>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Store categories">
      {categories.map((c) => (
        <li key={c.slug}>
          <Link
            href={`/search?category=${encodeURIComponent(c.slug)}`}
            className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {c.name}
            <span className="text-muted-foreground">{c.productCount}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ReturnConfirmation({
  orderId,
  items,
  reason,
}: {
  orderId: string;
  items: ReturnLine[];
  reason: string;
}) {
  return (
    <section
      aria-label={`Return filed for order ${orderId}`}
      className="space-y-2 rounded-lg border border-border bg-card p-3"
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
        Return filed for order {orderId}
      </p>
      <ul className="space-y-1 text-sm">
        {items.map((item) => (
          <li key={item.productId} className="flex items-center gap-2">
            <PackageCheck className="size-3.5 text-muted-foreground" aria-hidden="true" />
            {item.quantity} × {item.name}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Reason: {reason}</p>
      <ol className="list-inside list-decimal space-y-0.5 text-xs text-muted-foreground">
        <li>{"We'll email you that your return is being processed."}</li>
        <li>Your refund is pre-authorized.</li>
        <li>The store reviews the return, usually within a few minutes.</li>
      </ol>
    </section>
  );
}
