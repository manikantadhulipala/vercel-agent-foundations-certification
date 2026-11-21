import { hasAdminSession, unauthorized } from "@/lib/admin-session";
import { resumeRunStream } from "@/lib/agents/http";

/** Reconnect endpoint for the admin chat (admin session required). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!(await hasAdminSession())) return unauthorized();
  const { id } = await params;
  return resumeRunStream(request, id, "adminChatWorkflow");
}
