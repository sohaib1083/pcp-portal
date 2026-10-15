"use server";
import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ChecklistItem, SupervisorCheck } from "@/db/schema";
import { requestedPeriod } from "@/lib/appdetail";
import { audit } from "@/lib/audit";
import { certificatePdf } from "@/lib/certificate";
import { decisionLetter } from "@/lib/decision-letters";
import { assertNoStayOrder } from "@/lib/governance";
import { bandFor, scoreProblem, scoreTotals, weightFor } from "@/lib/inspection-scoring";
import { fileDocument } from "@/lib/letters";
import { requireOtp } from "@/lib/otp";
import { assertNotOnHold } from "@/lib/overrides";
import { pgTypeRule, supervisorsRequired } from "@/lib/pg";
import { accreditationYearsFor, caseFaculty, getPgRule, getScoringRule } from "@/lib/rules";
import { requirePermission, requireUser } from "@/lib/session";
import { clockFor } from "@/lib/sla";
import { can } from "@/lib/roles";
import { nextRef, notify } from "@/lib/util";
import { DEFICIENCY_FROM, KIND_LABELS, PG_TECHNICAL_REVIEW_CRITERIA, SUPERVISOR_SUBJECT, TECHNICAL_REVIEW_CRITERIA, assertTransition, isPg, programmeName } from "@/lib/workflow";
import type { ActionResult } from "./faculty";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Clock = Awaited<ReturnType<typeof clockFor>>;

async function getApp(ref: string) {
  const app = await db.query.applications.findFirst({ where: eq(schema.applications.ref, ref) });
  if (!app) throw new Error("Application not found");
  const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, app.institutionId) });
  if (!inst) throw new Error("Institution not found");
  await assertNotOnHold(db, app.id); // an administrative hold stops every step (RFP 4.1.2 overrides)
  return { app, inst };
}

/** Every transition restarts the service-level clock for the new stage (guide section 14). */
async function move(tx: Tx, app: { id: number; status: string }, to: string, user: { username: string; role: string }, note?: string, extra: Partial<typeof schema.applications.$inferInsert> = {}, clock?: Clock) {
  await assertNotOnHold(tx, app.id);
  const c = clock ?? (await clockFor(to));
  await tx.update(schema.applications).set({ status: to, updatedAt: new Date(), ...c, ...extra }).where(eq(schema.applications.id, app.id));
  await tx.insert(schema.applicationEvents).values({ applicationId: app.id, fromStatus: app.status, toStatus: to, actor: user.username, actorRole: user.role, note: note ?? null });
}

function done(ref: string, message: string): ActionResult {
  revalidatePath(`/pcp/applications/${ref}`);
  revalidatePath("/pcp/applications");
  revalidatePath("/pcp");
  revalidatePath(`/institution/applications/${ref}`);
  return { ok: true, message, level: "success" };
}

async function guard<T>(fn: () => Promise<T>): Promise<T | ActionResult> {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e), level: "error" };
  }
}

const progName = (t: string, field?: string | null) => programmeName(t, field);

/** The programme row a case belongs to (a postgraduate programme is one per field). */
const programOf = (institutionId: number, app: { programType: string; field: string | null }) =>
  and(eq(schema.programs.institutionId, institutionId), eq(schema.programs.type, app.programType), eq(schema.programs.field, app.field ?? ""));

export async function startScrutiny(ref: string) {
  const user = await requirePermission("pcp.app.scrutiny");
  return guard(async () => {
    const { app, inst } = await getApp(ref);
    assertTransition(app.status, "UNDER_SCRUTINY", user.roles);
    await db.transaction(async (tx) => {
      await move(tx, app, "UNDER_SCRUTINY", user, "Initial scrutiny started", { assignedOfficer: user.username });
      await notify(tx, `inst:${inst.code}`, `${ref} under scrutiny`, "A PCP registration officer has started reviewing your application.", `/institution/applications/${ref}`);
      await audit(tx, { actor: user.username, action: "application.scrutiny.started", entity: "application", entityId: ref });
    });
    return done(ref, "Scrutiny started and assigned to you.");
  });
}

/** Initial scrutiny passed: the case moves to the technical review (academic check against standards). */
export async function passScrutiny(ref: string) {
  const user = await requirePermission("pcp.app.scrutiny");
  return guard(async () => {
    const { app, inst } = await getApp(ref);
    assertTransition(app.status, "TECHNICAL_REVIEW", user.roles);
    const open = await db.select().from(schema.deficiencies).where(and(eq(schema.deficiencies.applicationId, app.id), inArray(schema.deficiencies.status, ["OUTSTANDING", "RESPONDED", "REJECTED"])));
    if (open.length) throw new Error(`Resolve ${open.map((d) => d.ref).join(", ")} before passing scrutiny.`);
    await db.transaction(async (tx) => {
      await move(tx, app, "TECHNICAL_REVIEW", user, "Initial scrutiny passed; technical review started", { assignedOfficer: app.assignedOfficer ?? user.username });
      await notify(tx, `inst:${inst.code}`, `${ref} in technical review`, "Initial scrutiny is complete. PCP is now checking the programme against the academic standards.", `/institution/applications/${ref}`);
      await notify(tx, "role:pcp_technical", `Technical review: ${ref}`, `${inst.shortCode} ${progName(app.programType, app.field)} ${(KIND_LABELS[app.kind] ?? app.kind).toLowerCase()} passed initial scrutiny. Record the academic check${isPg(app.programType) ? ", the PG proforma review and a check of each supervisor" : ""}.`, `/pcp/applications/${ref}`);
      await audit(tx, { actor: user.username, action: "application.scrutiny.passed", entity: "application", entityId: ref });
    });
    return done(ref, "Scrutiny passed. The technical review has started.");
  });
}

