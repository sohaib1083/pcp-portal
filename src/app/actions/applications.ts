"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, inArray, ne, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { SelfAssessmentItem } from "@/db/schema";
import { confirmPayment, createChallan } from "@/lib/payments";
import { requireOtp } from "@/lib/otp";
import { audit } from "@/lib/audit";
import { normalizeName } from "@/lib/names";
import { feeFor, getRule, refreshChecks, runChecks, subjectRequirements, suggestAssignment, type ProgramRule } from "@/lib/rules";
import { requireInstitution } from "@/lib/session";
import { clockFor } from "@/lib/sla";
import { nextRef, notify } from "@/lib/util";
import { CLOSED_STATUSES, KIND_LABELS, PROGRAM_LABELS, SELF_ASSESSMENT_CRITERIA, assertTransition } from "@/lib/workflow";
import type { ActionResult } from "./faculty";

async function loadOwnApp(ref: string, institutionId: number) {
  const app = await db.query.applications.findFirst({ where: and(eq(schema.applications.ref, ref), eq(schema.applications.institutionId, institutionId)) });
  if (!app) throw new Error("Application not found for your institution");
  return app;
}

const draftOnly = (status: string): ActionResult | null =>
  status === "DRAFT" ? null : { ok: false, message: "Only drafts can be edited. After submission, changes go through deficiency responses.", level: "error" };

const refresh = (ref: string) => {
  revalidatePath(`/institution/applications/${ref}`);
  revalidatePath("/institution/applications");
};

export async function createApplication(programType: "PHARMD" | "TECH") {
  const { user, inst } = await requireInstitution("inst.app.edit");
  const program = await db.query.programs.findFirst({ where: and(eq(schema.programs.institutionId, inst.id), eq(schema.programs.type, programType)) });
  if (program?.nocStatus === "APPROVED") return { ok: false, message: "This program already has an approved NOC." } as ActionResult;
  const draft = await db.query.applications.findFirst({
    where: and(eq(schema.applications.institutionId, inst.id), eq(schema.applications.programType, programType), eq(schema.applications.kind, "NOC"), eq(schema.applications.status, "DRAFT")),
  });
  if (draft) redirect(`/institution/applications/${draft.ref}`);
  const fee = await feeFor("NOC", programType);
  const campuses = await db.select().from(schema.campuses).where(eq(schema.campuses.institutionId, inst.id));
  // One campus: chosen for you. Two or more: the first field of the form asks which one.
  const only = campuses.length === 1 ? campuses[0] : null;
  const ref = await db.transaction(async (tx) => {
    const r = await nextRef(tx, "NOC", "applications", 4);
    const [app] = await tx
      .insert(schema.applications)
      .values({ ref: r, institutionId: inst.id, kind: "NOC", programType, status: "DRAFT", data: only ? { campus: only.name } : {}, campusId: only?.id ?? null, feeAmount: fee, createdBy: user.username })
      .returning();
    await tx.insert(schema.applicationEvents).values({ applicationId: app.id, fromStatus: null, toStatus: "DRAFT", actor: user.username, actorRole: user.role, note: "Application started" });
    if (!program) await tx.insert(schema.programs).values({ institutionId: inst.id, type: programType, nocStatus: "NONE" });
    await audit(tx, { actor: user.username, action: "application.created", entity: "application", entityId: r, details: { programType } });
    return r;
  });
  await refreshChecks(ref);
  redirect(`/institution/applications/${ref}`);
}

/**
 * Accreditation or renewal from a programme card (guide section 5). The file is prepared from existing
 * records: the approved intake, the faculty, labs and library of the last case. The institution updates
 * only what changed and files a self-assessment.
 */
