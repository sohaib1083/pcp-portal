/* Demo seed. All institutions and people are FICTIONAL. Run: npm run seed */
import { rm } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db, schema } from "../src/db";
import { audit } from "../src/lib/audit";
import { normalizeName } from "../src/lib/names";
import { putFile } from "../src/lib/storage";
import type { ChecklistItem, CheckResult } from "../src/db/schema";
import { seedModules } from "./seed/index";

let seed = 20261004;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];

const PROVINCE_CNIC: Record<string, string> = {
  "Khyber Pakhtunkhwa": "17301",
  Punjab: "35202",
  Sindh: "42101",
  Balochistan: "54400",
  "Gilgit-Baltistan": "71501",
  "Islamabad Capital Territory": "61101",
};
const usedCnic = new Set<string>();
function cnicFor(province: string, last?: number) {
  for (;;) {
    const mid = String(Math.floor(rand() * 9_000_000) + 1_000_000);
    const c = `${PROVINCE_CNIC[province]}-${mid}-${last ?? Math.floor(rand() * 9) + 1}`;
    if (!usedCnic.has(c)) {
      usedCnic.add(c);
      return c;
    }
  }
}

const MALE = ["Ahmed", "Ali", "Hamza", "Bilal", "Usman", "Hassan", "Faisal", "Imran", "Kashif", "Saad", "Waqas", "Zeeshan", "Adnan", "Asad", "Junaid", "Rizwan", "Shahid", "Tahir", "Naveed", "Owais"];
const FEMALE = ["Ayesha", "Fatima", "Sana", "Hira", "Maryam", "Zainab", "Amna", "Rabia", "Saba", "Nida", "Iqra", "Mehwish", "Sadia", "Kiran", "Hafsa", "Noor"];
const LAST = ["Khan", "Ahmed", "Malik", "Qureshi", "Shah", "Butt", "Chaudhry", "Raza", "Siddiqui", "Hussain", "Javed", "Aslam", "Iqbal", "Farooq", "Baloch", "Memon", "Abbasi", "Yousafzai", "Durrani", "Shaikh"];
const SPECIALIZATIONS = ["Pharmacology", "Pharmaceutics", "Pharmaceutical Chemistry", "Pharmacognosy", "Pharmacy Practice", "Clinical Pharmacy"];
const DESIGNATIONS = ["Professor", "Associate Professor", "Assistant Professor", "Lecturer", "Lecturer"];

function personName() {
  const female = rand() < 0.45;
  const first = female ? pick(FEMALE) : pick(MALE);
  const middle = rand() < 0.4 ? " " + pick(female ? FEMALE : MALE) : "";
  return { full: `${first}${middle} ${pick(LAST)}`, father: `${pick(MALE)} ${pick(LAST)}` };
}

async function samplePdf(title: string, lines: string[]) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({ x: 0, y: 792, width: 595, height: 50, color: rgb(0.05, 0.36, 0.27) });
  page.drawText("DEMO DOCUMENT - fictional data", { x: 40, y: 810, size: 12, font: bold, color: rgb(1, 1, 1) });
  page.drawText(title, { x: 40, y: 740, size: 18, font: bold });
  lines.forEach((l, i) => page.drawText(l, { x: 40, y: 700 - i * 20, size: 11, font }));
  return Buffer.from(await pdf.save());
}

