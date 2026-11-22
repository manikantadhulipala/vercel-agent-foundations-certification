"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE_NAME, ADMIN_PASSWORD } from "./admin-auth";

const COOKIE_MAX_AGE = 60 * 60 * 24; // 1 day

// Scoped to "/" (not "/admin") so the admin agent's API routes under
// /api/admin also receive the session and can reject anonymous callers.
const COOKIE_PATH = "/";

/**
 * `Secure` cookies are only sent over HTTPS. Vercel always serves HTTPS; a
 * local production build (`pnpm start`) is plain HTTP, where Safari would
 * drop a Secure cookie and sign-in would silently fail.
 */
async function isHttpsRequest(): Promise<boolean> {
  if (process.env.VERCEL) return true;
  const proto = (await headers()).get("x-forwarded-proto") ?? "";
  return proto.split(",")[0].trim() === "https";
}

export async function loginAction(formData: FormData): Promise<void> {
  const password = formData.get("password");
  if (typeof password !== "string" || password !== ADMIN_PASSWORD) {
    redirect("/admin/login?error=1");
  }
  const store = await cookies();
  store.set(ADMIN_COOKIE_NAME, ADMIN_PASSWORD, {
    httpOnly: true,
    sameSite: "lax",
    secure: await isHttpsRequest(),
    maxAge: COOKIE_MAX_AGE,
    path: COOKIE_PATH,
  });
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  // One deletion per cookie name: Next.js keeps a single Set-Cookie per name,
  // so a second delete (e.g. for an old path) would cancel this one.
  store.delete({ name: ADMIN_COOKIE_NAME, path: COOKIE_PATH });
  redirect("/admin/login");
}