const ReviewInput = z.object({
  items: z.array(z.object({ criterion: z.string(), result: z.enum(["MEETS", "PARTLY", "DOES_NOT_MEET"]), remarks: z.string().default("") })).min(1),
  supervisors: z.array(z.object({ facultyId: z.number().int(), result: z.enum(["ELIGIBLE", "NOT_ELIGIBLE"]), remarks: z.string().max(500).default("") })).default([]),
  summary: z.string().min(5, "Write a short summary of the review"),
});

/**
 * The technical officer records the technical review: the academic check against PCP standards (RFP 4.1.2,
 * 4.1.7.2). On a postgraduate case it is the PG proforma review plus a check of every linked supervisor against
 * the `pg.rules` rule. A criterion that does not meet the standard, or too few eligible supervisors for the
 * intake, needs a deficiency, not a pass.
 */
export async function recordTechnicalReview(ref: string, raw: unknown) {
  const user = await requirePermission("pcp.technical.review");
  return guard(async () => {
    const { app } = await getApp(ref);
    if (app.status !== "TECHNICAL_REVIEW") throw new Error("The case is not in technical review.");
    const done1 = await db.query.technicalReviews.findFirst({ where: eq(schema.technicalReviews.applicationId, app.id) });
    if (done1) throw new Error("The technical review is already recorded. The coordinator assigns the inspection team next.");
    const parsed = ReviewInput.safeParse(raw);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Complete the review form.");
    const v = parsed.data;
    const pg = isPg(app.programType);
    const criteria = pg ? PG_TECHNICAL_REVIEW_CRITERIA : TECHNICAL_REVIEW_CRITERIA;
    const missing = criteria.filter((c) => !v.items.some((i) => i.criterion === c));
    if (missing.length) throw new Error(`Rate every criterion. Missing: ${missing.join("; ")}`);
    const items = v.items.filter((i) => criteria.includes(i.criterion));
    const fails = items.filter((i) => i.result === "DOES_NOT_MEET");
    if (fails.length) throw new Error(`${fails.map((f) => f.criterion).join("; ")} does not meet the standard. Raise a deficiency for it instead of passing the review.`);
    const noRemark = items.filter((i) => i.result === "PARTLY" && !i.remarks.trim());
    if (noRemark.length) throw new Error(`Add a remark for: ${noRemark.map((f) => f.criterion).join("; ")}`);

    // Postgraduate: one eligibility check per linked supervisor, and enough eligible supervisors for the intake.
    let supervisors: SupervisorCheck[] | null = null;
    if (pg) {
      const linked = (await caseFaculty(app.id, app.institutionId, app.programType)).filter((f) => f.subject === SUPERVISOR_SUBJECT);
      const unchecked = linked.filter((f) => !v.supervisors.some((s) => s.facultyId === f.facultyId));
      if (unchecked.length) throw new Error(`Check every supervisor. Not checked: ${unchecked.map((f) => `${f.fullName} (${f.pcpId})`).join("; ")}`);
      supervisors = linked.map((f) => {
        const s = v.supervisors.find((x) => x.facultyId === f.facultyId)!;
        return { facultyId: f.facultyId, pcpId: f.pcpId, name: f.fullName, result: s.result, remarks: s.remarks.trim() };
      });
      const noReason = supervisors.filter((s) => s.result === "NOT_ELIGIBLE" && !s.remarks);
      if (noReason.length) throw new Error(`Say why ${noReason.map((s) => s.name).join(" and ")} ${noReason.length === 1 ? "is" : "are"} not eligible.`);
      const { value: rule } = await getPgRule();
      const required = supervisorsRequired(pgTypeRule(rule, app.programType), Number(app.data?.proposedIntake ?? 0));
      const eligible = supervisors.filter((s) => s.result === "ELIGIBLE").length;
      if (eligible < required)
        throw new Error(`${progName(app.programType, app.field)}: ${eligible} supervisor${eligible === 1 ? "" : "s"} confirmed eligible, ${required} required for intake ${app.data?.proposedIntake ?? 0}. Raise a deficiency instead of passing the review.`);
    }
    const clock = await clockFor("TECHNICAL_REVIEW");
    await db.transaction(async (tx) => {
      await tx.insert(schema.technicalReviews).values({ applicationId: app.id, reviewer: user.username, items, supervisors, summary: v.summary, outcome: "PROCEED" });
      await move(tx, app, "TECHNICAL_REVIEW", user, `Technical review recorded: ${v.summary}${supervisors ? ` (${supervisors.filter((s) => s.result === "ELIGIBLE").length} of ${supervisors.length} supervisors confirmed eligible)` : ""}`, {}, clock);
      await notify(tx, "role:pcp_coordinator", `Ready for inspection: ${ref}`, `The technical review of ${ref} is complete. Assign an inspection team.`, `/pcp/applications/${ref}`);
      await audit(tx, {
        actor: user.username,
        action: "application.technical_review.recorded",
        entity: "application",
        entityId: ref,
        details: { results: items.map((i) => i.result), ...(supervisors ? { supervisors: supervisors.map((s) => `${s.pcpId}:${s.result}`) } : {}) },
      });
    });
    return done(ref, "Technical review recorded. The case is ready for an inspection team.");
  });
}

const DefInput = z.object({ criterion: z.string().min(2), requiredAction: z.string().min(5), evidenceRequired: z.string().min(2), dueDays: z.coerce.number().int().min(1).max(120) });

