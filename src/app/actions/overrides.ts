"use server";
// Super administrator overrides on a case (RFP 4.1.2 "global overrides"). Each override needs a reason and a
// one-time code, writes a prominent audit entry and a timeline event, and tells the people it affects.
// An override never records a council decision: that stays with the Secretary.
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { requireOtp } from "@/lib/otp";
import { OVERRIDE_AUDIT, OVERRIDE_PERMISSION, REOPEN_FROM, REOPEN_TO, activeHold, nextOverrideRef } from "@/lib/overrides";
import { can } from "@/lib/roles";
import { requirePermission } from "@/lib/session";
import { clockFor } from "@/lib/sla";
import { notify } from "@/lib/util";
import { OPEN_STATUSES, STAGE_LABELS, STATUS_LABELS } from "@/lib/workflow";
import type { ActionResult } from "./faculty";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const reason = z.string().trim().min(10, "Give the reason for the override in a sentence (at least 10 characters).").max(1000);

const Input = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("REASSIGN_OFFICER"), officer: z.string().min(2, "Choose the new case officer."), reason, otp: z.string().optional() }),
  z.object({ kind: z.literal("EXTEND_DEADLINE"), until: z.string().regex(YMD, "Pick the new deadline."), reason, otp: z.string().optional() }),
  z.object({ kind: z.literal("REOPEN"), stage: z.string(), reason, otp: z.string().optional() }),
  z.object({ kind: z.literal("HOLD"), reason, otp: z.string().optional() }),
  z.object({ kind: z.literal("RELEASE_HOLD"), reason, otp: z.string().optional() }),
]);

