import "server-only";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, ADMIN_PASSWORD } from "./admin-auth";

/**
 * Server-side check for the demo admin session. `proxy.ts` guards the /admin
 * pages; API routes call this directly and answer 401 instead of redirecting.
 */
export async function hasAdminSession(): Promise<boolean> {
  const store = await cookies();
  return store.get(ADMIN_COOKIE_NAME)?.value === ADMIN_PASSWORD;
}

export function unauthorized(): Response {
  return Response.json({ error: "Admin sign-in required." }, { status: 401 });
}
