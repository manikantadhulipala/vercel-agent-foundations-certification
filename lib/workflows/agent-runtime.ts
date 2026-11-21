/*
 * Shared runtime settings for both agent workflows.
 */

/**
 * Retries per model call. The AI SDK backs off 2s, 4s, 8s… and only honors a
 * gateway "retry after" under 60s, so six retries (~2 minutes in total) are
 * enough to outlast a per-minute rate-limit window instead of failing the turn.
 */
export const MODEL_MAX_RETRIES = 6;
