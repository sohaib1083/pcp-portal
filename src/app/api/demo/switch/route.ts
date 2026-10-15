import { AuthError } from "next-auth";
import { NextResponse } from "next/server";
import { signIn } from "@/lib/auth";
import { quickLoginEnabled } from "@/lib/demo";

/**
 * Demo build only: switch persona with a plain form POST (a full page load), so the presenter guide
 * never races the router refreshing a page the new persona may not open.
 * With DEMO_MODE on, a sign-in through this switch counts as having passed the officer sign-in code
 * (see officerCodeSatisfied in src/lib/officer-code.ts), so switching to a PCP or provincial officer
 * opens their workspace directly. A real Keycloak sign-in still asks for the code.
 */
export async function POST(req: Request) {
  if (!quickLoginEnabled()) return new Response("Not found", { status: 404 });
  const base = process.env.PUBLIC_BASE_URL ?? "http://localhost:8088";
  const form = await req.formData();
  const username = String(form.get("username") ?? "");
  const next = String(form.get("next") ?? "");
  const redirectTo = next.startsWith("/") && !next.startsWith("//") ? next : "/home";
  try {
    // Sets the session cookie on this response; 303 turns the POST into a GET of the target page.
    await signIn("demo", { username, redirect: false });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.redirect(new URL(`/login?error=quick&u=${encodeURIComponent(username)}`, base), 303);
    throw e;
  }
  return NextResponse.redirect(new URL(redirectTo, base), 303);
}