/** Case officers raise deficiencies at any review stage; the technical officer during the technical review. */
export async function raiseDeficiency(ref: string, raw: unknown) {
  const user = await requireUser("pcp");
  return guard(async () => {
    const { app, inst } = await getApp(ref);
    if (!can(user.roles, "pcp.app.scrutiny") && !(app.status === "TECHNICAL_REVIEW" && can(user.roles, "pcp.technical.review"))) throw new Error("Not allowed: your role cannot raise a deficiency at this stage.");
    const v = DefInput.parse(raw);
    assertTransition(app.status, "DEFICIENCY_RAISED", user.roles);
    const due = new Date(Date.now() + v.dueDays * 86400000).toISOString().slice(0, 10);
    const clock = await clockFor("DEFICIENCY_RAISED", { until: due });
    await db.transaction(async (tx) => {
      const dref = await nextRef(tx, "DF", "deficiencies", 5);
      await tx.insert(schema.deficiencies).values({ ref: dref, applicationId: app.id, institutionId: inst.id, criterion: v.criterion, requiredAction: v.requiredAction, evidenceRequired: v.evidenceRequired, dueDate: due, raisedBy: user.username });
      await move(tx, app, "DEFICIENCY_RAISED", user, `${dref}: ${v.criterion}`, { assignedOfficer: app.assignedOfficer ?? user.username }, clock);
      await notify(tx, `inst:${inst.code}`, `Deficiency ${dref} on ${ref}`, `${v.criterion}: ${v.requiredAction}. Respond by ${due}.`, `/institution/applications/${ref}`);
      await audit(tx, { actor: user.username, action: "deficiency.raised", entity: "deficiency", entityId: dref, details: { application: ref } });
    });
    return done(ref, "Deficiency raised and the institution notified (in-app + email).");
  });
}

/** The stage a deficiency was raised from; accepting the responses returns the case there. */
async function deficiencyOrigin(applicationId: number) {
  const ev = await db
    .select({ fromStatus: schema.applicationEvents.fromStatus })
    .from(schema.applicationEvents)
    .where(and(eq(schema.applicationEvents.applicationId, applicationId), eq(schema.applicationEvents.toStatus, "DEFICIENCY_RAISED"), ne(schema.applicationEvents.fromStatus, "RESPONDED")))
    .orderBy(desc(schema.applicationEvents.id))
    .limit(1);
  const o = ev[0]?.fromStatus;
  return o && DEFICIENCY_FROM.includes(o) ? o : "UNDER_SCRUTINY";
}

/** Case officers accept or return responses; the technical officer also does for deficiencies raised in the technical review. */
export async function reviewDeficiency(deficiencyId: number, accept: boolean, note: string) {
  const user = await requireUser("pcp");
  return guard(async () => {
    const def = await db.query.deficiencies.findFirst({ where: eq(schema.deficiencies.id, deficiencyId) });
    if (!def) throw new Error("Deficiency not found");
    const app = await db.query.applications.findFirst({ where: eq(schema.applications.id, def.applicationId) });
    const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, def.institutionId) });
    if (!app || !inst) throw new Error("Not found");
    await assertNotOnHold(db, app.id);
    const origin = await deficiencyOrigin(app.id);
    if (!can(user.roles, "pcp.app.scrutiny") && !(origin === "TECHNICAL_REVIEW" && can(user.roles, "pcp.technical.review"))) throw new Error("Not allowed: a case officer reviews this response.");
    const backClock = origin === "DEFERRED" && app.deferUntil ? await clockFor("DEFERRED", { until: app.deferUntil }) : await clockFor(origin);
    const againClock = await clockFor("DEFICIENCY_RAISED", { until: def.dueDate });
    await db.transaction(async (tx) => {
      await tx.update(schema.deficiencies).set({ status: accept ? "ACCEPTED" : "REJECTED", reviewedBy: user.username, reviewNote: note || (accept ? "Accepted" : "Not sufficient") }).where(eq(schema.deficiencies.id, def.id));
      await audit(tx, { actor: user.username, action: accept ? "deficiency.accepted" : "deficiency.rejected", entity: "deficiency", entityId: def.ref });
      // A deficiency withdrawn by a super administrator override (case reopened) is closed, like an accepted one.
      const open = await tx.select().from(schema.deficiencies).where(and(eq(schema.deficiencies.applicationId, app.id), notInArray(schema.deficiencies.status, ["ACCEPTED", "WITHDRAWN"])));
      if (!accept && app.status === "RESPONDED") {
        await move(tx, app, "DEFICIENCY_RAISED", user, `${def.ref} response not accepted`, {}, againClock);
        await notify(tx, `inst:${inst.code}`, `Response to ${def.ref} not accepted`, note || "Please provide the required evidence.", `/institution/applications/${app.ref}`);
      } else if (open.length === 0 && app.status === "RESPONDED") {
        assertTransition(app.status, origin, user.roles);
        await move(tx, app, origin, user, "All deficiencies resolved", {}, backClock);
        await notify(tx, `inst:${inst.code}`, `Deficiencies resolved on ${app.ref}`, "All your responses were accepted. The review continues.", `/institution/applications/${app.ref}`);
      }
    });
    return done(app.ref, accept ? "Response accepted." : "Response rejected; the institution is notified.");
  });
}

type Panelist = typeof schema.staff.$inferSelect;

/** The conflict check for one panel member: the same-province rule plus declared conflicts (guide sections 10 and 14). */
async function conflictFor(member: Panelist, inst: { id: number; province: string; shortCode: string }) {
  if (member.province === inst.province) return `${member.displayName} belongs to ${member.province}, the same province as ${inst.shortCode}. No member may inspect an institution in their own province.`;
  const declared = await db.query.conflictDeclarations.findFirst({
    where: and(eq(schema.conflictDeclarations.username, member.username), eq(schema.conflictDeclarations.institutionId, inst.id), eq(schema.conflictDeclarations.active, true)),
  });
  if (declared) return `${member.displayName} has declared a conflict with ${inst.shortCode}: ${declared.reason}.`;
  return null;
}

const ScheduleInput = z.object({
  members: z.array(z.string()).max(6).default([]),
  scope: z.string().max(1000).optional(),
  // The automated suggestion the coordinator started from, if any: recorded with the booking (RFP 4.1.1).
  suggestion: z.object({ lead: z.string(), members: z.array(z.string()).max(6), date: z.string().nullable() }).optional().nullable(),
});

