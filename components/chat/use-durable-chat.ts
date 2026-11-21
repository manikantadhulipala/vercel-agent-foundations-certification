"use client";

import { useChat } from "@ai-sdk/react";
import { WorkflowChatTransport } from "@ai-sdk/workflow/client";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

/** Messages up to and including the last user message. */
function upToLastUserMessage<M extends UIMessage>(messages: M[]): M[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages.slice(0, i + 1);
  }
  return [];
}

export function useDurableChat<M extends UIMessage>({
  api,
  storageKey,
}: {
  /** POST endpoint; reconnects go to `${api}/${runId}/stream`. */
  api: string;
  /** localStorage key, unique per agent so conversations stay separate. */
  storageKey: string;
}) {
  const activeRunId = useRef<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [resuming, setResuming] = useState(false);

  const transport = useMemo(
    () =>
      new WorkflowChatTransport<M>({
        api,
        maxConsecutiveErrors: 5,
        onChatSendMessage: (response) => {
          activeRunId.current = response.headers.get("x-workflow-run-id");
        },
        onChatEnd: () => {
          activeRunId.current = null;
        },
        prepareReconnectToStreamRequest: ({ api: defaultApi }) => ({
          api: activeRunId.current
            ? `${api}/${encodeURIComponent(activeRunId.current)}/stream`
            : defaultApi,
        }),
      }),
    [api],
  );

  // A stable id per agent: changing it would recreate the chat instance and
  // drop the restored messages.
  const chat = useChat<M>({
    id: storageKey,
    transport,
    experimental_throttle: 50,
  });
  const { messages, setMessages, status, resumeStream } = chat;

  // Restore the saved conversation, then reconnect to any in-flight run.
  useEffect(() => {
    const stored = readStored<M>(storageKey);
    if (stored) {
      activeRunId.current = stored.activeRunId;
      setMessages(stored.messages);
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated || !activeRunId.current) return;
    setResuming(true);
    resumeStream()
      .catch(() => {
        // The run is gone (expired or never started): drop the stale pointer.
        activeRunId.current = null;
      })
      .finally(() => setResuming(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, after restore
  }, [hydrated]);

  // Persist after every change. While a reply streams, save only the user's
  // side; the reply itself lives in the durable run until it finishes.
  useEffect(() => {
    if (!hydrated) return;
    const inFlight = status === "submitted" || status === "streaming";
    writeStored<M>(storageKey, {
      version: STORAGE_VERSION,
      messages: inFlight ? upToLastUserMessage(messages) : messages,
      activeRunId: inFlight ? activeRunId.current : null,
    });
  }, [hydrated, messages, status, storageKey]);

  const reset = useCallback(() => {
    chat.stop();
    activeRunId.current = null;
    setMessages([]);
    writeStored<M>(storageKey, {
      version: STORAGE_VERSION,
      messages: [],
      activeRunId: null,
    });
  }, [chat, setMessages, storageKey]);

  /** The last user message never got a reply (e.g. refreshed before it started). */
  const interrupted =
    hydrated &&
    !resuming &&
    status === "ready" &&
    messages.length > 0 &&
    messages.at(-1)?.role === "user";

  return { ...chat, hydrated, resuming, interrupted, reset };
}
