"use server";
import { revalidatePath } from "next/cache";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { AnnualFigures } from "@/db/modules/students";
import { audit } from "@/lib/audit";
import { normalizeCnic } from "@/lib/names";
import { requireOtp } from "@/lib/otp";
import { lockedReturn, lockedYears, nextStudentIds, nextYearRef, notifyVerifiers, thisYear } from "@/lib/registry";
import { FIGURE_KEYS, FIGURE_LABELS, PROGRAMME_YEARS, annualReturnDue, applyCorrections, figureProblems, type FigureChange, type UploadRow } from "@/lib/registry-shared";
import { requireInstitution, requirePermission } from "@/lib/session";
import { notify } from "@/lib/util";
import { PROGRAM_LABELS } from "@/lib/workflow";
import type { ActionResult } from "./faculty";

type Inst = typeof schema.institutions.$inferSelect;

const lockedMessage = (programType: string, year: number) =>
  `${PROGRAM_LABELS[programType]} ${year} is locked: PCP accepted that year's annual return. Records for a locked year cannot be changed; file a correction request on Annual returns instead.`;

function revalidateStudents() {
  revalidatePath("/institution/students");
  revalidatePath("/institution/annual-returns");
  revalidatePath("/pcp/annual-returns");
  revalidatePath("/student");
}

// ---------- Enrolment ----------

const StudentInput = z.object({
  cnic: z.string().min(13),
  fullName: z.string().trim().min(3),
  fatherName: z.string().trim().min(3),
  mobile: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  shift: z.enum(["Morning", "Evening", "Self-finance"]),
  programType: z.enum(["PHARMD", "TECH"]),
  enrollmentYear: z.coerce.number().int().min(2015).max(2030),
});

export async function addStudent(raw: unknown): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.students.edit");
  const parsed = StudentInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Please complete all required fields.", level: "error" };
  const s = parsed.data;
  const cnic = normalizeCnic(s.cnic);
  if (!cnic) return { ok: false, message: "CNIC / B-Form must have 13 digits.", level: "error" };

  const program = await db.query.programs.findFirst({ where: and(eq(schema.programs.institutionId, inst.id), eq(schema.programs.type, s.programType)) });
  if (!program || program.nocStatus !== "APPROVED")
    return { ok: false, message: "You can enrol students only in a program with an approved NOC.", level: "error" };
  if (await lockedReturn(db, inst.id, s.programType, s.enrollmentYear)) return { ok: false, level: "error", message: lockedMessage(s.programType, s.enrollmentYear) };

  const existing = await db.query.students.findFirst({ where: eq(schema.students.cnic, cnic) });
  if (existing) {
    return {
      ok: false,
      level: "error",
      message:
        existing.institutionId === inst.id
          ? `Already enrolled at your institution as ${existing.pcpId}.`
          : "This CNIC is already enrolled at another institution. A student can hold only one active PCP student ID.",
    };
  }

  const enrolled = await db.$count(schema.students, and(eq(schema.students.institutionId, inst.id), eq(schema.students.programType, s.programType), eq(schema.students.enrollmentYear, s.enrollmentYear)));
  const overIntake = enrolled + 1 > program.approvedIntake;
  let pcpId = "";
  await db.transaction(async (tx) => {
    [pcpId] = await nextStudentIds(tx, inst.shortCode, s.enrollmentYear, s.programType, 1);
    await tx.insert(schema.students).values({
      pcpId,
      institutionId: inst.id,
      programType: s.programType,
      cnic,
      fullName: s.fullName.trim(),
      fatherName: s.fatherName.trim(),
      mobile: s.mobile || null,
      email: s.email || null,
      shift: s.shift,
      enrollmentYear: s.enrollmentYear,
      currentYear: 1,
      status: "ENROLLED",
    });
    await audit(tx, { actor: user.username, action: "student.enrolled", entity: "student", entityId: pcpId, details: { institution: inst.code, overIntake } });
  });
  revalidateStudents();
  return overIntake
    ? { ok: true, level: "warning", message: `Enrolled as ${pcpId}. Note: ${s.enrollmentYear} enrolment now exceeds the approved intake of ${program.approvedIntake}; PCP's dashboard will flag this.` }
    : { ok: true, level: "success", message: `Enrolled. PCP student ID: ${pcpId}` };
}

