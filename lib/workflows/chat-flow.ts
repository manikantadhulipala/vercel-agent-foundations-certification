import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow";
import { convertToModelMessages, isStepCount, type UIMessage } from "ai";
import { getWritable } from "workflow";
import { MODEL_MAX_RETRIES, providerOptionsFor } from "./agent-runtime";
import { SHOPPING_INSTRUCTIONS } from "@/lib/agents/shopping/instructions";
import { shoppingTools } from "@/lib/agents/shopping/tools";

/** Enough for search → details → follow-up, while preventing runaway loops. */
const MAX_AGENT_STEPS = 8;

/**
 * One shopper turn as a durable workflow run.
 *
 * The browser owns the conversation history and sends it with each message
 * (single-turn workflow pattern). Inside the run, every model call and tool
 * call is a durable step: transient failures are retried, and the run's
 * output stream is persisted so a refreshed page can reconnect to it.
 */
export async function shoppingChatWorkflow(
  messages: UIMessage[],
  options: { model: string },
): Promise<void> {
  "use workflow";

  const agent = new WorkflowAgent({
    model: options.model,
    instructions: SHOPPING_INSTRUCTIONS,
    maxRetries: MODEL_MAX_RETRIES,
    providerOptions: providerOptionsFor(options.model),
    tools: shoppingTools,
  });

  // If a model call still fails after its retries, the run fails; the HTTP
  // layer (lib/agents/http.ts) turns that into a visible error in the chat.
  await agent.stream({
    messages: await convertToModelMessages(messages),
    writable: getWritable<ModelCallStreamPart>(),
    stopWhen: isStepCount(MAX_AGENT_STEPS),
  });
}
