import type { LogWarningsFunction } from "ai";

/**
 * Runs once per server instance (Next.js instrumentation hook).
 *
 * Installs an AI SDK warning logger that drops one known, benign interop
 * note: between agent steps, the SDK hands GPT-5's (encrypted, empty)
 * reasoning back to the model, and the Gateway's OpenAI provider skips it.
 * Every other AI SDK warning is still logged.
 */
const BENIGN_WARNINGS = [/reasoning parts are not supported/i];

export function register(): void {
  const logWarnings: LogWarningsFunction = ({ warnings, provider, model }) => {
    for (const warning of warnings) {
      const text = JSON.stringify(warning);
      if (BENIGN_WARNINGS.some((pattern) => pattern.test(text))) continue;
      console.warn(`AI SDK Warning (${provider ?? "unknown"} / ${model ?? "unknown"}): ${text}`);
    }
  };
  (globalThis as { AI_SDK_LOG_WARNINGS?: LogWarningsFunction }).AI_SDK_LOG_WARNINGS =
    logWarnings;
}
