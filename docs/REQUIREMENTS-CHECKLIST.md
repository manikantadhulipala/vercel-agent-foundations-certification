# Requirements checklist

Each requirement from the Store Agents assignment, with where it is implemented and how it is verified.

Verification key:
- **Code** — implemented in the source and covered by unit tests (`pnpm test`) or the type checker.
- **Prod e2e** — covered by a Playwright test that runs against the deployed site.
- **Not yet tested** — implemented, but not yet confirmed by an automated test or by hand in this review.

## Shopping agent

| Requirement | Implementation | Verified |
| --- | --- | --- |
| Storefront chat connected to an AI SDK agent | `components/agent-chat.tsx` → `POST /api/chat` → `lib/workflows/chat-flow.ts` | Prod e2e |
| Streaming responses and follow-up questions with context | `useDurableChat`, `WorkflowChatTransport`, history sent with each turn | Prod e2e (follow-up in refresh test) |
| Messages, assistant replies and tool results in one conversation | `components/chat/chat-panel.tsx` with AI Elements `Conversation`, `Message`, `PromptInput` | Prod e2e |
| Shopping behavior: focus on products and returns, redirect unrelated requests | `lib/agents/shopping/instructions.ts` | Not yet tested |
| `searchProducts` (text and category, browse full catalog) | `lib/agents/shopping/tools.ts` | Code |
| `getAllCategories` (categories from live data) | `lib/agents/shopping/tools.ts` | Code |
| `getProductDetails` (description, price, images, stock) | `lib/agents/shopping/tools.ts` | Code |
| `returnOrder` (look up order, notify, pre-authorize refund, file return) | `lib/workflows/return-flow.ts` | Code |
| Product results as browsable cards with links to product pages | `components/shopping/tool-views.tsx` | Prod e2e |
| Product details as richer content | `components/shopping/tool-views.tsx` | Not yet tested |
| Lookup progress and failure / missing-product states | `components/chat/tool-states.tsx`, `components/shopping/tool-views.tsx` | Not yet tested |
| Model and tool calls run as durable steps with retries | `WorkflowAgent`, step functions in `lib/agents/shopping/steps.ts` | Code |
| Returns run durably; chat confirms as soon as the workflow starts | `returnOrderWorkflow` started from the tool | Code |
| Completed actions are not repeated on retry | Each side effect is a separate step | Code |
| Reconnect after refresh or dropped connection without duplicate output | `GET /api/chat/[id]/stream`, `lib/agents/http.ts` | Prod e2e (refresh test) |

## Store admin agent

| Requirement | Implementation | Verified |
| --- | --- | --- |
| Admin chat at `/admin` connected to a separate AI SDK agent | `components/admin-agent-chat.tsx` → `POST /api/admin/chat` → `lib/workflows/admin-chat-flow.ts` | Prod e2e |
| Streaming, conversation context, starter prompts | `components/chat/chat-panel.tsx` (`persistentSuggestions`) | Prod e2e |
| Separate agent, tools, endpoint, workflow and history from shopping | Separate files under `lib/agents/admin/` and `lib/workflows/admin-chat-flow.ts` | Code |
| Admin API requires the admin session | 401 for signed-out requests | Prod e2e |
| Read-only store access; never changes inventory, tickets or refunds | Admin tools only call read endpoints in `lib/api.ts` | Code |
| `getSupportTickets` with date, status, priority, category, assignee and limit filters | `lib/agents/admin/tools.ts` | Code |
| `getReturnsHistory` with date, status, decision and limit filters, plus order and refund info | `lib/agents/admin/tools.ts` | Code |
| `getInventoryStock` with product, low-stock and availability filters, paginated | `lib/agents/admin/tools.ts` | Code |
| `getSalesAnalytics` for a date range, filterable by product | `lib/agents/admin/tools.ts` | Code |
| Catalog context via `searchProducts` and `getAllCategories` | `lib/agents/admin/tools.ts` | Code |
| Admin model and tool calls run as durable workflow steps | `WorkflowAgent` in `lib/workflows/admin-chat-flow.ts` | Code |
| `bash` tool runs in Vercel Sandbox, admin only | `lib/agents/admin/tools.ts`, `lib/agents/admin/sandbox.ts` | Code |
| Aggregates and joins computed in the sandbox | Data saved as JSON files; the model runs Python in the sandbox | E2e (admin test: inventory + sales joined in the sandbox) |
| Sandbox has no outbound network access and no credentials | `networkPolicy: "deny-all"` in `lib/agents/admin/sandbox.ts` | Code |
| Command activity, output, running and failure states shown in chat | `components/admin/tool-views.tsx` | Prod e2e (admin test, after the admin run) |
| Memory stored as a file in the admin sandbox | `saveMemory` appends to `/vercel/memory/admin-memory.md` (`MEMORY_FILE` in `sandbox.ts`) | Code |
| Memory read at the start of each admin conversation and given to the agent | `loadMemoryStep` in the admin workflow | Code |
| Memory can be added to by the agent | `saveMemory` tool | Code |
| Saved context reused in new conversations; no memory is handled | Covered by the memory step; a new chat with no memory file works normally | Not yet tested |
| Answers name products, numbers and date ranges; money formatted; assumptions explained | `lib/agents/admin/instructions.ts` | Not yet tested |