export async function startProgrammeCase(programType: "PHARMD" | "TECH", kind: "ACCREDITATION" | "RENEWAL") {
  const { user, inst } = await requireInstitution("inst.app.edit");
  const program = await db.query.programs.findFirst({ where: and(eq(schema.programs.institutionId, inst.id), eq(schema.programs.type, programType)) });
  const label = PROGRAM_LABELS[programType];
  if (!program || program.nocStatus !== "APPROVED") return { ok: false, message: `${label} has no approved NOC yet. Accreditation follows the NOC.`, level: "error" } as ActionResult;
  if (kind === "RENEWAL" && !program.accreditationValidUntil) return { ok: false, message: `${label} has no accreditation to renew. Apply for accreditation instead.`, level: "error" } as ActionResult;
  const open = await db.query.applications.findFirst({
    where: and(eq(schema.applications.institutionId, inst.id), eq(schema.applications.programType, programType), inArray(schema.applications.kind, ["ACCREDITATION", "RENEWAL"]), notInArray(schema.applications.status, CLOSED_STATUSES)),
  });
  if (open) redirect(`/institution/applications/${open.ref}`);

  const last = await db.query.applications.findFirst({
    where: and(eq(schema.applications.institutionId, inst.id), eq(schema.applications.programType, programType), ne(schema.applications.status, "DRAFT")),
    orderBy: desc(schema.applications.id),
  });
  const lastCert = await db.query.applications.findFirst({
    where: and(eq(schema.applications.institutionId, inst.id), eq(schema.applications.programType, programType), inArray(schema.applications.kind, ["ACCREDITATION", "RENEWAL"]), eq(schema.applications.status, "NOC_ISSUED")),
    orderBy: desc(schema.applications.id),
  });
  const campuses = await db.select().from(schema.campuses).where(eq(schema.campuses.institutionId, inst.id)).orderBy(desc(schema.campuses.isMain));
  const campus = campuses.find((c) => c.id === last?.campusId) ?? campuses[0];
  const ld = last?.data ?? {};
  const data = {
    campus: campus?.name,
    proposedIntake: program.approvedIntake || ld.proposedIntake,
    classrooms: ld.classrooms,
    labs: ld.labs,
    labList: ld.labList,
    libraryBooks: ld.libraryBooks,
    libraryJournals: ld.libraryJournals,
    buildingAreaSqft: ld.buildingAreaSqft,
  };
  const fee = await feeFor(kind, programType);
  const { value: rule } = await getRule<ProgramRule>(`noc.${programType}`);

  // Faculty: the last case's links that are still active here, else the programme's own faculty.
  const active = await db
    .select({ id: schema.faculty.id, specialization: schema.faculty.specialization, qualification: schema.faculty.qualification, programType: schema.facultyLinks.programType })
    .from(schema.facultyLinks)
    .innerJoin(schema.faculty, eq(schema.faculty.id, schema.facultyLinks.facultyId))
    .where(and(eq(schema.facultyLinks.institutionId, inst.id), eq(schema.facultyLinks.status, "ACTIVE"), ne(schema.faculty.verificationStatus, "REJECTED")));
  const prev = last ? await db.select().from(schema.applicationFaculty).where(eq(schema.applicationFaculty.applicationId, last.id)) : [];
  let links = prev.filter((p) => active.some((a) => a.id === p.facultyId)).map((p) => ({ facultyId: p.facultyId, subject: p.subject }));
  if (!links.length) links = suggestAssignment(active.filter((a) => a.programType === programType), subjectRequirements(rule, Number(data.proposedIntake ?? 0)));

  const ref = await db.transaction(async (tx) => {
    const r = await nextRef(tx, kind === "RENEWAL" ? "RNW" : "ACC", "applications", 4);
    const [app] = await tx
      .insert(schema.applications)
      .values({ ref: r, institutionId: inst.id, kind, programType, status: "DRAFT", data, campusId: campus?.id ?? null, feeAmount: fee, renewalOf: lastCert?.certificateNo ?? program.nocNumber, selfAssessment: [], createdBy: user.username })
      .returning();
    if (links.length) await tx.insert(schema.applicationFaculty).values(links.map((l) => ({ applicationId: app.id, facultyId: l.facultyId, subject: l.subject, createdBy: user.username })));
    await tx.insert(schema.applicationEvents).values({
      applicationId: app.id,
      fromStatus: null,
      toStatus: "DRAFT",
      actor: user.username,
      actorRole: user.role,
      note: `${KIND_LABELS[kind]} file prepared from existing records${last ? ` (${last.ref})` : ""}: intake ${data.proposedIntake ?? "-"}, ${links.length} faculty`,
    });
    await audit(tx, { actor: user.username, action: "application.created", entity: "application", entityId: r, details: { programType, kind, preparedFrom: last?.ref ?? null } });
    return r;
  });
  await refreshChecks(ref);
  redirect(`/institution/applications/${ref}`);
}

