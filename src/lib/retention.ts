// Retention rules (guide section 14, "Retention rules: academic and regulatory records are kept; temporary
// drafts are cleared on a set schedule"). The schedule lives in the `retention.policy` reference rule.
//
// What is cleared:
//   - draft applications nobody touched for N days (deleted with their draft history and draft faculty links)
//   - institution onboarding drafts that were never submitted and not touched for N days
//   - one-time codes more than N days past their expiry
//   - unpaid challans older than N days: CANCELLED, never deleted, so the PSID can no longer be paid
// What is never touched: submitted or decided cases and requests, documents, the audit log, payments other than
// cancelling an unpaid challan, and messages. A draft with a document or a challan attached is kept and listed.
//
// The daily scheduler calls runRetention() (one line in the scheduler); the Super administrator can preview it
// and run it by hand from Users & institutions > Retention.
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "./audit";
import { getRule } from "./rules";
import { notify } from "./util";

export type RetentionPolicy = {
  draftApplicationDays: number;
  onboardingDraftDays: number;
  expiredCodeDays: number;
  unpaidChallanDays: number;
};
export const RETENTION_RULE = "retention.policy";
export const DEFAULT_RETENTION: RetentionPolicy = { draftApplicationDays: 90, onboardingDraftDays: 90, expiredCodeDays: 1, unpaidChallanDays: 30 };

export type RetentionCategory = "draftApplications" | "onboardingDrafts" | "expiredCodes" | "unpaidChallans";
export const CATEGORY_LABELS: Record<RetentionCategory, string> = {
  draftApplications: "Draft applications",
  onboardingDrafts: "Onboarding drafts never submitted",
  expiredCodes: "Expired one-time codes",
  unpaidChallans: "Unpaid challans (cancelled, not deleted)",
};

export type RetentionItem = { category: RetentionCategory; ref: string; what: string };
export type RetentionPlan = {
  policy: RetentionPolicy;
  version: number | null;
  items: RetentionItem[];
  kept: { category: RetentionCategory; ref: string; why: string }[];
  counts: Record<RetentionCategory, number>;
  ids: { apps: number[]; onboarding: number[]; codes: number[]; challans: number[] };
};
export type RetentionSummary = {
  runId: number;
  dryRun: boolean;
  counts: Record<RetentionCategory, number>;
  items: RetentionItem[];
  kept: RetentionPlan["kept"];
  message: string;
};

const DAY = 86400000;
const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const ago = (d: Date, now: Date) => Math.floor((now.getTime() - d.getTime()) / DAY);
const PROG: Record<string, string> = { PHARMD: "PharmD", TECH: "Pharmacy Technician", MPHIL: "MS/MPhil", PHD: "PhD" };

/** The policy in force (the latest version of the rule), or the defaults when the rule is missing. */
export async function retentionPolicy(): Promise<{ value: RetentionPolicy; version: number | null }> {
  try {
    const r = await getRule<Partial<RetentionPolicy>>(RETENTION_RULE);
    return { value: { ...DEFAULT_RETENTION, ...r.value }, version: r.version };
  } catch {
    return { value: DEFAULT_RETENTION, version: null };
  }
}

