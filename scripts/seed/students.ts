// Seed data for the students module. Runs after the core seed (see scripts/seed/index.ts).
// Gives every student a coherent life (results, promotion, graduation, degree check), adds a final-year
// PharmD cohort that graduated in 2026, the two student logins, annual returns and a correction request.
import { and, eq, sql } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db, schema } from "../../src/db";
import type { AnnualFigures } from "../../src/db/modules/students";
import { audit } from "../../src/lib/audit";
import { fileDocument } from "../../src/lib/letters";
import { figuresFromRecords } from "../../src/lib/registry";
import { PROGRAMME_YEARS } from "../../src/lib/registry-shared";

type Inst = typeof schema.institutions.$inferSelect;

let seed = 8204;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

const FIRST = ["Ahmed", "Bilal", "Hassan", "Saad", "Usman", "Ayesha", "Fatima", "Hira", "Maryam", "Zainab", "Rabia", "Iqra", "Hamza", "Owais", "Sana", "Kiran"];
const LAST = ["Khan", "Ahmed", "Malik", "Qureshi", "Shah", "Butt", "Raza", "Siddiqui", "Hussain", "Javed", "Farooq", "Yousafzai"];
const FATHER = ["Muhammad Aslam", "Abdul Rehman", "Tariq Mehmood", "Javed Iqbal", "Khalid Hussain", "Nasir Ali", "Zahid Shah", "Imran Butt"];
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];

async function evidencePdf(title: string, lines: string[]) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({ x: 0, y: 782, width: 595, height: 60, color: rgb(0.1, 0.2, 0.35) });
  page.drawText("Office of the Controller of Examinations (DEMO, fictional)", { x: 40, y: 806, size: 12, font: bold, color: rgb(1, 1, 1) });
  page.drawText(title, { x: 40, y: 730, size: 16, font: bold });
  lines.forEach((l, i) => page.drawText(l, { x: 40, y: 700 - i * 18, size: 11, font }));
  return Buffer.from(await pdf.save());
}

