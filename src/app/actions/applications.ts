"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { confirmPayment, createChallan } from "@/lib/payments";
import { requireOtp } from "@/lib/otp";
import { audit } from "@/lib/audit";
import { feeFor, refreshChecks, runChecks } from "@/lib/rules";
import { requireInstitution } from "@/lib/session";
import { nextRef, notify, psidFor } from "@/lib/util";
import { assertTransition } from "@/lib/workflow";
import type { ActionResult } from "./faculty";

async function loadOwnApp(ref: string, institutionId: number) {
  const app = await db.query.applications.findFirst({ where: and(eq(schema.applications.ref, ref), eq(schema.applications.institutionId, institutionId)) });
  if (!app) throw new Error("Application not found for your institution");
  return app;
}

export async function createApplication(programType: "PHARMD" | "TECH") {
  const { user, inst } = await requireInstitution("inst.app.edit");
  const program = await db.query.programs.findFirst({ where: and(eq(schema.programs.institutionId, inst.id), eq(schema.programs.type, programType)) });
  if (program?.nocStatus === "APPROVED") return { ok: false, message: "This program already has an approved NOC." } as ActionResult;
  const draft = await db.query.applications.findFirst({
    where: and(eq(schema.applications.institutionId, inst.id), eq(schema.applications.programType, programType), eq(schema.applications.kind, "NOC"), eq(schema.applications.status, "DRAFT")),
  });
  if (draft) redirect(`/institution/applications/${draft.ref}`);
  const fee = await feeFor("NOC", programType);
  const ref = await db.transaction(async (tx) => {
    const r = await nextRef(tx, "NOC", "applications", 4);
    const [app] = await tx.insert(schema.applications).values({ ref: r, institutionId: inst.id, kind: "NOC", programType, status: "DRAFT", data: {}, feeAmount: fee, createdBy: user.username }).returning();
    await tx.insert(schema.applicationEvents).values({ applicationId: app.id, fromStatus: null, toStatus: "DRAFT", actor: user.username, actorRole: user.role, note: "Application started" });
    if (!program) await tx.insert(schema.programs).values({ institutionId: inst.id, type: programType, nocStatus: "NONE" });
    await audit(tx, { actor: user.username, action: "application.created", entity: "application", entityId: r, details: { programType } });
    return r;
  });
  redirect(`/institution/applications/${ref}`);
}

const DataInput = z.object({
  campus: z.string().optional(),
  proposedIntake: z.coerce.number().int().min(0).optional(),
  classrooms: z.coerce.number().int().min(0).optional(),
  labs: z.coerce.number().int().min(0).optional(),
  labList: z.string().optional(),
  libraryBooks: z.coerce.number().int().min(0).optional(),
  libraryJournals: z.coerce.number().int().min(0).optional(),
  buildingAreaSqft: z.coerce.number().int().min(0).optional(),
  notes: z.string().optional(),
});

export async function saveApplication(ref: string, raw: unknown): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.app.edit");
  const app = await loadOwnApp(ref, inst.id);
  if (app.status !== "DRAFT") return { ok: false, message: "Only drafts can be edited. After submission, changes go through deficiency responses.", level: "error" };
  const parsed = DataInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Check the numbers you entered.", level: "error" };
  await db.update(schema.applications).set({ data: { ...app.data, ...parsed.data }, updatedAt: new Date() }).where(eq(schema.applications.id, app.id));
  await audit(db, { actor: user.username, action: "application.saved", entity: "application", entityId: ref });
  await refreshChecks(ref);
  revalidatePath(`/institution/applications/${ref}`);
  return { ok: true, message: "Saved. Automatic checks re-run.", level: "success" };
}

export async function recheck(ref: string): Promise<ActionResult> {
  const { inst } = await requireInstitution("inst.app.view");
  await loadOwnApp(ref, inst.id);
  await refreshChecks(ref);
  revalidatePath(`/institution/applications/${ref}`);
  return { ok: true, message: "Checks re-run", level: "success" };
}