// ---------- Bulk upload ----------

export type UploadCheck = { line: number; data: UploadRow; errors: string[] };

const MAX_ROWS = 2000;
const PROGRAMME_ALIASES: Record<string, "PHARMD" | "TECH"> = {
  pharmd: "PHARMD",
  "pharm.d": "PHARMD",
  "pharm d": "PHARMD",
  "doctor of pharmacy": "PHARMD",
  tech: "TECH",
  technician: "TECH",
  "pharmacy technician": "TECH",
};
const SESSION_ALIASES: Record<string, string> = { morning: "Morning", evening: "Evening", "self-finance": "Self-finance", "self finance": "Self-finance", selffinance: "Self-finance" };

type CleanRow = { cnic: string; fullName: string; fatherName: string; mobile: string | null; email: string | null; programType: "PHARMD" | "TECH"; shift: string; enrollmentYear: number; currentYear: number };

/** Check every row before anything is saved: required fields, formats, duplicates in the file and the registry, programme, session and years. */
async function validateUpload(inst: Inst, rows: UploadRow[]): Promise<{ checks: UploadCheck[]; clean: Map<number, CleanRow> }> {
  const programs = await db.select().from(schema.programs).where(eq(schema.programs.institutionId, inst.id));
  const approved = new Set(programs.filter((p) => p.nocStatus === "APPROVED").map((p) => p.type));
  const locked = await lockedYears(db, inst.id);
  const year = thisYear();
  const cnics = rows.map((r) => normalizeCnic(String(r.cnic ?? ""))).filter((c): c is string => !!c);
  const inRegistry = cnics.length
    ? await db.select({ cnic: schema.students.cnic, institutionId: schema.students.institutionId, pcpId: schema.students.pcpId }).from(schema.students).where(inArray(schema.students.cnic, [...new Set(cnics)]))
    : [];
  const firstLine = new Map<string, number>();
  const checks: UploadCheck[] = [];
  const clean = new Map<number, CleanRow>();
  rows.forEach((raw, i) => {
    const line = i + 2; // row 1 is the header
    const v = (k: keyof UploadRow) => String(raw[k] ?? "").trim();
    const errors: string[] = [];
    const missing = (["full_name", "father_name", "cnic", "programme", "session", "enrolment_year", "year_of_study"] as const).filter((k) => !v(k));
    if (missing.length) errors.push(`Missing ${missing.map((m) => m.replace(/_/g, " ")).join(", ")}`);
    const nameOk = (s: string) => /^[A-Za-z][A-Za-z .'-]{2,}$/.test(s);
    if (v("full_name") && !nameOk(v("full_name"))) errors.push("Full name must be at least 3 letters (letters, spaces, . ' - only)");
    if (v("father_name") && !nameOk(v("father_name"))) errors.push("Father's name must be at least 3 letters (letters, spaces, . ' - only)");
    const cnic = v("cnic") ? normalizeCnic(v("cnic")) : null;
    if (v("cnic") && (!cnic || !/^[\d\s-]+$/.test(v("cnic")))) errors.push("CNIC must be 13 digits, e.g. 17301-1234567-1");
    if (v("mobile") && !/^03\d{2}-?\d{7}$/.test(v("mobile").replace(/\s/g, ""))) errors.push("Mobile must look like 0301-2345678");
    if (v("email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v("email"))) errors.push("Email address is not valid");
    const programType = PROGRAMME_ALIASES[v("programme").toLowerCase()];
    if (v("programme") && !programType) errors.push("Programme must be PHARMD or TECH");
    else if (programType && !approved.has(programType)) errors.push(`Your institution has no approved NOC for ${PROGRAM_LABELS[programType]}`);
    const shift = SESSION_ALIASES[v("session").toLowerCase()];
    if (v("session") && !shift) errors.push("Session must be Morning, Evening or Self-finance");
    const ey = Number(v("enrolment_year"));
    const eyOk = /^\d{4}$/.test(v("enrolment_year")) && ey >= 2015 && ey <= year;
    if (v("enrolment_year") && !eyOk) errors.push(`Enrolment year must be between 2015 and ${year}`);
    const ys = Number(v("year_of_study"));
    const len = programType ? PROGRAMME_YEARS[programType] : 5;
    if (v("year_of_study") && (!/^\d+$/.test(v("year_of_study")) || ys < 1 || ys > len)) errors.push(`Year of study must be 1 to ${len}${programType ? ` for ${PROGRAM_LABELS[programType]}` : ""}`);
    else if (eyOk && ys > year - ey + 1) errors.push(`Year of study ${ys} is not possible for a student who enrolled in ${ey}`);
    if (programType && eyOk && locked.some((l) => l.programType === programType && l.year === ey)) errors.push(`${PROGRAM_LABELS[programType]} ${ey} is locked by PCP; ask through a correction request`);
    if (cnic) {
      const dupLine = firstLine.get(cnic);
      if (dupLine) errors.push(`Same CNIC as row ${dupLine}`);
      else firstLine.set(cnic, line);
      const reg = inRegistry.find((r) => r.cnic === cnic);
      if (reg) errors.push(reg.institutionId === inst.id ? `CNIC already registered at your institution as ${reg.pcpId}` : "CNIC already registered at another institution");
    }
    checks.push({ line, data: raw, errors });
    if (!errors.length)
      clean.set(line, {
        cnic: cnic!,
        fullName: v("full_name"),
        fatherName: v("father_name"),
        mobile: v("mobile") || null,
        email: v("email") || null,
        programType: programType!,
        shift: shift!,
        enrollmentYear: ey,
        currentYear: ys,
      });
  });
  return { checks, clean };
}

/** Check an uploaded file. Nothing is saved. */
export async function checkStudentUpload(rows: UploadRow[]): Promise<{ ok: boolean; message?: string; checks: UploadCheck[] }> {
  const { user, inst } = await requireInstitution("inst.students.edit");
  if (!Array.isArray(rows) || !rows.length) return { ok: false, message: "The file has no data rows under the header.", checks: [] };
  if (rows.length > MAX_ROWS) return { ok: false, message: `The file has ${rows.length} rows; upload at most ${MAX_ROWS} at a time.`, checks: [] };
  const { checks } = await validateUpload(inst, rows);
  await audit(db, { actor: user.username, action: "student.bulk.checked", entity: "institution", entityId: inst.code, details: { rows: rows.length, invalid: checks.filter((c) => c.errors.length).length } });
  return { ok: true, checks };
}

/** Import the rows that pass every check. The file is checked again on the server first. */
export async function importStudentUpload(rows: UploadRow[]): Promise<ActionResult & { imported?: number; ids?: string[] }> {
  const { user, inst } = await requireInstitution("inst.students.edit");
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) return { ok: false, level: "error", message: "Upload the file again." };
  const { checks, clean } = await validateUpload(inst, rows);
  if (!clean.size) return { ok: false, level: "error", message: "No row passed the checks, so nothing was imported. Fix the file and upload it again." };
  const ids: string[] = [];
  try {
    await db.transaction(async (tx) => {
      const groups = new Map<string, CleanRow[]>();
      for (const r of clean.values()) {
        const k = `${r.enrollmentYear}:${r.programType}`;
        groups.set(k, [...(groups.get(k) ?? []), r]);
      }
      for (const [k, list] of groups) {
        const [y, type] = k.split(":");
        const newIds = await nextStudentIds(tx, inst.shortCode, Number(y), type, list.length);
        await tx.insert(schema.students).values(
          list.map((r, i) => ({ pcpId: newIds[i], institutionId: inst.id, programType: r.programType, cnic: r.cnic, fullName: r.fullName, fatherName: r.fatherName, mobile: r.mobile, email: r.email, shift: r.shift, enrollmentYear: r.enrollmentYear, currentYear: r.currentYear, status: "ENROLLED" })),
        );
        ids.push(...newIds);
      }
      await audit(tx, { actor: user.username, action: "student.bulk.imported", entity: "institution", entityId: inst.code, details: { imported: ids.length, skipped: checks.length - ids.length, first: ids[0], last: ids[ids.length - 1] } });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, level: "error", message: msg.includes("cnic") ? "A CNIC in the file was registered while you were checking it. Check the file again." : msg };
  }
  revalidateStudents();
  const skipped = checks.length - ids.length;
  return {
    ok: true,
    level: skipped ? "warning" : "success",
    imported: ids.length,
    ids,
    message: `Imported ${ids.length} student${ids.length === 1 ? "" : "s"} with new PCP student IDs.${skipped ? ` ${skipped} row${skipped === 1 ? "" : "s"} with errors were not imported.` : ""}`,
  };
}

// ---------- Student lifecycle ----------

const LifeInput = z.discriminatedUnion("op", [
  z.object({ op: z.literal("RESULT"), result: z.enum(["PASS", "FAIL"]), year: z.coerce.number().int() }),
  z.object({ op: z.literal("PROMOTE") }),
  z.object({ op: z.literal("REPEAT") }),
  z.object({ op: z.literal("GRADUATE") }),
  z.object({ op: z.literal("WITHDRAW"), year: z.coerce.number().int() }),
]);

/** Result, promote or repeat, graduate, withdraw. Nothing in a year PCP has locked can change. */
export async function updateStudentLifecycle(studentId: number, raw: unknown): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.students.edit");
  const parsed = LifeInput.safeParse(raw);
  if (!parsed.success) return { ok: false, level: "error", message: "Choose what to record." };
  const v = parsed.data;
  const s = await db.query.students.findFirst({ where: and(eq(schema.students.id, studentId), eq(schema.students.institutionId, inst.id)) });
  if (!s) return { ok: false, level: "error", message: "Student not found." };
  if (["GRADUATED", "WITHDRAWN"].includes(s.status)) return { ok: false, level: "error", message: `${s.fullName} has ${s.status === "GRADUATED" ? "graduated" : "withdrawn"}; the record is closed.` };
  const len = PROGRAMME_YEARS[s.programType] ?? 5;
  const year = thisYear();
  const set: Partial<typeof schema.students.$inferInsert> = {};
  let touches: number;
  let done: string;
  if (v.op === "RESULT" || v.op === "WITHDRAW") {
    if (v.year < s.enrollmentYear || v.year > year) return { ok: false, level: "error", message: `Choose a year from ${s.enrollmentYear} to ${year}.` };
    touches = v.year;
    if (v.op === "RESULT") {
      Object.assign(set, { result: v.result, resultYear: v.year }, s.resultYear !== v.year ? { status: "ENROLLED" } : {});
      done = `${v.year} result recorded: ${v.result === "PASS" ? "pass" : "fail"}.`;
    } else {
      Object.assign(set, { status: "WITHDRAWN", result: null, resultYear: v.year, eligibleForRegistration: false });
      done = `Withdrawal recorded for ${v.year}.`;
    }
  } else {
    if (!s.result || !s.resultYear) return { ok: false, level: "error", message: "Record this year's result first." };
    touches = s.resultYear;
    if (v.op === "PROMOTE") {
      if (s.result !== "PASS") return { ok: false, level: "error", message: "Only a student who passed can be promoted. Mark them as repeating instead." };
      if (s.status === "PROMOTED") return { ok: false, level: "error", message: `Already promoted after the ${s.resultYear} result.` };
      if (s.currentYear >= len) return { ok: false, level: "error", message: `Year ${s.currentYear} is the final year of ${PROGRAM_LABELS[s.programType]}. Graduate the student instead.` };
      Object.assign(set, { status: "PROMOTED", currentYear: s.currentYear + 1 });
      done = `Promoted to year ${s.currentYear + 1}.`;
    } else if (v.op === "REPEAT") {
      if (s.result !== "FAIL") return { ok: false, level: "error", message: "Only a student who failed repeats the year." };
      if (s.status === "REPEAT") return { ok: false, level: "error", message: `Already repeating after the ${s.resultYear} result.` };
      Object.assign(set, { status: "REPEAT" });
      done = `Marked as repeating year ${s.currentYear}.`;
    } else {
      if (s.result !== "PASS" || s.currentYear < len) return { ok: false, level: "error", message: `A student graduates after passing the final year (year ${len}).` };
      Object.assign(set, { status: "GRADUATED", eligibleForRegistration: s.degreeVerified });
      done = "Graduated. Next: the degree check with the university and HEC.";
    }
  }
  if (await lockedReturn(db, inst.id, s.programType, touches)) return { ok: false, level: "error", message: lockedMessage(s.programType, touches) };
  await db.transaction(async (tx) => {
    await tx.update(schema.students).set(set).where(eq(schema.students.id, s.id));
    await audit(tx, { actor: user.username, action: `student.${v.op.toLowerCase()}`, entity: "student", entityId: s.pcpId, details: { ...v, from: { status: s.status, result: s.result, resultYear: s.resultYear, currentYear: s.currentYear } } });
  });
  revalidateStudents();
  return { ok: true, level: "success", message: `${s.fullName}: ${done}` };
}

/** Simulated degree check against the university and HEC record. Graduated and verified means eligible for registration. */
export async function checkDegree(studentId: number): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.students.edit");
  const s = await db.query.students.findFirst({ where: and(eq(schema.students.id, studentId), eq(schema.students.institutionId, inst.id)) });
  if (!s) return { ok: false, level: "error", message: "Student not found." };
  if (s.status !== "GRADUATED") return { ok: false, level: "error", message: "The degree check runs after the student graduates." };
  if (s.degreeVerified) return { ok: false, level: "warning", message: "The degree is already verified." };
  await new Promise((r) => setTimeout(r, 1200)); // the simulated university/HEC service answers
  const reference = `HEC-DV-${thisYear()}-${String(s.id * 7919).padStart(6, "0").slice(-6)}`;
  await db.transaction(async (tx) => {
    await tx.update(schema.students).set({ degreeVerified: true, eligibleForRegistration: true }).where(eq(schema.students.id, s.id));
    await audit(tx, { actor: user.username, action: "student.degree.verified", entity: "student", entityId: s.pcpId, details: { source: "University and HEC record (simulated)", reference, graduated: s.resultYear } });
    if (s.username) await notify(tx, `user:${s.username}`, "Degree verified", "Your degree was confirmed with the university and HEC record. You are eligible to apply for registration as a pharmacist.", "/student");
  });
  revalidateStudents();
  return { ok: true, level: "success", message: `Degree confirmed by the university and HEC record (simulated, ref ${reference}). ${s.fullName} is eligible for registration.` };
}

// ---------- Annual student update ----------

const count = () => z.coerce.number().int().min(0);
const Figures = z.object({ enrolled: count(), promoted: count(), passed: count(), failed: count(), repeat: count(), graduated: count(), withdrawn: count() });
const ReturnInput = z.object({
  programType: z.enum(["PHARMD", "TECH"]),
  year: z.coerce.number().int(),
  figures: Figures,
  note: z.string().max(1000).optional().nullable(),
  evidenceDocumentId: z.coerce.number().int().optional().nullable(),
  submit: z.boolean(),
});

async function ownDocument(institutionId: number, id: number | null | undefined) {
  if (!id) return null;
  return (await db.query.documents.findFirst({ where: and(eq(schema.documents.id, id), eq(schema.documents.institutionId, institutionId)) })) ?? null;
}

/** Save or submit the annual student update for one programme and year. */
export async function saveAnnualReturn(raw: unknown): Promise<ActionResult & { ref?: string }> {
  const { user, inst } = await requireInstitution("inst.annual.file");
  const parsed = ReturnInput.safeParse(raw);
  if (!parsed.success) return { ok: false, level: "error", message: "Every figure must be a whole number, 0 or more." };
  const v = parsed.data;
  const year = thisYear();
  if (v.year < 2015 || v.year > year) return { ok: false, level: "error", message: `Choose a year from 2015 to ${year}.` };
  const program = await db.query.programs.findFirst({ where: and(eq(schema.programs.institutionId, inst.id), eq(schema.programs.type, v.programType)) });
  if (!program || program.nocStatus !== "APPROVED") return { ok: false, level: "error", message: `Your institution has no approved ${PROGRAM_LABELS[v.programType]} programme.` };
  const ref = `AR-${v.year}-${inst.shortCode}-${v.programType}`;
  const existing = await db.query.annualReturns.findFirst({ where: and(eq(schema.annualReturns.institutionId, inst.id), eq(schema.annualReturns.programType, v.programType), eq(schema.annualReturns.year, v.year)) });
  if (existing?.lockedAt) return { ok: false, level: "error", message: lockedMessage(v.programType, v.year) };
  if (existing?.status === "SUBMITTED") return { ok: false, level: "error", message: `${ref} is with PCP for review. You can change it only if PCP returns it.` };
  const figures = v.figures as AnnualFigures;
  const doc = await ownDocument(inst.id, v.evidenceDocumentId);
  if (v.evidenceDocumentId && !doc) return { ok: false, level: "error", message: "The evidence file was not found. Upload it again." };
  if (v.submit) {
    const problems = figureProblems(figures);
    if (problems.length) return { ok: false, level: "error", message: `The figures do not add up: ${problems.join(" ")}` };
    if (!doc) return { ok: false, level: "error", message: "Upload the result evidence (result gazette or notification) before you submit." };
  }
  const values = {
    figures,
    note: v.note?.trim() || null,
    evidenceDocumentId: doc?.id ?? null,
    status: v.submit ? "SUBMITTED" : "DRAFT",
    dueDate: annualReturnDue(v.year),
    ...(v.submit ? { submittedBy: user.username, submittedAt: new Date() } : {}),
  };
  await db.transaction(async (tx) => {
    if (existing) await tx.update(schema.annualReturns).set(values).where(eq(schema.annualReturns.id, existing.id));
    else await tx.insert(schema.annualReturns).values({ ref, institutionId: inst.id, programType: v.programType, year: v.year, ...values });
    if (v.submit) {
      await notify(tx, `inst:${inst.code}`, `Annual return ${ref} submitted`, `${user.name} submitted the ${v.year} annual student update for ${PROGRAM_LABELS[v.programType]}. PCP will review it.`, "/institution/annual-returns");
      await notifyVerifiers(tx, `Annual return ${ref} submitted`, `${inst.name} filed its ${v.year} ${PROGRAM_LABELS[v.programType]} return.`, "/pcp/annual-returns");
    }
    await audit(tx, { actor: user.username, action: v.submit ? "annual_return.submitted" : "annual_return.saved", entity: "annual_return", entityId: ref, details: { figures, evidenceDocumentId: doc?.id ?? null } });
  });
  revalidateStudents();
  return v.submit
    ? { ok: true, level: "success", ref, message: `${ref} submitted to PCP. You will be notified when PCP accepts or returns it.` }
    : { ok: true, level: "success", ref, message: `Draft of ${ref} saved. Submit it to PCP when it is complete.` };
}

/** PCP accepts a return (the year locks) or returns it with a reason. */
export async function reviewAnnualReturn(id: number, accept: boolean, note: string, otp?: string): Promise<ActionResult> {
  const user = await requirePermission("pcp.annual.review");
  try {
    const r = await db.query.annualReturns.findFirst({ where: eq(schema.annualReturns.id, id) });
    if (!r) throw new Error("Annual return not found.");
    if (r.status !== "SUBMITTED") throw new Error(`${r.ref} is not waiting for review.`);
    if (!accept && (note ?? "").trim().length < 5) throw new Error("Give the reason for returning it, so the institution knows what to fix.");
    await requireOtp(user.username, `decision:${r.ref}`, otp);
    const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, r.institutionId) });
    if (!inst) throw new Error("Institution not found.");
    await db.transaction(async (tx) => {
      await tx
        .update(schema.annualReturns)
        .set({ status: accept ? "ACCEPTED" : "RETURNED", reviewedBy: user.username, reviewedAt: new Date(), reviewNote: note?.trim() || null, ...(accept ? { lockedAt: new Date() } : {}) })
        .where(eq(schema.annualReturns.id, r.id));
      await notify(
        tx,
        `inst:${inst.code}`,
        `Annual return ${r.ref} ${accept ? "accepted" : "returned"}`,
        accept
          ? `PCP accepted your ${r.year} ${PROGRAM_LABELS[r.programType]} return. The year is now locked; later changes need a correction request.`
          : `PCP returned your ${r.year} ${PROGRAM_LABELS[r.programType]} return: ${note.trim()}. Correct it and submit again.`,
        "/institution/annual-returns",
      );
      await audit(tx, { actor: user.username, action: accept ? "annual_return.accepted" : "annual_return.returned", entity: "annual_return", entityId: r.ref, details: { note } });
    });
  } catch (e) {
    return { ok: false, level: "error", message: e instanceof Error ? e.message : String(e) };
  }
  revalidateStudents();
  return { ok: true, level: "success", message: accept ? "Accepted. The year is locked and the institution is notified." : "Returned to the institution with your reason." };
}

