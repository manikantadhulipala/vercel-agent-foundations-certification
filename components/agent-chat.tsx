"use client";

import { useState } from "react";
import type { InferUITools, UIMessage } from "ai";
import { RotateCcw, ShoppingBag } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Button } from "@/components/ui/button";
import { ToolPending, ToolProblem } from "@/components/chat/tool-states";
import { useDurableChat } from "@/components/chat/use-durable-chat";
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

export type ShoppingUIMessage = UIMessage<
  unknown,
  never,
  InferUITools<ShoppingTools>
>;
type ShoppingPart = ShoppingUIMessage["parts"][number];

const SUGGESTIONS = [
  "What categories do you have?",
  "Show me hoodies",
  "I'd like to return order 11111",
];

function renderPart(
  part: ShoppingPart,
  key: string,
  /** True when this reply also shows product or return results. */
  hasPrimaryResults: boolean,
) {
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
        <ReturnConfirmation
          key={key}
          orderId={out.orderId}
          items={out.items}
          reason={out.reason}
        />
      );
    }

    default:
      // Reasoning and step markers aren't shown to shoppers.
      return null;
  }
}

export function AgentChat() {
  const [input, setInput] = useState("");
  const {
    messages,
    sendMessage,
    status,
    stop,
    error,
    clearError,
    regenerate,
    hydrated,
    resuming,
    interrupted,
    reset,
  } = useDurableChat<ShoppingUIMessage>({
    api: "/api/chat",
    storageKey: "ship-it-shop:shopping-chat",
  });

  const busy = status === "submitted" || status === "streaming";
  const lastMessage = messages.at(-1);
  const waitingForFirstToken =
    status === "submitted" || (busy && lastMessage?.role === "user");

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    clearError();
    sendMessage({ text: trimmed });
    setInput("");
  };

  const handleSubmit = (message: PromptInputMessage) => send(message.text ?? "");

  return (
    <div className="flex h-full min-h-0 flex-col">
      {messages.length > 0 && (
        <div className="flex justify-end border-b px-2 py-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              reset();
              setInput("");
            }}
            disabled={busy}
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            New chat
          </Button>
        </div>
      )}

      <Conversation className="flex-1">
        <ConversationContent className="gap-5 p-3">
          {hydrated && messages.length === 0 ? (
            <ConversationEmptyState
              icon={<ShoppingBag className="size-8" aria-hidden="true" />}
              title="Hi! How can I help you shop?"
              description="Ask about products, sizes and stock, or start a return."
            />
          ) : (
            messages.map((message) => {
              const hasPrimaryResults = message.parts.some(
                (p) =>
                  p.type === "tool-searchProducts" ||
                  p.type === "tool-getProductDetails" ||
                  p.type === "tool-returnOrder",
              );
              return (
                <Message key={message.id} from={message.role}>
                  <MessageContent>
                    {message.parts.map((part, index) =>
                      message.role === "user"
                        ? part.type === "text" && (
                            <p key={index} className="whitespace-pre-wrap">
                              {part.text}
                            </p>
                          )
                        : renderPart(part, `${message.id}-${index}`, hasPrimaryResults),
                    )}
                  </MessageContent>
                </Message>
              );
            })
          )}

          {(waitingForFirstToken || resuming) && (
            <ToolPending label={resuming ? "Reconnecting…" : "Thinking…"} />
          )}

          {interrupted && !error && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2 text-sm">
              <span className="text-muted-foreground">This reply was interrupted.</span>
              <Button type="button" size="sm" variant="outline" onClick={() => regenerate()}>
                Retry
              </Button>
            </div>
          )}

          {error && (
            <div className="space-y-2">
              <ToolProblem
                reason="unavailable"
                message="The assistant couldn't respond. Check your connection and try again."
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  clearError();
                  regenerate();
                }}
              >
                Try again
              </Button>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="flex flex-col gap-2 border-t p-3">
        {messages.length === 0 && (
          <Suggestions>
            {SUGGESTIONS.map((s) => (
              <Suggestion key={s} suggestion={s} onClick={send} disabled={busy} />
            ))}
          </Suggestions>
        )}
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputBody>
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              placeholder="Ask about products or returns…"
              aria-label="Message the shopping assistant"
              maxLength={2000}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools />
            <PromptInputSubmit
              status={status}
              onStop={stop}
              disabled={!busy && !input.trim()}
              aria-label={busy ? "Stop response" : "Send message"}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
