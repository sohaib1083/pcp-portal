"use server";
// People as users (RFP 4.1.2, 4.1.3): provincial councils, faculty self-service, student requests and the
// officer sign-in code. Every decision needs a one-time code; every change is audited and notified.
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { createUser, findUser } from "@/lib/keycloak-admin";
import { sendEmail } from "@/lib/messages";
import { OFFICER_CODE_PURPOSE, needsOfficerCode, rememberOfficerCode } from "@/lib/officer-code";
import { issueOtp, requireOtp, verifyOtp } from "@/lib/otp";
import { facultyForUser, nextCertificateNo, nextPeopleRef, studentCertificatePdf, studentCheckUrl } from "@/lib/people";
import { STUDENT_DOCUMENT, STUDENT_REQUEST_LABELS } from "@/lib/people-shared";
import { checkImportFile, sampleImportFile, type ImportReport } from "@/lib/pharmacist-import";
import { councilName, institutionInProvince, notifyCouncil, requireProvince } from "@/lib/province";
import { fileDocument } from "@/lib/letters";
import { nextYearRef, notifyVerifiers, thisYear, today } from "@/lib/registry";
import { DESIGNATIONS } from "@/lib/registry-shared";
import type { Drill, DrillKind, DrillResult } from "@/lib/report-types";
import { drillList } from "@/lib/reports";
import { HOME_BY_KIND, ROLE_LABELS } from "@/lib/roles";
import { getUser, requireInstitution, requirePermission, requireUser } from "@/lib/session";
import { notify } from "@/lib/util";
import { PROGRAM_LABELS } from "@/lib/workflow";
import type { ActionResult } from "./faculty";
import { runImport } from "./pharmacists";

const fail = (message: string, level: ActionResult["level"] = "error"): ActionResult => ({ ok: false, level, message });
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ====================================================================================================
// Officer sign-in code (RFP 4.1.3, 4.1.16)
// ====================================================================================================

/** Send the sign-in code by SMS (simulated). In the demo build the code also comes back so the screen can fill it in. */
export async function sendSigninCode(): Promise<{ ok: boolean; message: string; sentTo?: string; demoCode?: string }> {
  const user = await getUser();
  if (!user) return { ok: false, message: "Your session has ended. Sign in again." };
  if (!needsOfficerCode(user.roles)) return { ok: false, message: "Your account does not need a sign-in code." };
  const r = await issueOtp(user.username, OFFICER_CODE_PURPOSE);
  await audit(db, { actor: user.username, action: "signin.code.sent", entity: "user", entityId: user.username, details: { sentTo: r.sentTo } });
  return { ok: true, message: `Code sent to ${r.sentTo}.`, sentTo: r.sentTo, demoCode: process.env.DEMO_MODE === "1" ? r.demoCode : undefined };
}

/** Check the sign-in code and remember it for this sign-in. Returns where to go next. */
export async function confirmSigninCode(code: string, next: string): Promise<{ ok: boolean; message: string; next?: string }> {
  const user = await getUser();
  if (!user) return { ok: false, message: "Your session has ended. Sign in again." };
  const clean = String(code ?? "").replace(/\D/g, "");
  if (clean.length !== 6) return { ok: false, message: "Type the 6-digit code from the SMS." };
  if (!(await verifyOtp(user.username, OFFICER_CODE_PURPOSE, clean))) {
    await audit(db, { actor: user.username, action: "signin.code.failed", entity: "user", entityId: user.username });
    return { ok: false, message: "That code is wrong or has expired. Send a new code and try again." };
  }
  await rememberOfficerCode();
  await audit(db, { actor: user.username, action: "signin.code.verified", entity: "user", entityId: user.username });
  const home = HOME_BY_KIND[user.kind];
  const target = typeof next === "string" && next.startsWith(home) && !next.startsWith("//") ? next : home;
  return { ok: true, message: "Code accepted.", next: target };
}

// ====================================================================================================
// Provincial council: validation routing and regional reporting (RFP 4.1.2)
// ====================================================================================================

function refreshPharmacists(id?: number) {
  revalidatePath("/province/pharmacists");
  revalidatePath("/pcp/pharmacists");
  if (id) {
    revalidatePath(`/pcp/pharmacists/${id}`);
    revalidatePath(`/province/pharmacists/${id}`);
  }
  revalidatePath("/pharmacist");
}

/**
 * The council validates (or returns) a pharmacist's practice update before PCP registration sees it.
 * Only updates of registrations this council issued; a one-time code is required.
 */