export default async function seedStudents(): Promise<string | void> {
  const inst: Record<string, Inst> = Object.fromEntries((await db.select().from(schema.institutions)).map((i) => [i.shortCode, i]));
  const NOW = 2026;

  // 1. A coherent life for every student already seeded. Exams are held each summer; currentYear is the
  //    year of study now (after promotion). A student who enrols in year y graduates after the y + length exam.
  const all = await db.select().from(schema.students);
  for (const s of all) {
    const len = PROGRAMME_YEARS[s.programType] ?? 5;
    const y = s.enrollmentYear;
    let set: Partial<typeof schema.students.$inferInsert> = {};
    if (s.status === "GRADUATED") {
      const g = y + len;
      const verified = g <= 2025 ? rand() < 0.9 : rand() < 0.4;
      set = { result: "PASS", resultYear: g, currentYear: len, degreeVerified: verified, eligibleForRegistration: verified };
    } else if (s.status === "WITHDRAWN") {
      const w = Math.min(NOW, y + Math.floor(rand() * (NOW - y + 1)));
      set = { result: null, resultYear: w, currentYear: Math.max(1, Math.min(len, w - y + 1)) };
    } else if (y === NOW) {
      set = { status: "ENROLLED", result: null, resultYear: null, currentYear: 1 };
    } else if (s.status === "REPEAT") {
      set = { result: "FAIL", resultYear: NOW, currentYear: Math.max(1, Math.min(len, NOW - y)) };
    } else {
      set = { status: "PROMOTED", result: "PASS", resultYear: NOW, currentYear: Math.min(len, NOW - y + 1) };
    }
    await db.update(schema.students).set(set).where(eq(schema.students.id, s.id));
  }

  // 2. The 2021 PharmD cohort sat its final examination in 2026 at Riverside and Ravi Bank.
  let added = 0;
  for (const [code, province, n] of [["RUH", "17301", 34], ["RBU", "35202", 40]] as const) {
    const rows: (typeof schema.students.$inferInsert)[] = [];
    for (let k = 1; k <= n; k++) {
      const r = rand();
      const female = k % 2 === 0;
      const first = female ? pick(FIRST.slice(5, 12).concat(["Sana", "Kiran"])) : pick(FIRST.slice(0, 5).concat(["Hamza", "Owais"]));
      const base = { pcpId: `PCP-${code}-2021-${String(k).padStart(8, "0")}`, institutionId: inst[code].id, programType: "PHARMD", cnic: `${province}-2021${String(k).padStart(3, "0")}-${(k % 9) + 1}`, fatherName: pick(FATHER), shift: k % 4 === 0 ? "Evening" : "Morning", enrollmentYear: 2021, mobile: `0300-${String(5200000 + k * 37)}` };
      const fullName = `${first} ${pick(LAST)}`;
      const email = `${fullName.split(" ")[0].toLowerCase()}.${code.toLowerCase()}21${k}@student.demo`;
      if (r < 0.06) rows.push({ ...base, fullName, email, status: "WITHDRAWN", result: null, resultYear: 2024, currentYear: 3 });
      else if (r < 0.16) rows.push({ ...base, fullName, email, status: "REPEAT", result: "FAIL", resultYear: NOW, currentYear: 5 });
      else {
        const verified = rand() < 0.3;
        rows.push({ ...base, fullName, email, status: "GRADUATED", result: "PASS", resultYear: NOW, currentYear: 5, degreeVerified: verified, eligibleForRegistration: verified });
      }
    }
    // Areeba Noor (student.ruh): graduated in 2026; the degree check is still to run.
    if (code === "RUH")
      rows[0] = { ...rows[0], fullName: "Areeba Noor", fatherName: "Noor Ahmed", email: "areeba.noor@student.demo", shift: "Morning", status: "GRADUATED", result: "PASS", resultYear: NOW, currentYear: 5, degreeVerified: false, eligibleForRegistration: false, username: "student.ruh" };
    await db.insert(schema.students).values(rows);
    added += rows.length;
  }

  // 3. Hamza Iqbal (student.rbu): a fourth-year Ravi Bank PharmD student, promoted after the 2026 examination.
  const [hamza] = await db
    .select({ id: schema.students.id })
    .from(schema.students)
    .where(and(eq(schema.students.institutionId, inst.RBU.id), eq(schema.students.programType, "PHARMD"), eq(schema.students.enrollmentYear, 2023), eq(schema.students.status, "PROMOTED")))
    .limit(1);
  await db.update(schema.students).set({ fullName: "Hamza Iqbal", fatherName: "Muhammad Iqbal", email: "hamza.iqbal@student.demo", username: "student.rbu" }).where(eq(schema.students.id, hamza.id));

  // 4. Annual returns. 2025: accepted and locked for every approved programme. 2026: RBU PharmD submitted,
  //    CCP PharmD returned, Riverside PharmD due.
  const programs = await db.select().from(schema.programs).where(eq(schema.programs.nocStatus, "APPROVED"));
  const byId = Object.fromEntries(Object.values(inst).map((i) => [i.id, i]));
  const evidence = async (i: Inst, ref: string, year: number, docType = "Result evidence", lines?: string[]) =>
    fileDocument(db, {
      institutionId: i.id,
      folder: `student-documents/annual-returns/${ref}`,
      docType,
      fileName: docType === "Result evidence" ? `result-notification-${year}.pdf` : `supplementary-result-${year}.pdf`,
      bytes: await evidencePdf(`${docType}: ${ref}`, lines ?? [i.name, `Annual examination ${year}: result notification`, "Signed by the Controller of Examinations"]),
      uploadedBy: `${i.shortCode.toLowerCase()}.${i.shortCode === "RUH" ? "exam" : "poc"}`,
      verificationStatus: "VERIFIED",
    });

  // 2025 figures: everyone enrolled by 2024 sat an exam; about 6 in 100 failed; no PharmD cohort graduated in 2025.
  const figures2025 = async (institutionId: number, type: string): Promise<AnnualFigures> => {
    const len = PROGRAMME_YEARS[type] ?? 5;
    const rows = await db
      .select({ y: schema.students.enrollmentYear, status: schema.students.status, ry: schema.students.resultYear })
      .from(schema.students)
      .where(and(eq(schema.students.institutionId, institutionId), eq(schema.students.programType, type), sql`${schema.students.enrollmentYear} <= 2025`));
    const onRoll = rows.filter((r) => !(["GRADUATED", "WITHDRAWN"].includes(r.status) && r.ry !== null && r.ry < 2025));
    const sat = onRoll.filter((r) => r.y <= 2024 && !(r.status === "WITHDRAWN" && r.ry === 2025));
    const graduated = sat.filter((r) => r.y + len === 2025).length;
    const failed = Math.round(sat.length * 0.06);
    const passed = sat.length - failed;
    return { enrolled: onRoll.length, promoted: passed - graduated, passed, failed, repeat: failed, graduated, withdrawn: rows.filter((r) => r.status === "WITHDRAWN" && r.ry === 2025).length };
  };

  const returns: { ref: string; status: string }[] = [];
  for (const p of programs) {
    const i = byId[p.institutionId];
    const students = await db.$count(schema.students, and(eq(schema.students.institutionId, i.id), eq(schema.students.programType, p.type)));
    if (!students) continue;
    const ref = `AR-2025-${i.shortCode}-${p.type}`;
    const doc = await evidence(i, ref, 2025);
    await db.insert(schema.annualReturns).values({
      ref,
      institutionId: i.id,
      programType: p.type,
      year: 2025,
      status: "ACCEPTED",
      figures: await figures2025(i.id, p.type),
      evidenceDocumentId: doc.id,
      dueDate: "2025-10-31",
      submittedBy: i.shortCode === "RUH" ? "ruh.exam" : `${i.shortCode.toLowerCase()}.poc`,
      submittedAt: new Date("2025-10-20T09:00:00Z"),
      reviewedBy: "pcp.verification",
      reviewedAt: new Date("2025-11-20T10:00:00Z"),
      reviewNote: "Figures match the result notification",
      lockedAt: new Date("2025-11-20T10:00:00Z"),
      createdAt: new Date("2025-10-12T09:00:00Z"),
    });
    returns.push({ ref, status: "ACCEPTED" });
  }

  const file2026 = async (s: string, type: string, status: "SUBMITTED" | "RETURNED", note?: string) => {
    const i = inst[s];
    const ref = `AR-2026-${s}-${type}`;
    const doc = await evidence(i, ref, 2026);
    const { figures } = await figuresFromRecords(db, i.id, type, 2026);
    await db.insert(schema.annualReturns).values({
      ref,
      institutionId: i.id,
      programType: type,
      year: 2026,
      status,
      figures,
      evidenceDocumentId: doc.id,
      dueDate: "2026-10-31",
      submittedBy: `${s.toLowerCase()}.poc`,
      submittedAt: new Date(status === "SUBMITTED" ? "2026-10-01T09:00:00Z" : "2026-09-18T09:00:00Z"),
      ...(status === "RETURNED" ? { reviewedBy: "pcp.verification", reviewedAt: new Date("2026-09-25T09:00:00Z"), reviewNote: note } : {}),
    });
    returns.push({ ref, status });
  };
  await file2026("RBU", "PHARMD", "SUBMITTED");
  await file2026("CCP", "PHARMD", "RETURNED", "The result evidence covers only the morning session. Upload the evening-session result notification and check the passed figure.");

  // 5. A correction request on Riverside's locked 2025 return, waiting for PCP.
  const ruh2025 = await db.query.annualReturns.findFirst({ where: and(eq(schema.annualReturns.institutionId, inst.RUH.id), eq(schema.annualReturns.programType, "PHARMD"), eq(schema.annualReturns.year, 2025)) });
  if (ruh2025?.figures) {
    const f = ruh2025.figures;
    const doc = await evidence(inst.RUH, ruh2025.ref, 2025, "Correction evidence", ["Riverside University of Health Sciences", "Supplementary examination, September 2025", "2 candidates declared pass after re-evaluation"]);
    await db.insert(schema.correctionRequests).values({
      ref: "CR-2026-0001",
      annualReturnId: ruh2025.id,
      institutionId: inst.RUH.id,
      changes: [
        { field: "passed", from: f.passed, to: f.passed + 2 },
        { field: "failed", from: f.failed, to: f.failed - 2 },
        { field: "promoted", from: f.promoted, to: f.promoted + 2 },
        { field: "repeat", from: f.repeat, to: f.repeat - 2 },
      ],
      reason: "Two students passed the supplementary examination in September 2025. The original return counted them as failed and repeating.",
      evidenceDocumentId: doc.id,
      requestedBy: "ruh.exam",
      createdAt: new Date("2026-09-12T10:00:00Z"),
    });
  }

  await db.insert(schema.notifications).values([
    { audience: "role:pcp_verification", title: "Annual return AR-2026-RBU-PHARMD submitted", body: "Ravi Bank University filed its 2026 PharmD return.", link: "/pcp/annual-returns" },
    { audience: "role:pcp_verification", title: "Correction request CR-2026-0001", body: "RUH asks to correct AR-2025-RUH-PHARMD (supplementary results).", link: "/pcp/annual-returns?tab=corrections" },
    { audience: `inst:${inst.RUH.code}`, title: "Annual student update 2026 is due", body: "File the 2026 PharmD return (enrolment, progression, results and evidence) by 31 Oct 2026.", link: "/institution/annual-returns" },
  ]);
  for (const r of returns) await audit(db, { actor: "system", action: `annual_return.${r.status.toLowerCase()}`, entity: "annual_return", entityId: r.ref, details: { seeded: true } });

  return `${added} final-year PharmD students added, logins student.ruh and student.rbu, ${returns.length} annual returns, 1 correction request`;
}
