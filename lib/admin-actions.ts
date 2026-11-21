"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE_NAME, ADMIN_PASSWORD } from "./admin-auth";

const COOKIE_MAX_AGE = 60 * 60 * 24; // 1 day

// Scoped to "/" (not "/admin") so the admin agent's API routes under
// /api/admin also receive the session and can reject anonymous callers.
const COOKIE_PATH = "/";

export async function loginAction(formData: FormData): Promise<void> {
  const password = formData.get("password");
  if (typeof password !== "string" || password !== ADMIN_PASSWORD) {
    redirect("/admin/login?error=1");
  }
  const store = await cookies();
  store.set(ADMIN_COOKIE_NAME, ADMIN_PASSWORD, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
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