export async function validatePracticeUpdate(updateId: number, decision: "VALIDATED" | "RETURNED", note: string, otp: string): Promise<ActionResult> {
  const ctx = await requireProvince();
  const u = await db.query.practiceUpdates.findFirst({ where: eq(schema.practiceUpdates.id, Number(updateId)) });
  const p = u ? await db.query.pharmacists.findFirst({ where: eq(schema.pharmacists.id, u.pharmacistId) }) : null;
  // Another council's update reads exactly like a missing one.
  if (!u || !p || p.council !== ctx.province) return fail("This update is not in your council's queue. Reload the page.");
  if (u.status !== "WITH_COUNCIL") return fail("This update was already validated, returned or replaced. Reload the page.", "warning");
  const why = String(note ?? "").trim();
  if (decision === "RETURNED" && why.length < 10) return fail("Tell the pharmacist what is wrong and what to send instead (at least 10 characters).");
  try {
    await requireOtp(ctx.user.username, `validation:practice-${u.id}`, otp);
  } catch (e) {
    return fail(errText(e));
  }
  const now = new Date();
  const done = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.practiceUpdates)
      .set(decision === "VALIDATED" ? { status: "PENDING" } : { status: "REJECTED", reviewedBy: ctx.user.username, reviewedAt: now, reviewNote: `Returned by the ${ctx.councilName}: ${why}` })
      .where(and(eq(schema.practiceUpdates.id, u.id), eq(schema.practiceUpdates.status, "WITH_COUNCIL")))
      .returning({ id: schema.practiceUpdates.id });
    if (!row) return false;
    await tx.insert(schema.provincialValidations).values({ entity: "PRACTICE_UPDATE", entityId: u.id, council: ctx.province, status: decision, note: why || null, decidedBy: ctx.user.username, decidedAt: now });
    if (decision === "RETURNED" && u.evidenceDocumentId) await tx.update(schema.documents).set({ verificationStatus: "REJECTED" }).where(eq(schema.documents.id, u.evidenceDocumentId));
    await tx.insert(schema.pharmacistEvents).values({
      pharmacistId: p.id,
      kind: "PROVINCE",
      note:
        decision === "VALIDATED"
          ? `Validated by the ${ctx.councilName}: ${u.designation}, ${u.practicePlace}.${why ? ` Note: ${why}` : ""} Sent to PCP registration.`
          : `Returned by the ${ctx.councilName}: ${why}`,
      actor: ctx.user.username,
    });
    await audit(tx, { actor: ctx.user.username, action: decision === "VALIDATED" ? "pharmacist.practice.council_validated" : "pharmacist.practice.council_returned", entity: "pharmacist", entityId: p.regNo, details: { updateId: u.id, council: ctx.province, note: why } });
    if (decision === "VALIDATED") {
      for (const role of ["role:pcp_registration", "role:pcp_officer"])
        await notify(tx, role, `Practice update validated by the ${ctx.councilName}`, `${p.fullName} (${p.regNo}): ${u.designation}, ${u.practicePlace}. The council validated it; verify or reject it.`, "/pcp/pharmacists?tab=updates");
      if (p.username) await notify(tx, `user:${p.username}`, "Your practice update is with PCP", `The ${ctx.councilName} validated ${u.designation}, ${u.practicePlace}. PCP registration verifies it next.`, "/pharmacist");
    } else if (p.username) await notify(tx, `user:${p.username}`, "Your practice update was returned", `The ${ctx.councilName} returned ${u.practicePlace}: ${why}`, "/pharmacist");
    else if (p.email) await sendEmail(tx, { to: p.email, toName: p.fullName, subject: "Your practice update was returned", body: `The ${ctx.councilName} returned ${u.practicePlace}: ${why}`, entity: "pharmacist", entityRef: p.regNo });
    return true;
  });
  refreshPharmacists(p.id);
  if (!done) return fail("This update was already validated, returned or replaced. Reload the page.", "warning");
  return decision === "VALIDATED"
    ? { ok: true, level: "success", message: `Validated. ${p.fullName}'s update is now with PCP registration, marked "Validated by the ${ctx.councilName}".` }
    : { ok: true, level: "success", message: `Returned to ${p.fullName} with your reason. PCP will not see it.` };
}

/** Check a register file from the council's own records. Nothing is saved. */
export async function checkCouncilFile(fileName: string, text: string): Promise<ImportReport | { ok: false; message: string }> {
  const ctx = await requireProvince();
  if (!ctx.council) return { ok: false, message: `${ctx.province} has no pharmacy council register in PCP's index.` };
  if (String(text ?? "").length > 900_000) return { ok: false, message: "The file is larger than 900 KB. Split it into smaller files." };
  return checkImportFile(ctx.council, String(fileName ?? "register.csv").slice(0, 120), String(text ?? ""));
}

/** Demo: a sample register file in the council's own number format, with a few deliberate errors. */
export async function sampleCouncilFile(): Promise<{ ok: boolean; message?: string; fileName?: string; csv?: string }> {
  const ctx = await requireProvince();
  if (!ctx.council) return { ok: false, message: `${ctx.province} has no pharmacy council register in PCP's index.` };
  return { ok: true, ...(await sampleImportFile(ctx.council)) };
}

/** The council validates a register file and sends it to PCP registration, which loads it into the index. */
export async function submitCouncilFile(fileName: string, text: string, note: string, otp: string): Promise<ActionResult & { ref?: string }> {
  const ctx = await requireProvince();
  if (!ctx.council) return fail(`${ctx.province} has no pharmacy council register in PCP's index.`);
  const name = String(fileName ?? "register.csv").slice(0, 120);
  const report = await checkImportFile(ctx.council, name, String(text ?? ""));
  if (!report.ok) return fail(report.message ?? "The file could not be read.");
  if (!report.ready) return fail("No row is ready to send. Fix the errors in the file and check it again.");
  try {
    await requireOtp(ctx.user.username, `validation:council-file`, otp);
  } catch (e) {
    return fail(errText(e));
  }
  let ref = "";
  await db.transaction(async (tx) => {
    ref = await nextPeopleRef(tx, "PCF");
    await tx.insert(schema.councilFiles).values({
      ref,
      council: ctx.council!,
      fileName: name,
      content: String(text),
      totalRows: report.total,
      readyRows: report.ready,
      errorRows: report.withErrors,
      note: String(note ?? "").trim().slice(0, 500) || null,
      submittedBy: ctx.user.username,
    });
    await audit(tx, { actor: ctx.user.username, action: "council.file.validated", entity: "council_file", entityId: ref, details: { council: ctx.council, fileName: name, total: report.total, ready: report.ready, errors: report.withErrors } });
    for (const role of ["role:pcp_registration", "role:pcp_officer"])
      await notify(tx, role, `${ref}: register file from the ${ctx.councilName}`, `${report.ready} of ${report.total} rows validated by the council (${ctx.user.name}). Load it into the register.`, "/pcp/pharmacists?tab=imports");
  });
  refreshPharmacists();
  return {
    ok: true,
    level: report.withErrors ? "warning" : "success",
    ref,
    message: `${ref} sent to PCP registration: ${report.ready} rows validated by the ${ctx.councilName}.${report.withErrors ? ` ${report.withErrors} rows with errors stay out until you fix them.` : ""}`,
  };
}

