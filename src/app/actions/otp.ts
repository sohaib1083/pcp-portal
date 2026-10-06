"use server";
import { issueOtp } from "@/lib/otp";
import { getUser } from "@/lib/session";

/** Send a one-time code for a decision or payment. Returns the masked number and, in the demo, the code. */
export async function requestOtp(purpose: string) {
  const user = await getUser();
  if (!user) return { ok: false as const, message: "Sign in again." };
  const r = await issueOtp(user.username, purpose.slice(0, 120));
  return { ok: true as const, sentTo: r.sentTo, demoCode: r.demoCode, expiresAt: r.expiresAt };
}