const CorrectionInput = z.object({
  annualReturnId: z.coerce.number().int(),
  figures: Figures,
  reason: z.string().trim().min(10, "Explain the correction in at least 10 characters."),
  evidenceDocumentId: z.coerce.number().int().optional().nullable(),
});

async function approvedCorrections(annualReturnId: number) {
  return db
    .select({ changes: schema.correctionRequests.changes })
    .from(schema.correctionRequests)
    .where(and(eq(schema.correctionRequests.annualReturnId, annualReturnId), eq(schema.correctionRequests.status, "APPROVED")))
    .orderBy(asc(schema.correctionRequests.decidedAt), asc(schema.correctionRequests.id));
}

/** After the lock, a change goes to PCP as a correction request with reason and evidence. The original figures stay. */
export async function requestCorrection(raw: unknown): Promise<ActionResult & { ref?: string }> {
  const { user, inst } = await requireInstitution("inst.annual.file");
  const parsed = CorrectionInput.safeParse(raw);
  if (!parsed.success) return { ok: false, level: "error", message: parsed.error.issues[0]?.message ?? "Complete the correction." };
  const v = parsed.data;
  const r = await db.query.annualReturns.findFirst({ where: and(eq(schema.annualReturns.id, v.annualReturnId), eq(schema.annualReturns.institutionId, inst.id)) });
  if (!r) return { ok: false, level: "error", message: "Annual return not found." };
  if (!r.lockedAt) return { ok: false, level: "error", message: `${r.ref} is not locked; change it directly while it is a draft or returned.` };
  const open = await db.query.correctionRequests.findFirst({ where: and(eq(schema.correctionRequests.annualReturnId, r.id), eq(schema.correctionRequests.status, "PENDING")) });
  if (open) return { ok: false, level: "error", message: `Correction request ${open.ref} for this return is already with PCP.` };
  const current = applyCorrections(r.figures, await approvedCorrections(r.id));
  if (!current) return { ok: false, level: "error", message: "This return has no figures to correct." };
  const next = v.figures as AnnualFigures;
  const changes: FigureChange[] = FIGURE_KEYS.filter((k) => next[k] !== current[k]).map((k) => ({ field: k, from: current[k], to: next[k] }));
  if (!changes.length) return { ok: false, level: "error", message: "Nothing changed. Edit the figures that need correcting." };
  const problems = figureProblems(next);
  if (problems.length) return { ok: false, level: "error", message: `The corrected figures do not add up: ${problems.join(" ")}` };
  const doc = await ownDocument(inst.id, v.evidenceDocumentId);
  if (!doc) return { ok: false, level: "error", message: "Upload the evidence for the correction (for example the supplementary result notification)." };
  let ref = "";
  await db.transaction(async (tx) => {
    ref = await nextYearRef(tx, "CR");
    await tx.insert(schema.correctionRequests).values({ ref, annualReturnId: r.id, institutionId: inst.id, changes, reason: v.reason, evidenceDocumentId: doc.id, requestedBy: user.username });
    await notifyVerifiers(tx, `Correction request ${ref}`, `${inst.shortCode} asks to correct ${r.ref}: ${changes.map((c) => `${FIGURE_LABELS[c.field as keyof typeof FIGURE_LABELS]} ${c.from} to ${c.to}`).join(", ")}.`, "/pcp/annual-returns?tab=corrections");
    await audit(tx, { actor: user.username, action: "correction.requested", entity: "annual_return", entityId: r.ref, details: { ref, changes, reason: v.reason, evidenceDocumentId: doc.id } });
  });
  revalidateStudents();
  return { ok: true, level: "success", ref, message: `Correction request ${ref} sent to PCP. The accepted figures stay as they are until PCP approves it.` };
}

