"use server";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ChecklistItem } from "@/db/schema";
import { audit } from "@/lib/audit";
import { certificatePdf } from "@/lib/certificate";
import { requirePermission, requireUser } from "@/lib/session";
import { putFile } from "@/lib/storage";
import { nextRef, notify } from "@/lib/util";
import { assertTransition, PROGRAM_LABELS } from "@/lib/workflow";
import type { ActionResult } from "./faculty";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function getApp(ref: string) {
  const app = await db.query.applications.findFirst({ where: eq(schema.applications.ref, ref) });
  if (!app) throw new Error("Application not found");
  const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, app.institutionId) });
  if (!inst) throw new Error("Institution not found");
  return { app, inst };
}

async function move(tx: Tx, app: { id: number; status: string }, to: string, user: { username: string; role: string }, note?: string, extra: Partial<typeof schema.applications.$inferInsert> = {}) {
  await tx.update(schema.applications).set({ status: to, updatedAt: new Date(), ...extra }).where(eq(schema.applications.id, app.id));
  await tx.insert(schema.applicationEvents).values({ applicationId: app.id, fromStatus: app.status, toStatus: to, actor: user.username, actorRole: user.role, note: note ?? null });
}

function done(ref: string, message: string): ActionResult {
  revalidatePath(`/pcp/applications/${ref}`);
  revalidatePath("/pcp/applications");
  revalidatePath("/pcp");
  return { ok: true, message, level: "success" };
}

async function guard<T>(fn: () => Promise<T>): Promise<T | ActionResult> {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e), level: "error" };
  }
}

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

const DefInput = z.object({ criterion: z.string().min(2), requiredAction: z.string().min(5), evidenceRequired: z.string().min(2), dueDays: z.coerce.number().int().min(1).max(120) });

export async function raiseDeficiency(ref: string, raw: unknown) {
  const user = await requirePermission("pcp.app.scrutiny");
  return guard(async () => {
    const { app, inst } = await getApp(ref);
    const v = DefInput.parse(raw);
    assertTransition(app.status, "DEFICIENCY_RAISED", user.roles);
    await db.transaction(async (tx) => {
      const dref = await nextRef(tx, "DF", "deficiencies", 5);
      const due = new Date(Date.now() + v.dueDays * 86400000).toISOString().slice(0, 10);
      await tx.insert(schema.deficiencies).values({ ref: dref, applicationId: app.id, institutionId: inst.id, criterion: v.criterion, requiredAction: v.requiredAction, evidenceRequired: v.evidenceRequired, dueDate: due, raisedBy: user.username });
      await move(tx, app, "DEFICIENCY_RAISED", user, `${dref}: ${v.criterion}`);
      await notify(tx, `inst:${inst.code}`, `Deficiency ${dref} on ${ref}`, `${v.criterion}: ${v.requiredAction}. Respond by ${due}.`, `/institution/applications/${ref}`);
      await audit(tx, { actor: user.username, action: "deficiency.raised", entity: "deficiency", entityId: dref, details: { application: ref } });
    });
    return done(ref, "Deficiency raised and the institution notified (in-app + email).");
  });
}

export async function reviewDeficiency(deficiencyId: number, accept: boolean, note: string) {
  const user = await requirePermission("pcp.app.scrutiny");
  return guard(async () => {
    const def = await db.query.deficiencies.findFirst({ where: eq(schema.deficiencies.id, deficiencyId) });
    if (!def) throw new Error("Deficiency not found");
    const app = await db.query.applications.findFirst({ where: eq(schema.applications.id, def.applicationId) });
    const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, def.institutionId) });
    if (!app || !inst) throw new Error("Not found");
    await db.transaction(async (tx) => {
      await tx.update(schema.deficiencies).set({ status: accept ? "ACCEPTED" : "REJECTED", reviewedBy: user.username, reviewNote: note || (accept ? "Accepted" : "Not sufficient") }).where(eq(schema.deficiencies.id, def.id));
      await audit(tx, { actor: user.username, action: accept ? "deficiency.accepted" : "deficiency.rejected", entity: "deficiency", entityId: def.ref });
      const open = await tx.select().from(schema.deficiencies).where(and(eq(schema.deficiencies.applicationId, app.id), ne(schema.deficiencies.status, "ACCEPTED")));
      if (!accept && app.status === "RESPONDED") {
        await move(tx, app, "DEFICIENCY_RAISED", user, `${def.ref} response not accepted`);
        await notify(tx, `inst:${inst.code}`, `Response to ${def.ref} not accepted`, note || "Please provide the required evidence.", `/institution/applications/${app.ref}`);
      } else if (open.length === 0 && app.status === "RESPONDED") {
        assertTransition(app.status, "UNDER_SCRUTINY", user.roles);
        await move(tx, app, "UNDER_SCRUTINY", user, "All deficiencies resolved");
        await notify(tx, `inst:${inst.code}`, `Deficiencies resolved on ${app.ref}`, "All your responses were accepted. Scrutiny continues.", `/institution/applications/${app.ref}`);
      }
    });
    return done(app.ref, accept ? "Response accepted." : "Response rejected; the institution is notified.");
  });
}