/**
 * The coordinator assigns an inspection team: a lead (`inspector`) plus members. Every member passes the
 * conflict check, also when the team came from the automated suggestion. The institution is told the date,
 * what to prepare and the team size.
 */
export async function scheduleInspection(ref: string, inspector: string, date: string, opts: { members?: string[]; scope?: string; suggestion?: { lead: string; members: string[]; date: string | null } | null } = {}) {
  const user = await requirePermission("pcp.inspection.schedule");
  return guard(async () => {
    const { app, inst } = await getApp(ref);
    assertTransition(app.status, "INSPECTION_SCHEDULED", user.roles);
    const review = await db.query.technicalReviews.findFirst({ where: eq(schema.technicalReviews.applicationId, app.id) });
    if (!review) throw new Error("Record the technical review before assigning an inspection team.");
    const o = ScheduleInput.parse(opts);
    const usernames = [inspector, ...o.members.filter((m) => m && m !== inspector)];
    if (!inspector) throw new Error("Choose a team lead");
    if (new Set(usernames).size !== usernames.length) throw new Error("Each member can be on the team once.");
    const panel = await db.select().from(schema.staff).where(inArray(schema.staff.username, usernames));
    for (const u of usernames) {
      const m = panel.find((p) => p.username === u);
      if (!m || m.role !== "pcp_inspector" || !m.active) throw new Error(`Choose inspection panel members only (${u} is not one).`);
      const conflict = await conflictFor(m, inst);
      if (conflict) {
        await audit(db, { actor: user.username, action: "inspection.coi.blocked", entity: "application", entityId: ref, details: { member: u, reason: conflict } });
        throw new Error(`Conflict of interest: ${conflict}`);
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pick a date");
    const scope =
      o.scope?.trim() ||
      (isPg(app.programType)
        ? `Supervisor files with publication lists and current student loads; research laboratories with equipment registers; journal subscriptions and HEC Digital Library access; coursework timetable; ethics and biosafety committee minutes; thesis synopsis approvals.`
        : `Faculty files and appointment letters for every linked teacher; laboratories with equipment registers; library stock and journal subscriptions; student records for the current intake.`);
    const size = usernames.length;
    const sug = o.suggestion;
    const fromSuggestion = sug
      ? { lead: sug.lead, members: sug.members, date: sug.date, followed: sug.lead === inspector && sug.date === date && sug.members.length === usernames.length - 1 && sug.members.every((m) => usernames.includes(m)) }
      : null;
    const clock = await clockFor("INSPECTION_SCHEDULED", { base: date });
    await db.transaction(async (tx) => {
      const [insp] = await tx.insert(schema.inspections).values({ applicationId: app.id, institutionId: inst.id, inspector, scheduledFor: date, scope, createdBy: user.username }).returning();
      await tx.insert(schema.inspectionTeam).values(usernames.map((u, i) => ({ inspectionId: insp.id, username: u, role: i === 0 ? "LEAD" : "MEMBER" })));
      await move(tx, app, "INSPECTION_SCHEDULED", user, `Inspection on ${date}; team of ${size}`, {}, clock);
      for (const [i, u] of usernames.entries())
        await notify(tx, `user:${u}`, `Inspection ${i === 0 ? "lead" : "team"}: ${ref}`, `${inst.name}, ${inst.city}, on ${date}. ${i === 0 ? "You lead the team and submit the checklist." : "You are a team member; the lead submits the checklist."}`, "/pcp/inspections");
      await notify(tx, `inst:${inst.code}`, `Inspection scheduled for ${ref}`, `PCP will inspect your institution on ${date} with a team of ${size}. Please prepare: ${scope}`, `/institution/applications/${ref}`);
      await audit(tx, {
        actor: user.username,
        action: "inspection.scheduled",
        entity: "application",
        entityId: ref,
        details: { lead: inspector, members: usernames.slice(1), date, conflictCheck: "passed", ...(fromSuggestion ? { suggestion: fromSuggestion.followed ? "accepted as proposed" : "changed by the coordinator", suggested: { lead: fromSuggestion.lead, members: fromSuggestion.members, date: fromSuggestion.date } } : {}) },
      });
    });
    const names = usernames.map((u) => panel.find((p) => p.username === u)!).map((m) => `${m.displayName} (${m.province})`);
    return done(ref, `Inspection scheduled${fromSuggestion?.followed ? " as suggested" : ""}. Team of ${size}: ${names.join(", ")}. Every member passed the conflict check.`);
  });
}

const ConflictInput = z.object({ username: z.string().min(2), institutionId: z.coerce.number().int(), reason: z.string().min(5, "Give the reason for the conflict") });

/** Record a declared conflict of interest. The coordinator records any member's; a panel member can declare their own. */
export async function declareConflict(raw: unknown) {
  const user = await requireUser("pcp");
  return guard(async () => {
    const parsed = ConflictInput.safeParse(raw);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Complete the form");
    const v = parsed.data;
    if (!can(user.roles, "pcp.inspection.schedule") && v.username !== user.username) throw new Error("You can declare only your own conflicts.");
    const member = await db.query.staff.findFirst({ where: eq(schema.staff.username, v.username) });
    const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, v.institutionId) });
    if (!member || member.role !== "pcp_inspector") throw new Error("Choose an inspection panel member");
    if (!inst) throw new Error("Choose an institution");
    await db.transaction(async (tx) => {
      await tx.insert(schema.conflictDeclarations).values({ username: v.username, institutionId: v.institutionId, reason: v.reason });
      await audit(tx, { actor: user.username, action: "inspection.conflict.declared", entity: "staff", entityId: v.username, details: { institution: inst.code, reason: v.reason } });
    });
    revalidatePath("/pcp/inspections");
    return { ok: true, message: `Conflict recorded: ${member.displayName} will not be assigned to ${inst.shortCode}.`, level: "success" } as ActionResult;
  });
}

