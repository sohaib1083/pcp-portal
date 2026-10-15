// Super administrator overrides and administrative holds (RFP 4.1.2 "global overrides"). Shared server helpers:
// no Next.js imports, so the seed and the workflow actions can use them.
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | Tx;

export { OVERRIDE_AUDIT, OVERRIDE_LABELS, REOPEN_FROM, REOPEN_TO } from "./overrides-shared";

/** Only the Super Administrator overrides. roles.ts has no override permission of its own; user management is pcp_admin's alone. */
export const OVERRIDE_PERMISSION = "pcp.users.manage" as const;

/** The open hold on a case, if any. */
export async function activeHold(exec: Executor, applicationId: number) {
  const [h] = await exec
    .select()
    .from(schema.caseHolds)
    .where(and(eq(schema.caseHolds.applicationId, applicationId), isNull(schema.caseHolds.releasedAt)))
    .orderBy(desc(schema.caseHolds.id))
    .limit(1);
  return h ?? null;
}

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Karachi" });

/** Throws while the case is on administrative hold: no workflow step can be taken, on either side. */
export async function assertNotOnHold(exec: Executor, applicationId: number) {
  const h = await activeHold(exec, applicationId);
  if (!h) return;
  const app = await exec.query.applications.findFirst({ where: eq(schema.applications.id, applicationId), columns: { ref: true } });
  throw new Error(`${app?.ref ?? "This case"} is on administrative hold since ${day(h.placedAt)}. No step can be taken until the super administrator releases the hold.`);
}

/** Next override reference, OVR-<year>-0001 (highest number + 1). */
export async function nextOverrideRef(exec: Executor, year = new Date().getFullYear()) {
  if (exec !== db) await exec.execute(sql`select pg_advisory_xact_lock(hashtext('ref:case_overrides'))`);
  const res = await exec.execute(sql`select coalesce(max(nullif(regexp_replace(ref, '^.*-', ''), '')::int), 0) as n from case_overrides where ref like ${`OVR-${year}-%`}`);
  return `OVR-${year}-${String(Number((res.rows[0] as { n: number }).n) + 1).padStart(4, "0")}`;
}
