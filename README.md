# Ship It Shop — Store Agents

Two AI agents for the Vercel Ship Shop, built for the **Vercel Agent Foundations Certification**:

- **Shopping agent** (storefront chat, robot icon in the header) helps customers discover products, inspect items, and file returns.
- **Store admin agent** (`/admin`) helps employees investigate support, returns, inventory and sales, computes results in Vercel Sandbox, and remembers context between conversations.

Both use the **AI SDK** with **AI Elements**, run as **durable Vercel Workflows**, and route model calls through **Vercel AI Gateway**.

**Live:** https://vercel-agent-foundations-certificat-tan-eight.vercel.app · Admin: `/admin`

---

## How the requirements are met

### Shopping agent

| Requirement | Implementation |
| --- | --- |
| Chat integration | `components/agent-chat.tsx` → `POST /api/chat` → `shoppingChatWorkflow` (`lib/workflows/chat-flow.ts`). Streaming replies, full conversation context on follow-ups. |
| Tools | `searchProducts`, `getAllCategories`, `getProductDetails`, `returnOrder` in `lib/agents/shopping/tools.ts`, each validated with Zod and backed by a durable step (`steps.ts`). Categories are validated against live store data, never a fixed list. |
| Shopping behavior | Instructions (`instructions.ts`) keep the agent on products and returns, require tools for facts, and redirect unrelated requests. |
| Generative UI | Product results render as browsable cards (image, name, formatted price, link to the existing product page); details render as a richer card with gallery, live stock, tags; returns render as a confirmation. Lookup progress and failures have their own states (`components/shopping/tool-views.tsx`). |
| Durable returns | `returnOrderWorkflow` (`lib/workflows/return-flow.ts`): notify customer → pre-authorize refund → file return, each a separate step, so a retry never repeats a completed action. The chat confirms as soon as the workflow starts. The store's decision arrives on a `createWebhook()` callback; it's verified by re-reading the return from the API (the callback URL is a bearer token), with polling as a fallback. |
| Model & tool resilience | Every model call and tool execution runs as a workflow step (`WorkflowAgent`). Transient API failures (network, 429, 5xx) are thrown and retried; permanent ones (404, validation) return `{ ok: false, reason, message }` so the agent explains them instead of inventing results. |
| Chat recovery | `useDurableChat` (`components/chat/use-durable-chat.ts`) persists the conversation and the in-flight run id; after a refresh or dropped connection `WorkflowChatTransport` reconnects to `GET /api/chat/[id]/stream` and finishes the same reply once. |

### Store admin agent

| Requirement | Implementation |
| --- | --- |
| Admin chat integration | `components/admin-agent-chat.tsx` → `POST /api/admin/chat` → `adminChatWorkflow`. Streaming, conversation context, starter prompts for operational questions. |
| Separation | Separate agent, tools, endpoint, workflow and chat history. Admin API routes require the admin session (401 otherwise); the shopping stream endpoint refuses to replay non-shopping runs. |
| Back-office tools | `getSupportTickets`, `getReturnsHistory`, `getInventoryStock`, `getSalesAnalytics` support every filter and the result metadata of the starter's API helpers; `searchProducts` / `getAllCategories` provide catalog context. All store access is read-only. |
| Sandbox computation | Each data read saves its full dataset as JSON in the admin sandbox and tells the model the file path and field names. A `bash` tool runs commands (typically short Python scripts) there for aggregates and joins, e.g. return rates per product or low-stock top sellers. Command, output, running and failure states show in the chat. |
| Isolation | One named, persistent Vercel Sandbox per environment with **all outbound network access denied**. No credentials are passed into it. |
| Persistent memory | `saveMemory` appends preferences, corrections and business context to `/vercel/memory/admin-memory.md` in that same sandbox. The app reads the file at the start of every admin conversation (`loadMemoryStep`) and adds it to the agent's instructions. A new conversation with no memory works normally. |
| Durable admin runs | Same `WorkflowAgent` + resumable stream pattern as the shopping chat. Near the step limit tools are disabled so every turn ends with an answer. |

### Shared

- **Secrets** stay server-side: the store API access value is only read in `lib/api.ts` (server), never sent to the sandbox, the model, tool results or the browser. Error messages are sanitized before they reach a chat. Admin and agent instructions refuse to disclose credentials.
- **Responsive and accessible:** both chats work on desktop and mobile, with labelled inputs and buttons, `role="status"` progress, alt text, and keyboard-reachable product links.
- **Validation:** chat requests are size-limited, validated with `safeValidateUIMessages`, and `system` messages from the browser are dropped.

## Architecture

