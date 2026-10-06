import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// Route protection for every request (Next.js 16 "proxy", formerly middleware):
// 1. signed-out users are sent to /login for any protected page
// 2. institution users stay in /institution, PCP users stay in /pcp
// 3. protected pages are never cached, so Back after sign-out cannot show them
// The proxy only READS the session token. It never re-issues the cookie, which would undo sign-out.
const PROTECTED = /^\/(institution|pcp|certificate|home|student|pharmacist|onboarding)(\/|$)/;
// Each area belongs to one kind of user (see HOME_BY_KIND in lib/roles.ts).
const AREAS: [prefix: string, allowed: (roles: string[]) => boolean][] = [
  ["/pcp", (r) => r.some((x) => x.startsWith("pcp_"))],
  ["/institution", (r) => r.some((x) => x.startsWith("inst_") && x !== "inst_applicant")],
  ["/student", (r) => r.includes("student")],
  ["/pharmacist", (r) => r.includes("pharmacist")],
  ["/onboarding", (r) => r.includes("inst_applicant")],
];

export default async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isProtected = PROTECTED.test(pathname);
  // Behind a TLS-terminating proxy or tunnel the app sees plain http, so also trust the forwarded scheme
  // and AUTH_URL; otherwise Auth.js's __Secure- session cookie would be looked up under the wrong name.
  const secure =
    req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https" || (process.env.AUTH_URL ?? "").startsWith("https://");
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET!,
    secureCookie: secure,
    salt: secure ? "__Secure-authjs.session-token" : "authjs.session-token",
  });
  const username = token?.username as string | undefined;

  if (!username) {
    if (!isProtected) return NextResponse.next();
    const url = new URL("/login", req.nextUrl);
    const params = new URLSearchParams(search);
    params.delete("_rsc"); // Next.js internal cache-buster, not part of the page address
    const qs = params.toString();
    url.searchParams.set("next", pathname + (qs ? `?${qs}` : ""));
    return NextResponse.redirect(url);
  }

  const roles = (token?.roles as string[] | undefined) ?? [];
  for (const [prefix, allowed] of AREAS) {
    if ((pathname === prefix || pathname.startsWith(prefix + "/")) && !allowed(roles)) return NextResponse.redirect(new URL("/home", req.nextUrl));
  }

  const res = NextResponse.next();
  if (isProtected) {
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.headers.set("Pragma", "no-cache");
  }
  return res;
}

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