/** PCP registration loads a council-validated file: the normal import runs, and each row records the council's validation. */
export async function loadCouncilFile(id: number, otp: string): Promise<ActionResult & { ref?: string }> {
  const user = await requirePermission("pcp.pharmacists.manage");
  const f = await db.query.councilFiles.findFirst({ where: eq(schema.councilFiles.id, Number(id)) });
  if (!f) return fail("This file no longer exists. Reload the page.");
  if (f.status !== "WITH_PCP") return fail(`${f.ref} was already ${f.status === "LOADED" ? "loaded" : "returned"}.`, "warning");
  try {
    await requireOtp(user.username, `decision:${f.ref}`, otp);
  } catch (e) {
    return fail(errText(e));
  }
  const r = await runImport(f.council, f.fileName, f.content);
  if (!r.ok || !r.ref) return { ok: false, level: r.level ?? "error", message: `${f.ref} was not loaded. ${r.message}` };
  const imp = await db.query.pharmacistImports.findFirst({ where: eq(schema.pharmacistImports.ref, r.ref) });
  const name = councilName(f.council);
  await db.transaction(async (tx) => {
    await tx.update(schema.councilFiles).set({ status: "LOADED", decidedBy: user.username, decidedAt: new Date(), importRef: r.ref }).where(eq(schema.councilFiles.id, f.id));
    if (imp) {
      const added = await tx.select({ id: schema.pharmacists.id }).from(schema.pharmacists).where(eq(schema.pharmacists.importId, imp.id));
      // The council validated the rows before PCP loaded them, so the event carries the validation time.
      if (added.length)
        await tx.insert(schema.pharmacistEvents).values(
          added.map((a) => ({ pharmacistId: a.id, kind: "PROVINCE", note: `Validated by the ${name} in file ${f.ref} (${f.fileName}) before PCP loaded it.`, actor: f.submittedBy, createdAt: f.submittedAt })),
        );
    }
    await audit(tx, { actor: user.username, action: "council.file.loaded", entity: "council_file", entityId: f.ref, details: { importRef: r.ref, council: f.council } });
    await notifyCouncil(tx, f.council, `${f.ref} loaded into PCP's register`, `PCP registration loaded your file ${f.fileName} as ${r.ref}. ${r.message}`, "/province/pharmacists?tab=files");
  });
  refreshPharmacists();
  return { ok: true, level: r.level ?? "success", ref: r.ref, message: `${f.ref} loaded. ${r.message}` };
}

/** PCP registration returns a council file without loading it. */
export async function returnCouncilFile(id: number, note: string, otp: string): Promise<ActionResult> {
  const user = await requirePermission("pcp.pharmacists.manage");
  const f = await db.query.councilFiles.findFirst({ where: eq(schema.councilFiles.id, Number(id)) });
  if (!f || f.status !== "WITH_PCP") return fail("Only a file waiting for PCP can be returned. Reload the page.");
  const why = String(note ?? "").trim();
  if (why.length < 10) return fail("Tell the council what to fix (at least 10 characters).");
  try {
    await requireOtp(user.username, `decision:${f.ref}`, otp);
  } catch (e) {
    return fail(errText(e));
  }
  await db.transaction(async (tx) => {
    await tx.update(schema.councilFiles).set({ status: "RETURNED", decidedBy: user.username, decidedAt: new Date(), decisionNote: why }).where(eq(schema.councilFiles.id, f.id));
    await audit(tx, { actor: user.username, action: "council.file.returned", entity: "council_file", entityId: f.ref, details: { note: why } });
    await notifyCouncil(tx, f.council, `${f.ref} returned by PCP`, `PCP registration did not load ${f.fileName}: ${why}`, "/province/pharmacists?tab=files");
  });
  refreshPharmacists();
  return { ok: true, level: "success", message: `${f.ref} returned to the ${councilName(f.council)} with your note.` };
}

const PROVINCE_DRILLS: DrillKind[] = ["institutions", "students", "faculty", "programmes", "deficiencies", "returns", "faculty-moves", "cases", "return-timeliness"];

/** The list behind a report figure, for a provincial officer: always their own province, never another's institutions. */
export async function provinceDrill(d: Drill): Promise<{ ok: true; result: DrillResult } | { ok: false; message: string }> {
  const ctx = await requireProvince();
  if (!d || !PROVINCE_DRILLS.includes(d.kind)) return { ok: false, message: "This list is not available for your province." };
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(d.params ?? {})) if (v !== undefined && v !== null && v !== "") params[k] = typeof v === "number" ? v : String(v).slice(0, 400);
  params.province = ctx.province; // the officer's province, whatever the request says
  const codes = [...(typeof params.code === "string" ? [params.code] : []), ...(typeof params.codes === "string" ? params.codes.split(",").filter((c) => c && c !== "-") : [])];
  for (const c of codes) if (!(await institutionInProvince(c, ctx.province))) return { ok: false, message: "This list is not available for your province." };
  const result = await drillList({ kind: d.kind, params, label: String(d.label ?? "").slice(0, 160) });
  await audit(db, { actor: ctx.user.username, action: "report.list.viewed", entity: "report", entityId: d.kind, details: { params, rows: result.rows.length, province: ctx.province } });
  return { ok: true, result };
}

// ====================================================================================================
// Faculty self-service (RFP 4.1.2: academic profile updates, attachment declarations, verification requests)
// ====================================================================================================

async function facultyContext() {
  const user = await requireUser("faculty");
  const person = await facultyForUser(user.username);
  return { user, person };
}

function refreshFaculty() {
  revalidatePath("/faculty");
  revalidatePath("/pcp/verification");
  revalidatePath("/institution/faculty");
}