/** PCP decides a correction request. Approved changes show next to the original figures; nothing is overwritten. */
export async function decideCorrection(id: number, approve: boolean, note: string, otp?: string): Promise<ActionResult> {
  const user = await requirePermission("pcp.annual.review");
  try {
    const c = await db.query.correctionRequests.findFirst({ where: eq(schema.correctionRequests.id, id) });
    if (!c) throw new Error("Correction request not found.");
    if (c.status !== "PENDING") throw new Error(`${c.ref} is already ${c.status.toLowerCase()}.`);
    if (!approve && (note ?? "").trim().length < 5) throw new Error("Give the reason for rejecting it.");
    await requireOtp(user.username, `decision:${c.ref}`, otp);
    const r = await db.query.annualReturns.findFirst({ where: eq(schema.annualReturns.id, c.annualReturnId) });
    const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, c.institutionId) });
    if (!r || !inst) throw new Error("Return not found.");
    await db.transaction(async (tx) => {
      await tx
        .update(schema.correctionRequests)
        .set({ status: approve ? "APPROVED" : "REJECTED", decidedBy: user.username, decidedAt: new Date(), decisionNote: note?.trim() || null })
        .where(eq(schema.correctionRequests.id, c.id));
      await notify(
        tx,
        `inst:${inst.code}`,
        `Correction ${c.ref} ${approve ? "approved" : "rejected"}`,
        approve ? `PCP approved your correction to ${r.ref}. The corrected figures now show next to the original ones.` : `PCP rejected your correction to ${r.ref}: ${note.trim()}. The accepted figures stand.`,
        "/institution/annual-returns",
      );
      await audit(tx, { actor: user.username, action: approve ? "correction.approved" : "correction.rejected", entity: "annual_return", entityId: r.ref, details: { ref: c.ref, note } });
    });
  } catch (e) {
    return { ok: false, level: "error", message: e instanceof Error ? e.message : String(e) };
  }
  revalidateStudents();
  return { ok: true, level: "success", message: approve ? "Correction approved. The original figures stay visible beside it." : "Correction rejected. The accepted figures stand." };
}