const DataInput = z.object({
  campusId: z.coerce.number().int().optional(),
  proposedIntake: z.coerce.number().int().min(0).optional(),
  classrooms: z.coerce.number().int().min(0).optional(),
  labs: z.coerce.number().int().min(0).optional(),
  labList: z.string().optional(),
  libraryBooks: z.coerce.number().int().min(0).optional(),
  libraryJournals: z.coerce.number().int().min(0).optional(),
  buildingAreaSqft: z.coerce.number().int().min(0).optional(),
  notes: z.string().optional(),
  complianceConfirmed: z.boolean().optional(),
});

export async function saveApplication(ref: string, raw: unknown): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.app.edit");
  const app = await loadOwnApp(ref, inst.id);
  const locked = draftOnly(app.status);
  if (locked) return locked;
  const parsed = DataInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Check the numbers you entered.", level: "error" };
  const { campusId, ...rest } = parsed.data;
  let campus: typeof schema.campuses.$inferSelect | undefined;
  if (campusId) {
    campus = await db.query.campuses.findFirst({ where: and(eq(schema.campuses.id, campusId), eq(schema.campuses.institutionId, inst.id)) });
    if (!campus) return { ok: false, message: "Pick one of your own campuses.", level: "error" };
  }
  const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== null));
  await db
    .update(schema.applications)
    .set({ data: { ...app.data, ...clean, ...(campus ? { campus: campus.name } : {}) }, ...(campus ? { campusId: campus.id } : {}), updatedAt: new Date() })
    .where(eq(schema.applications.id, app.id));
  await audit(db, { actor: user.username, action: "application.saved", entity: "application", entityId: ref });
  const checks = await refreshChecks(ref);
  refresh(ref);
  const failing = checks.filter((c) => !c.ok).length;
  return { ok: true, message: failing ? `Saved. Automatic checks re-run: ${failing} still failing.` : "Saved. Automatic checks re-run: all passing.", level: "success" };
}

export async function recheck(ref: string): Promise<ActionResult> {
  const { inst } = await requireInstitution("inst.app.view");
  await loadOwnApp(ref, inst.id);
  await refreshChecks(ref);
  refresh(ref);
  return { ok: true, message: "Checks re-run", level: "success" };
}

const maskCnic = (c: string) => c.replace(/^(\d{5})-(\d{5})(\d{2})-(\d)$/, "$1-•••••$3-$4");

export type FacultyOption = { id: number; pcpId: string; fullName: string; cnic: string; qualification: string; specialization: string; designation: string; verificationStatus: string; programType: string };

