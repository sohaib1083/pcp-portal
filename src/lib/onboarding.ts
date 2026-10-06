// Institution onboarding (guide section 3): reference lists, required documents and verification codes.
import { createHash, randomInt } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

// Used only if the rules table has no row yet (the onboarding seed adds them).
const FALLBACK: Record<string, string[]> = {
  "onboarding.requiredDocs": ["Registration or charter certificate", "Affiliation or HEC recognition letter", "Building ownership or lease", "Head of institution appointment letter"],
  "ref.provinces": ["Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan", "Islamabad Capital Territory", "Gilgit-Baltistan", "Azad Jammu and Kashmir"],
  "ref.universities": [],
};

/** A reference list or document list kept as a versioned rule (latest version wins). */
export async function ruleList(key: string, exec: Executor = db): Promise<string[]> {
  const row = await exec.query.rules.findFirst({ where: eq(schema.rules.key, key), orderBy: desc(schema.rules.version) });
  const v = row?.value;
  return Array.isArray(v) ? v.map(String) : (FALLBACK[key] ?? []);
}

export const requiredDocs = (exec: Executor = db) => ruleList("onboarding.requiredDocs", exec);

export function newCode() {
  return String(randomInt(100000, 1000000));
}

export function hashCode(ref: string, channel: "email" | "mobile", code: string) {
  return createHash("sha256").update(`${ref}:${channel}:${code.trim()}`).digest("hex");
}

export async function nextRegRef(exec: Executor) {
  const year = new Date().getFullYear();
  const res = await exec.execute(sql`select coalesce(max(substring(ref from 10)::int), 0) as n from onboarding_requests where ref like ${`REG-${year}-%`}`);
  const n = Number((res.rows[0] as { n: number }).n) + 1;
  return `REG-${year}-${String(n).padStart(4, "0")}`;
}

/** The next free Institution ID, e.g. PCP-UNI-000109. */
export async function nextInstitutionCode(exec: Executor) {
  const [{ max }] = await exec.select({ max: sql<number>`coalesce(max(substring(code from 9)::int), 100)` }).from(schema.institutions);
  return `PCP-UNI-${String(Number(max) + 1).padStart(6, "0")}`;
}

export async function logEvent(exec: Executor, requestId: number, fromStatus: string | null, toStatus: string, actor: string, note?: string | null) {
  await exec.insert(schema.onboardingEvents).values({ requestId, fromStatus, toStatus, actor, note: note ?? null });
}

/** Demo only: the codes most recently "sent" for a request, read back from the simulated outbox. */
export async function demoCodes(ref: string) {
  if (process.env.DEMO_MODE !== "1") return null;
  const rows = await db
    .select({ channel: schema.messages.channel, body: schema.messages.body })
    .from(schema.messages)
    .where(sql`${schema.messages.entity} = 'onboarding' and ${schema.messages.entityRef} = ${ref} and ${schema.messages.subject} ilike '%verification code%'`)
    .orderBy(desc(schema.messages.id))
    .limit(10);
  const find = (channel: string) => rows.find((r) => r.channel === channel)?.body.match(/\b(\d{6})\b/)?.[1] ?? null;
  return { email: find("EMAIL"), mobile: find("SMS") };
}
