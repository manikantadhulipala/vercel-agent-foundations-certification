"use client";

import type { InferUITools, UIMessage } from "ai";
import { Brain, ClipboardList } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { MemorySaved, DataLookup, SandboxCommand } from "@/components/admin/tool-views";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ToolPending, ToolProblem } from "@/components/chat/tool-states";
import type { AdminTools } from "@/lib/agents/admin/tools";

/**
 * Admin chat at /admin, connected to the separate store admin agent. Shows
 * which data was read, sandbox command activity (running, done, failed) and
 * memory saves alongside the agent's answers.
 */

export type AdminUIMessage = UIMessage<unknown, never, InferUITools<AdminTools>>;
type AdminPart = AdminUIMessage["parts"][number];

const SUGGESTIONS = [
  "Which products have the highest return rates this month?",
  "Which low-stock items are top sellers?",
  "Summarize open urgent support tickets",
  "Summarize this week's revenue",
];

const DATA_LABELS: Record<string, string> = {
  "tool-getSupportTickets": "Reading support tickets…",
  "tool-getReturnsHistory": "Reading returns history…",
  "tool-getInventoryStock": "Reading inventory…",
  "tool-getSalesAnalytics": "Reading sales…",
};

function renderPart(part: AdminPart, key: string) {
  switch (part.type) {
    case "text":
      return part.text ? <MessageResponse key={key}>{part.text}</MessageResponse> : null;

    case "tool-getSupportTickets":
    case "tool-getReturnsHistory":
    case "tool-getInventoryStock":
    case "tool-getSalesAnalytics": {
      if (part.state === "output-error") {
        return <ToolProblem key={key} message="That data couldn't be loaded." />;
      }
      if (part.state !== "output-available") {
        return <ToolPending key={key} label={DATA_LABELS[part.type]} />;
      }
      const out = part.output;
      if (!out.ok) return <ToolProblem key={key} reason={out.reason} message={out.message} />;
      return (
        <DataLookup
          key={key}
          dataset={out.dataset}
          filters={out.filters}
          totalRows={out.totalRows}
          rows={out.rows}
          meta={out.meta}
        />
      );
    }

    case "tool-searchProducts":
    case "tool-getAllCategories": {
      if (part.state === "output-error") {
        return <ToolProblem key={key} message="The catalog lookup failed." />;
      }
      if (part.state !== "output-available") {
        return <ToolPending key={key} label="Checking the catalog…" />;
      }
      const out = part.output;
      if (!out.ok) return <ToolProblem key={key} reason={out.reason} message={out.message} />;
      const count = "products" in out ? out.products.length : out.categories.length;
      const noun = "products" in out ? "products" : "categories";
      return (
        <p key={key} className="text-xs text-muted-foreground">
          Checked the catalog · {count} {noun}
        </p>
      );
    }

    case "tool-bash": {
      const command = part.input?.command ?? "";
      if (part.state === "output-error") {
        return <ToolProblem key={key} message="The sandbox command couldn't run." />;
      }
      if (part.state !== "output-available") {
        return command ? (
          <SandboxCommand key={key} command={command} running />
        ) : (
          <ToolPending key={key} label="Preparing analysis…" />
        );
      }
      const out = part.output;
      if (!out.ok) return <ToolProblem key={key} reason={out.reason} message={out.message} />;
      return <SandboxCommand key={key} command={out.command} running={false} result={out} />;
    }

    case "tool-saveMemory": {
      if (part.state === "output-error") {
        return <ToolProblem key={key} message="That note couldn't be saved to memory." />;
      }
      if (part.state !== "output-available") {
        return <ToolPending key={key} label="Saving to memory…" />;
      }
      const out = part.output;
      if (!out.ok) return <ToolProblem key={key} reason={out.reason} message={out.message} />;
      return <MemorySaved key={key} note={out.saved} />;
    }

    default:
      return null;
  }
}

function renderAssistantMessage(message: AdminUIMessage) {
  return message.parts.map((part, index) => renderPart(part, `${message.id}-${index}`));
}

export function AdminAgentChat() {
  return (
    <ChatPanel<AdminUIMessage>
      api="/api/admin/chat"
      storageKey="ship-it-shop:admin-chat"
      renderAssistantMessage={renderAssistantMessage}
      suggestions={SUGGESTIONS}
      persistentSuggestions
      placeholder="Ask about support, returns, inventory or sales…"
      inputLabel="Message the store admin agent"
      emptyState={{
        icon: <ClipboardList className="size-8" aria-hidden="true" />,
        title: "Store operations assistant",
        description:
          "Ask about support tickets, returns, inventory and sales. Calculations run in an isolated sandbox.",
      }}
      footerNote={
        <span className="flex items-center gap-1 px-2 text-xs text-muted-foreground">
          <Brain className="size-3.5" aria-hidden="true" />
          Remembers saved preferences
        </span>
      }
    />
  );
}