```
Browser (useChat + WorkflowChatTransport, history in localStorage)
   │  POST /api/chat | /api/admin/chat         GET …/[runId]/stream  (reconnect)
   ▼
Route handler ── start(workflow) ──► Vercel Workflow run (durable)
                                      └─ WorkflowAgent
                                          ├─ model call steps  ──► AI Gateway
                                          └─ tool steps ──► Store API (lib/api.ts)
                                                         └─► Vercel Sandbox (admin only)
returnOrder tool ── start(returnOrderWorkflow) ─► notify → preauthorize → file
                                                   → webhook / poll → verify → notify
```

Each user message starts one workflow run (single-turn pattern): the browser owns the history, every turn runs on the latest deployment, and the run's persisted output stream makes the reply resumable.

## Setup

**Prerequisites:** Node.js 22+ (LTS), pnpm, a Vercel account, and the Vercel CLI (`npm i -g vercel`).

```bash
pnpm install
vercel link                    # select this project
vercel env pull .env.local     # BYPASS_SECRET, API_BASE_URL, VERCEL_OIDC_TOKEN
pnpm dev
```

Open http://localhost:3000. The shopping chat is the robot icon in the header. The admin agent is at `/admin` (demo password: `letmeinadminagent`).

`VERCEL_OIDC_TOKEN` authenticates both AI Gateway and Vercel Sandbox locally and expires after about 12 hours. Rerun `vercel env pull .env.local` when model or sandbox calls start failing with an auth error. On Vercel, OIDC is automatic.

Inspect workflow runs locally with `npx workflow web`, or in production under **Observability → Workflows** in the Vercel dashboard.

## Environment variables

See `.env.example`. Never commit real values.

| Variable | Required | Description |
| --- | --- | --- |
| `BYPASS_SECRET` | Yes | Store API deployment-protection bypass value, prefilled by the Deploy button. Server-only. |
| `API_BASE_URL` | No | Store API base URL. Defaults to `https://vercel-agentic-swag-store-api.vercel.app/api`. |
| `VERCEL_OIDC_TOKEN` | Local dev | AI Gateway and Sandbox auth, written by `vercel env pull`. Automatic on Vercel. |
| `AI_GATEWAY_API_KEY` | No | Alternative AI Gateway credential instead of OIDC. |
| `AI_MODEL` | No | AI Gateway model for both agents. Default `openai/gpt-5-mini`; any model with tool calling works. |
| `ADMIN_SANDBOX_NAME` | No | Name of the admin agent's persistent sandbox. Default `ship-it-shop-admin-<VERCEL_ENV>`, so development and production keep separate memory. |
| `NEXT_PUBLIC_SITE_URL` | No | Public site URL for metadata. |

## Try it

**Shopping chat**
- "What categories do you have?" → category chips from live data
- "Show me hoodies" → product cards; then "Tell me more about it" → details card
- "I'd like to return order 11111" → asks for a reason → files the return and confirms immediately
- Orders `11111`–`33333` are returnable; `44444` (paid) and `55555` (cancelled) are refused with an explanation; `99999` doesn't exist
- Refresh the page while a reply streams: it reconnects and finishes without duplicates

**Admin chat** (`/admin`)
- "Which products have the highest return rates this month?" → returns + sales joined in the sandbox
- "Which low-stock items are top sellers?" → inventory + sales joined in the sandbox
- "Remember: show revenue in thousands like $12.3k, and our weeks start on Sunday" → then, in a **new chat**, "Summarize this week's revenue"

## Project structure

```
app/api/chat/route.ts                   shopping agent endpoint
app/api/chat/[id]/stream/route.ts       shopping reconnect endpoint
app/api/admin/chat/…                    admin endpoints (admin session required)
lib/agents/shared.ts                    tool result types, error mapping, model config
lib/agents/http.ts                      request validation, run streaming and resume
lib/agents/shopping/                    shopping tools, steps, instructions, types
lib/agents/admin/                       admin tools, steps, sandbox, instructions
lib/workflows/chat-flow.ts              shopping chat workflow
lib/workflows/admin-chat-flow.ts        admin chat workflow
lib/workflows/return-flow.ts            durable return workflow
components/chat/                        shared ChatPanel, useDurableChat, tool states
components/shopping/tool-views.tsx      shopping generative UI
components/admin/tool-views.tsx         admin data, sandbox and memory views
```

## Notes and limitations

- **Return decisions locally:** the store calls the webhook at the deployment URL. On `localhost` it can't reach your machine, so the workflow falls back to polling the return status every minute.
- **Resumable streams** replay the run from the start on the server and skip the chunks the browser already rendered, because the run stores raw model parts while the browser counts UI chunks. This keeps resumed replies exact.
- **Admin auth** is the template's demo cookie gate. It now also protects the admin API routes; real deployments should replace it with proper authentication.
- **Model:** `openai/gpt-5-mini` is used because it's available on AI Gateway's free tier with reliable tool calling. Set `AI_MODEL` to change it.