export async function withdrawConflict(id: number) {
  const user = await requireUser("pcp");
  return guard(async () => {
    const row = await db.query.conflictDeclarations.findFirst({ where: eq(schema.conflictDeclarations.id, id) });
    if (!row) throw new Error("Not found");
    if (!can(user.roles, "pcp.inspection.schedule") && row.username !== user.username) throw new Error("You can withdraw only your own declarations.");
    await db.transaction(async (tx) => {
      await tx.update(schema.conflictDeclarations).set({ active: false }).where(eq(schema.conflictDeclarations.id, id));
      await audit(tx, { actor: user.username, action: "inspection.conflict.withdrawn", entity: "staff", entityId: row.username, details: { institutionId: row.institutionId } });
    });
    revalidatePath("/pcp/inspections");
    return { ok: true, message: "Declaration withdrawn. It stays in the history.", level: "success" } as ActionResult;
  });
}

const ChecklistInput = z.object({
  items: z
    .array(
      z.object({
        criterion: z.string(),
        result: z.enum(["COMPLIANT", "PARTIAL", "NON_COMPLIANT", "NA"]),
        score: z.number().min(0).max(100).nullable().optional(),
        remarks: z.string().default(""),
        evidence: z.array(z.object({ id: z.number().int(), name: z.string().max(200) })).max(20).default([]),
      }),
    )
    .min(1),
  summary: z.string().min(5),
});

/** Only the team lead submits the checklist; members see the visit. */
export async function submitInspection(inspectionId: number, raw: unknown) {
  const user = await requirePermission("pcp.inspection.submit");
  return guard(async () => {
    const insp = await db.query.inspections.findFirst({ where: eq(schema.inspections.id, inspectionId) });
    if (!insp) throw new Error("Inspection not found");
    if (insp.inspector !== user.username) throw new Error("Only the team lead submits the checklist.");
    const app = await db.query.applications.findFirst({ where: eq(schema.applications.id, insp.applicationId) });
    const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, insp.institutionId) });
    if (!app || !inst) throw new Error("Not found");
    assertTransition(app.status, "INSPECTION_SUBMITTED", user.roles);
    const v = ChecklistInput.parse(raw);
    // Evidence must be this case's own inspection files (sent from the tablet just before).
    const evidenceIds = v.items.flatMap((i) => i.evidence.map((e) => e.id));
    if (evidenceIds.length) {
      const docs = await db.select({ id: schema.documents.id, applicationId: schema.documents.applicationId, folder: schema.documents.folder }).from(schema.documents).where(inArray(schema.documents.id, evidenceIds));
      const ok = new Set(docs.filter((d) => d.applicationId === app.id && d.folder.includes(`inspection-reports/${app.ref}/evidence`)).map((d) => d.id));
      if (evidenceIds.some((id) => !ok.has(id))) throw new Error("A photo or document does not belong to this inspection. Remove it and attach it again.");
    }
    // Score entry (RFP 4.1.2): each scored line within its result's band, weighted by the `inspection.scoring` rule.
    const { value: scoring, version: scoringVersion } = await getScoringRule();
    const items: ChecklistItem[] = v.items.map((it) => {
      const band = bandFor(scoring, it.result);
      return { ...it, score: band ? (it.score ?? scoring.defaults?.[it.result as "COMPLIANT"] ?? scoring.maxScore) : null, weight: weightFor(scoring, it.criterion) };
    });
    const problems = items.map((it) => scoreProblem(scoring, it)).filter(Boolean);
    if (problems.length) throw new Error(`Check the scores: ${problems.join("; ")}.`);
    const totals = scoreTotals(items, scoring);
    const team = await db.select().from(schema.inspectionTeam).where(eq(schema.inspectionTeam.inspectionId, insp.id));
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText(`Inspection report - ${app.ref} (DEMO)`, { x: 40, y: 790, size: 16, font });
    page.drawText(`${inst.name} - ${progName(app.programType, app.field)} - inspected ${insp.scheduledFor}`.slice(0, 95), { x: 40, y: 768, size: 11, font });
    page.drawText(`Team: ${[insp.inspector, ...team.filter((t) => t.username !== insp.inspector).map((t) => t.username)].join(", ")} (lead first)`.slice(0, 100), { x: 40, y: 750, size: 9, font });
    items.forEach((it, i) =>
      page.drawText(`${it.result.padEnd(14)} ${it.score === null ? "  -  " : `${it.score}/${scoring.maxScore}`} x${it.weight}  ${it.criterion}${it.evidence?.length ? ` (${it.evidence.length} file${it.evidence.length === 1 ? "" : "s"})` : ""}`.slice(0, 100), { x: 40, y: 720 - i * 18, size: 9.5, font }),
    );
    page.drawText(`Score: ${totals.total} of ${totals.max} (${totals.percent}%) - ${totals.passed ? "PASS" : "BELOW THE PASS MARK"} (pass mark ${totals.passPercent}%)`, { x: 40, y: 575, size: 10.5, font });
    page.drawText(`Summary: ${v.summary}`.slice(0, 110), { x: 40, y: 555, size: 10, font });
    const bytes = Buffer.from(await pdf.save());
    await db.transaction(async (tx) => {
      await tx.update(schema.inspections).set({ status: "SUBMITTED", checklist: items, summary: v.summary, submittedAt: new Date() }).where(eq(schema.inspections.id, insp.id));
      await tx
        .insert(schema.inspectionScores)
        .values({ inspectionId: insp.id, total: totals.total, max: totals.max, percent: totals.percent, passPercent: totals.passPercent, passed: totals.passed, ruleVersion: scoringVersion })
        .onConflictDoNothing();
      await fileDocument(tx, { institutionId: inst.id, folder: `inspection-reports/${app.ref}`, docType: "Inspection report", fileName: "inspection-report.pdf", bytes, applicationId: app.id, uploadedBy: user.username });
      await move(tx, app, "INSPECTION_SUBMITTED", user, `Digital checklist submitted: score ${totals.percent}% (${totals.passed ? "pass" : "below the pass mark"})`);
      await notify(tx, app.assignedOfficer ? `user:${app.assignedOfficer}` : "role:pcp_officer", `Inspection report: ${app.ref}`, `${inst.shortCode} inspection submitted by ${user.name}. Score ${totals.total} of ${totals.max} (${totals.percent}%), ${totals.passed ? "above" : "below"} the pass mark of ${totals.passPercent}%.`, `/pcp/applications/${app.ref}`);
      await audit(tx, { actor: user.username, action: "inspection.submitted", entity: "application", entityId: app.ref, details: { results: items.map((i) => i.result), scores: items.map((i) => i.score), percent: totals.percent, passed: totals.passed, scoringRule: scoringVersion, evidence: evidenceIds.length } });
    });
    revalidatePath("/pcp/inspections");
    return done(app.ref, `Inspection report submitted. Score ${totals.percent}%: ${totals.passed ? "pass" : "below the pass mark"}.`);
  });
}