/** Search the institution's own active faculty by Faculty ID, CNIC or name. Names are never typed freehand. */
export async function searchCaseFaculty(ref: string, q: string): Promise<FacultyOption[]> {
  const { inst } = await requireInstitution("inst.app.view");
  const app = await loadOwnApp(ref, inst.id);
  const s = q.trim();
  const digits = s.replace(/\D/g, "");
  const cond = !s
    ? undefined
    : digits.length >= 3 && digits.length === s.replace(/[\s-]/g, "").replace(/^PCP-?FAC-?/i, "").length
      ? or(sql`${schema.faculty.pcpId} like ${"%" + digits + "%"}`, sql`replace(${schema.faculty.cnic}, '-', '') like ${"%" + digits + "%"}`)
      : or(sql`${schema.faculty.pcpId} ilike ${"%" + s + "%"}`, sql`${schema.faculty.fullName} ilike ${"%" + s + "%"}`, sql`${schema.faculty.nameNorm} like ${"%" + normalizeName(s) + "%"}`);
  const rows = await db
    .select({
      id: schema.faculty.id,
      pcpId: schema.faculty.pcpId,
      fullName: schema.faculty.fullName,
      cnic: schema.faculty.cnic,
      qualification: schema.faculty.qualification,
      specialization: schema.faculty.specialization,
      designation: schema.faculty.designation,
      verificationStatus: schema.faculty.verificationStatus,
      programType: schema.facultyLinks.programType,
    })
    .from(schema.facultyLinks)
    .innerJoin(schema.faculty, eq(schema.faculty.id, schema.facultyLinks.facultyId))
    .where(and(eq(schema.facultyLinks.institutionId, inst.id), eq(schema.facultyLinks.status, "ACTIVE"), ne(schema.faculty.verificationStatus, "REJECTED"), cond))
    .orderBy(sql`case when ${schema.facultyLinks.programType} = ${app.programType} then 0 else 1 end`, asc(schema.faculty.pcpId))
    .limit(25);
  return rows.map((r) => ({ ...r, cnic: maskCnic(r.cnic) }));
}

export async function linkCaseFaculty(ref: string, facultyId: number, subject: string): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.app.edit");
  const app = await loadOwnApp(ref, inst.id);
  const locked = draftOnly(app.status);
  if (locked) return locked;
  const { value: rule } = await getRule<ProgramRule>(`noc.${app.programType}`);
  if (!(rule.subjects ?? []).some((s) => s.name === subject)) return { ok: false, message: "Pick a subject from the list.", level: "error" };
  const link = await db.query.facultyLinks.findFirst({ where: and(eq(schema.facultyLinks.facultyId, facultyId), eq(schema.facultyLinks.institutionId, inst.id), eq(schema.facultyLinks.status, "ACTIVE")) });
  const fac = await db.query.faculty.findFirst({ where: eq(schema.faculty.id, facultyId) });
  if (!link || !fac) return { ok: false, message: "That Faculty ID is not on your active faculty list. Add the person under Faculty first.", level: "error" };
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.applicationFaculty)
      .values({ applicationId: app.id, facultyId, subject, createdBy: user.username })
      .onConflictDoUpdate({ target: [schema.applicationFaculty.applicationId, schema.applicationFaculty.facultyId], set: { subject } });
    await audit(tx, { actor: user.username, action: "application.faculty.linked", entity: "application", entityId: ref, details: { faculty: fac.pcpId, subject } });
  });
  const checks = await refreshChecks(ref);
  refresh(ref);
  const line = checks.find((c) => c.key === `subject:${subject}`);
  return { ok: true, message: `${fac.fullName} (${fac.pcpId}) linked to ${subject}. ${line?.detail ?? ""}`.trim(), level: "success" };
}

export async function unlinkCaseFaculty(ref: string, facultyId: number): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.app.edit");
  const app = await loadOwnApp(ref, inst.id);
  const locked = draftOnly(app.status);
  if (locked) return locked;
  const fac = await db.query.faculty.findFirst({ where: eq(schema.faculty.id, facultyId) });
  await db.transaction(async (tx) => {
    await tx.delete(schema.applicationFaculty).where(and(eq(schema.applicationFaculty.applicationId, app.id), eq(schema.applicationFaculty.facultyId, facultyId)));
    await audit(tx, { actor: user.username, action: "application.faculty.unlinked", entity: "application", entityId: ref, details: { faculty: fac?.pcpId } });
  });
  await refreshChecks(ref);
  refresh(ref);
  return { ok: true, message: `${fac?.fullName ?? "Teacher"} removed from this case.`, level: "success" };
}