export async function scheduleInspection(ref: string, inspector: string, date: string) {
  const user = await requirePermission("pcp.inspection.schedule");
  return guard(async () => {
    const { app, inst } = await getApp(ref);
    assertTransition(app.status, "INSPECTION_SCHEDULED", user.roles);
    const member = await db.query.staff.findFirst({ where: eq(schema.staff.username, inspector) });
    if (!member || member.role !== "pcp_inspector") throw new Error("Choose an inspection panel member");
    if (member.province === inst.province) {
      await audit(db, { actor: user.username, action: "inspection.coi.blocked", entity: "application", entityId: ref, details: { inspector, province: inst.province } });
      throw new Error(`Conflict of interest: ${member.displayName} belongs to ${member.province}, the same province as ${inst.shortCode}. No member may inspect an institution in their own province.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pick a date");
    await db.transaction(async (tx) => {
      await tx.insert(schema.inspections).values({ applicationId: app.id, institutionId: inst.id, inspector, scheduledFor: date, createdBy: user.username });
      await move(tx, app, "INSPECTION_SCHEDULED", user, `Inspection on ${date}`);
      await notify(tx, `user:${inspector}`, `Inspection assigned: ${ref}`, `${inst.name}, ${inst.city}, on ${date}.`, "/pcp/inspections");
      await notify(tx, `inst:${inst.code}`, `Inspection scheduled for ${ref}`, `PCP will inspect your institution on ${date}.`, `/institution/applications/${ref}`);
      await audit(tx, { actor: user.username, action: "inspection.scheduled", entity: "application", entityId: ref, details: { inspector, date } });
    });
    return done(ref, `Inspection scheduled. ${member.displayName} (${member.province}) passes the conflict-of-interest check.`);
  });
}

const ChecklistInput = z.object({
  items: z.array(z.object({ criterion: z.string(), result: z.enum(["COMPLIANT", "PARTIAL", "NON_COMPLIANT", "NA"]), remarks: z.string().default("") })).min(1),
  summary: z.string().min(5),
});

export async function submitInspection(inspectionId: number, raw: unknown) {
  const user = await requirePermission("pcp.inspection.submit");
  return guard(async () => {
    const insp = await db.query.inspections.findFirst({ where: eq(schema.inspections.id, inspectionId) });
    if (!insp) throw new Error("Inspection not found");
    if (insp.inspector !== user.username) throw new Error("This inspection is assigned to another member");
    const app = await db.query.applications.findFirst({ where: eq(schema.applications.id, insp.applicationId) });
    const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, insp.institutionId) });
    if (!app || !inst) throw new Error("Not found");
    assertTransition(app.status, "INSPECTION_SUBMITTED", user.roles);
    const v = ChecklistInput.parse(raw);
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText(`Inspection report - ${app.ref} (DEMO)`, { x: 40, y: 790, size: 16, font });
    page.drawText(`${inst.name} - inspected ${insp.scheduledFor}`, { x: 40, y: 768, size: 11, font });
    v.items.forEach((it, i) => page.drawText(`${it.result.padEnd(14)} ${it.criterion}`.slice(0, 95), { x: 40, y: 730 - i * 18, size: 10, font }));
    page.drawText(`Summary: ${v.summary}`.slice(0, 110), { x: 40, y: 560, size: 10, font });
    const bytes = Buffer.from(await pdf.save());
    const stored = await putFile(inst.code, `inspection-reports/${app.ref}`, 1, "inspection-report.pdf", bytes);
    await db.transaction(async (tx) => {
      await tx.update(schema.inspections).set({ status: "SUBMITTED", checklist: v.items as ChecklistItem[], summary: v.summary, submittedAt: new Date() }).where(eq(schema.inspections.id, insp.id));
      await tx.insert(schema.documents).values({ institutionId: inst.id, folder: stored.folder, docType: "Inspection report", fileName: "inspection-report.pdf", storageKey: stored.key, version: 1, sizeBytes: bytes.length, mimeType: "application/pdf", sha256: stored.sha256, verificationStatus: "VERIFIED", applicationId: app.id, uploadedBy: user.username });
      await move(tx, app, "INSPECTION_SUBMITTED", user, "Digital checklist submitted");
      await notify(tx, "role:pcp_officer", `Inspection report: ${app.ref}`, `${inst.shortCode} inspection submitted by ${user.name}.`, `/pcp/applications/${app.ref}`);
      await audit(tx, { actor: user.username, action: "inspection.submitted", entity: "application", entityId: app.ref, details: { results: v.items.map((i) => i.result) } });
    });
    revalidatePath("/pcp/inspections");
    return done(app.ref, "Inspection report submitted.");
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

export async function recordDecision(ref: string, decision: "APPROVED" | "DEFERRED" | "REJECTED", note: string) {
  const user = await requirePermission("pcp.council.decide");
  return guard(async () => {
    const { app, inst } = await getApp(ref);
    assertTransition(app.status, decision, user.roles);
    await db.transaction(async (tx) => {
      await move(tx, app, decision, user, `Council decision: ${note || decision.toLowerCase()}`, { decision, decisionNote: note || null, decidedAt: new Date() });
      if (decision === "REJECTED") await tx.update(schema.programs).set({ nocStatus: "REJECTED" }).where(and(eq(schema.programs.institutionId, inst.id), eq(schema.programs.type, app.programType)));
      await notify(tx, `inst:${inst.code}`, `Council decision on ${ref}: ${decision.toLowerCase()}`, note || "See your application for details.", `/institution/applications/${ref}`);
      await audit(tx, { actor: user.username, action: "council.decision", entity: "application", entityId: ref, details: { decision, note } });
    });
    return done(ref, `Council decision recorded: ${decision.toLowerCase()}.`);
  });
}

export async function issueCertificate(ref: string) {
  const user = await requirePermission("pcp.noc.issue");
  return guard(async () => {
    const { app, inst } = await getApp(ref);
    assertTransition(app.status, "NOC_ISSUED", user.roles);
    const year = new Date().getFullYear();
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.applications).where(sql`certificate_no like ${`NOC-${app.programType}-${year}-%`}`);
    const certNo = `NOC-${app.programType}-${year}-${String(n + 1).padStart(4, "0")}`;
    const issuedAt = new Date();
    const validUntil = new Date(Date.now() + 5 * 365 * 86400000).toISOString().slice(0, 10);
    const intake = Number(app.data?.proposedIntake ?? 0);
    const bytes = await certificatePdf({ certNo, institution: inst.name, institutionCode: inst.code, city: inst.city, program: PROGRAM_LABELS[app.programType], intake, issuedAt, validUntil, decisionNote: app.decisionNote });
    const stored = await putFile(inst.code, `noc-applications/${ref}`, 1, `${certNo}.pdf`, bytes);
    await db.transaction(async (tx) => {
      await move(tx, app, "NOC_ISSUED", user, `Certificate ${certNo} issued`, { certificateNo: certNo, issuedAt, validUntil });
      await tx.update(schema.programs).set({ nocStatus: "APPROVED", nocNumber: certNo, approvedIntake: intake }).where(and(eq(schema.programs.institutionId, inst.id), eq(schema.programs.type, app.programType)));
      await tx.insert(schema.documents).values({ institutionId: inst.id, folder: stored.folder, docType: "NOC certificate", fileName: `${certNo}.pdf`, storageKey: stored.key, version: 1, sizeBytes: bytes.length, mimeType: "application/pdf", sha256: stored.sha256, verificationStatus: "VERIFIED", applicationId: app.id, uploadedBy: user.username });
      await notify(tx, `inst:${inst.code}`, `NOC issued: ${certNo}`, `Your ${PROGRAM_LABELS[app.programType]} NOC is issued. Anyone can verify it by scanning its QR code.`, `/institution/applications/${ref}`);
      await audit(tx, { actor: user.username, action: "certificate.issued", entity: "application", entityId: ref, details: { certNo, sha256: stored.sha256 } });
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
