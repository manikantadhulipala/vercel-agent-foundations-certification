/**
 * Shape of `ApiRequestError` from lib/api.ts. Checked structurally so this
 * module stays free of server-only imports and can be used inside workflows.
 */
type ApiErrorLike = { status: number; message: string };

function asApiError(error: unknown): ApiErrorLike | null {
  if (
    error instanceof Error &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    return error as unknown as ApiErrorLike;
  }
  return null;
}

/**
 * Default model for both agents. Any AI Gateway model that supports tool
 * calling works; override per environment with `AI_MODEL`.
 */
export const DEFAULT_MODEL = "openai/gpt-5-mini";

export function resolveModel(): string {
  return process.env.AI_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * Every tool returns this shape instead of throwing for expected problems, so
 * the model can explain what happened and the UI can render a clear state.
 * Unexpected/transient failures are thrown inside steps so the Workflow
 * runtime retries them; once retries are exhausted the tool wrapper turns
 * them into `{ ok: false, reason: "unavailable" }`.
 */
export type ToolFailure = {
  ok: false;
  reason: "not_found" | "invalid_request" | "not_allowed" | "unavailable";
  message: string;
};

export type ToolSuccess<T> = { ok: true } & T;
export type ToolResult<T> = ToolSuccess<T> | ToolFailure;

export function failure(
  reason: ToolFailure["reason"],
  message: string,
): ToolFailure {
  return { ok: false, reason, message };
}

/** Network errors, rate limits and 5xx responses are worth retrying. */
export function isTransient(error: unknown): boolean {
  const apiError = asApiError(error);
  if (apiError) {
    return (
      apiError.status === 0 || apiError.status === 429 || apiError.status >= 500
    );
  }
  // Unknown errors (timeouts, aborted fetches) are treated as transient.
  return true;
}

/**
 * Converts a permanent API error into a message that is safe to show the model
 * and the user. Never includes URLs, headers or request details, so the
 * store API access value can't leak into a chat.
 */
export function toFailure(error: unknown, notFoundMessage: string): ToolFailure {
  const apiError = asApiError(error);
  if (apiError?.status === 404) return failure("not_found", notFoundMessage);
  if (apiError?.status === 400 || apiError?.status === 422) {
    return failure(
      "invalid_request",
      sanitize(apiError.message) || "The store rejected that request.",
    );
  }
  return failure(
    "unavailable",
    "The store service is temporarily unavailable. Please try again shortly.",
  );
}

function sanitize(message: string): string {
  return message
    .replace(/https?:\/\/\S+/g, "")
    .replace(/x-vercel-protection-bypass\S*/gi, "")
    .trim()
    .slice(0, 300);
}

/**
 * Wraps a step call made from a tool. The step itself retries transient
 * failures; if it still fails, the shopper or employee gets an honest
 * "unavailable" result instead of a crashed conversation.
 */
export async function settle<T>(
  call: () => Promise<ToolResult<T>>,
): Promise<ToolResult<T>> {
  try {
    return await call();
  } catch {
    return failure(
      "unavailable",
      "The store service didn't respond after several attempts. Please try again shortly.",
    );
  }
}