export async function forwardToCouncil(ref: string, recommendation: string) {
  const user = await requirePermission("pcp.app.scrutiny");
  return guard(async () => {
    const { app } = await getApp(ref);
    assertTransition(app.status, "COUNCIL_REVIEW", user.roles);
    await db.transaction(async (tx) => {
      await move(tx, app, "COUNCIL_REVIEW", user, `Recommendation: ${recommendation || "—"}`);
      await notify(tx, "role:pcp_secretary", `${ref} ready for council`, recommendation || "Forwarded for council decision.", `/pcp/applications/${ref}`);
      await audit(tx, { actor: user.username, action: "application.forwarded", entity: "application", entityId: ref, details: { recommendation } });
    });
    return done(ref, "Forwarded to the council agenda.");
  });
}

/** A deferred case goes back on the agenda once the institution has answered the reason for deferral. */
export async function returnToCouncil(ref: string, note: string) {
  const user = await requirePermission("pcp.app.scrutiny");
  return guard(async () => {
    const { app, inst } = await getApp(ref);
    if (app.status !== "DEFERRED") throw new Error("Only a deferred case returns to the council.");
    assertTransition(app.status, "COUNCIL_REVIEW", user.roles);
    if (!note || note.trim().length < 5) throw new Error("Say what changed since the deferral.");
    await db.transaction(async (tx) => {
      await move(tx, app, "COUNCIL_REVIEW", user, `Returned to council after deferral: ${note}`);
      await notify(tx, "role:pcp_secretary", `${ref} back on the council agenda`, note, `/pcp/applications/${ref}`);
      await notify(tx, `inst:${inst.code}`, `${ref} back on the council agenda`, "Your case has returned to the Council after the deferral.", `/institution/applications/${ref}`);
      await audit(tx, { actor: user.username, action: "application.returned_to_council", entity: "application", entityId: ref, details: { note } });
    });
    return done(ref, "Returned to the council agenda.");
  });
}

/** Options the guide requires: a deferral has a reason and a date to return; a rejection states its grounds; a decision needs a one-time code. */
export type DecisionOptions = { deferUntil?: string; grounds?: string; otp?: string };

/**
 * Record the council decision on a case. Needs a one-time code requested for the purpose `decision:<ref>`
 * (useOtp on the client). A deferral needs a reason (`grounds`, or the note) and a future `deferUntil`
 * (YYYY-MM-DD); a rejection needs its grounds. Generates and files the decision letter for every outcome.
 */
