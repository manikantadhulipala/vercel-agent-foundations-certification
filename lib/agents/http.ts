import "server-only";
import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import {
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  type UIMessage,
} from "ai";
import { getRun } from "workflow/api";

/*
 * Shared HTTP plumbing for both chat endpoints. Keeps request validation and
 * stream-resume behavior identical for the shopping and admin agents.
 */

const MAX_BODY_BYTES = 512 * 1024;
const MAX_MESSAGES = 60;
const RUN_ID_PATTERN = /^wrun_[A-Za-z0-9]{10,64}$/;

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

/**
 * Parses and validates a `useChat` request body. Rejects oversized payloads,
 * malformed messages, and `system` messages (the browser must never be able
 * to override an agent's instructions).
 */
export async function readChatMessages(
  request: Request,
): Promise<{ ok: true; messages: UIMessage[] } | { ok: false; response: Response }> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return { ok: false, response: jsonError(413, "Conversation is too long. Start a new chat.") };
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, response: jsonError(400, "Request body must be JSON.") };
  }

  const candidate = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(candidate) || candidate.length === 0) {
    return { ok: false, response: jsonError(400, "Send at least one message.") };
  }
  if (candidate.length > MAX_MESSAGES) {
    return { ok: false, response: jsonError(413, "Conversation is too long. Start a new chat.") };
  }

  const validated = await safeValidateUIMessages({ messages: candidate });
  if (!validated.success) {
    return { ok: false, response: jsonError(400, "Messages are malformed.") };
  }

  const messages = validated.data.filter((m) => m.role !== "system");
  if (messages.at(-1)?.role !== "user") {
    return { ok: false, response: jsonError(400, "The last message must come from the user.") };
  }
  return { ok: true, messages };
}

function skipChunks<T>(count: number): TransformStream<T, T> {
  let seen = 0;
  return new TransformStream<T, T>({
    transform(chunk, controller) {
      if (seen++ >= count) controller.enqueue(chunk);
    },
  });
}

/** Response for a freshly started run, with the header `WorkflowChatTransport` needs. */
export function runStreamResponse(run: {
  runId: string;
  readable: ReadableStream;
}): Response {
  return createUIMessageStreamResponse({
    stream: run.readable.pipeThrough(createModelCallToUIChunkTransform()),
    headers: { "x-workflow-run-id": run.runId },
  });
}

/**
 * Resumes a run's persisted output stream from `startIndex`, used after a
 * dropped connection or page refresh. Only serves runs of `workflowName`, so
 * one agent's endpoint can never replay the other agent's conversation.
 */
export async function resumeRunStream(
  request: Request,
  runId: string,
  workflowName: string,
): Promise<Response> {
  if (!RUN_ID_PATTERN.test(runId)) return jsonError(400, "Invalid run id.");

  const startParam = new URL(request.url).searchParams.get("startIndex") ?? "0";
  const startIndex = Number.parseInt(startParam, 10);
  if (!Number.isInteger(startIndex) || startIndex < 0) {
    return jsonError(400, "startIndex must be a non-negative integer.");
  }

  try {
    const run = getRun(runId);
    const name = await run.workflowName;
    if (!name.endsWith(`//${workflowName}`)) return jsonError(404, "Run not found.");

    // The run persists raw model-call parts, but the client counts the UI
    // chunks it has rendered, and one raw part can become several UI chunks.
    // Replaying from the start and skipping `startIndex` UI chunks keeps both
    // sides on the same index, so a resumed reply never repeats or drops text.
    const readable = run
      .getReadable({ startIndex: 0 })
      .pipeThrough(createModelCallToUIChunkTransform())
      .pipeThrough(skipChunks(startIndex));
    return createUIMessageStreamResponse({
      stream: readable,
      headers: { "x-workflow-run-id": runId },
    });
  } catch {
    return jsonError(404, "Run not found.");
  }
}