/** The teacher asks PCP to verify their record (for example after an institution added them). */
export async function requestFacultyVerification(note: string): Promise<ActionResult & { ref?: string }> {
  const { user, person } = await facultyContext();
  if (!person) return fail("Your login is not linked to a PCP Faculty ID yet. Ask PCP's verification desk to link it.");
  if (person.verificationStatus === "REJECTED") return fail("PCP deactivated this record as a duplicate. Contact PCP's verification desk.");
  const open = await db.query.facultyRequests.findFirst({ where: and(eq(schema.facultyRequests.facultyId, person.id), eq(schema.facultyRequests.kind, "VERIFICATION"), eq(schema.facultyRequests.status, "PENDING")) });
  if (open) return fail(`Your verification request ${open.ref} is already with PCP.`, "warning");
  const why = String(note ?? "").trim().slice(0, 500);
  let ref = "";
  await db.transaction(async (tx) => {
    ref = await nextPeopleRef(tx, "FUR");
    await tx.insert(schema.facultyRequests).values({ ref, facultyId: person.id, kind: "VERIFICATION", note: why || null, requestedBy: user.username });
    await notifyVerifiers(tx, `Verification request ${ref}`, `${person.fullName} (${person.pcpId}) asks PCP to verify their record.${why ? ` Note: ${why}` : ""}`, "/pcp/verification?tab=faculty-requests");
    await audit(tx, { actor: user.username, action: "faculty.self.verification_requested", entity: "faculty", entityId: person.pcpId, details: { ref, note: why } });
  });
  refreshFaculty();
  return { ok: true, level: "success", ref, message: `Verification request ${ref} sent to PCP. You will see the decision here.` };
}

export type AttachmentInput = { action: "JOINED" | "LEFT"; institutionCode?: string; programType?: string; designation?: string; date?: string; linkId?: number; reason: string; category?: string };

/**
 * The teacher declares joining or leaving an institution. It becomes a link request (joined) or an end-of-appointment
 * change request (left) in the registry, so PCP decides it the usual way; the institution and PCP are notified.
 */