const INSTITUTIONS = [
  { code: "PCP-UNI-000101", shortCode: "RUH", name: "Riverside University of Health Sciences", city: "Peshawar", province: "Khyber Pakhtunkhwa", sector: "Public", est: 2004 },
  { code: "PCP-UNI-000102", shortCode: "NHC", name: "Northern Hills College of Pharmacy", city: "Abbottabad", province: "Khyber Pakhtunkhwa", sector: "Private", est: 2012, aff: "Riverside University of Health Sciences" },
  { code: "PCP-UNI-000103", shortCode: "RBU", name: "Ravi Bank University", city: "Lahore", province: "Punjab", sector: "Public", est: 1998 },
  { code: "PCP-UNI-000104", shortCode: "CCP", name: "Clifton College of Pharmacy", city: "Karachi", province: "Sindh", sector: "Private", est: 2010, aff: "Sindh Coastal University" },
  { code: "PCP-UNI-000105", shortCode: "BVU", name: "Bolan Valley University", city: "Quetta", province: "Balochistan", sector: "Public", est: 2007 },
  { code: "PCP-UNI-000106", shortCode: "GMI", name: "Gilgit Mountain Institute of Pharmacy", city: "Gilgit", province: "Gilgit-Baltistan", sector: "Private", est: 2015 },
  { code: "PCP-UNI-000107", shortCode: "FRU", name: "Five Rivers University", city: "Multan", province: "Punjab", sector: "Private", est: 2009 },
  { code: "PCP-UNI-000108", shortCode: "SCU", name: "Sindh Coastal University", city: "Hyderabad", province: "Sindh", sector: "Public", est: 2001 },
];

type ProgSeed = { inst: string; type: "PHARMD" | "TECH"; noc: string; nocNo?: string; intake: number; acc: string; validUntil?: string; faculty: number };
const PROGRAMS: ProgSeed[] = [
  { inst: "RUH", type: "PHARMD", noc: "APPROVED", nocNo: "NOC-PHARMD-2005-0011", intake: 100, acc: "VALID", validUntil: "2027-03-15", faculty: 12 },
  { inst: "NHC", type: "PHARMD", noc: "PENDING", intake: 0, acc: "NONE", faculty: 7 },
  { inst: "RBU", type: "PHARMD", noc: "APPROVED", nocNo: "NOC-PHARMD-1999-0004", intake: 120, acc: "PENDING", validUntil: "2026-12-20", faculty: 14 },
  { inst: "RBU", type: "TECH", noc: "APPROVED", nocNo: "NOC-TECH-2014-0021", intake: 50, acc: "VALID", validUntil: "2028-06-30", faculty: 4 },
  { inst: "CCP", type: "PHARMD", noc: "APPROVED", nocNo: "NOC-PHARMD-2011-0017", intake: 80, acc: "VALID", validUntil: "2028-01-31", faculty: 10 },
  { inst: "CCP", type: "TECH", noc: "PENDING", intake: 0, acc: "NONE", faculty: 2 },
  { inst: "BVU", type: "PHARMD", noc: "PENDING", intake: 0, acc: "NONE", faculty: 8 },
  { inst: "BVU", type: "TECH", noc: "APPROVED", nocNo: "NOC-TECH-2016-0009", intake: 40, acc: "VALID", validUntil: "2027-08-31", faculty: 3 },
  { inst: "GMI", type: "TECH", noc: "APPROVED", nocNo: "NOC-TECH-2025-0007", intake: 40, acc: "NONE", faculty: 3 },
  { inst: "FRU", type: "PHARMD", noc: "PENDING", intake: 0, acc: "NONE", faculty: 9 },
  { inst: "FRU", type: "TECH", noc: "APPROVED", nocNo: "NOC-TECH-2013-0015", intake: 60, acc: "VALID", validUntil: "2026-11-30", faculty: 4 },
  { inst: "SCU", type: "PHARMD", noc: "APPROVED", nocNo: "NOC-PHARMD-2002-0006", intake: 100, acc: "VALID", validUntil: "2029-09-30", faculty: 12 },
  { inst: "SCU", type: "TECH", noc: "PENDING", intake: 0, acc: "NONE", faculty: 3 },
  { inst: "RUH", type: "TECH", noc: "NONE", intake: 0, acc: "NONE", faculty: 3 },
];

