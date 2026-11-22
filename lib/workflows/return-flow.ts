import { createWebhook, FatalError, sleep } from "workflow";
import {
  createReturn,
  getReturn,
  notifyReturnInProcess,
  preauthorizeRefund,
} from "@/lib/api";
import { isTransient } from "@/lib/agents/shared";
import type { ReturnRequest } from "@/lib/agents/shopping/types";

/*
 * Durable return processing, started by the shopping agent's `returnOrder`
 * tool. The chat confirms the return as soon as this workflow starts; the
 * work below runs in the background and survives restarts and deploys.
 *
 * Each side effect is its own step. Step results are persisted, so when a
 * later step fails and retries, earlier steps (the customer notification and
 * the refund pre-authorization) are never repeated.
 */

/** How often to re-check the store if its decision callback hasn't arrived. */
const STATUS_CHECK_INTERVAL = "1m";
/** The API decides within 5 minutes; stop polling well after that. */
const MAX_STATUS_CHECKS = 20;

export type ReturnOutcome = {
  orderId: string;
  returnId: string;
  preauthorizationId: string;
  decision: "approved" | "rejected" | "undecided";
  refundAmount: number | null;
  currency: string;
};

export async function returnOrderWorkflow(
  request: ReturnRequest,
): Promise<ReturnOutcome> {
  "use workflow";

  // 1. Tell the customer the return is in progress (runs exactly once).
  await notifyCustomerStep(request.orderId);

  // 2. Pre-authorize the refund (runs exactly once).
  const preauth = await preauthorizeRefundStep(request.orderId);

  // 3. File the return with a callback URL the store calls with its decision.
  using webhook = createWebhook();
  // Make sure the callback endpoint is registered before handing out its URL.
  await webhook.getConflict();
  const filed = await fileReturnStep({ ...request, callback: webhook.url });

  // 4. Wait for the decision. The callback is only a wake-up signal: anyone
  //    holding the URL could call it, so the decision itself is always read
  //    back from the store API. Polling covers a missed or blocked callback.
  const callbackArrived = webhook.then(() => "callback" as const);
  let decision: Awaited<ReturnType<typeof getReturnDecisionStep>> = {
    decision: null,
    refundAmount: null,
  };
  for (let check = 0; check < MAX_STATUS_CHECKS; check++) {
    decision = await getReturnDecisionStep(filed.returnId);
    if (decision.decision) break;
    await Promise.race([callbackArrived, sleep(STATUS_CHECK_INTERVAL)]);
  }

  const outcome: ReturnOutcome = {
    orderId: request.orderId,
    returnId: filed.returnId,
    preauthorizationId: preauth.id,
    decision: decision.decision ?? "undecided",
    refundAmount: decision.refundAmount,
    currency: preauth.currency,
  };

  // 5. Let the customer know the outcome.
  await notifyDecisionStep(outcome);
  return outcome;
}

async function notifyCustomerStep(orderId: string): Promise<void> {
  "use step";
  await notifyReturnInProcess(orderId);
}

async function preauthorizeRefundStep(
  orderId: string,
): Promise<{ id: string; amount: number; currency: string }> {
  "use step";
  try {
    const preauth = await preauthorizeRefund(orderId);
    return { id: preauth.id, amount: preauth.amount, currency: preauth.currency };
  } catch (error) {
    // Validation errors won't fix themselves; stop instead of retrying.
    if (!isTransient(error)) {
      throw new FatalError(`Refund pre-authorization rejected for order ${orderId}`);
    }
    throw error;
  }
}

/**
 * On Vercel, `webhook.url` points at this deployment's unique URL, which
 * Deployment Protection puts behind a login, so the store's callback would be
 * redirected and never arrive. In production, send it to the public production
 * domain instead; webhook tokens are resolved by the Workflow service, not by
 * a specific deployment. Elsewhere (local, protected previews) the status
 * polling below still delivers the decision.
 */
export function publicCallbackUrl(webhookUrl: string): string {
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (process.env.VERCEL_ENV !== "production" || !productionHost) return webhookUrl;
  const url = new URL(webhookUrl);
  return `https://${productionHost}${url.pathname}${url.search}`;
}

async function fileReturnStep(
  request: ReturnRequest & { callback: string },
): Promise<{ returnId: string }> {
  "use step";
  try {
    const created = await createReturn({
      ...request,
      callback: publicCallbackUrl(request.callback),
    });
    return { returnId: created.id };
  } catch (error) {
    if (!isTransient(error)) {
      throw new FatalError(`The store rejected the return for order ${request.orderId}`);
    }
    throw error;
  }
}

async function getReturnDecisionStep(returnId: string): Promise<{
  decision: "approved" | "rejected" | null;
  refundAmount: number | null;
}> {
  "use step";
  const current = await getReturn(returnId);
  return { decision: current.decision, refundAmount: current.refundAmount };
}

async function notifyDecisionStep(outcome: ReturnOutcome): Promise<void> {
  "use step";
  // In production this would email the customer via your provider.
  console.log(
    `[returnOrder] 📧 told customer the return for order ${outcome.orderId} was ${outcome.decision}`,
  );
}