export async function declareAttachment(raw: AttachmentInput): Promise<ActionResult & { ref?: string }> {
  const { user, person } = await facultyContext();
  if (!person) return fail("Your login is not linked to a PCP Faculty ID yet. Ask PCP's verification desk to link it.");
  if (person.verificationStatus === "REJECTED") return fail("PCP deactivated this record as a duplicate. Contact PCP's verification desk.");
  const reason = String(raw?.reason ?? "").trim();
  if (reason.length < 5) return fail("Say in a few words what happened, for example: Appointed Lecturer from 1 November.");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(raw?.date ?? "")) ? String(raw.date) : today();
  if (date > new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)) return fail("The date is more than 90 days ahead. Declare it closer to the date.");
  const links = await db.select().from(schema.facultyLinks).where(eq(schema.facultyLinks.facultyId, person.id));
  const pendingFcrs = await db.select().from(schema.facultyChangeRequests).where(and(eq(schema.facultyChangeRequests.facultyId, person.id), eq(schema.facultyChangeRequests.status, "PENDING")));

  let fcrRef = "";
  let ref = "";
  let instName = "";
  if (raw.action === "LEFT") {
    const link = links.find((l) => l.id === Number(raw.linkId) && l.status === "ACTIVE");
    if (!link) return fail("Choose the appointment you left. Only an active appointment can be ended.");
    if (date < link.startDate) return fail("The date you left is before the appointment started.");
    const open = pendingFcrs.find((r) => r.linkId === link.id);
    if (open) return fail(`Request ${open.ref} for this appointment is already with PCP.`, "warning");
    const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, link.institutionId) });
    if (!inst) return fail("Institution not found.");
    instName = inst.name;
    await db.transaction(async (tx) => {
      fcrRef = await nextYearRef(tx, "FCR");
      await tx.insert(schema.facultyChangeRequests).values({
        ref: fcrRef,
        facultyId: person.id,
        linkId: link.id,
        institutionId: inst.id,
        kind: "END_LINK",
        details: { changes: { status: { from: "ACTIVE", to: "ENDED" }, endDate: { from: null, to: date } }, category: raw.category || "Declared by the teacher", declaredBy: "faculty" },
        reason: `Declared by ${person.fullName}: ${reason}`,
        requestedBy: user.username,
      });
      ref = await nextPeopleRef(tx, "FUR");
      await tx.insert(schema.facultyRequests).values({
        ref,
        facultyId: person.id,
        kind: "ATTACHMENT",
        status: "FORWARDED",
        note: reason,
        details: { action: "LEFT", institutionId: inst.id, institutionCode: inst.code, institutionName: inst.name, programType: link.programType, date, linkId: link.id, fcrRef },
        requestedBy: user.username,
      });
      await notify(tx, `inst:${inst.code}`, `${person.fullName} declared leaving`, `${person.fullName} (${person.pcpId}) told PCP they left ${inst.shortCode} on ${date}: ${reason}. PCP decides change request ${fcrRef}. If this is wrong, tell PCP through the help desk.`, "/institution/faculty");
      await notifyVerifiers(tx, `Change request ${fcrRef} declared by the teacher`, `${person.fullName} (${person.pcpId}) declared leaving ${inst.shortCode} on ${date}. ${inst.shortCode} has been told.`, "/pcp/verification?tab=changes");
      await audit(tx, { actor: user.username, action: "faculty.self.attachment_declared", entity: "faculty", entityId: person.pcpId, details: { ref, fcrRef, action: "LEFT", institution: inst.code, date } });
    });
  } else if (raw.action === "JOINED") {
    const inst = raw.institutionCode ? await db.query.institutions.findFirst({ where: eq(schema.institutions.code, String(raw.institutionCode)) }) : null;
    if (!inst || inst.status !== "ACTIVE") return fail("Choose the institution you joined from the list.");
    const programType = String(raw.programType ?? "");
    const offered = (await db.select({ type: schema.programs.type }).from(schema.programs).where(eq(schema.programs.institutionId, inst.id))).map((p) => p.type);
    if (!offered.includes(programType)) return fail(`${inst.shortCode} has no ${PROGRAM_LABELS[programType] ?? "such"} programme on record. Choose the programme you teach in.`);
    const designation = String(raw.designation ?? "");
    if (!DESIGNATIONS.includes(designation)) return fail("Choose your designation from the list.");
    if (links.some((l) => l.status === "REQUESTED")) return fail("A link request for you is already with PCP. Wait for PCP's decision first.", "warning");
    const active = links.find((l) => l.status === "ACTIVE");
    if (active?.institutionId === inst.id) return fail(`You are already active at ${inst.shortCode}.`, "warning");
    if (active && !pendingFcrs.some((r) => r.linkId === active.id && r.kind === "END_LINK"))
      return fail("You are still active at another institution. A teacher is active at one institution at a time: first declare that you left it, then declare the new one.");
    instName = inst.name;
    await db.transaction(async (tx) => {
      const [link] = await tx.insert(schema.facultyLinks).values({ facultyId: person.id, institutionId: inst.id, programType, status: "REQUESTED", startDate: date, createdBy: user.username }).returning();
      fcrRef = await nextYearRef(tx, "FCR");
      const changes: Record<string, { from: string | null; to: string | null }> = { programType: { from: null, to: programType } };
      if (designation !== person.designation) changes.designation = { from: person.designation, to: designation };
      await tx.insert(schema.facultyChangeRequests).values({
        ref: fcrRef,
        facultyId: person.id,
        linkId: link.id,
        institutionId: inst.id,
        kind: "NEW_LINK",
        details: { changes, declaredBy: "faculty" },
        reason: `Declared by ${person.fullName}: joined as ${designation}, ${PROGRAM_LABELS[programType]}, from ${date}. ${reason}`,
        requestedBy: user.username,
      });
      ref = await nextPeopleRef(tx, "FUR");
      await tx.insert(schema.facultyRequests).values({
        ref,
        facultyId: person.id,
        kind: "ATTACHMENT",
        status: "FORWARDED",
        note: reason,
        details: { action: "JOINED", institutionId: inst.id, institutionCode: inst.code, institutionName: inst.name, programType, designation, date, linkId: link.id, fcrRef },
        requestedBy: user.username,
      });
      await notify(tx, `inst:${inst.code}`, `${person.fullName} declared joining ${inst.shortCode}`, `${person.fullName} (${person.pcpId}) told PCP they joined your ${PROGRAM_LABELS[programType]} programme as ${designation} from ${date}. They show as Requested on your faculty list until PCP decides ${fcrRef}. If this is wrong, tell PCP through the help desk.`, "/institution/faculty");
      await notifyVerifiers(tx, `Link request ${fcrRef} declared by the teacher`, `${person.fullName} (${person.pcpId}) declared joining ${inst.shortCode} (${PROGRAM_LABELS[programType]}) as ${designation}. ${inst.shortCode} has been told.`, "/pcp/verification?tab=links");
      await audit(tx, { actor: user.username, action: "faculty.self.attachment_declared", entity: "faculty", entityId: person.pcpId, details: { ref, fcrRef, action: "JOINED", institution: inst.code, programType, designation, date } });
    });
  } else return fail("Say whether you joined or left an institution.");
  refreshFaculty();
  return { ok: true, level: "success", ref, message: `Declared (${ref}). ${instName} and PCP were told; PCP decides it as ${raw.action === "JOINED" ? "link request" : "change request"} ${fcrRef}.` };
}

/** Withdraw a profile update or verification request PCP has not decided. */
export async function withdrawFacultyRequest(id: number): Promise<ActionResult> {
  const { user, person } = await facultyContext();
  if (!person) return fail("Your login is not linked to a PCP Faculty ID.");
  const r = await db.query.facultyRequests.findFirst({ where: and(eq(schema.facultyRequests.id, Number(id)), eq(schema.facultyRequests.facultyId, person.id)) });
  if (!r || r.status !== "PENDING") return fail("Only a request PCP has not decided can be withdrawn.");
  await db.transaction(async (tx) => {
    await tx.update(schema.facultyRequests).set({ status: "WITHDRAWN", decidedBy: user.username, decidedAt: new Date(), decisionNote: "Withdrawn by the teacher" }).where(eq(schema.facultyRequests.id, r.id));
    await audit(tx, { actor: user.username, action: "faculty.self.request_withdrawn", entity: "faculty", entityId: person.pcpId, details: { ref: r.ref } });
  });
  refreshFaculty();
  return { ok: true, level: "success", message: `${r.ref} withdrawn. Nothing changed on your record.` };
}