const STAFF = [
  ["pcp.admin", "Super Admin", "pcp_admin", null, null],
  ["pcp.officer", "Usman Farooq", "pcp_officer", null, null],
  ["pcp.inspector", "Dr. Kamran Javed", "pcp_inspector", "Punjab", null],
  ["pcp.inspector2", "Dr. Zainab Qureshi", "pcp_inspector", "Khyber Pakhtunkhwa", null],
  ["pcp.secretary", "Dr. Nadia Hussain", "pcp_secretary", null, null],
  ["ruh.poc", "Prof. Ayesha Khan", "inst_poc", null, "RUH"],
  ["nhc.poc", "Dr. Tariq Mehmood", "inst_poc", null, "NHC"],
  ["rbu.poc", "Dr. Saima Rauf", "inst_poc", null, "RBU"],
  ["ccp.poc", "Farhan Siddiqui", "inst_poc", null, "CCP"],
  ["bvu.poc", "Dr. Naseebullah Kakar", "inst_poc", null, "BVU"],
  ["gmi.poc", "Sher Ali Baig", "inst_poc", null, "GMI"],
  ["fru.poc", "Dr. Rabia Noor", "inst_poc", null, "FRU"],
  ["ruh.dean", "Dr. Imran Shah", "inst_principal", null, "RUH"],
  ["ruh.admin", "Saba Qureshi", "inst_dept_admin", null, "RUH"],
  ["ruh.entry", "Junaid Akhtar", "inst_data_entry", null, "RUH"],
  ["ruh.exam", "Nida Farooq", "inst_exam", null, "RUH"],
  ["ruh.finance", "Waqas Butt", "inst_finance", null, "RUH"],
  ["pcp.registration", "Hina Malik", "pcp_registration", null, null],
  ["pcp.coordinator", "Bilal Ahmed", "pcp_coordinator", null, null],
  ["pcp.accounts", "Sadia Raza", "pcp_accounts", null, null],
  ["pcp.verification", "Kashif Iqbal", "pcp_verification", null, null],
  ["student.ruh", "Areeba Noor", "student", null, null],
  ["student.rbu", "Hamza Iqbal", "student", null, null],
  ["pharm.ali", "Ali Raza", "pharmacist", null, null],
  ["pharm.sana", "Sana Memon", "pharmacist", null, null],
  ["ivc.applicant", "Rehana Baloch", "inst_applicant", null, null],
  ["scu.poc", "Dr. Ali Raza Memon", "inst_poc", null, "SCU"],
] as const;

const CRITERIA = [
  "Faculty: qualified, full-time, as per submitted list",
  "Laboratories: equipment, chemicals and safety",
  "Library: books, journals and digital access",
  "Classrooms and building",
  "Student records and attendance",
  "Hospital / pharmacy practice linkage",
  "Governance and finances",
];

