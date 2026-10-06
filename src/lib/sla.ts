// Service levels (guide section 14): a time limit on every stage, a reminder to whoever holds the case
// when it passes its limit, then one escalation to the supervisor.
import { and, desc, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "./audit";
import { getRule } from "./rules";
import { notify } from "./util";
import { OPEN_STATUSES, STAGE_LABELS } from "./workflow";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

/** Used when the sla.stages rule is missing. Days per status. */
export const DEFAULT_SLA: Record<string, number> = {
  SUBMITTED: 3,
  UNDER_SCRUTINY: 14,
  DEFICIENCY_RAISED: 30,
  RESPONDED: 7,
  TECHNICAL_REVIEW: 14,
  INSPECTION_SCHEDULED: 7,
  INSPECTION_SUBMITTED: 7,
  COUNCIL_REVIEW: 30,
  APPROVED: 7,
  DEFERRED: 60,
};

/** An overdue case is escalated to the supervisor once it is this many days past its limit. */
export const ESCALATE_AFTER_DAYS = 3;

export async function slaDays(): Promise<Record<string, number>> {
  try {
    return { ...DEFAULT_SLA, ...(await getRule<Record<string, number>>("sla.stages")).value };
  } catch {
    return DEFAULT_SLA;
  }
}

const endOfDay = (d: string) => new Date(`${d}T23:59:59+05:00`);

/**
 * Clock fields for a case entering `status`. `until` is an exact due date (a deficiency deadline or a
 * deferral's return date); `base` is the date the stage's days count from (an inspection's visit date).
 */
export async function clockFor(status: string, o: { at?: Date; until?: string | null; base?: string | null } = {}) {
  const at = o.at ?? new Date();
  if (!STAGE_LABELS[status]) return { stageStartedAt: at, stageDueAt: null, escalatedAt: null };
  if (o.until) return { stageStartedAt: at, stageDueAt: endOfDay(o.until), escalatedAt: null };
  const days = (await slaDays())[status] ?? 14;
  const from = o.base ? endOfDay(o.base) : at;
  return { stageStartedAt: at, stageDueAt: new Date(from.getTime() + days * 86400000), escalatedAt: null };
}

/** Who must act (reminder) and who supervises them (escalation), per stage. */
async function owners(exec: Executor, app: typeof schema.applications.$inferSelect, instCode: string) {
  const officer = app.assignedOfficer ? `user:${app.assignedOfficer}` : "role:pcp_officer";
  switch (app.status) {
    case "SUBMITTED":
      return { assignee: "role:pcp_officer", supervisor: "role:pcp_secretary", who: "the case officers" };
    case "UNDER_SCRUTINY":
    case "RESPONDED":
    case "INSPECTION_SUBMITTED":
      return { assignee: officer, supervisor: "role:pcp_secretary", who: "the assigned officer" };
    case "TECHNICAL_REVIEW": {
      const review = await exec.query.technicalReviews.findFirst({ where: eq(schema.technicalReviews.applicationId, app.id) });
      return review
        ? { assignee: "role:pcp_coordinator", supervisor: "role:pcp_secretary", who: "the inspection coordinator" }
        : { assignee: officer, supervisor: "role:pcp_secretary", who: "the assigned officer" };
    }
    case "INSPECTION_SCHEDULED": {
      const insp = await exec.query.inspections.findFirst({ where: and(eq(schema.inspections.applicationId, app.id), eq(schema.inspections.status, "SCHEDULED")), orderBy: desc(schema.inspections.id) });
      return { assignee: insp ? `user:${insp.inspector}` : "role:pcp_coordinator", supervisor: "role:pcp_coordinator", who: "the inspection lead" };
    }
    case "COUNCIL_REVIEW":
    case "APPROVED":
      return { assignee: "role:pcp_secretary", supervisor: "role:pcp_admin", who: "the Secretary" };
    case "DEFICIENCY_RAISED":
    case "DEFERRED":
      return { assignee: `inst:${instCode}`, supervisor: officer, who: "the institution" };
    default:
      return null;
  }
}

/**
 * Reminders and escalations for every case past its stage limit. Idempotent: each reminder and escalation
 * is sent once per stage visit (sla_notices has a unique key), so the scheduler can run it as often as it likes.
 */
export async function runSlaChecks(now = new Date()) {
  const overdue = await db
    .select()
    .from(schema.applications)
    .where(and(inArray(schema.applications.status, OPEN_STATUSES), isNotNull(schema.applications.stageDueAt), isNotNull(schema.applications.stageStartedAt), lt(schema.applications.stageDueAt, now)));
  let reminders = 0;
  let escalations = 0;
  for (const app of overdue) {
    const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, app.institutionId) });
    if (!inst) continue;
    const o = await owners(db, app, inst.code);
    if (!o) continue;
    const days = Math.floor((now.getTime() - app.stageDueAt!.getTime()) / 86400000);
    const stage = STAGE_LABELS[app.status] ?? app.status;
    const isInst = o.assignee.startsWith("inst:");
    const link = isInst ? `/institution/applications/${app.ref}` : `/pcp/applications/${app.ref}`;
    await db.transaction(async (tx) => {
      const [r] = await tx
        .insert(schema.slaNotices)
        .values({ applicationId: app.id, status: app.status, stageStartedAt: app.stageStartedAt!, kind: "REMINDER", audience: o.assignee })
        .onConflictDoNothing()
        .returning();
      if (r) {
        reminders++;
        await notify(tx, o.assignee, `Overdue: ${app.ref} (${stage})`, `${stage} on ${app.ref} (${inst.shortCode}) passed its time limit on ${app.stageDueAt!.toISOString().slice(0, 10)}. Please act on it today.`, link);
        await audit(tx, { actor: "system", action: "sla.reminder", entity: "application", entityId: app.ref, details: { stage: app.status, to: o.assignee } });
      }
      if (days >= ESCALATE_AFTER_DAYS && !app.escalatedAt) {
        const [e] = await tx
          .insert(schema.slaNotices)
          .values({ applicationId: app.id, status: app.status, stageStartedAt: app.stageStartedAt!, kind: "ESCALATION", audience: o.supervisor })
          .onConflictDoNothing()
          .returning();
        if (e) {
          escalations++;
          await tx.update(schema.applications).set({ escalatedAt: now }).where(eq(schema.applications.id, app.id));
          await notify(tx, o.supervisor, `Escalated: ${app.ref} is ${days} days overdue`, `${stage} on ${app.ref} (${inst.name}) is ${days} days past its limit. It is with ${o.who}. A reminder was sent.`, `/pcp/applications/${app.ref}`);
          await audit(tx, { actor: "system", action: "sla.escalated", entity: "application", entityId: app.ref, details: { stage: app.status, to: o.supervisor, daysOverdue: days } });
        }
      }
    });
  }
  return { checked: overdue.length, reminders, escalations };
}