export async function recordDecision(ref: string, decision: "APPROVED" | "DEFERRED" | "REJECTED", note: string, opts: DecisionOptions = {}) {
  const user = await requirePermission("pcp.council.decide");
  return guard(async () => {
    const { app, inst } = await getApp(ref);
    assertTransition(app.status, decision, user.roles);
    await assertNoStayOrder(app.ref); // a court's stay order on the case (or its appeal) blocks the decision until it is lifted
    const grounds = (opts.grounds ?? "").trim() || (decision !== "APPROVED" ? (note ?? "").trim() : "");
    const today = new Date().toISOString().slice(0, 10);
    if (decision === "DEFERRED") {
      if (grounds.length < 10) throw new Error("A deferral needs a reason the institution can act on (at least a sentence).");
      if (!opts.deferUntil || !/^\d{4}-\d{2}-\d{2}$/.test(opts.deferUntil)) throw new Error("A deferral needs a return date.");
      if (opts.deferUntil <= today) throw new Error("The return date must be in the future.");
    }
    if (decision === "REJECTED" && grounds.length < 10) throw new Error("A rejection must state its grounds (at least a sentence).");
    await requireOtp(user.username, `decision:${ref}`, opts.otp);

    const program = await db.query.programs.findFirst({ where: programOf(inst.id, app) });
    const years = await accreditationYearsFor(app.programType);
    const period = app.kind === "NOC" ? null : requestedPeriod(app.kind, program?.accreditationValidUntil, years, app.submittedAt ?? new Date());
    const intake = Number(app.data?.proposedIntake ?? 0);
    const campus = app.campusId ? (await db.query.campuses.findFirst({ where: eq(schema.campuses.id, app.campusId) }))?.name : app.data?.campus;
    const at = new Date();
    const pdf = await decisionLetter({ decision, ref, kind: app.kind, programType: app.programType, field: app.field, intake, campus, inst, note, grounds, deferUntil: opts.deferUntil, period, signedBy: user.name, at });
    const deferClock = decision === "DEFERRED" ? await clockFor("DEFERRED", { until: opts.deferUntil }) : undefined;
    const folder = app.kind === "NOC" ? `noc-applications/${ref}` : `accreditation/${period?.from ?? at.getFullYear()}/${ref}`;

    await db.transaction(async (tx) => {
      const letter = await fileDocument(tx, { institutionId: inst.id, folder, docType: "Decision letter", fileName: `${ref}-decision-${decision.toLowerCase()}.pdf`, bytes: pdf, applicationId: app.id, uploadedBy: user.username });
      const label = decision === "DEFERRED" ? `deferred until ${opts.deferUntil}: ${grounds}` : decision === "REJECTED" ? `rejected: ${grounds}` : `approved${note ? `: ${note}` : ""}`;
      await move(
        tx,
        app,
        decision,
        user,
        `Council decision: ${label}`,
        { decision, decisionNote: note || null, decisionGrounds: decision === "APPROVED" ? null : grounds, deferUntil: decision === "DEFERRED" ? opts.deferUntil : null, decidedAt: at, letterDocumentId: letter.id },
        deferClock,
      );
      const where = programOf(inst.id, app);
      if (decision === "REJECTED") {
        if (app.kind === "NOC") await tx.update(schema.programs).set({ nocStatus: "REJECTED" }).where(where);
        else if (program && period) {
          // History is never overwritten: a rejected renewal is a row of its own.
          await tx.insert(schema.accreditationHistory).values({ programId: program.id, year: period.from, status: app.kind === "RENEWAL" ? "Renewal" : "Accredited", validFrom: period.from, validUntil: period.until, intake, decision: "Rejected", applicationRef: ref });
          const until = program.accreditationValidUntil;
          await tx.update(schema.programs).set({ accreditationStatus: until && until >= today ? "VALID" : until ? "EXPIRED" : "NONE" }).where(where);
        }
      }
      const outcome = describe(decision, opts.deferUntil);
      await notify(tx, `inst:${inst.code}`, `Council decision on ${ref}: ${outcome}`, decision === "APPROVED" ? `The decision letter is in your case file.${note ? ` Conditions: ${note}` : ""}` : `${decision === "DEFERRED" ? "Reason" : "Grounds"}: ${grounds}. The decision letter is in your case file.`, `/institution/applications/${ref}`);
      if (app.assignedOfficer) await notify(tx, `user:${app.assignedOfficer}`, `Council decision on ${ref}: ${outcome}`, grounds || note || "See the case file.", `/pcp/applications/${ref}`);
      await audit(tx, { actor: user.username, action: "council.decision", entity: "application", entityId: ref, details: { decision, note, grounds: grounds || null, deferUntil: opts.deferUntil ?? null, letterSha256: letter.sha256, otp: "verified" } });
    });
    return done(ref, `Council decision recorded: ${describe(decision, opts.deferUntil)}. Decision letter generated and filed.`);
  });
}

const describe = (d: string, until?: string) => (d === "APPROVED" ? "approved" : d === "DEFERRED" ? `deferred until ${until}` : "rejected");

/** Issue the NOC or accreditation certificate (signed PDF with a QR code). Needs a one-time code for `certificate:<ref>`. */
export async function issueCertificate(ref: string, otp?: string) {
  const user = await requirePermission("pcp.noc.issue");
  return guard(async () => {
    const { app, inst } = await getApp(ref);
    assertTransition(app.status, "NOC_ISSUED", user.roles);
    await assertNoStayOrder(app.ref); // no certificate either while a stay order is in force
    await requireOtp(user.username, `certificate:${ref}`, otp);
    const year = new Date().getFullYear();
    const acc = app.kind !== "NOC";
    const prefix = acc ? "ACR" : "NOC";
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.applications).where(sql`certificate_no like ${`${prefix}-${app.programType}-${year}-%`}`);
    const certNo = `${prefix}-${app.programType}-${year}-${String(n + 1).padStart(4, "0")}`;
    const issuedAt = new Date();
    const today = issuedAt.toISOString().slice(0, 10);
    const intake = Number(app.data?.proposedIntake ?? 0);
    const program = await db.query.programs.findFirst({ where: programOf(inst.id, app) });
    const years = await accreditationYearsFor(app.programType);
    // A renewal continues from the current expiry; a first accreditation (or a lapsed one) starts today.
    const current = program?.accreditationValidUntil;
    const validFrom = acc && app.kind === "RENEWAL" && current && current > today ? current : today;
    const plusYears = (d: string, y: number) => `${Number(d.slice(0, 4)) + y}${d.slice(4)}`;
    const validUntil = acc ? plusYears(validFrom, years) : new Date(Date.now() + 5 * 365 * 86400000).toISOString().slice(0, 10);
    const pg = isPg(app.programType);
    const hecNoc = pg ? (app.data?.hecNocNumber ?? "").trim() || null : null;
    const bytes = await certificatePdf({ kind: app.kind, validFrom, certNo, institution: inst.name, institutionCode: inst.code, city: inst.city, program: progName(app.programType, app.field), intake, issuedAt, validUntil, decisionNote: app.decisionNote, hecNoc });
    await db.transaction(async (tx) => {
      await move(tx, app, "NOC_ISSUED", user, `Certificate ${certNo} issued`, { certificateNo: certNo, issuedAt, validUntil });
      const where = programOf(inst.id, app);
      if (acc && program) {
        // A postgraduate programme card shows the HEC NOC it was accredited on.
        await tx.update(schema.programs).set({ accreditationStatus: "VALID", accreditationValidUntil: validUntil, approvedIntake: intake, ...(hecNoc ? { nocNumber: hecNoc } : {}) }).where(where);
        await tx.insert(schema.accreditationHistory).values({
          programId: program.id,
          year: Number(validFrom.slice(0, 4)),
          status: app.kind === "RENEWAL" ? "Renewal" : "Accredited",
          validFrom: Number(validFrom.slice(0, 4)),
          validUntil: Number(validUntil.slice(0, 4)),
          intake,
          decision: "Approved",
          applicationRef: ref,
        });
      } else {
        await tx.update(schema.programs).set({ nocStatus: "APPROVED", nocNumber: certNo, approvedIntake: intake }).where(where);
      }
      const doc = await fileDocument(tx, {
        institutionId: inst.id,
        folder: acc ? `accreditation/${validFrom.slice(0, 4)}/${ref}` : `noc-applications/${ref}`,
        docType: acc ? "Accreditation certificate" : "NOC certificate",
        fileName: `${certNo}.pdf`,
        bytes,
        applicationId: app.id,
        uploadedBy: user.username,
      });
      await notify(
        tx,
        `inst:${inst.code}`,
        `${acc ? "Accreditation certificate" : "NOC"} issued: ${certNo}`,
        acc
          ? `Your ${progName(app.programType, app.field)} accreditation is valid until ${validUntil} for an intake of ${intake}. Anyone can verify it by scanning its QR code.`
          : `Your ${progName(app.programType, app.field)} NOC is issued. Anyone can verify it by scanning its QR code.`,
        `/institution/applications/${ref}`,
      );
      await audit(tx, { actor: user.username, action: "certificate.issued", entity: "application", entityId: ref, details: { certNo, kind: KIND_LABELS[app.kind], sha256: doc.sha256, otp: "verified" } });
    });
    return done(ref, `Certificate ${certNo} issued with a QR verification code.`);
  });
}