/** What a run would clear now. Reads only. */
export async function planRetention(now = new Date()): Promise<RetentionPlan> {
  const { value: policy, version } = await retentionPolicy();
  const before = (days: number) => new Date(now.getTime() - days * DAY);
  const items: RetentionItem[] = [];
  const kept: RetentionPlan["kept"] = [];
  const ids: RetentionPlan["ids"] = { apps: [], onboarding: [], codes: [], challans: [] };

  // 1. Draft applications nobody touched.
  const drafts = await db
    .select({ a: schema.applications, code: schema.institutions.shortCode })
    .from(schema.applications)
    .innerJoin(schema.institutions, eq(schema.institutions.id, schema.applications.institutionId))
    .where(and(eq(schema.applications.status, "DRAFT"), isNull(schema.applications.submittedAt), lt(schema.applications.updatedAt, before(policy.draftApplicationDays))))
    .orderBy(schema.applications.updatedAt);
  if (drafts.length) {
    const draftIds = drafts.map((d) => d.a.id);
    const withDocs = new Set((await db.select({ id: schema.documents.applicationId }).from(schema.documents).where(inArray(schema.documents.applicationId, draftIds))).map((r) => r.id));
    const withPay = new Set((await db.select({ id: schema.payments.applicationId }).from(schema.payments).where(inArray(schema.payments.applicationId, draftIds))).map((r) => r.id));
    for (const { a, code } of drafts) {
      const label = `Draft ${a.kind === "NOC" ? "NOC" : a.kind.toLowerCase()} for ${PROG[a.programType] ?? a.programType}, ${code}: untouched since ${day(a.updatedAt)} (${ago(a.updatedAt, now)} days)`;
      if (withDocs.has(a.id)) kept.push({ category: "draftApplications", ref: a.ref, why: `${label}. Kept: documents are attached, and documents are never cleared.` });
      else if (withPay.has(a.id)) kept.push({ category: "draftApplications", ref: a.ref, why: `${label}. Kept: a fee challan was issued for it.` });
      else {
        items.push({ category: "draftApplications", ref: a.ref, what: label });
        ids.apps.push(a.id);
      }
    }
  }

  // 2. Onboarding drafts that were never submitted.
  const onb = await db
    .select()
    .from(schema.onboardingRequests)
    .where(and(eq(schema.onboardingRequests.status, "DRAFT"), isNull(schema.onboardingRequests.submittedAt), lt(schema.onboardingRequests.updatedAt, before(policy.onboardingDraftDays))))
    .orderBy(schema.onboardingRequests.updatedAt);
  if (onb.length) {
    const onbIds = onb.map((o) => o.id);
    const withDocs = new Set((await db.select({ id: schema.documents.onboardingId }).from(schema.documents).where(inArray(schema.documents.onboardingId, onbIds))).map((r) => r.id));
    const withPay = new Set((await db.select({ id: schema.payments.onboardingId }).from(schema.payments).where(inArray(schema.payments.onboardingId, onbIds))).map((r) => r.id));
    for (const o of onb) {
      const label = `Onboarding draft by ${o.applicantName} (${o.applicantUsername})${o.profile?.name ? ` for ${o.profile.name}` : ""}: never submitted, untouched since ${day(o.updatedAt)} (${ago(o.updatedAt, now)} days)`;
      if (withDocs.has(o.id)) kept.push({ category: "onboardingDrafts", ref: o.ref, why: `${label}. Kept: documents are attached.` });
      else if (withPay.has(o.id)) kept.push({ category: "onboardingDrafts", ref: o.ref, why: `${label}. Kept: a fee challan was issued for it.` });
      else {
        items.push({ category: "onboardingDrafts", ref: o.ref, what: label });
        ids.onboarding.push(o.id);
      }
    }
  }

  // 3. One-time codes long past their expiry.
  const codes = await db
    .select({ id: schema.otpChallenges.id, purpose: schema.otpChallenges.purpose, username: schema.otpChallenges.username, expiresAt: schema.otpChallenges.expiresAt, usedAt: schema.otpChallenges.usedAt })
    .from(schema.otpChallenges)
    .where(lt(schema.otpChallenges.expiresAt, before(policy.expiredCodeDays)))
    .orderBy(schema.otpChallenges.expiresAt);
  for (const c of codes) {
    items.push({ category: "expiredCodes", ref: `Code #${c.id}`, what: `One-time code for ${c.username} (${c.purpose}), ${c.usedAt ? "used" : "never used"}, expired ${day(c.expiresAt)}` });
    ids.codes.push(c.id);
  }

  // 4. Unpaid challans: cancelled, never deleted.
  const challans = await db
    .select({ p: schema.payments, code: schema.institutions.shortCode })
    .from(schema.payments)
    .leftJoin(schema.institutions, eq(schema.institutions.id, schema.payments.institutionId))
    .where(and(eq(schema.payments.status, "PENDING"), lt(schema.payments.createdAt, before(policy.unpaidChallanDays))))
    .orderBy(schema.payments.createdAt);
  for (const { p, code } of challans) {
    items.push({ category: "unpaidChallans", ref: `PSID ${p.psid}`, what: `Unpaid challan of Rs ${p.amount.toLocaleString("en-PK")} for ${p.purpose}${code ? ` (${code})` : ""}, issued ${day(p.createdAt)} (${ago(p.createdAt, now)} days): cancel` });
    ids.challans.push(p.id);
  }

  const counts = { draftApplications: ids.apps.length, onboardingDrafts: ids.onboarding.length, expiredCodes: ids.codes.length, unpaidChallans: ids.challans.length };
  return { policy, version, items, kept, counts, ids };
}

/**
 * Apply the retention policy. `dryRun` reports what would be cleared without changing anything.
 * Every run (dry or not) is stored in retention_runs and written to the audit log with its counts.
 */