/** PCP decides a teacher's profile update or verification request. Approve applies it; reject keeps the record. */
export async function decideFacultyRequest(id: number, approve: boolean, note: string, otp: string): Promise<ActionResult> {
  const user = await requirePermission("pcp.faculty.verify");
  const r = await db.query.facultyRequests.findFirst({ where: eq(schema.facultyRequests.id, Number(id)) });
  if (!r) return fail("Request not found. Reload the page.");
  if (r.status !== "PENDING") return fail(`${r.ref} is already ${r.status.toLowerCase()}.`, "warning");
  const why = String(note ?? "").trim();
  if (!approve && why.length < 5) return fail("Give the reason, so the teacher knows what to send instead.");
  const person = await db.query.faculty.findFirst({ where: eq(schema.faculty.id, r.facultyId) });
  if (!person) return fail("The faculty record no longer exists.");
  if (approve) {
    const flags = await db.select({ id: schema.duplicateFlags.id }).from(schema.duplicateFlags).where(and(eq(schema.duplicateFlags.recordId, person.id), eq(schema.duplicateFlags.status, "OPEN")));
    if (flags.length) return fail("This person has an open duplicate flag. Resolve it on the Duplicates tab first.");
  }
  try {
    await requireOtp(user.username, `decision:${r.ref}`, otp);
  } catch (e) {
    return fail(errText(e));
  }
  const active = await db
    .select({ code: schema.institutions.code })
    .from(schema.facultyLinks)
    .innerJoin(schema.institutions, eq(schema.institutions.id, schema.facultyLinks.institutionId))
    .where(and(eq(schema.facultyLinks.facultyId, person.id), eq(schema.facultyLinks.status, "ACTIVE")));
  const changes = r.details.changes ?? {};
  await db.transaction(async (tx) => {
    if (approve && r.kind === "PROFILE") {
      const set: Partial<typeof schema.faculty.$inferInsert> = {};
      if (changes.qualification?.to) set.qualification = changes.qualification.to;
      if (changes.specialization?.to) set.specialization = changes.specialization.to;
      if (changes.pcpRegNo) set.pcpRegNo = changes.pcpRegNo.to || null;
      if (Object.keys(set).length) await tx.update(schema.faculty).set(set).where(eq(schema.faculty.id, person.id));
    }
    if (approve && r.kind === "VERIFICATION") await tx.update(schema.faculty).set({ verificationStatus: "VERIFIED" }).where(eq(schema.faculty.id, person.id));
    if (r.evidenceDocumentId) await tx.update(schema.documents).set({ verificationStatus: approve ? "VERIFIED" : "REJECTED" }).where(eq(schema.documents.id, r.evidenceDocumentId));
    await tx.update(schema.facultyRequests).set({ status: approve ? "APPROVED" : "REJECTED", decidedBy: user.username, decidedAt: new Date(), decisionNote: why || null }).where(eq(schema.facultyRequests.id, r.id));
    const what = r.kind === "PROFILE" ? "qualification update" : "verification request";
    await notify(
      tx,
      `user:${r.requestedBy}`,
      `Your ${what} ${r.ref} was ${approve ? "approved" : "not approved"}`,
      approve ? (r.kind === "PROFILE" ? "PCP verified your evidence and updated your Faculty record." : "PCP verified your Faculty record.") : `PCP did not approve it: ${why}. Your record stays as it was.`,
      "/faculty",
    );
    if (approve) for (const a of active) await notify(tx, `inst:${a.code}`, `Faculty record ${person.pcpId} ${r.kind === "PROFILE" ? "updated" : "verified"}`, `PCP ${r.kind === "PROFILE" ? "approved a qualification update for" : "verified"} ${person.fullName} (${person.pcpId}) on the teacher's own request ${r.ref}.`, "/institution/faculty");
    await audit(tx, { actor: user.username, action: approve ? "faculty.self.request_approved" : "faculty.self.request_rejected", entity: "faculty", entityId: person.pcpId, details: { ref: r.ref, kind: r.kind, changes, note: why } });
  });
  refreshFaculty();
  revalidatePath(`/pcp/faculty/${person.pcpId}`);
  return { ok: true, level: "success", message: approve ? `${r.ref} approved and applied. The teacher is notified.` : `${r.ref} not approved. The record is unchanged and the teacher sees your reason.` };
}

/** Create a Keycloak login with the faculty role for a PCP-FAC record. The temporary password is returned once and never stored. */
export async function createFacultyLogin(facultyId: number): Promise<ActionResult & { username?: string; password?: string }> {
  const user = await requirePermission("pcp.faculty.verify");
  const p = await db.query.faculty.findFirst({ where: eq(schema.faculty.id, Number(facultyId)) });
  if (!p) return fail("This faculty record no longer exists.");
  if (p.verificationStatus === "REJECTED") return fail("A record deactivated as a duplicate cannot get a login.");
  const existing = await db.query.facultyAccounts.findFirst({ where: eq(schema.facultyAccounts.facultyId, p.id) });
  if (existing) return fail(`${p.fullName} already signs in as ${existing.username}.`, "warning");
  const first =
    p.fullName
      .replace(/^(Dr|Prof|Mr|Ms|Mrs)\.?\s+/i, "")
      .split(/\s+/)[0]
      .toLowerCase()
      .replace(/[^a-z]/g, "") || "faculty";
  const tail = p.pcpId.replace(/\D/g, "").slice(-4);
  let username = "";
  for (const suffix of ["", "a", "b", "c", "d", "e", "f"]) {
    const candidate = `fac.${first}.${tail}${suffix}`;
    if (await db.query.staff.findFirst({ where: eq(schema.staff.username, candidate) })) continue;
    try {
      if (await findUser(candidate)) continue;
    } catch (e) {
      return fail(`Keycloak could not be reached, so no login was created. ${errText(e)}`);
    }
    username = candidate;
    break;
  }
  if (!username) return fail("Could not find a free username. Try again.");
  const email = `${username}@demo.pcp.local`;
  let password: string;
  try {
    ({ password } = await createUser({ username, email, fullName: p.fullName, role: "faculty" }));
  } catch (e) {
    return fail(`Keycloak did not create the login: ${errText(e)}`);
  }
  await db.transaction(async (tx) => {
    await tx.insert(schema.staff).values({ username, displayName: p.fullName, email, role: "faculty", createdBy: user.username });
    await tx.insert(schema.facultyAccounts).values({ username, facultyId: p.id, createdBy: user.username });
    await audit(tx, { actor: user.username, action: "faculty.login.created", entity: "faculty", entityId: p.pcpId, details: { username } });
    await sendEmail(tx, {
      to: email,
      toName: p.fullName,
      subject: "Your PCP faculty login",
      body: `A login was created for you: ${username}. PCP gives you a temporary password; you set your own at first sign-in. You can then keep your academic profile current, declare institutional attachments and request verification.`,
      entity: "faculty",
      entityRef: p.pcpId,
    });
  });
  revalidatePath(`/pcp/faculty/${p.pcpId}`);
  return { ok: true, level: "success", username, password, message: `Login ${username} created for ${p.fullName}.` };
}

