// Two-step sign-in for officers (RFP 4.1.3, 4.1.16: "a password and a one-time code for officers").
// After Keycloak sign-in, a PCP officer (any pcp_* role) or a provincial council officer enters a one-time
// code before any /pcp or /province page opens. The code is sent by SMS (simulated: src/lib/otp.ts).
//
// The "verified" flag is a signed, httpOnly cookie bound to this sign-in: it carries an HMAC of the username
// and the Keycloak session id (`sid` in the id token), so it is worthless after sign-out, for another user,
// or for a later sign-in. It expires with the 8-hour app session.
//
// Switch it off with OFFICER_SIGNIN_CODE=off (for example while an SMS gateway is down).
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";

export const OFFICER_CODE_COOKIE = "pcp_officer_code";
export const OFFICER_CODE_PURPOSE = "sign-in";
const MAX_AGE = 8 * 60 * 60; // the app session's maxAge (src/lib/auth.ts)

export const officerCodeEnabled = () => (process.env.OFFICER_SIGNIN_CODE ?? "on").toLowerCase() !== "off";

/** PCP officers and provincial council officers need the code; institutions, students, faculty and pharmacists do not. */
export const needsOfficerCode = (roles: string[]) => roles.some((r) => r.startsWith("pcp_")) || roles.includes("provincial_council");

type SignIn = { username: string; sid: string; demoClient: boolean };

/** The current sign-in: username, Keycloak session id and whether it came through the demo client. */
async function currentSignIn(): Promise<SignIn | null> {
  const session = await auth();
  const username = session?.user?.username;
  if (!username) return null;
  let claims: Record<string, unknown> = {};
  try {
    if (session.idToken) claims = JSON.parse(Buffer.from(session.idToken.split(".")[1], "base64url").toString("utf8"));
  } catch {
    claims = {};
  }
  const sid = String(claims.sid ?? claims.session_state ?? claims.iat ?? "");
  const demoClient = !!process.env.KEYCLOAK_DEMO_CLIENT_ID && claims.azp === process.env.KEYCLOAK_DEMO_CLIENT_ID;
  return { username, sid, demoClient };
}

const sign = (s: SignIn, exp: number) => createHmac("sha256", process.env.AUTH_SECRET ?? "pcp-demo").update(`${s.username}|${s.sid}|${exp}`).digest("base64url");

function valid(value: string | undefined, s: SignIn) {
  if (!value || !s.sid) return false;
  const [expText, mac] = value.split(".");
  const exp = Number(expText);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now() || !mac) return false;
  const want = Buffer.from(sign(s, exp));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** True when this sign-in has passed the officer code (or does not need it). */
export async function officerCodeSatisfied(roles: string[]) {
  if (!officerCodeEnabled() || !needsOfficerCode(roles)) return true;
  const s = await currentSignIn();
  if (!s) return false;
  // Demo build only: the presenter's quick switch (/api/demo/switch) and the "Enter as ..." buttons sign in through
  // the separate demo client, and with DEMO_MODE on that sign-in counts as code-verified, so switching persona never
  // stops at the code screen. A real Keycloak sign-in always asks for the code.
  if (s.demoClient && process.env.DEMO_MODE === "1") return true;
  return valid((await cookies()).get(OFFICER_CODE_COOKIE)?.value, s);
}

/**
 * Call at the top of the /pcp and /province layouts, after the user check. Sends an officer who has not entered
 * the code for this sign-in to the code screen; `area` is where they return afterwards.
 */
export async function requireOfficerCode(roles: string[], area: "/pcp" | "/province") {
  if (await officerCodeSatisfied(roles)) return;
  redirect(`/login/code?next=${encodeURIComponent(area)}`);
}

/** Remember the code for this sign-in. Only from a server action or route handler, after the code was checked. */
export async function rememberOfficerCode() {
  const s = await currentSignIn();
  if (!s?.sid) return false;
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const secure = (process.env.AUTH_URL ?? process.env.PUBLIC_BASE_URL ?? "").startsWith("https://");
  (await cookies()).set(OFFICER_CODE_COOKIE, `${exp}.${sign(s, exp)}`, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: MAX_AGE });
  return true;
}