export async function verifyFaculty(facultyId: number) {
  const user = await requirePermission("pcp.faculty.verify");
  return guard(async () => {
    const fac = await db.query.faculty.findFirst({ where: eq(schema.faculty.id, facultyId) });
    if (!fac) throw new Error("Not found");
    const flags = await db.select().from(schema.duplicateFlags).where(and(eq(schema.duplicateFlags.recordId, facultyId), eq(schema.duplicateFlags.status, "OPEN")));
    if (flags.length) throw new Error("Resolve the open duplicate flag first");
    await db.update(schema.faculty).set({ verificationStatus: "VERIFIED" }).where(eq(schema.faculty.id, facultyId));
    await audit(db, { actor: user.username, action: "faculty.verified", entity: "faculty", entityId: fac.pcpId });
    revalidatePath("/pcp/verification");
    return { ok: true, message: `${fac.fullName} verified (qualification check: HEC in production).`, level: "success" } as ActionResult;
  });
}

export async function resolveDuplicate(flagId: number, outcome: "SAME_PERSON" | "DIFFERENT") {
  const user = await requirePermission("pcp.faculty.verify");
  return guard(async () => {
    const flag = await db.query.duplicateFlags.findFirst({ where: eq(schema.duplicateFlags.id, flagId) });
    if (!flag || flag.status !== "OPEN") throw new Error("Flag not open");
    const rec = await db.query.faculty.findFirst({ where: eq(schema.faculty.id, flag.recordId) });
    if (!rec) throw new Error("Record missing");
    await db.transaction(async (tx) => {
      await tx.update(schema.duplicateFlags).set({ status: outcome, resolvedBy: user.username, resolvedAt: new Date() }).where(eq(schema.duplicateFlags.id, flagId));
      const stillOpen = await tx.select().from(schema.duplicateFlags).where(and(eq(schema.duplicateFlags.recordId, rec.id), eq(schema.duplicateFlags.status, "OPEN")));
      const links = await tx.select().from(schema.facultyLinks).where(and(eq(schema.facultyLinks.facultyId, rec.id), eq(schema.facultyLinks.status, "ACTIVE")));
      const inst = links[0] ? await tx.query.institutions.findFirst({ where: eq(schema.institutions.id, links[0].institutionId) }) : null;
      if (outcome === "SAME_PERSON") {
        await tx.update(schema.faculty).set({ verificationStatus: "REJECTED" }).where(eq(schema.faculty.id, rec.id));
        if (links.length) await tx.update(schema.facultyLinks).set({ status: "ENDED", endDate: new Date().toISOString().slice(0, 10) }).where(inArray(schema.facultyLinks.id, links.map((l) => l.id)));
        if (inst) await notify(tx, `inst:${inst.code}`, `Faculty record ${rec.pcpId} rejected`, `PCP found that ${rec.fullName} is the same person as an existing faculty member at another institution. The record was removed from your active list.`, "/institution/faculty");
      } else if (stillOpen.length === 0) {
        await tx.update(schema.faculty).set({ verificationStatus: "PENDING" }).where(eq(schema.faculty.id, rec.id));
        if (inst) await notify(tx, `inst:${inst.code}`, `Duplicate flag cleared: ${rec.pcpId}`, `PCP confirmed ${rec.fullName} is a different person. The record now counts towards your applications.`, "/institution/faculty");
      }
      await audit(tx, { actor: user.username, action: "duplicate.resolved", entity: "faculty", entityId: rec.pcpId, details: { outcome, matchRecordId: flag.matchRecordId } });
    });
    revalidatePath("/pcp/verification");
    return { ok: true, message: outcome === "SAME_PERSON" ? "Marked as the same person: the duplicate record was deactivated." : "Marked as different people: the flag is cleared.", level: "success" } as ActionResult;
  });
}

export async function verifyDocument(id: number, status: "VERIFIED" | "REJECTED") {
  const user = await requirePermission("pcp.documents.verify");
  return guard(async () => {
    await db.update(schema.documents).set({ verificationStatus: status }).where(eq(schema.documents.id, id));
    await audit(db, { actor: user.username, action: `document.${status.toLowerCase()}`, entity: "document", entityId: id });
    revalidatePath("/pcp/documents");
    return { ok: true, message: `Document ${status.toLowerCase()}.`, level: "success" } as ActionResult;
  });
}

export async function markNotificationsRead() {
  const user = await requireUser();
  const audiences = [`user:${user.username}`, ...user.roles.map((r) => `role:${r}`), ...(user.institutionCode ? [`inst:${user.institutionCode}`] : [])];
  await db.update(schema.notifications).set({ readAt: new Date() }).where(inArray(schema.notifications.audience, audiences));
  revalidatePath("/", "layout");
  return { ok: true, message: "Marked as read" } as ActionResult;
}