export async function runRetention(opts: { dryRun?: boolean; actor?: string; trigger?: "SCHEDULED" | "MANUAL" } = {}): Promise<RetentionSummary> {
  const dryRun = !!opts.dryRun;
  const actor = opts.actor ?? "system";
  const trigger = opts.trigger ?? "SCHEDULED";
  const startedAt = new Date();
  const plan = await planRetention(startedAt);
  const counts = { ...plan.counts };
  const kept = [...plan.kept];
  let items = plan.items;

  if (!dryRun) {
    // Draft applications: one transaction each, so one that cannot be cleared does not stop the rest.
    // plan.items lists the drafts in the same order as plan.ids.apps.
    const appItems = plan.items.filter((i) => i.category === "draftApplications");
    const cleared: number[] = [];
    for (const id of plan.ids.apps) {
      try {
        await db.transaction(async (tx) => {
          const app = await tx.query.applications.findFirst({ where: eq(schema.applications.id, id) });
          if (!app || app.status !== "DRAFT" || app.submittedAt) throw new Error("no longer a draft");
          await tx.delete(schema.applicationFaculty).where(eq(schema.applicationFaculty.applicationId, id));
          await tx.delete(schema.applicationEvents).where(eq(schema.applicationEvents.applicationId, id));
          await tx.delete(schema.applications).where(and(eq(schema.applications.id, id), eq(schema.applications.status, "DRAFT")));
          const inst = await tx.query.institutions.findFirst({ where: eq(schema.institutions.id, app.institutionId) });
          if (inst)
            await notify(
              tx,
              `inst:${inst.code}`,
              `Draft ${app.ref} cleared`,
              `Your draft ${app.ref} was not changed for ${plan.policy.draftApplicationDays} days, so it was cleared under PCP's retention rules. Start a new application when you are ready; submitted applications are never cleared.`,
              "/institution/applications",
            );
        });
        cleared.push(id);
      } catch (e) {
        const ref = appItems[plan.ids.apps.indexOf(id)]?.ref ?? String(id);
        kept.push({ category: "draftApplications", ref, why: `Not cleared: ${(e as Error).message}` });
      }
    }
    counts.draftApplications = cleared.length;

    await db.transaction(async (tx) => {
      if (plan.ids.onboarding.length) {
        await tx.delete(schema.onboardingEvents).where(inArray(schema.onboardingEvents.requestId, plan.ids.onboarding));
        const gone = await tx
          .delete(schema.onboardingRequests)
          .where(and(inArray(schema.onboardingRequests.id, plan.ids.onboarding), eq(schema.onboardingRequests.status, "DRAFT"), isNull(schema.onboardingRequests.submittedAt)))
          .returning({ id: schema.onboardingRequests.id });
        counts.onboardingDrafts = gone.length;
      }
      if (plan.ids.codes.length) counts.expiredCodes = (await tx.delete(schema.otpChallenges).where(inArray(schema.otpChallenges.id, plan.ids.codes)).returning({ id: schema.otpChallenges.id })).length;
      if (plan.ids.challans.length) {
        const cancelled = await tx
          .update(schema.payments)
          .set({ status: "CANCELLED" })
          .where(and(inArray(schema.payments.id, plan.ids.challans), eq(schema.payments.status, "PENDING")))
          .returning({ psid: schema.payments.psid, institutionId: schema.payments.institutionId, purpose: schema.payments.purpose });
        counts.unpaidChallans = cancelled.length;
        for (const c of cancelled) {
          const inst = c.institutionId ? await tx.query.institutions.findFirst({ where: eq(schema.institutions.id, c.institutionId) }) : null;
          if (inst) await notify(tx, `inst:${inst.code}`, `Challan ${c.psid} cancelled`, `The challan for ${c.purpose} was not paid within ${plan.policy.unpaidChallanDays} days, so it was cancelled. Generate a new challan when you are ready to pay.`, "/institution/payments");
        }
      }
    });
    const done = new Set(cleared);
    items = [...appItems.filter((_, i) => done.has(plan.ids.apps[i])), ...plan.items.filter((i) => i.category !== "draftApplications")];
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const [run] = await db
    .insert(schema.retentionRuns)
    .values({ dryRun, trigger, policyVersion: plan.version, counts, details: items.slice(0, 300).map((i) => ({ category: i.category, ref: i.ref, what: i.what })), runBy: actor, startedAt, finishedAt: new Date() })
    .returning();
  await audit(db, {
    actor,
    action: dryRun ? "retention.dry_run" : "retention.run",
    entity: "retention",
    entityId: run.id,
    details: { trigger, policyVersion: plan.version, counts, kept: kept.length, refs: items.filter((i) => i.category !== "expiredCodes").map((i) => i.ref).slice(0, 50) },
  });
  const parts = (Object.keys(counts) as RetentionCategory[]).filter((k) => counts[k]).map((k) => `${CATEGORY_LABELS[k].toLowerCase()} ${counts[k]}`);
  return {
    runId: run.id,
    dryRun,
    counts,
    items,
    kept,
    message: total ? `${dryRun ? "Would clear" : "Cleared"}: ${parts.join(", ")}.${kept.length ? ` ${kept.length} kept (see the list).` : ""}` : `Nothing ${dryRun ? "would be" : "was"} cleared: no draft, code or challan is past its limit.`,
  };
}

/** The latest runs, newest first, for the Retention tab. */
export async function retentionRuns(limit = 10) {
  return db.select().from(schema.retentionRuns).orderBy(desc(schema.retentionRuns.startedAt)).limit(limit);
}

/** Count rows of a table the policy touches (for the "never touched" reassurance on screen). */
export async function protectedCounts() {
  const n = sql<number>`count(*)::int`;
  const [[docs], [audits], [msgs], [pays]] = await Promise.all([
    db.select({ n }).from(schema.documents),
    db.select({ n }).from(schema.auditLog),
    db.select({ n }).from(schema.messages),
    db.select({ n }).from(schema.payments),
  ]);
  return { documents: docs.n, auditLog: audits.n, messages: msgs.n, payments: pays.n };
}
