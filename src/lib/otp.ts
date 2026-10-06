// One-time codes for officers and for anyone submitting a decision or a payment (guide section 12).
// Demo: the code is "sent" by SMS to the outbox, and the confirmation dialog shows it so a presenter
// is never stuck. Production: SMS gateway or an authenticator app, never shown on screen.
import { createHash, randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { demoMobile, sendSms } from "./messages";

const hash = (code: string, salt: string) => createHash("sha256").update(`${salt}:${code}`).digest("hex");

export async function issueOtp(username: string, purpose: string) {
  const code = String(randomInt(100000, 1000000));
  const sentTo = demoMobile(username);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await db.insert(schema.otpChallenges).values({ username, purpose, codeHash: hash(code, `${username}:${purpose}`), sentTo, expiresAt });
  await sendSms(db, { to: sentTo, toName: username, body: `PCP one-time code: ${code}. It confirms: ${purpose}. Valid for 10 minutes. Do not share it.`, entity: "otp", entityRef: purpose, audience: `user:${username}` });
  const masked = sentTo.replace(/\d(?=\d{2})/g, (d, i: number) => (i > 6 ? "•" : d));
  return { sentTo: masked, demoCode: code, expiresAt: expiresAt.toISOString() };
}

/** True once per code: a used or expired code fails. */
export async function verifyOtp(username: string, purpose: string, code: string) {
  const row = await db.query.otpChallenges.findFirst({
    where: and(eq(schema.otpChallenges.username, username), eq(schema.otpChallenges.purpose, purpose), isNull(schema.otpChallenges.usedAt), gt(schema.otpChallenges.expiresAt, new Date())),
    orderBy: desc(schema.otpChallenges.id),
  });
  if (!row || row.codeHash !== hash(String(code ?? "").trim(), `${username}:${purpose}`)) return false;
  await db.update(schema.otpChallenges).set({ usedAt: new Date() }).where(eq(schema.otpChallenges.id, row.id));
  return true;
}

/** Throws unless the code is right. Use at the top of a server action that records a decision or a payment. */
export async function requireOtp(username: string, purpose: string, code: string | undefined | null) {
  if (process.env.STEP_UP_OTP === "off") return;
  if (!code || !(await verifyOtp(username, purpose, code))) throw new Error("The one-time code is missing, wrong or expired. Request a new code and try again.");
}