## Shared requirements

| Requirement | Implementation | Verified |
| --- | --- | --- |
| Starter application extended, storefront and admin access control kept working | Changes are additive; `app/`, `lib/api.ts` unchanged in behavior | Prod e2e (storefront and admin tests) |
| AI SDK for both agents, AI Elements for both chat UIs | `ai`, `@ai-sdk/*`, `components/ai-elements/` | Code |
| Model calls through Vercel AI Gateway, any provider with tool use | `lib/agents/shared.ts` (`AI_MODEL`, default `openai/gpt-5-mini`) | Code |
| Desktop and mobile responsive, accessible controls | AI Elements and shadcn/ui components; axe scan in the e2e suite | Prod e2e (accessibility tests) on desktop and phone viewports |
| Tool inputs validated; invalid requests, missing records and empty results handled | Zod schemas on every tool; `{ ok: false, reason, message }` results | Code and unit tests |
| Service failures are not reported as success | Permanent errors return `ok: false`; transient errors retry, then the chat shows a retry notice | Code |
| Credentials stay on the server; never in tool results or chat messages | `lib/api.ts` (server only), error sanitizing in `lib/agents/shared.ts` | Code and unit tests |
| No `NEXT_PUBLIC_` secrets; `.env*` ignored by git | `.gitignore`, no `NEXT_PUBLIC_` variables in source | Code |
| Repository includes setup instructions and env variable names without values | `README.md`, `.env.example` | Not yet tested |

## Browser coverage

The end-to-end suite (`pnpm test:e2e`) runs against the deployed site in:

| Project | Browser engine | Device |
| --- | --- | --- |
| `desktop-chrome` | Chromium | Desktop Chrome |
| `desktop-firefox` | Firefox | Desktop Firefox |
| `desktop-safari` | WebKit | Desktop Safari |
| `iphone-safari` | WebKit | iPhone 15 viewport |
| `android-chrome` | Chromium | Pixel 7 viewport |

Last full run (production build of this branch, `E2E_BASE_URL=http://localhost:3300`, `--retries=0`): **35 passed, 0 failed, 0 flaky** of 35.

| Test | Chrome | Firefox | Safari | iPhone | Android |
| --- | --- | --- | --- | --- | --- |
| Storefront loads and the shopping chat opens | Pass | Pass | Pass | Pass | Pass |
| Shopping agent answers with product cards | Pass | Pass | Pass | Pass | Pass |
| Refresh mid-reply reconnects without duplicates | Pass | Pass | Pass | Pass | Pass |
| Admin area protected when signed out (redirect and 401) | Pass | Pass | Pass | Pass | Pass |
| Storefront and chat accessibility (axe, WCAG 2 A/AA) | Pass | Pass | Pass | Pass | Pass |
| Admin wrong password rejected | Pass | Pass | Pass | Pass | Pass |
| Admin computes in the sandbox, accessibility, sign-out locks the area | Pass | Pass | Pass | Pass | Pass |

Fixed in this change, found by the suite:
- Safari and iPhone: a reload during a reply lost the run id, because WebKit reports the cancelled stream as an error before unloading. The run id is now kept while the run is unfinished.
- Safari over plain HTTP (local runs): the admin cookie was marked `Secure` and dropped. It is now `Secure` only on HTTPS and always on Vercel.
- Admin: the saved dataset key now matches the tool result (`rows`), and the agent is told that a preview is partial, so it computes from the full file instead of reporting missing items as zero.
- Accessibility: labelled copy button, keyboard-scrollable command output and suggestions, and readable stderr and status colors on the dark terminal.

These engines cover what the browsers do; they do not cover every device or network in the world. Real-device checks on physical phones are still recommended before a final demo.
