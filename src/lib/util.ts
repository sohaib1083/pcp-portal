import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { emailAudience } from "./messages";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

/**
 * In-app notification plus the matching email (simulated, stored in the outbox).
 * Email and a dashboard alert fire together; every message is stored on the case (guide section 12).
 */
export async function notify(exec: Executor, audience: string, title: string, body: string, link?: string) {
  await exec.insert(schema.notifications).values({ audience, title, body, link });
  await emailAudience(exec, audience, title, body, link);
}

export async function nextRef(exec: Executor, prefix: string, table: "applications" | "deficiencies", pad: number) {
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const res =
    table === "applications"
      ? await exec.execute(sql`select count(*)::int as n from applications where ref like ${like}`)
      : await exec.execute(sql`select count(*)::int as n from deficiencies where ref like ${like}`);
  const n = Number((res.rows[0] as { n: number }).n) + 1;
  return `${prefix}-${year}-${String(n).padStart(pad, "0")}`;
}

export function psidFor(appId: number) {
  // Demo PSID: 17 digits. A real PSID comes from the sponsor bank / 1Link.
  return `2026${String(appId).padStart(5, "0")}${String((appId * 7919) % 100000000).padStart(8, "0")}`;
}

export { formatPKR, daysUntil } from "./format";

export function iso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}