// ====================================================================================================
// Student requests (RFP 4.1.2: registration requests, lifecycle tracking, certificate printing)
// ====================================================================================================

function refreshStudents() {
  revalidatePath("/student");
  revalidatePath("/institution/students");
  revalidatePath("/pcp/verification");
}

export async function withdrawStudentRequest(id: number): Promise<ActionResult> {
  const user = await requireUser("student");
  const s = await db.query.students.findFirst({ where: eq(schema.students.username, user.username) });
  const r = s ? await db.query.studentRequests.findFirst({ where: and(eq(schema.studentRequests.id, Number(id)), eq(schema.studentRequests.studentId, s.id)) }) : null;
  if (!s || !r || !["WITH_INSTITUTION", "RETURNED"].includes(r.status)) return fail("Only a request that is still with your institution can be withdrawn.");
  await db.transaction(async (tx) => {
    await tx.update(schema.studentRequests).set({ status: "WITHDRAWN", updatedAt: new Date() }).where(eq(schema.studentRequests.id, r.id));
    await audit(tx, { actor: user.username, action: "student.request.withdrawn", entity: "student", entityId: s.pcpId, details: { ref: r.ref } });
  });
  refreshStudents();
  return { ok: true, level: "success", message: `${r.ref} withdrawn.` };
}

/**
 * The examination officer checks the request against the institution's records and forwards it to PCP, or returns it.
 * For an eligibility certificate, forwarding also runs the degree check with the university and HEC (simulated).
 */
export async function forwardStudentRequest(id: number, note: string): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.annual.file");
  const r = await db.query.studentRequests.findFirst({ where: and(eq(schema.studentRequests.id, Number(id)), eq(schema.studentRequests.institutionId, inst.id)) });
  if (!r) return fail("Request not found. Reload the page.");
  if (r.status !== "WITH_INSTITUTION") return fail(`${r.ref} is no longer waiting for your institution.`, "warning");
  const s = await db.query.students.findFirst({ where: eq(schema.students.id, r.studentId) });
  if (!s) return fail("The student record no longer exists.");
  const why = String(note ?? "").trim().slice(0, 500);
  let degreeLine = "";
  const details = { ...r.details };
  if (r.kind === "ELIGIBILITY") {
    if (s.status !== "GRADUATED") return fail(`${s.fullName} has not graduated on your records. Record the final result first, or return the request.`);
    if (!s.degreeVerified) {
      await new Promise((res) => setTimeout(res, 600)); // the simulated university/HEC service answers
      details.degreeRef = `HEC-DV-${thisYear()}-${String(s.id * 7919).padStart(6, "0").slice(-6)}`;
      degreeLine = ` Degree confirmed with the university and HEC (simulated, ref ${details.degreeRef}).`;
    }
  }
  await db.transaction(async (tx) => {
    if (details.degreeRef && !s.degreeVerified) {
      await tx.update(schema.students).set({ degreeVerified: true, eligibleForRegistration: true }).where(eq(schema.students.id, s.id));
      await audit(tx, { actor: user.username, action: "student.degree.verified", entity: "student", entityId: s.pcpId, details: { source: "University and HEC record (simulated)", reference: details.degreeRef, request: r.ref } });
    }
    await tx.update(schema.studentRequests).set({ status: "WITH_PCP", details, institutionBy: user.username, institutionAt: new Date(), institutionNote: why || null, updatedAt: new Date() }).where(eq(schema.studentRequests.id, r.id));
    await notifyVerifiers(tx, `Student request ${r.ref}`, `${inst.shortCode} forwarded ${s.fullName}'s request (${STUDENT_REQUEST_LABELS[r.kind]}).${degreeLine}`, "/pcp/verification?tab=student-requests");
    if (s.username) await notify(tx, `user:${s.username}`, `${r.ref} is with PCP`, `${inst.shortCode} checked your request (${STUDENT_REQUEST_LABELS[r.kind].toLowerCase()}) and sent it to PCP.${degreeLine}`, "/student");
    await audit(tx, { actor: user.username, action: "student.request.forwarded", entity: "student", entityId: s.pcpId, details: { ref: r.ref, kind: r.kind, note: why, degreeRef: details.degreeRef } });
  });
  refreshStudents();
  return { ok: true, level: "success", message: `${r.ref} forwarded to PCP.${degreeLine}` };
}

export async function returnStudentRequest(id: number, note: string): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.annual.file");
  const r = await db.query.studentRequests.findFirst({ where: and(eq(schema.studentRequests.id, Number(id)), eq(schema.studentRequests.institutionId, inst.id)) });
  if (!r || r.status !== "WITH_INSTITUTION") return fail("Only a request waiting for your institution can be returned.");
  const why = String(note ?? "").trim();
  if (why.length < 10) return fail("Tell the student what is wrong and what to do (at least 10 characters).");
  const s = await db.query.students.findFirst({ where: eq(schema.students.id, r.studentId) });
  await db.transaction(async (tx) => {
    await tx.update(schema.studentRequests).set({ status: "RETURNED", institutionBy: user.username, institutionAt: new Date(), institutionNote: why, updatedAt: new Date() }).where(eq(schema.studentRequests.id, r.id));
    if (s?.username) await notify(tx, `user:${s.username}`, `${r.ref} returned by ${inst.shortCode}`, `${inst.shortCode} returned your request: ${why}`, "/student");
    await audit(tx, { actor: user.username, action: "student.request.returned", entity: "student", entityId: s?.pcpId ?? r.studentId, details: { ref: r.ref, note: why } });
  });
  refreshStudents();
  return { ok: true, level: "success", message: `${r.ref} returned to the student with your note.` };
}

