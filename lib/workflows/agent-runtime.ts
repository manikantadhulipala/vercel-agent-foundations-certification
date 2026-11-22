/*
 * Shared runtime settings for both agent workflows.
 */

/**
 * Retries per model call. The AI SDK backs off 2s, 4s, 8s… and only honors a
 * gateway "retry after" under 60s, so six retries (~2 minutes in total) are
 * enough to outlast a per-minute rate-limit window instead of failing the turn.
 */
export const MODEL_MAX_RETRIES = 6;

/**
 * GPT-5 models reason before every call at "medium" effort by default, which
 * dominated response time (most of each turn was spent before the first
 * token). "low" keeps tool selection and answers accurate for these focused
 * agents while responding much faster. Other providers keep their defaults.
 */
export function providerOptionsFor(model: string) {
  if (model.startsWith("openai/gpt-5")) {
    return { openai: { reasoningEffort: "low" } };
  }
  return undefined;
}
