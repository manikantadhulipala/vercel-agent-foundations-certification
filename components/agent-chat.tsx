"use client";

import type { InferUITools, UIMessage } from "ai";
import { ShoppingBag } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ToolPending, ToolProblem } from "@/components/chat/tool-states";
import {
  CategoryList,
  ProductDetailCard,
  ProductResults,
  ReturnConfirmation,
} from "@/components/shopping/tool-views";
import type { ShoppingTools } from "@/lib/agents/shopping/tools";

/**
 * Storefront chat, connected to the durable shopping agent. Tool results
 * render as product components; progress and failures are explained in
 * plain language. The conversation survives refreshes and dropped
 * connections (see useDurableChat).
 */

export type ShoppingUIMessage = UIMessage<unknown, never, InferUITools<ShoppingTools>>;
type ShoppingPart = ShoppingUIMessage["parts"][number];

const SUGGESTIONS = [
  "What categories do you have?",
  "Show me hoodies",
  "I'd like to return order 11111",
];

function renderPart(part: ShoppingPart, key: string, hasPrimaryResults: boolean) {
  switch (part.type) {
    case "text":
      return part.text ? <MessageResponse key={key}>{part.text}</MessageResponse> : null;

    case "tool-searchProducts": {
      if (part.state === "output-error") {
        return <ToolProblem key={key} message="The product search failed. Please try again." />;
      }
      if (part.state !== "output-available") {
        return <ToolPending key={key} label="Searching products…" />;
      }
      const out = part.output;
      if (!out.ok) return <ToolProblem key={key} reason={out.reason} message={out.message} />;
      return (
        <ProductResults
          key={key}
          products={out.products}
          query={out.query}
          category={out.category}
          pagination={out.pagination}
        />
      );
    }

    case "tool-getProductDetails": {
      if (part.state === "output-error") {
        return <ToolProblem key={key} message="Couldn't load that product. Please try again." />;
      }
      if (part.state !== "output-available") {
        return <ToolPending key={key} label="Looking up product details…" />;
      }
      const out = part.output;
      if (!out.ok) return <ToolProblem key={key} reason={out.reason} message={out.message} />;
      return <ProductDetailCard key={key} product={out.product} />;
    }

    case "tool-getAllCategories": {
      if (part.state === "output-error") {
        return <ToolProblem key={key} message="Couldn't load categories. Please try again." />;
      }
      if (part.state !== "output-available") {
        return <ToolPending key={key} label="Checking categories…" />;
      }
      const out = part.output;
      if (!out.ok) return <ToolProblem key={key} reason={out.reason} message={out.message} />;
      // When categories were only looked up to filter a search, a quiet note
      // is enough; show the full list when categories are the answer.
      if (hasPrimaryResults) {
        return (
          <p key={key} className="text-xs text-muted-foreground">
            Checked {out.categories.length} store categories
          </p>
        );
      }
      return <CategoryList key={key} categories={out.categories} />;
    }

    case "tool-returnOrder": {
      if (part.state === "output-error") {
        return <ToolProblem key={key} message="We couldn't file the return. Please try again." />;
      }
      if (part.state !== "output-available") {
        return <ToolPending key={key} label="Filing your return…" />;
      }
      const out = part.output;
      if (!out.ok) return <ToolProblem key={key} reason={out.reason} message={out.message} />;
      return (
        <ReturnConfirmation key={key} orderId={out.orderId} items={out.items} reason={out.reason} />
      );
    }

    default:
      // Reasoning and step markers aren't shown to shoppers.
      return null;
  }
}

function renderAssistantMessage(message: ShoppingUIMessage) {
  const hasPrimaryResults = message.parts.some(
    (p) =>
      p.type === "tool-searchProducts" ||
      p.type === "tool-getProductDetails" ||
      p.type === "tool-returnOrder",
  );
  return message.parts.map((part, index) =>
    renderPart(part, `${message.id}-${index}`, hasPrimaryResults),
  );
}

export function AgentChat() {
  return (
    <ChatPanel<ShoppingUIMessage>
      api="/api/chat"
      storageKey="ship-it-shop:shopping-chat"
      renderAssistantMessage={renderAssistantMessage}
      suggestions={SUGGESTIONS}
      placeholder="Ask about products or returns…"
      inputLabel="Message the shopping assistant"
      emptyState={{
        icon: <ShoppingBag className="size-8" aria-hidden="true" />,
        title: "Hi! How can I help you shop?",
        description: "Ask about products, sizes and stock, or start a return.",
      }}
    />
  );
}