/** Demo shortcut: link the programme's own faculty to subjects by specialisation. Every line can be changed after. */
export async function autoLinkCaseFaculty(ref: string): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.app.edit");
  const app = await loadOwnApp(ref, inst.id);
  const locked = draftOnly(app.status);
  if (locked) return locked;
  const { value: rule } = await getRule<ProgramRule>(`noc.${app.programType}`);
  const have = await db.select().from(schema.applicationFaculty).where(eq(schema.applicationFaculty.applicationId, app.id));
  const pool = await db
    .select({ id: schema.faculty.id, specialization: schema.faculty.specialization, qualification: schema.faculty.qualification })
    .from(schema.facultyLinks)
    .innerJoin(schema.faculty, eq(schema.faculty.id, schema.facultyLinks.facultyId))
    .where(and(eq(schema.facultyLinks.institutionId, inst.id), eq(schema.facultyLinks.programType, app.programType), eq(schema.facultyLinks.status, "ACTIVE"), ne(schema.faculty.verificationStatus, "REJECTED")));
  const reqs = subjectRequirements(rule, Number(app.data?.proposedIntake ?? 0)).map((r) => ({ ...r, required: Math.max(0, r.required - have.filter((h) => h.subject === r.name).length) }));
  const add = suggestAssignment(pool.filter((p) => !have.some((h) => h.facultyId === p.id)), reqs);
  if (!add.length) return { ok: true, message: "All of this programme's faculty are already linked.", level: "warning" };
  await db.transaction(async (tx) => {
    await tx.insert(schema.applicationFaculty).values(add.map((a) => ({ applicationId: app.id, facultyId: a.facultyId, subject: a.subject, createdBy: user.username })));
    await audit(tx, { actor: user.username, action: "application.faculty.linked", entity: "application", entityId: ref, details: { count: add.length, by: "specialisation" } });
  });
  const checks = await refreshChecks(ref);
  refresh(ref);
  const short = checks.filter((c) => c.key.startsWith("subject:") && !c.ok);
  return { ok: true, message: `${add.length} teachers linked by Faculty ID.${short.length ? ` ${short.map((c) => c.detail).join(" ")}` : ""}`, level: short.length ? "warning" : "success" };
}

const SelfInput = z.array(z.object({ criterion: z.string(), rating: z.enum(["MET", "PARTLY", "NOT_MET"]), comment: z.string().default("") }));

export async function saveSelfAssessment(ref: string, raw: unknown): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.app.edit");
  const app = await loadOwnApp(ref, inst.id);
  const locked = draftOnly(app.status);
  if (locked) return locked;
  if (app.kind === "NOC") return { ok: false, message: "A NOC case has no self-assessment.", level: "error" };
  const parsed = SelfInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Rate each criterion as met, partly met or not met.", level: "error" };
  const items: SelfAssessmentItem[] = parsed.data.filter((x) => SELF_ASSESSMENT_CRITERIA.includes(x.criterion));
  await db.update(schema.applications).set({ selfAssessment: items, updatedAt: new Date() }).where(eq(schema.applications.id, app.id));
  await audit(db, { actor: user.username, action: "application.self_assessment.saved", entity: "application", entityId: ref, details: { rated: items.length } });
  const checks = await refreshChecks(ref);
  refresh(ref);
  const sa = checks.find((c) => c.key === "self_assessment");
  return { ok: !!sa, message: sa?.ok ? "Self-assessment saved: all criteria rated." : `Self-assessment saved. ${sa?.detail ?? ""}`, level: sa?.ok ? "success" : "warning" };
}

