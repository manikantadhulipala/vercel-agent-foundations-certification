import { start } from "workflow/api";
import { readChatMessages, runStreamResponse } from "@/lib/agents/http";
import { resolveModel } from "@/lib/agents/shared";
import { shoppingChatWorkflow } from "@/lib/workflows/chat-flow";

/**
 * Shopping agent endpoint. Each shopper message starts a durable workflow run
 * and streams its output back. The `x-workflow-run-id` header lets the chat
 * reconnect to the same run after an interruption.
 */
export async function POST(request: Request): Promise<Response> {
  const parsed = await readChatMessages(request);
  if (!parsed.ok) return parsed.response;

  const run = await start(shoppingChatWorkflow, [
    parsed.messages,
    { model: resolveModel() },
  ]);
  return runStreamResponse(run);
}