export async function generateChallan(ref: string): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.fee.pay");
  const app = await loadOwnApp(ref, inst.id);
  if (app.feePaidAt) return { ok: true, message: "Already paid", level: "success" };
  const pay = await db.transaction(async (tx) => {
    const p = await createChallan(tx, { institutionId: inst.id, applicationId: app.id, purpose: `${app.kind === "NOC" ? "NOC" : app.kind === "RENEWAL" ? "Renewal" : "Accreditation"} fee · ${app.programType === "PHARMD" ? "PharmD" : "Pharmacy Technician"} · ${ref}`, amount: app.feeAmount, createdBy: user.username });
    await audit(tx, { actor: user.username, action: "fee.challan.generated", entity: "application", entityId: ref, details: { psid: p.psid, amount: p.amount } });
    return p;
  });
  revalidatePath(`/institution/applications/${ref}`);
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
  revalidatePath(`/institution/applications/${ref}`);
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
    revalidatePath(`/institution/applications/${ref}`);
    return { ok: false, message: `Cannot submit: ${failed.length} automatic check(s) failing.`, level: "error" };
  }
  if (!app.feePaidAt) return { ok: false, message: "Cannot submit: the fee has not been paid.", level: "error" };
  await db.transaction(async (tx) => {
    await tx.update(schema.applications).set({ status: "SUBMITTED", checks, submittedBy: user.username, submittedAt: new Date(), updatedAt: new Date() }).where(eq(schema.applications.id, app.id));
    await tx.insert(schema.applicationEvents).values({ applicationId: app.id, fromStatus: app.status, toStatus: "SUBMITTED", actor: user.username, actorRole: user.role, note: "Submitted with all checks passing and fee paid" });
    await tx.update(schema.programs).set({ nocStatus: "PENDING" }).where(and(eq(schema.programs.institutionId, inst.id), eq(schema.programs.type, app.programType)));
    await notify(tx, "role:pcp_officer", `New application ${ref}`, `${inst.name} submitted a ${app.programType === "TECH" ? "Pharmacy Technician" : "PharmD"} NOC application.`, `/pcp/applications/${ref}`);
    await notify(tx, `inst:${inst.code}`, `Application ${ref} received`, "PCP has received your application. You will be notified at each step.", `/institution/applications/${ref}`);
    await audit(tx, { actor: user.username, action: "application.submitted", entity: "application", entityId: ref });
  });
  revalidatePath(`/institution/applications/${ref}`);
  return { ok: true, message: "Submitted to PCP. Acknowledgement sent.", level: "success" };
}

export async function respondDeficiency(deficiencyId: number, note: string): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.deficiency.respond");
  const def = await db.query.deficiencies.findFirst({ where: and(eq(schema.deficiencies.id, deficiencyId), eq(schema.deficiencies.institutionId, inst.id)) });
  if (!def) return { ok: false, message: "Not found", level: "error" };
  if (!note || note.length < 5) return { ok: false, message: "Describe what you did to fix it.", level: "error" };
  const app = await db.query.applications.findFirst({ where: eq(schema.applications.id, def.applicationId) });
  if (!app) return { ok: false, message: "Not found", level: "error" };
  await db.transaction(async (tx) => {
    await tx.update(schema.deficiencies).set({ status: "RESPONDED", responseNote: note, respondedBy: user.username, respondedAt: new Date() }).where(eq(schema.deficiencies.id, def.id));
    await audit(tx, { actor: user.username, action: "deficiency.responded", entity: "deficiency", entityId: def.ref });
    const open = await tx.select().from(schema.deficiencies).where(and(eq(schema.deficiencies.applicationId, app.id), inArray(schema.deficiencies.status, ["OUTSTANDING", "REJECTED"])));
    if (open.length === 0 && app.status === "DEFICIENCY_RAISED") {
      await tx.update(schema.applications).set({ status: "RESPONDED", updatedAt: new Date() }).where(eq(schema.applications.id, app.id));
      await tx.insert(schema.applicationEvents).values({ applicationId: app.id, fromStatus: "DEFICIENCY_RAISED", toStatus: "RESPONDED", actor: user.username, actorRole: user.role, note: "All deficiencies answered" });
      await notify(tx, "role:pcp_officer", `Deficiencies answered: ${app.ref}`, `${inst.shortCode} responded to all deficiencies.`, `/pcp/applications/${app.ref}`);
    }
  });
  revalidatePath(`/institution/applications/${app.ref}`);
  return { ok: true, message: "Response submitted to PCP.", level: "success" };
}