/** The Pay button: active only when every automatic check passes (guide section 4). */
export async function generateChallan(ref: string): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.fee.pay");
  const app = await loadOwnApp(ref, inst.id);
  if (app.feePaidAt) return { ok: true, message: "Already paid", level: "success" };
  if (app.status !== "DRAFT") return { ok: false, message: "The fee is paid before submission.", level: "error" };
  const checks = await refreshChecks(ref);
  const failing = checks.filter((c) => !c.ok);
  if (failing.length) {
    refresh(ref);
    return { ok: false, message: `Fix the failing checks before paying: ${failing.map((c) => c.detail).join(" ")}`, level: "error" };
  }
  const pay = await db.transaction(async (tx) => {
    const p = await createChallan(tx, { institutionId: inst.id, applicationId: app.id, purpose: `${KIND_LABELS[app.kind] ?? app.kind} fee · ${PROGRAM_LABELS[app.programType]} · ${ref}`, amount: app.feeAmount, createdBy: user.username });
    await audit(tx, { actor: user.username, action: "fee.challan.generated", entity: "application", entityId: ref, details: { psid: p.psid, amount: p.amount } });
    return p;
  });
  refresh(ref);
  return { ok: true, message: `Challan generated. PSID ${pay.psid}`, level: "success" };
}

/** Demo only: simulates the bank callback after a Raast QR / PSID payment. Needs a one-time code. */
export async function payFeeDemo(ref: string, otp?: string): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.fee.pay");
  const app = await loadOwnApp(ref, inst.id);
  if (!app.feePsid) return { ok: false, message: "Generate the challan first.", level: "error" };
  if (app.feePaidAt) return { ok: true, message: "Already paid.", level: "success" };
  try {
    await requireOtp(user.username, `payment:${app.feePsid}`, otp);
  } catch (e) {
    return { ok: false, message: (e as Error).message, level: "error" };
  }
  const paid = await db.transaction((tx) => confirmPayment(tx, { psid: app.feePsid!, method: "RAAST_QR", payerName: inst.name, actor: user.username }));
  refresh(ref);
  return { ok: true, message: `Payment confirmed (demo bank callback). Receipt ${paid.receiptNo}.`, level: "success" };
}

export async function submitApplication(ref: string): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.app.submit");
  const app = await loadOwnApp(ref, inst.id);
  assertTransition(app.status, "SUBMITTED", user.roles);
  const { checks } = await runChecks(app.id);
  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    await db.update(schema.applications).set({ checks }).where(eq(schema.applications.id, app.id));
    refresh(ref);
    return { ok: false, message: `Cannot submit: ${failed.length} automatic check(s) failing. ${failed[0].detail}`, level: "error" };
  }
  if (!app.feePaidAt) return { ok: false, message: "Cannot submit: the fee has not been paid.", level: "error" };
  const kind = KIND_LABELS[app.kind] ?? app.kind;
  const clock = await clockFor("SUBMITTED");
  await db.transaction(async (tx) => {
    await tx.update(schema.applications).set({ status: "SUBMITTED", checks, submittedBy: user.username, submittedAt: new Date(), updatedAt: new Date(), ...clock }).where(eq(schema.applications.id, app.id));
    await tx.insert(schema.applicationEvents).values({ applicationId: app.id, fromStatus: app.status, toStatus: "SUBMITTED", actor: user.username, actorRole: user.role, note: "Submitted with all checks passing and fee paid" });
    const where = and(eq(schema.programs.institutionId, inst.id), eq(schema.programs.type, app.programType));
    if (app.kind === "NOC") await tx.update(schema.programs).set({ nocStatus: "PENDING" }).where(where);
    else await tx.update(schema.programs).set({ accreditationStatus: sql`case when ${schema.programs.accreditationStatus} in ('NONE','EXPIRED') then 'PENDING' else ${schema.programs.accreditationStatus} end` }).where(where);
    await notify(tx, "role:pcp_officer", `New application ${ref}`, `${inst.name} submitted a ${PROGRAM_LABELS[app.programType]} ${kind} application.`, `/pcp/applications/${ref}`);
    await notify(tx, `inst:${inst.code}`, `Application ${ref} received`, `PCP has received your ${kind} application. You will be notified at each step.`, `/institution/applications/${ref}`);
    await audit(tx, { actor: user.username, action: "application.submitted", entity: "application", entityId: ref });
  });
  refresh(ref);
  return { ok: true, message: "Submitted to PCP. Acknowledgement sent.", level: "success" };
}