async function main() {
  console.log("Resetting tables and storage ...");
  // Every table, including the module tables (anything not created by Drizzle's own bookkeeping).
  const tables = (await db.execute(sql`select tablename from pg_tables where schemaname = 'public' and tablename not like '__drizzle%'`)).rows.map((r) => `"${(r as { tablename: string }).tablename}"`);
  await db.execute(sql.raw(`truncate ${tables.join(", ")} restart identity cascade`));
  for (const dir of ["institutions", "onboarding", "pharmacists", "misc"]) await rm(path.resolve(process.env.STORAGE_DIR ?? "./storage", dir), { recursive: true, force: true });

  const instRows = await db
    .insert(schema.institutions)
    .values(INSTITUTIONS.map((i) => ({ code: i.code, shortCode: i.shortCode, name: i.name, city: i.city, province: i.province, sector: i.sector, establishedYear: i.est, affiliatedUniversity: i.aff ?? null })))
    .returning();
  const inst = Object.fromEntries(instRows.map((r) => [r.shortCode, r]));
  // Each institution has a main campus; Riverside also runs a second campus (campuses are child records, guide section 3).
  await db.insert(schema.campuses).values([
    ...instRows.map((r) => ({ institutionId: r.id, name: `Main campus, ${r.city}`, city: r.city, province: r.province, isMain: true })),
    { institutionId: inst.RUH.id, name: "Hayatabad campus, Peshawar", city: "Peshawar", province: "Khyber Pakhtunkhwa", address: "Phase 5, Hayatabad", isMain: false },
  ]);
  for (const r of instRows) await audit(db, { actor: "system", action: "institution.approved", entity: "institution", entityId: r.code, details: { name: r.name } });

  await db.insert(schema.staff).values(STAFF.map(([username, displayName, role, province, s]) => ({ username, displayName, email: `${username}@demo.pcp.local`, role, province, institutionId: s ? inst[s].id : null, createdBy: "system" })));

  await db.insert(schema.rules).values([
    // Programme rules (demo values). Per-subject faculty: max(min, ceil(intake / perIntake)) teachers linked by Faculty ID.
    // maxTeacherLoad: how many programmes or open cases one teacher may be counted on at a time.
    {
      key: "noc.PHARMD",
      version: 1,
      effectiveFrom: "2026-01-01",
      description: "PharmD programme requirements (demo values)",
      value: {
        maxIntake: 150,
        studentsPerFaculty: 10,
        minPhdFaculty: 2,
        minLabs: 4,
        minClassrooms: 5,
        minLibraryBooks: 1500,
        requiredDocs: ["Charter or affiliation letter", "Building plan", "Laboratory inventory", "Faculty appointment letters"],
        subjects: [
          { name: "Pharmaceutics", perIntake: 40, min: 1 },
          { name: "Pharmacology", perIntake: 40, min: 1 },
          { name: "Pharmaceutical Chemistry", perIntake: 50, min: 1 },
          { name: "Pharmacognosy", perIntake: 50, min: 1 },
          { name: "Pharmacy Practice", perIntake: 60, min: 1 },
        ],
        maxTeacherLoad: 1,
        accreditationDocs: ["Self-assessment evidence", "Annual compliance statement"],
        accreditationYears: 3,
      },
    },
    {
      key: "noc.TECH",
      version: 1,
      effectiveFrom: "2026-01-01",
      description: "Pharmacy Technician programme requirements (demo values)",
      value: {
        maxIntake: 60,
        studentsPerFaculty: 15,
        minPhdFaculty: 0,
        minLabs: 2,
        minClassrooms: 3,
        minLibraryBooks: 500,
        requiredDocs: ["Charter or affiliation letter", "Building plan", "Laboratory inventory"],
        subjects: [
          { name: "Pharmaceutics", perIntake: 60, min: 1 },
          { name: "Pharmacology", perIntake: 40, min: 1 },
          { name: "Pharmaceutical Chemistry", perIntake: 60, min: 1 },
        ],
        maxTeacherLoad: 1,
        accreditationDocs: ["Self-assessment evidence", "Annual compliance statement"],
        accreditationYears: 3,
      },
    },
    { key: "fees", version: 1, effectiveFrom: "2026-01-01", description: "Fees from the PCP FAQ (pcpisb.gov.pk/faqs)", value: { "NOC:PHARMD": 1000000, "NOC:TECH": 500000, "RENEWAL:PHARMD": 300000, "RENEWAL:TECH": 200000, "ACCREDITATION:PHARMD": 300000, "ACCREDITATION:TECH": 200000 } },
  ]);

  // Programs + accreditation history
  const programRows: Record<string, typeof schema.programs.$inferSelect> = {};
  for (const p of PROGRAMS) {
    const [row] = await db
      .insert(schema.programs)
      .values({ institutionId: inst[p.inst].id, type: p.type, nocStatus: p.noc, nocNumber: p.nocNo ?? null, approvedIntake: p.intake, accreditationStatus: p.acc, accreditationValidUntil: p.validUntil ?? null })
      .returning();
    programRows[`${p.inst}:${p.type}`] = row;
    if (p.validUntil) {
      const end = Number(p.validUntil.slice(0, 4));
      for (let y = end - 9; y <= end - 3; y += 3) {
        await db.insert(schema.accreditationHistory).values({ programId: row.id, year: y, status: y === end - 9 ? "Accredited" : "Renewal", validFrom: y, validUntil: y + 3, intake: p.intake, decision: "Approved" });
      }
    }
  }

  // Faculty
  let facNo = 0;
  const addFaculty = async (s: string, type: string, f: { full: string; father: string; cnic?: string; qual?: string; spec?: string; desig?: string; status?: string }) => {
    facNo++;
    const i = inst[s];
    const [row] = await db
      .insert(schema.faculty)
      .values({
        pcpId: `PCP-FAC-${String(facNo).padStart(6, "0")}`,
        cnic: f.cnic ?? cnicFor(i.province),
        fullName: f.full,
        fatherName: f.father,
        nameNorm: normalizeName(f.full),
        qualification: f.qual ?? pick(["PhD", "PhD", "MPhil", "MPhil", "PharmD", "M.Pharm"]),
        specialization: f.spec ?? pick(SPECIALIZATIONS),
        pcpRegNo: `PC-${Math.floor(rand() * 90000) + 10000}`,
        designation: f.desig ?? pick(DESIGNATIONS),
        verificationStatus: f.status ?? "VERIFIED",
      })
      .returning();
    await db.insert(schema.facultyLinks).values({ facultyId: row.id, institutionId: i.id, programType: type, status: "ACTIVE", startDate: `${2014 + Math.floor(rand() * 11)}-0${1 + Math.floor(rand() * 9)}-01`, createdBy: "system" });
    return row;
  };

  // Named faculty used in the demo script
  usedCnic.add("17301-1234567-1");
  usedCnic.add("35202-7654321-2");
  await addFaculty("RUH", "PHARMD", { full: "Dr. Muhammad Ali Khan", father: "Abdul Ghafoor Khan", cnic: "17301-1234567-1", qual: "PhD", spec: "Pharmacology", desig: "Professor" });
  await addFaculty("RBU", "PHARMD", { full: "Dr. Sara Malik", father: "Javed Malik", cnic: "35202-7654321-2", qual: "PhD", spec: "Pharmaceutics", desig: "Associate Professor" });
  const usmanA = await addFaculty("RBU", "PHARMD", { full: "Dr. Muhammad Usman Tariq", father: "Tariq Mehmood", qual: "PhD", spec: "Pharmaceutical Chemistry", desig: "Assistant Professor" });
  const usmanB = await addFaculty("FRU", "PHARMD", { full: "Dr. Mohammad Usman Tariq", father: "Tariq Mahmood", qual: "PhD", spec: "Pharmaceutical Chemistry", desig: "Assistant Professor", status: "FLAGGED" });
  await db.insert(schema.duplicateFlags).values({ entity: "faculty", recordId: usmanB.id, matchRecordId: usmanA.id, score: 0.93, reason: "Name and father's name match after normalisation (Muhammad/Mohammad, Mehmood/Mahmood); different CNIC; both active" });

  for (const p of PROGRAMS) {
    const already = p.inst === "RUH" && p.type === "PHARMD" ? 1 : p.inst === "RBU" && p.type === "PHARMD" ? 2 : p.inst === "FRU" && p.type === "PHARMD" ? 1 : 0;
    for (let k = already; k < p.faculty; k++) {
      const n = personName();
      await addFaculty(p.inst, p.type, { full: (rand() < 0.5 ? "Dr. " : "") + n.full, father: n.father, qual: p.type === "TECH" ? pick(["MPhil", "PharmD", "M.Pharm"]) : undefined });
    }
  }

  // Students
  let stuCount = 0;
  for (const p of PROGRAMS.filter((x) => x.noc === "APPROVED")) {
    const i = inst[p.inst];
    const length = p.type === "PHARMD" ? 5 : 2;
    const perYear = Math.max(8, Math.floor(p.intake * 0.4));
    const counters: Record<number, number> = {};
    for (let y = 2022; y <= 2026; y++) {
      for (let k = 0; k < perYear; k++) {
        counters[y] = (counters[y] ?? 0) + 1;
        const n = personName();
        const yearOfStudy = Math.min(2026 - y + 1, length + 1);
        const graduated = 2026 - y + 1 > length;
        const r = rand();
        const status = graduated ? "GRADUATED" : r < 0.03 ? "WITHDRAWN" : r < 0.08 ? "REPEAT" : y === 2026 ? "ENROLLED" : "PROMOTED";
        await db.insert(schema.students).values({
          pcpId: `PCP-${i.shortCode}-${y}-${String(counters[y] + (p.type === "TECH" ? 5000 : 0)).padStart(8, "0")}`,
          institutionId: i.id,
          programType: p.type,
          cnic: cnicFor(i.province),
          fullName: n.full,
          fatherName: n.father,
          mobile: `03${Math.floor(rand() * 5) + 0}${Math.floor(rand() * 9_000_000) + 1_000_000}`,
          email: `${n.full.split(" ")[0].toLowerCase()}${Math.floor(rand() * 900) + 100}@student.demo`,
          shift: pick(["Morning", "Morning", "Evening", "Self-finance"]),
          enrollmentYear: y,
          currentYear: Math.min(yearOfStudy, length),
          status,
        });
        stuCount++;
      }
    }
  }

  // Applications in every workflow stage
  const mkApp = async (o: { ref: string; s: string; kind: string; type: string; status: string; submitted?: string; officer?: string; data: Record<string, unknown>; cert?: string; issued?: string; validUntil?: string }) => {
    const fee = ({ "NOC:PHARMD": 1000000, "NOC:TECH": 500000, "ACCREDITATION:PHARMD": 300000 } as Record<string, number>)[`${o.kind}:${o.type}`] ?? 0;
    const checks: CheckResult[] = [{ key: "all", label: "Automatic checks", ok: true, detail: "All checks passed at submission" }];
    const [row] = await db
      .insert(schema.applications)
      .values({
        ref: o.ref,
        institutionId: inst[o.s].id,
        kind: o.kind,
        programType: o.type,
        status: o.status,
        data: o.data,
        checks,
        feeAmount: fee,
        feePsid: `2026${String(Math.floor(rand() * 1e13)).padStart(13, "0")}`,
        feePaidAt: o.submitted ? new Date(o.submitted) : null,
        feePaidBy: o.submitted ? `${o.s.toLowerCase()}.poc` : null,
        feeMethod: o.submitted ? "Raast QR (demo)" : null,
        assignedOfficer: o.officer ?? null,
        submittedBy: o.submitted ? `${o.s.toLowerCase()}.poc` : null,
        submittedAt: o.submitted ? new Date(o.submitted) : null,
        certificateNo: o.cert ?? null,
        issuedAt: o.issued ? new Date(o.issued) : null,
        validUntil: o.validUntil ?? null,
        decision: o.cert ? "APPROVED" : null,
        decidedAt: o.issued ? new Date(o.issued) : null,
        createdBy: `${o.s.toLowerCase()}.poc`,
      })
      .returning();
    await db.insert(schema.applicationEvents).values({ applicationId: row.id, fromStatus: "DRAFT", toStatus: "SUBMITTED", actor: `${o.s.toLowerCase()}.poc`, actorRole: "inst_poc", note: "Submitted with fee paid", createdAt: o.submitted ? new Date(o.submitted) : new Date() });
    if (o.status !== "SUBMITTED")
      await db.insert(schema.applicationEvents).values({ applicationId: row.id, fromStatus: "SUBMITTED", toStatus: o.status, actor: "pcp.officer", actorRole: "pcp_officer", note: "Seeded state for the demo" });
    await audit(db, { actor: "system", action: "application.seeded", entity: "application", entityId: o.ref, details: { status: o.status } });
    return row;
  };

  const baseData = (campus: string, intake: number) => ({ campus, proposedIntake: intake, classrooms: 8, labs: 6, labList: "Pharmaceutics, Pharmacology, Pharmaceutical Chemistry, Pharmacognosy, Microbiology, Physiology", libraryBooks: 3200, libraryJournals: 24, buildingAreaSqft: 42000 });

  const a1 = await mkApp({ ref: "NOC-2026-0001", s: "NHC", kind: "NOC", type: "PHARMD", status: "UNDER_SCRUTINY", submitted: "2026-09-12T09:30:00Z", officer: "pcp.officer", data: baseData("Main campus, Abbottabad", 60) });
  const a2 = await mkApp({ ref: "NOC-2026-0002", s: "CCP", kind: "NOC", type: "TECH", status: "DEFICIENCY_RAISED", submitted: "2026-08-28T08:00:00Z", officer: "pcp.officer", data: { ...baseData("Clifton campus, Karachi", 40), labs: 3, classrooms: 4, libraryBooks: 900 } });
  const a3 = await mkApp({ ref: "NOC-2026-0003", s: "FRU", kind: "NOC", type: "PHARMD", status: "INSPECTION_SCHEDULED", submitted: "2026-08-10T10:00:00Z", officer: "pcp.officer", data: baseData("City campus, Multan", 80) });
  const a4 = await mkApp({ ref: "NOC-2026-0004", s: "SCU", kind: "NOC", type: "TECH", status: "INSPECTION_SCHEDULED", submitted: "2026-08-02T10:00:00Z", officer: "pcp.officer", data: { ...baseData("Jamshoro road campus, Hyderabad", 40), labs: 3, classrooms: 4, libraryBooks: 800 } });
  const a5 = await mkApp({ ref: "NOC-2026-0005", s: "BVU", kind: "NOC", type: "PHARMD", status: "COUNCIL_REVIEW", submitted: "2026-06-20T10:00:00Z", officer: "pcp.officer", data: baseData("Sariab road campus, Quetta", 60) });
  const a6 = await mkApp({ ref: "NOC-2025-0007", s: "GMI", kind: "NOC", type: "TECH", status: "NOC_ISSUED", submitted: "2025-07-01T10:00:00Z", officer: "pcp.officer", data: { ...baseData("Jutial campus, Gilgit", 40), labs: 3, classrooms: 4, libraryBooks: 700 }, cert: "NOC-TECH-2025-0007", issued: "2025-11-20T10:00:00Z", validUntil: "2030-11-19" });
  const a7 = await mkApp({ ref: "ACC-2026-0001", s: "RBU", kind: "ACCREDITATION", type: "PHARMD", status: "SUBMITTED", submitted: "2026-09-25T10:00:00Z", data: baseData("Main campus, Lahore", 120) });

  await db.insert(schema.deficiencies).values([
    { ref: "DF-2026-00001", applicationId: a2.id, institutionId: inst.CCP.id, criterion: "Faculty", requiredAction: "Appoint a qualified lecturer for the technician program (at least 3 active faculty needed for intake 40)", evidenceRequired: "Appointment letter + CV", dueDate: "2026-10-28", raisedBy: "pcp.officer" },
    { ref: "DF-2026-00002", applicationId: a2.id, institutionId: inst.CCP.id, criterion: "Laboratories", requiredAction: "Provide the equipment list and safety certificate for the Pharmaceutics lab", evidenceRequired: "Equipment inventory + safety certificate", dueDate: "2026-10-28", raisedBy: "pcp.officer" },
  ]);

  await db.insert(schema.inspections).values([
    { applicationId: a3.id, institutionId: inst.FRU.id, inspector: "pcp.inspector2", scheduledFor: "2026-10-15", createdBy: "pcp.officer" },
    { applicationId: a4.id, institutionId: inst.SCU.id, inspector: "pcp.inspector", scheduledFor: "2026-10-12", createdBy: "pcp.officer" },
    {
      applicationId: a5.id,
      institutionId: inst.BVU.id,
      inspector: "pcp.inspector",
      scheduledFor: "2026-08-18",
      status: "SUBMITTED",
      submittedAt: new Date("2026-08-19T15:00:00Z"),
      createdBy: "pcp.officer",
      summary: "Facilities adequate. Library journals below target; recommend approval with a 6-month compliance condition.",
      checklist: CRITERIA.map((c, i) => ({ criterion: c, result: i === 2 ? "PARTIAL" : "COMPLIANT", remarks: i === 2 ? "Only 12 journal subscriptions; 20 recommended" : "Verified on site" })) as ChecklistItem[],
    },
  ]);

  // Documents: the per-institution folder tree from PCP's draft
  const addDoc = async (s: string, folder: string, docType: string, fileName: string, lines: string[], appId?: number, status = "VERIFIED") => {
    const i = inst[s];
    const bytes = await samplePdf(`${docType} - ${i.name}`, lines);
    const f = await putFile(i.code, folder, 1, fileName, bytes);
    await db.insert(schema.documents).values({ institutionId: i.id, folder: f.folder, docType, fileName, storageKey: f.key, version: 1, sizeBytes: bytes.length, mimeType: "application/pdf", sha256: f.sha256, verificationStatus: status, applicationId: appId ?? null, uploadedBy: `${s.toLowerCase()}.poc` });
  };
  for (const i of INSTITUTIONS) {
    await addDoc(i.shortCode, "legal-documents", "Charter or affiliation letter", "charter.pdf", [`Charter of ${i.name}`, `City: ${i.city}`, `Established: ${i.est}`]);
    await addDoc(i.shortCode, "university-documents", "University notification", "university-notification.pdf", ["Notification of the pharmacy department", "Signed by the Registrar (demo)"]);
  }
  await addDoc("RUH", "accreditation/2024", "Accreditation certificate", "accreditation-2024.pdf", ["PharmD accreditation 2024 to 2027", "Intake: 100"]);
  await addDoc("RUH", "faculty-documents/PCP-FAC-000001", "Faculty CV", "cv-muhammad-ali-khan.pdf", ["CV of Dr. Muhammad Ali Khan", "PhD Pharmacology"]);
  for (const [s, a, n] of [["NHC", a1, 4], ["CCP", a2, 3], ["FRU", a3, 4], ["SCU", a4, 3], ["BVU", a5, 4], ["GMI", a6, 3], ["RBU", a7, 4]] as const) {
    const docs = ["Charter or affiliation letter", "Building plan", "Laboratory inventory", "Faculty appointment letters"].slice(0, n);
    const folder = a.kind === "ACCREDITATION" ? `accreditation/2026/${a.ref}` : `noc-applications/${a.ref}`;
    for (const d of docs) await addDoc(s, folder, d, d.toLowerCase().replace(/[^a-z]+/g, "-") + ".pdf", [`${d} for ${a.ref}`], a.id, a.status === "UNDER_SCRUTINY" || a.status === "SUBMITTED" ? "PENDING" : "VERIFIED");
  }
  await addDoc("BVU", `inspection-reports/${a5.ref}`, "Inspection report", "inspection-report.pdf", [`Inspection of ${a5.ref}`, "Result: mostly compliant; library partial"], a5.id);
  await addDoc("GMI", `noc-applications/${a6.ref}`, "NOC certificate", "noc-certificate.pdf", ["NOC-TECH-2025-0007", "Pharmacy Technician program, intake 40"], a6.id);

  await db.insert(schema.notifications).values([
    { audience: "inst:PCP-UNI-000101", title: "Accreditation renewal due", body: "Your PharmD accreditation expires on 15 Mar 2027. Start the renewal at least 120 days before expiry.", link: "/institution" },
    { audience: "inst:PCP-UNI-000104", title: "Deficiency raised on NOC-2026-0002", body: "2 deficiencies need a response by 28 Oct 2026.", link: "/institution/applications/NOC-2026-0002" },
    { audience: "role:pcp_secretary", title: "NOC-2026-0005 awaiting council decision", body: "Inspection report submitted; forwarded by the PCP officer.", link: "/pcp/applications/NOC-2026-0005" },
    { audience: "user:pcp.inspector", title: "Inspection scheduled: NOC-2026-0004", body: "Sindh Coastal University, 12 Oct 2026.", link: "/pcp/inspections" },
    { audience: "role:pcp_officer", title: "Possible duplicate faculty", body: "Dr. Mohammad Usman Tariq (FRU) may be the same person as Dr. Muhammad Usman Tariq (RBU).", link: "/pcp/verification" },
  ]);

  // Module data (one file per module in scripts/seed/), after the core registry exists.
  await seedModules();

  await audit(db, { actor: "system", action: "seed.completed", entity: "system", entityId: "seed", details: { institutions: INSTITUTIONS.length, faculty: facNo, students: stuCount } });
  console.log(`Seeded ${INSTITUTIONS.length} institutions, ${facNo} faculty, ${stuCount} students, 7 applications.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
