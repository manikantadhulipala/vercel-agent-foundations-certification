import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow";
import { convertToModelMessages, isStepCount, type UIMessage } from "ai";
import { getWritable } from "workflow";
import { MODEL_MAX_RETRIES, providerOptionsFor } from "./agent-runtime";
import { buildAdminInstructions } from "@/lib/agents/admin/instructions";
import { loadMemoryStep } from "@/lib/agents/admin/steps";
import { adminTools } from "@/lib/agents/admin/tools";

/** Room for fetch → compute → fix-and-retry → answer, without runaway loops. */
const MAX_AGENT_STEPS = 16;
/** From this step on, tools are disabled so the employee always gets an answer. */
const ANSWER_BY_STEP = MAX_AGENT_STEPS - 2;

/**
 * One employee turn as a durable workflow run. Memory is read from the admin
 * sandbox first (a durable step), then the agent runs with model calls and
 * tool executions as retried, resumable steps.
 */
export async function adminChatWorkflow(
  messages: UIMessage[],
  options: { model: string; today: string },
): Promise<void> {
  "use workflow";

  const memory = await loadMemoryStep();

  const agent = new WorkflowAgent({
    model: options.model,
    instructions: buildAdminInstructions({
      today: options.today,
      memory: memory.notes,
      memoryAvailable: memory.available,
    }),
    maxRetries: MODEL_MAX_RETRIES,
    providerOptions: providerOptionsFor(options.model),
    tools: adminTools,
    // Guarantee a written answer: near the step limit, stop calling tools
    // and summarize what was found (and what couldn't be computed).
    prepareStep: ({ stepNumber }) =>
      stepNumber >= ANSWER_BY_STEP ? { toolChoice: "none" as const } : {},
  });

  // If a model call still fails after its retries, the run fails; the HTTP
  // layer (lib/agents/http.ts) turns that into a visible error in the chat.
  await agent.stream({
    messages: await convertToModelMessages(messages),
    writable: getWritable<ModelCallStreamPart>(),
    stopWhen: isStepCount(MAX_AGENT_STEPS),
  });
}