const fail = (message: string): ActionResult => ({ ok: false, message, level: "error" });
const pkDay = (d: Date | string) => new Date(typeof d === "string" ? `${d}T00:00:00+05:00` : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Karachi" });
const endOfDay = (d: string) => new Date(`${d}T23:59:59+05:00`);
const stageName = (s: string) => STAGE_LABELS[s] ?? STATUS_LABELS[s] ?? s;

export async function applyOverride(ref: string, raw: unknown): Promise<ActionResult> {
  const user = await requirePermission(OVERRIDE_PERMISSION);
  try {
    const parsed = Input.safeParse(raw);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Complete the override form.");
    const v = parsed.data;
    const app = await db.query.applications.findFirst({ where: eq(schema.applications.ref, ref) });
    if (!app) return fail("Case not found.");
    const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, app.institutionId) });
    if (!inst) return fail("Institution not found.");
    if (!OPEN_STATUSES.includes(app.status)) return fail(`${ref} is ${(STATUS_LABELS[app.status] ?? app.status).toLowerCase()}. Overrides apply to open cases only.`);
    const hold = await activeHold(db, app.id);
    const staff = await db.select().from(schema.staff);
    const name = (u: string | null | undefined) => (u ? staff.find((s) => s.username === u)?.displayName ?? u : "nobody");
    const now = new Date();

    // ---- Validate and work out what changes (nothing is written yet) ----
    let summary = ""; // for PCP: the timeline and the audit
    let publicNote = ""; // for the institution: its timeline and its notice (never the reason)
    let before: Record<string, unknown> = {};
    let after: Record<string, unknown> = {};
    let toStatus = app.status;
    let set: Partial<typeof schema.applications.$inferInsert> = {};
    const tell: { audience: string; title: string; body: string; link: string }[] = [];
    const officerAudience = app.assignedOfficer ? `user:${app.assignedOfficer}` : "role:pcp_officer";

    if (v.kind === "REASSIGN_OFFICER") {
      const o = staff.find((s) => s.username === v.officer);
      if (!o || !o.active || !can([o.role], "pcp.app.scrutiny")) return fail("Choose an active case officer (registration officer or PCP officer).");
      if (o.username === app.assignedOfficer) return fail(`${o.displayName} is already the case officer.`);
      before = { officer: app.assignedOfficer };
      after = { officer: o.username };
      set = { assignedOfficer: o.username };
      summary = `case officer changed from ${name(app.assignedOfficer)} to ${o.displayName}`;
      publicNote = `Your case officer is now ${o.displayName}.`;
      tell.push({ audience: `user:${o.username}`, title: `${ref} reassigned to you`, body: `The super administrator made you the case officer for ${ref} (${inst.shortCode}).`, link: `/pcp/applications/${ref}` });
      if (app.assignedOfficer) tell.push({ audience: `user:${app.assignedOfficer}`, title: `${ref} reassigned`, body: `${ref} is now with ${o.displayName}.`, link: `/pcp/applications/${ref}` });
    } else if (v.kind === "EXTEND_DEADLINE") {
      if (hold) return fail("The case is on hold and its clock is paused. Release the hold first.");
      if (!app.stageDueAt) return fail(`${stageName(app.status)} has no time limit to extend.`);
      if (app.status === "DEFERRED") return fail("The return date of a deferral is part of the council's decision. Only the council can change it.");
      const current = new Date(app.stageDueAt.getTime() + 5 * 3600000).toISOString().slice(0, 10);
      if (v.until <= current) return fail(`Pick a date after the current deadline (${pkDay(app.stageDueAt)}).`);
      const max = new Date(now.getTime() + 180 * 86400000).toISOString().slice(0, 10);
      if (v.until > max) return fail("An extension can run at most 180 days from today.");
      before = { stage: app.status, due: app.stageDueAt.toISOString() };
      after = { stage: app.status, due: endOfDay(v.until).toISOString() };
      set = { stageDueAt: endOfDay(v.until), escalatedAt: null };
      summary = `deadline for ${stageName(app.status)} extended from ${pkDay(app.stageDueAt)} to ${pkDay(v.until)}`;
      publicNote = `PCP extended the time limit for ${stageName(app.status).toLowerCase()} to ${pkDay(v.until)}.`;
      tell.push({ audience: officerAudience, title: `Deadline extended: ${ref}`, body: `${stageName(app.status)} on ${ref} is now due ${pkDay(v.until)}.`, link: `/pcp/applications/${ref}` });
    } else if (v.kind === "REOPEN") {
      if (hold) return fail("The case is on hold. Release the hold first.");
      if (!REOPEN_FROM.includes(app.status)) return fail("Only a case returned for a deficiency or deferred by the council can be reopened. A rejected case reopens through an appeal.");
      if (!REOPEN_TO.includes(v.stage)) return fail("Choose scrutiny, technical review or council review. An override never records a decision.");
      if (v.stage === "COUNCIL_REVIEW") {
        const report = await db.query.inspections.findFirst({ where: and(eq(schema.inspections.applicationId, app.id), eq(schema.inspections.status, "SUBMITTED")) });
        if (!report) return fail("The case has no inspection report yet, so it cannot go to the council. Reopen it at scrutiny or technical review.");
      }
      toStatus = v.stage;
      const clock = await clockFor(v.stage);
      before = { status: app.status, deferUntil: app.deferUntil };
      after = { status: v.stage };
      set = { status: v.stage, ...clock, ...(app.status === "DEFERRED" ? { decision: null, decisionNote: null, decidedAt: null, deferUntil: null, decisionGrounds: null } : {}) };
      summary = `reopened from ${(STATUS_LABELS[app.status] ?? app.status).toLowerCase()} at ${stageName(v.stage).toLowerCase()}`;
      publicNote = `PCP reopened the case at ${stageName(v.stage).toLowerCase()}.`;
      tell.push({ audience: v.stage === "COUNCIL_REVIEW" ? "role:pcp_secretary" : v.stage === "TECHNICAL_REVIEW" ? "role:pcp_technical" : officerAudience, title: `${ref} reopened`, body: `The super administrator reopened ${ref} at ${stageName(v.stage).toLowerCase()}.`, link: `/pcp/applications/${ref}` });
    } else if (v.kind === "HOLD") {
      if (hold) return fail(`${ref} is already on hold since ${pkDay(hold.placedAt)}.`);
      const remaining = app.stageDueAt ? Math.round((app.stageDueAt.getTime() - now.getTime()) / 1000) : null;
      before = { status: app.status, due: app.stageDueAt?.toISOString() ?? null };
      after = { hold: true, clock: "paused" };
      set = { stageDueAt: null };
      summary = `placed on administrative hold at ${stageName(app.status).toLowerCase()}${app.stageDueAt ? "; the clock is paused" : ""}`;
      publicNote = "PCP placed the case on administrative hold. No step is taken until the hold is released, and the time limit is paused.";
      tell.push({ audience: officerAudience, title: `${ref} on administrative hold`, body: `No step can be taken on ${ref} until the super administrator releases the hold.`, link: `/pcp/applications/${ref}` });
      after.remainingSeconds = remaining;
    } else {
      if (!hold) return fail(`${ref} is not on hold.`);
      const due = hold.remainingSeconds != null ? new Date(now.getTime() + hold.remainingSeconds * 1000) : null;
      before = { hold: true, since: hold.placedAt.toISOString() };
      after = { hold: false, due: due?.toISOString() ?? null };
      set = { stageDueAt: due };
      summary = `administrative hold released${due ? `; the clock restarts with the time that was left (due ${pkDay(due)})` : ""}`;
      publicNote = `PCP released the hold. The case continues at ${stageName(app.status).toLowerCase()}.`;
      tell.push({ audience: officerAudience, title: `Hold released: ${ref}`, body: `${ref} continues at ${stageName(app.status).toLowerCase()}.`, link: `/pcp/applications/${ref}` });
    }

    // Checked last, so a refused override does not use up the code.
    await requireOtp(user.username, `override:${ref}`, v.otp);

    const oref = await db.transaction(async (tx) => {
      const r = await nextOverrideRef(tx);
      if (Object.keys(set).length) await tx.update(schema.applications).set({ ...set, updatedAt: now }).where(eq(schema.applications.id, app.id));
      if (v.kind === "EXTEND_DEADLINE" && app.status === "DEFICIENCY_RAISED")
        await tx
          .update(schema.deficiencies)
          .set({ dueDate: v.until })
          .where(and(eq(schema.deficiencies.applicationId, app.id), inArray(schema.deficiencies.status, ["OUTSTANDING", "REJECTED"])));
      if (v.kind === "REOPEN") {
        const open = await tx.select().from(schema.deficiencies).where(and(eq(schema.deficiencies.applicationId, app.id), inArray(schema.deficiencies.status, ["OUTSTANDING", "RESPONDED", "REJECTED"])));
        if (open.length) {
          await tx
            .update(schema.deficiencies)
            .set({ status: "WITHDRAWN", reviewedBy: user.username, reviewNote: `Withdrawn: the case was reopened by override ${r}` })
            .where(inArray(schema.deficiencies.id, open.map((d) => d.id)));
          after.withdrawnDeficiencies = open.map((d) => d.ref);
        }
      }
      if (v.kind === "HOLD") await tx.insert(schema.caseHolds).values({ applicationId: app.id, status: app.status, reason: v.reason, remainingSeconds: (after.remainingSeconds as number | null) ?? null, placedBy: user.username });
      if (v.kind === "RELEASE_HOLD" && hold) await tx.update(schema.caseHolds).set({ releasedAt: now, releasedBy: user.username, releaseReason: v.reason }).where(eq(schema.caseHolds.id, hold.id));
      const [ev] = await tx
        .insert(schema.applicationEvents)
        .values({ applicationId: app.id, fromStatus: app.status, toStatus, actor: user.username, actorRole: user.role, note: `Override ${r}: ${summary}. Reason: ${v.reason}` })
        .returning({ id: schema.applicationEvents.id });
      await tx.insert(schema.caseOverrides).values({ ref: r, applicationId: app.id, kind: v.kind, reason: v.reason, before, after, publicNote, eventId: ev.id, actor: user.username });
      await audit(tx, { actor: user.username, action: OVERRIDE_AUDIT[v.kind], entity: "application", entityId: ref, details: { override: r, kind: v.kind, reason: v.reason, before, after, otp: "verified" } });
      for (const t of tell) await notify(tx, t.audience, t.title, t.body, t.link);
      await notify(tx, `inst:${inst.code}`, `Update on ${ref}`, publicNote, `/institution/applications/${ref}`);
      return r;
    });
    revalidatePath(`/pcp/applications/${ref}`);
    revalidatePath(`/institution/applications/${ref}`);
    revalidatePath("/pcp/applications");
    revalidatePath("/pcp/audit");
    revalidatePath("/pcp");
    return { ok: true, level: "success", message: `Override ${oref} applied: ${summary}. It is in the audit log and on the case timeline; the institution is notified.` };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
