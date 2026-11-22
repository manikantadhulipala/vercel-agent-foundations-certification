"use client";

import { useChat } from "@ai-sdk/react";
import { WorkflowChatTransport } from "@ai-sdk/workflow/client";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/*
 * `useChat` wired to a durable workflow backend, with recovery.
 *
 * - The browser owns the conversation (single-turn workflow pattern) and keeps
 *   it in localStorage, so a page refresh restores it.
 * - Each send starts a workflow run; its id (from `x-workflow-run-id`) is
 *   stored until the run finishes.
 * - On load, if a run was still in progress, we reconnect to it. While a reply
 *   is streaming we only persist messages up to the user's last message, so
 *   the resumed stream rebuilds the reply once — no duplicated output, and
 *   the task isn't started again.
 */

interface StoredChat<M> {
  version: 1;
  messages: M[];
  activeRunId: string | null;
}

const STORAGE_VERSION = 1;

function readStored<M>(key: string): StoredChat<M> | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredChat<M>;
    if (parsed?.version !== STORAGE_VERSION || !Array.isArray(parsed.messages)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStored<M>(key: string, value: StoredChat<M>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked (private mode): the chat still works, it just
    // won't survive a refresh.
  }
}

// Stay well under the server's limits (60 messages, 512 KB) so long
// conversations keep working; the newest context matters most.
const MAX_SENT_MESSAGES = 40;
const MAX_SENT_BYTES = 400_000;

/**
 * The most recent slice of the conversation that fits the request limits,
 * always starting at a user message so the model sees a coherent history.
 */
export function trimHistory<M extends UIMessage>(messages: M[]): M[] {
  let start = Math.max(0, messages.length - MAX_SENT_MESSAGES);
  const sizeOf = (from: number) => JSON.stringify(messages.slice(from)).length;
  while (start < messages.length - 1 && sizeOf(start) > MAX_SENT_BYTES) start++;
  while (start < messages.length - 1 && messages[start].role !== "user") start++;
  return messages.slice(start);
}

/** Messages up to and including the last user message. */
function upToLastUserMessage<M extends UIMessage>(messages: M[]): M[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages.slice(0, i + 1);
  }
  return [];
}

/**
 * Per-chat bookkeeping that lives with the transport, outside React state:
 * which run is streaming, and whether the saved conversation was restored.
 */
class ChatSession {
  private runId: string | null = null;
  private isRestored = false;
  private skipSave = false;

  get activeRunId(): string | null {
    return this.runId;
  }

  get restored(): boolean {
    return this.isRestored;
  }

  setActiveRun(runId: string | null): void {
    this.runId = runId;
  }

  /** Records that storage was read; `hadData` means a save would race the restore. */
  markRestored(hadData: boolean): void {
    this.isRestored = true;
    this.skipSave = hadData;
  }

  /** True once, for the save that runs in the same commit as the restore. */
  consumeSkipSave(): boolean {
    const skip = this.skipSave;
    this.skipSave = false;
    return skip;
  }
}

function createTransport<M extends UIMessage>(api: string, session: ChatSession) {
  return new WorkflowChatTransport<M>({
    api,
    maxConsecutiveErrors: 5,
    onChatSendMessage: (response) => {
      session.setActiveRun(response.headers.get("x-workflow-run-id"));
    },
    onChatEnd: () => session.setActiveRun(null),
    prepareSendMessagesRequest: ({ messages, body, headers }) => ({
      body: { ...body, messages: trimHistory(messages) },
      headers,
    }),
    prepareReconnectToStreamRequest: ({ api: defaultApi }) => ({
      api: session.activeRunId
        ? `${api}/${encodeURIComponent(session.activeRunId)}/stream`
        : defaultApi,
    }),
  });
}

const subscribeNever = () => () => {};

/** False during server rendering and hydration, true afterwards. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

export function useDurableChat<M extends UIMessage>({
  api,
  storageKey,
}: {
  /** POST endpoint; reconnects go to `${api}/${runId}/stream`. Fixed per chat. */
  api: string;
  /** localStorage key, unique per agent so conversations stay separate. */
  storageKey: string;
}) {
  const isClient = useIsClient();
  // Created once: the transport and its session outlive re-renders.
  const [{ session, transport }] = useState(() => {
    const session = new ChatSession();
    return { session, transport: createTransport<M>(api, session) };
  });

  // A stable id per agent: changing it would recreate the chat instance and
  // drop the restored messages.
  const chat = useChat<M>({
    id: storageKey,
    transport,
    experimental_throttle: 50,
  });
  const { messages, setMessages, status, resumeStream } = chat;

  // On load: restore the saved conversation, then reconnect to any run that
  // was still streaming when the page went away.
  useEffect(() => {
    const stored = readStored<M>(storageKey);
    session.markRestored(stored !== null);
    if (!stored) return;
    session.setActiveRun(stored.activeRunId);
    setMessages(stored.messages);
    if (stored.activeRunId) {
      resumeStream().catch(() => {
        // The run is gone (expired or never started): drop the stale pointer.
        session.setActiveRun(null);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, [storageKey]);

  // Persist after every change. While a reply streams, save only the user's
  // side; the reply itself lives in the durable run until it finishes.
  useEffect(() => {
    if (!session.restored || session.consumeSkipSave()) return;
    // A run is still in flight while streaming, and also when the connection
    // broke before its `finish` (the run id is only cleared on finish). Safari,
    // for example, reports the reload-cancelled stream as an error before the
    // page unloads; keeping the run id here lets the next load reconnect.
    const inFlight =
      status === "submitted" ||
      status === "streaming" ||
      (status === "error" && session.activeRunId !== null);
    writeStored<M>(storageKey, {
      version: STORAGE_VERSION,
      messages: inFlight ? upToLastUserMessage(messages) : messages,
      activeRunId: inFlight ? session.activeRunId : null,
    });
  }, [messages, status, storageKey, session]);

  const reset = useCallback(() => {
    chat.stop();
    session.setActiveRun(null);
    setMessages([]);
    writeStored<M>(storageKey, {
      version: STORAGE_VERSION,
      messages: [],
      activeRunId: null,
    });
  }, [chat, session, setMessages, storageKey]);

  const busy = status === "submitted" || status === "streaming";
  /** Reconnecting to a run that was streaming before the page reloaded. */
  const resuming = busy && messages.at(-1)?.role === "user" && session.activeRunId !== null;

  /** The last user message never got a reply (e.g. refreshed before it started). */
  const interrupted =
    isClient && status === "ready" && messages.length > 0 && messages.at(-1)?.role === "user";

  return { ...chat, hydrated: isClient, resuming, interrupted, reset };
}
