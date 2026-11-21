import { start } from "workflow/api";
import { hasAdminSession, unauthorized } from "@/lib/admin-session";
import { readChatMessages, runStreamResponse } from "@/lib/agents/http";
import { resolveModel } from "@/lib/agents/shared";
import { adminChatWorkflow } from "@/lib/workflows/admin-chat-flow";

/**
 * Admin agent endpoint. Requires the admin session; each employee message
 * starts a durable workflow run whose output streams back to /admin.
 */
export async function POST(request: Request): Promise<Response> {
  if (!(await hasAdminSession())) return unauthorized();

  const parsed = await readChatMessages(request);
  if (!parsed.ok) return parsed.response;

  const run = await start(adminChatWorkflow, [
    parsed.messages,
    { model: resolveModel(), today: new Date().toISOString().slice(0, 10) },
  ]);
  return runStreamResponse(run);
}