export async function respondDeficiency(deficiencyId: number, note: string): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.deficiency.respond");
  const def = await db.query.deficiencies.findFirst({ where: and(eq(schema.deficiencies.id, deficiencyId), eq(schema.deficiencies.institutionId, inst.id)) });
  if (!def) return { ok: false, message: "Not found", level: "error" };
  if (!note || note.length < 5) return { ok: false, message: "Describe what you did to fix it.", level: "error" };
  const app = await db.query.applications.findFirst({ where: eq(schema.applications.id, def.applicationId) });
  if (!app) return { ok: false, message: "Not found", level: "error" };
  const clock = await clockFor("RESPONDED");
  await db.transaction(async (tx) => {
    await tx.update(schema.deficiencies).set({ status: "RESPONDED", responseNote: note, respondedBy: user.username, respondedAt: new Date() }).where(eq(schema.deficiencies.id, def.id));
    await audit(tx, { actor: user.username, action: "deficiency.responded", entity: "deficiency", entityId: def.ref });
    const open = await tx.select().from(schema.deficiencies).where(and(eq(schema.deficiencies.applicationId, app.id), inArray(schema.deficiencies.status, ["OUTSTANDING", "REJECTED"])));
    if (open.length === 0 && app.status === "DEFICIENCY_RAISED") {
      await tx.update(schema.applications).set({ status: "RESPONDED", updatedAt: new Date(), ...clock }).where(eq(schema.applications.id, app.id));
      await tx.insert(schema.applicationEvents).values({ applicationId: app.id, fromStatus: "DEFICIENCY_RAISED", toStatus: "RESPONDED", actor: user.username, actorRole: user.role, note: "All deficiencies answered" });
      await notify(tx, "role:pcp_officer", `Deficiencies answered: ${app.ref}`, `${inst.shortCode} responded to all deficiencies.`, `/pcp/applications/${app.ref}`);
    }
  });
  refresh(app.ref);
  return { ok: true, message: "Response submitted to PCP.", level: "success" };
}

/** The institution answers a deferral: what it did about the reason, with the evidence uploaded on the case. */
export async function answerDeferral(ref: string, note: string): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.deficiency.respond");
  const app = await loadOwnApp(ref, inst.id);
  if (app.status !== "DEFERRED") return { ok: false, message: "This case is not deferred.", level: "error" };
  if (!note || note.trim().length < 5) return { ok: false, message: "Say what you did about the reason for deferral.", level: "error" };
  await db.transaction(async (tx) => {
    await tx.insert(schema.applicationEvents).values({ applicationId: app.id, fromStatus: "DEFERRED", toStatus: "DEFERRED", actor: user.username, actorRole: user.role, note: `Institution answered the deferral: ${note.trim()}` });
    await notify(tx, app.assignedOfficer ? `user:${app.assignedOfficer}` : "role:pcp_officer", `Deferral answered: ${ref}`, `${inst.shortCode} answered the reason for deferral. Return the case to the council when it is complete.`, `/pcp/applications/${ref}`);
    await audit(tx, { actor: user.username, action: "application.deferral.answered", entity: "application", entityId: ref, details: { note: note.trim() } });
  });
  refresh(ref);
  return { ok: true, message: "Sent to PCP. The officer returns the case to the council.", level: "success" };
}
