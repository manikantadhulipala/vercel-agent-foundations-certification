import { resumeRunStream } from "@/lib/agents/http";

/**
 * Reconnect endpoint for the shopping chat. `WorkflowChatTransport` calls this
 * with the run id and the index of the last chunk it received, so a dropped
 * connection or page refresh continues the same response without duplicates.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return resumeRunStream(request, id, "shoppingChatWorkflow");
}
