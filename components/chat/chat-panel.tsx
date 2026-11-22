"use client";

import { useState, type ReactNode } from "react";
import type { UIMessage } from "ai";
import { RotateCcw } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Suggestion } from "@/components/ai-elements/suggestion";
import { Button } from "@/components/ui/button";
import { ToolPending, ToolProblem } from "@/components/chat/tool-states";
import { useDurableChat } from "@/components/chat/use-durable-chat";
import { CONNECTION_FAILED_MESSAGE, RUN_FAILED_MESSAGE } from "@/lib/agents/messages";

/*
 * Shared chat UI for both agents: conversation, progress, interruption and
 * error states, suggestions and the composer. Each agent supplies how its
 * assistant message parts render (its generative UI).
 */

export interface ChatPanelProps<M extends UIMessage> {
  api: string;
  storageKey: string;
  renderAssistantMessage: (message: M) => ReactNode;
  suggestions: string[];
  placeholder: string;
  inputLabel: string;
  emptyState: { icon: ReactNode; title: string; description: string };
  /** Keep suggestions visible after the first message (e.g. for operators). */
  persistentSuggestions?: boolean;
  footerNote?: ReactNode;
}

export function ChatPanel<M extends UIMessage>({
  api,
  storageKey,
  renderAssistantMessage,
  suggestions,
  placeholder,
  inputLabel,
  emptyState,
  persistentSuggestions = false,
  footerNote,
}: ChatPanelProps<M>) {
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
  } = useDurableChat<M>({ api, storageKey });

  const busy = status === "submitted" || status === "streaming";
  const waitingForFirstToken =
    status === "submitted" || (busy && messages.at(-1)?.role === "user");

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    clearError();
    sendMessage({ text: trimmed } as Parameters<typeof sendMessage>[0]);
    setInput("");
  };

  const handleSubmit = (message: PromptInputMessage) => send(message.text ?? "");
  const showSuggestions = suggestions.length > 0 && (persistentSuggestions || messages.length === 0);

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
              icon={emptyState.icon}
              title={emptyState.title}
              description={emptyState.description}
            />
          ) : (
            messages.map((message) => (
              <Message key={message.id} from={message.role}>
                <MessageContent>
                  {message.role === "user"
                    ? message.parts.map(
                        (part, index) =>
                          part.type === "text" && (
                            <p key={index} className="whitespace-pre-wrap">
                              {part.text}
                            </p>
                          ),
                      )
                    : renderAssistantMessage(message)}
                </MessageContent>
              </Message>
            ))
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
                message={
                  error.message === RUN_FAILED_MESSAGE ? RUN_FAILED_MESSAGE : CONNECTION_FAILED_MESSAGE
                }
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
        {showSuggestions && (
          // A plain, keyboard-reachable horizontal scroller (the vendored
          // scroll-area viewport isn't focusable for keyboard scrolling).
          <div
            role="group"
            aria-label="Suggested questions"
            tabIndex={0}
            className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {suggestions.map((s) => (
              <Suggestion
                key={s}
                suggestion={s}
                onClick={send}
                disabled={busy}
                className="shrink-0"
              />
            ))}
          </div>
        )}
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputBody>
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              placeholder={placeholder}
              aria-label={inputLabel}
              maxLength={2000}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>{footerNote}</PromptInputTools>
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