/** PCP verification decides a forwarded request: a correction is applied, a letter or certificate is issued as a PDF with a QR code. */
export async function decideStudentRequest(id: number, approve: boolean, note: string, otp: string): Promise<ActionResult & { certificateNo?: string }> {
  const user = await requirePermission("pcp.faculty.verify");
  const r = await db.query.studentRequests.findFirst({ where: eq(schema.studentRequests.id, Number(id)) });
  if (!r) return fail("Request not found. Reload the page.");
  if (r.status !== "WITH_PCP") return fail(`${r.ref} is not waiting for PCP.`, "warning");
  const s = await db.query.students.findFirst({ where: eq(schema.students.id, r.studentId) });
  const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, r.institutionId) });
  if (!s || !inst) return fail("The student record no longer exists.");
  const why = String(note ?? "").trim();
  if (!approve && why.length < 5) return fail("Give the reason, so the student and the institution know what to do.");
  if (approve && r.kind === "ELIGIBILITY" && (s.status !== "GRADUATED" || !s.degreeVerified)) return fail("The degree is not verified yet. Return to the institution's check, or reject with a reason.");
  if (approve && r.kind === "ENROLMENT_LETTER" && s.status === "WITHDRAWN") return fail(`${s.fullName} withdrew from the programme, so PCP cannot confirm enrolment. Reject with a reason.`);
  try {
    await requireOtp(user.username, `decision:${r.ref}`, otp);
  } catch (e) {
    return fail(errText(e));
  }
  let certificateNo: string | undefined;
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      if (!approve) {
        await tx.update(schema.studentRequests).set({ status: "REJECTED", pcpBy: user.username, pcpAt: now, pcpNote: why, updatedAt: now }).where(eq(schema.studentRequests.id, r.id));
        if (r.evidenceDocumentId) await tx.update(schema.documents).set({ verificationStatus: "REJECTED" }).where(eq(schema.documents.id, r.evidenceDocumentId));
      } else if (r.kind === "CORRECTION") {
        const set: Partial<typeof schema.students.$inferInsert> = {};
        for (const [k, c] of Object.entries(r.details.changes ?? {})) {
          if (k === "fullName" && c.to) set.fullName = c.to;
          if (k === "fatherName" && c.to) set.fatherName = c.to;
          if (k === "shift" && c.to) set.shift = c.to;
        }
        if (Object.keys(set).length) await tx.update(schema.students).set(set).where(eq(schema.students.id, s.id));
        if (r.evidenceDocumentId) await tx.update(schema.documents).set({ verificationStatus: "VERIFIED" }).where(eq(schema.documents.id, r.evidenceDocumentId));
        await tx.update(schema.studentRequests).set({ status: "APPLIED", pcpBy: user.username, pcpAt: now, pcpNote: why || null, updatedAt: now }).where(eq(schema.studentRequests.id, r.id));
      } else {
        certificateNo = await nextCertificateNo(tx);
        if (r.kind === "ELIGIBILITY" && !s.eligibleForRegistration) await tx.update(schema.students).set({ eligibleForRegistration: true }).where(eq(schema.students.id, s.id));
        const pdf = await studentCertificatePdf({ kind: r.kind, no: certificateNo, student: { ...s, eligibleForRegistration: true }, inst, purpose: r.details.purpose, signedBy: { name: user.name, title: `${ROLE_LABELS[user.role] ?? "Officer"}, Pharmacy Council of Pakistan` }, issuedAt: now });
        const doc = await fileDocument(tx, { institutionId: inst.id, folder: `student-documents/certificates/${s.pcpId}`, docType: STUDENT_DOCUMENT[r.kind], fileName: `${certificateNo}.pdf`, bytes: pdf, uploadedBy: user.username, verificationStatus: "VERIFIED" });
        await tx.update(schema.studentRequests).set({ status: "ISSUED", pcpBy: user.username, pcpAt: now, pcpNote: why || null, certificateNo, certificateDocumentId: doc.id, updatedAt: now }).where(eq(schema.studentRequests.id, r.id));
      }
      const label = STUDENT_REQUEST_LABELS[r.kind];
      const outcome = !approve ? `not approved: ${why}` : r.kind === "CORRECTION" ? "approved; your record is corrected" : `issued as ${certificateNo}. Download or print it from your record; its QR code opens ${studentCheckUrl(certificateNo!)}`;
      if (s.username) await notify(tx, `user:${s.username}`, `${r.ref} ${approve ? "approved" : "not approved"}`, `${label}: ${outcome}.`, "/student");
      await notify(tx, `inst:${inst.code}`, `${r.ref} ${approve ? "approved" : "not approved"} by PCP`, `${s.fullName} (${s.pcpId}), ${label.toLowerCase()}: ${outcome}.`, "/institution/students");
      await audit(tx, { actor: user.username, action: approve ? (r.kind === "CORRECTION" ? "student.request.applied" : "student.certificate.issued") : "student.request.rejected", entity: "student", entityId: s.pcpId, details: { ref: r.ref, kind: r.kind, certificateNo, note: why } });
    });
  } catch (e) {
    return fail(`Nothing was saved: ${errText(e)}`);
  }
  refreshStudents();
  return approve
    ? { ok: true, level: "success", certificateNo, message: r.kind === "CORRECTION" ? `${r.ref} approved: the record is corrected. The student and the institution are notified.` : `${STUDENT_DOCUMENT[r.kind]} ${certificateNo} issued. The student can download and print it.` }
    : { ok: true, level: "success", message: `${r.ref} not approved. The student and the institution see your reason.` };
}
