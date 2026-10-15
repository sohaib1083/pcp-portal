// Seed data for postgraduate accreditation (RFP 4.1.10), the technical officer and inspection scoring (4.1.2, 4.1.14).
// Runs last, after the other module seeds. Adds:
//  - the `pg.rules` and `inspection.scoring` reference rules, and `fees` version 2 with the postgraduate fees;
//  - PhD supervisors at Riverside (Pharmacology), Ravi Bank (Pharmaceutics) and Sindh Coastal (Pharmaceutics);
//  - PGA-2026-0001: Riverside's PhD Pharmacology accreditation, waiting for the technical officer;
//  - PGA-2025-0001: Sindh Coastal's MS/MPhil Pharmaceutics, accredited with certificate ACR-MPHIL-2025-0001;
//  - a score on every submitted inspection.
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../src/db";
import type { ChecklistItem, SupervisorDetails } from "../../src/db/schema";
import { audit } from "../../src/lib/audit";
import { certificatePdf } from "../../src/lib/certificate";
import { decisionLetter } from "../../src/lib/decision-letters";
import { DEFAULT_SCORING, scoreTotals, weightFor, type ScoringRule } from "../../src/lib/inspection-scoring";
import { fileDocument, renderLetter } from "../../src/lib/letters";
import { resolveAudience } from "../../src/lib/messages";
import { normalizeName } from "../../src/lib/names";
import { DEFAULT_PG_FEES, DEFAULT_PG_RULE } from "../../src/lib/pg";
import { runChecks } from "../../src/lib/rules";
import { DEFAULT_SLA } from "../../src/lib/sla";
import { PG_INSPECTION_CRITERIA, PG_TECHNICAL_REVIEW_CRITERIA, SUPERVISOR_SUBJECT } from "../../src/lib/workflow";

const DAY = 86400000;
const now = Date.now();
const ago = (d: number) => new Date(now - d * DAY);
const at = (s: string) => new Date(s);

type Inst = typeof schema.institutions.$inferSelect;

async function samplePdf(title: string, lines: string[]) {
  return renderLetter({ kind: "Institution document", refNo: title, subject: title, paragraphs: lines });
}

/** Store an email on the case with the date it was sent (the outbox; nothing leaves the demo). */
async function mail(audience: string, subject: string, body: string, ref: string, link: string, when: Date) {
  const to = await resolveAudience(db, audience);
  const rows = to
    .filter((r) => r.email)
    .map((r) => ({ channel: "EMAIL", toAddress: r.email!, toName: r.name, audience, subject, body: `${body}\n\nOpen: http://localhost:8088${link}\n\nPharmacy Council of Pakistan · demo · this message was not actually sent`, entity: "application", entityRef: ref, link, institutionId: r.institutionId, createdAt: when }));
  if (rows.length) await db.insert(schema.messages).values(rows);
}

/** Line scores from the result: compliant 5 or 4, partial 3, non-compliant 1, not applicable none. */
function scoreLines(items: ChecklistItem[], rule: ScoringRule): ChecklistItem[] {
  return items.map((it, i) => ({
    ...it,
    score: it.result === "NA" ? null : it.result === "COMPLIANT" ? (i % 3 === 1 ? rule.bands.COMPLIANT[0] : rule.maxScore) : it.result === "PARTIAL" ? rule.bands.PARTIAL[1] : rule.bands.NON_COMPLIANT[1],
    weight: weightFor(rule, it.criterion),
  }));
}

export default async function seedPg(): Promise<string | void> {
  // ---------- Reference rules ----------
  const fees = await db.query.rules.findFirst({ where: eq(schema.rules.key, "fees"), orderBy: desc(schema.rules.version) });
  await db.insert(schema.rules).values([
    {
      key: "pg.rules",
      version: 1,
      effectiveFrom: "2026-01-01",
      description: "Postgraduate (MS/MPhil and PhD) accreditation: fields of study, PG proforma thresholds, supervisor eligibility (PhD plus publications or HEC-approved), students per supervisor and PhD faculty in the field (demo values)",
      value: DEFAULT_PG_RULE,
    },
    {
      key: "inspection.scoring",
      version: 1,
      effectiveFrom: "2026-01-01",
      description: "Inspection score entry: 0 to 5 per checklist line within the band of its result, weights per line, pass mark 60% (demo values)",
      value: DEFAULT_SCORING,
    },
    ...(fees
      ? [{ key: "fees", version: fees.version + 1, effectiveFrom: "2026-01-01", description: "Postgraduate accreditation and renewal fees added (MS/MPhil, PhD)", value: { ...(fees.value as Record<string, number>), ...DEFAULT_PG_FEES } }]
      : []),
  ]);
  const rule = DEFAULT_SCORING;

  const insts = await db.select().from(schema.institutions);
  const inst: Record<string, Inst> = Object.fromEntries(insts.map((i) => [i.shortCode, i]));
  const mainCampus = async (id: number) => (await db.query.campuses.findFirst({ where: and(eq(schema.campuses.institutionId, id), eq(schema.campuses.isMain, true)) }))!;

  // ---------- PhD supervisors (appointed to the PharmD programme, supervising postgraduates) ----------
  const res = await db.execute(sql`select coalesce(max(split_part(pcp_id, '-', 3)::int), 0) as n from faculty`);
  let facNo = Number((res.rows[0] as { n: number }).n);
  const person = async (s: string, f: { full: string; father: string; cnic: string; spec: string; desig: string }) => {
    facNo++;
    const [row] = await db
      .insert(schema.faculty)
      .values({ pcpId: `PCP-FAC-${String(facNo).padStart(6, "0")}`, cnic: f.cnic, fullName: f.full, fatherName: f.father, nameNorm: normalizeName(f.full), qualification: "PhD", specialization: f.spec, pcpRegNo: `PC-${70000 + facNo}`, designation: f.desig, verificationStatus: "VERIFIED" })
      .returning();
    await db.insert(schema.facultyLinks).values({ facultyId: row.id, institutionId: inst[s].id, programType: "PHARMD", status: "ACTIVE", startDate: "2019-09-01", createdBy: "system" });
    return row;
  };
  const byCnic = async (cnic: string) => (await db.query.faculty.findFirst({ where: eq(schema.faculty.cnic, cnic) }))!;
  const aliKhan = await byCnic("17301-1234567-1"); // Dr. Muhammad Ali Khan, PhD Pharmacology, Riverside
  const saraMalik = await byCnic("35202-7654321-2"); // Dr. Sara Malik, PhD Pharmaceutics, Ravi Bank
  const sadia = await person("RUH", { full: "Dr. Sadia Rehman", father: "Abdul Rehman", cnic: "17301-9100001-2", spec: "Pharmacology", desig: "Associate Professor" });
  const kamal = await person("RUH", { full: "Dr. Kamal Yousafzai", father: "Gul Yousafzai", cnic: "17301-9100002-3", spec: "Pharmacology", desig: "Assistant Professor" });
  const hina = await person("RBU", { full: "Dr. Hina Aslam", father: "Muhammad Aslam", cnic: "35202-9100003-4", spec: "Pharmaceutics", desig: "Assistant Professor" });
  const faraz = await person("RBU", { full: "Dr. Faraz Ahmed Siddiqui", father: "Ahmed Siddiqui", cnic: "35202-9100004-5", spec: "Pharmaceutics", desig: "Associate Professor" });
  const sattar = await person("SCU", { full: "Dr. Abdul Sattar Memon", father: "Ghulam Memon", cnic: "42101-9100005-6", spec: "Pharmaceutics", desig: "Professor" });
  const farah = await person("SCU", { full: "Dr. Farah Naz Shaikh", father: "Naseer Shaikh", cnic: "42101-9100006-7", spec: "Pharmaceutics", desig: "Associate Professor" });
  void hina;
  void faraz;
  void saraMalik;

  const supervise = async (appId: number, by: string, when: Date, rows: [typeof aliKhan, SupervisorDetails][]) =>
    db.insert(schema.applicationFaculty).values(rows.map(([f, details]) => ({ applicationId: appId, facultyId: f.id, subject: SUPERVISOR_SUBJECT, details, createdBy: by, createdAt: when })));
  const pgDocs = async (instId: number, appId: number, ref: string, folder: string, label: string, hecNoc: string, by: string, status: string) => {
    for (const [docType, lines] of [
      ["HEC NOC for the PG programme", [`Higher Education Commission: No Objection Certificate ${hecNoc}`, `${label}`, "Issued by the Quality Assurance Agency (demo)"]],
      ["PG scheme of studies", [`Scheme of studies: ${label}`, "Coursework, research methodology, seminar and thesis (demo)"]],
      ["Research laboratory inventory", [`Research laboratory inventory: ${label}`, "Equipment registers and calibration records (demo)"]],
    ] as const)
      await fileDocument(db, { institutionId: instId, folder, docType, fileName: `${docType.toLowerCase().replace(/\W+/g, "-")}.pdf`, bytes: await samplePdf(`${docType} - ${ref}`, [...lines]), applicationId: appId, uploadedBy: by, verificationStatus: status });
  };

  // ---------- PGA-2025-0001: Sindh Coastal, MS/MPhil Pharmaceutics, accredited with a certificate ----------
  const scu = inst.SCU;
  const scuCampus = await mainCampus(scu.id);
  const certNo = "ACR-MPHIL-2025-0001";
  const scuNoc = "HEC/QAA/PG/2025/0188";
  const [scuProg] = await db
    .insert(schema.programs)
    .values({ institutionId: scu.id, type: "MPHIL", field: "Pharmaceutics", nocStatus: "NONE", nocNumber: scuNoc, approvedIntake: 10, accreditationStatus: "VALID", accreditationValidUntil: "2028-08-31" })
    .returning();
  const scuData = {
    campus: scuCampus.name,
    proposedIntake: 10,
    durationYears: 2,
    courseworkCredits: 24,
    thesisRequired: true,
    researchLabs: 2,
    researchLabList: "Pharmaceutics research lab, Analytical (HPLC) lab",
    equipment: "HPLC with UV detector, dissolution apparatus, FTIR, particle size analyser, stability chambers",
    libraryJournals: 18,
    hecDigitalLibrary: true,
    hecNocNumber: scuNoc,
    hecNocDate: "2024-12-02",
  };
  const [pga] = await db
    .insert(schema.applications)
    .values({
      ref: "PGA-2025-0001",
      institutionId: scu.id,
      kind: "ACCREDITATION",
      programType: "MPHIL",
      field: "Pharmaceutics",
      status: "NOC_ISSUED",
      campusId: scuCampus.id,
      data: scuData,
      checks: [{ key: "all", label: "Automatic checks", ok: true, detail: "All checks passed at submission" }],
      feeAmount: DEFAULT_PG_FEES["ACCREDITATION:MPHIL"],
      feePsid: "2025000001080310",
      feePaidAt: at("2025-03-10T09:00:00Z"),
      feePaidBy: "scu.poc",
      feeMethod: "Raast QR",
      assignedOfficer: "pcp.officer",
      submittedBy: "scu.poc",
      submittedAt: at("2025-03-10T10:00:00Z"),
      decision: "APPROVED",
      decisionNote: "Approved for an intake of 10; publish the supervisor list on the university website.",
      decidedAt: at("2025-08-20T10:00:00Z"),
      certificateNo: certNo,
      issuedAt: at("2025-08-31T10:00:00Z"),
      validUntil: "2028-08-31",
      selfAssessment: [],
      createdBy: "scu.poc",
      createdAt: at("2025-03-01T10:00:00Z"),
      updatedAt: at("2025-08-31T10:00:00Z"),
    })
    .returning();
  const steps: [string, string, string, string, string, string][] = [
    ["DRAFT", "SUBMITTED", "scu.poc", "inst_poc", "2025-03-10T10:00:00Z", "Submitted with all checks passing and fee paid"],
    ["SUBMITTED", "UNDER_SCRUTINY", "pcp.officer", "pcp_officer", "2025-03-14T10:00:00Z", "Initial scrutiny started"],
    ["UNDER_SCRUTINY", "TECHNICAL_REVIEW", "pcp.officer", "pcp_officer", "2025-03-28T10:00:00Z", "Initial scrutiny passed; technical review started"],
    ["TECHNICAL_REVIEW", "TECHNICAL_REVIEW", "pcp.technical", "pcp_technical", "2025-04-15T10:00:00Z", "Technical review recorded: proforma meets the MS/MPhil standards (2 of 2 supervisors confirmed eligible)"],
    ["TECHNICAL_REVIEW", "INSPECTION_SCHEDULED", "pcp.coordinator", "pcp_coordinator", "2025-04-22T10:00:00Z", "Inspection on 2025-05-20; team of 1"],
    ["INSPECTION_SCHEDULED", "INSPECTION_SUBMITTED", "pcp.inspector", "pcp_inspector", "2025-05-21T10:00:00Z", "Digital checklist submitted"],
    ["INSPECTION_SUBMITTED", "COUNCIL_REVIEW", "pcp.officer", "pcp_officer", "2025-06-02T10:00:00Z", "Recommendation: approve the MS/MPhil Pharmaceutics programme for an intake of 10"],
    ["COUNCIL_REVIEW", "APPROVED", "pcp.secretary", "pcp_secretary", "2025-08-20T10:00:00Z", "Council decision: approved"],
    ["APPROVED", "NOC_ISSUED", "pcp.secretary", "pcp_secretary", "2025-08-31T10:00:00Z", `Certificate ${certNo} issued`],
  ];
  await db.insert(schema.applicationEvents).values(steps.map(([fromStatus, toStatus, actor, actorRole, when, note]) => ({ applicationId: pga.id, fromStatus, toStatus, actor, actorRole, note, createdAt: at(when) })));
  await supervise(pga.id, "scu.poc", at("2025-03-05T10:00:00Z"), [
    [sattar, { publications: 22, hecApproved: true, currentStudents: 3 }],
    [farah, { publications: 9, hecApproved: false, currentStudents: 2 }],
  ]);
  await db.insert(schema.technicalReviews).values({
    applicationId: pga.id,
    reviewer: "pcp.technical",
    items: PG_TECHNICAL_REVIEW_CRITERIA.map((criterion) => ({ criterion, result: "MEETS" as const, remarks: "" })),
    supervisors: [
      { facultyId: sattar.id, pcpId: sattar.pcpId, name: sattar.fullName, result: "ELIGIBLE", remarks: "HEC-approved supervisor; 22 publications" },
      { facultyId: farah.id, pcpId: farah.pcpId, name: farah.fullName, result: "ELIGIBLE", remarks: "9 publications verified on HEC's journal list" },
    ],
    summary: "Proforma meets the MS/MPhil standards; both supervisors eligible; intake of 10 fits.",
    outcome: "PROCEED",
    createdAt: at("2025-04-15T10:00:00Z"),
  });
  const scuChecklist = scoreLines(
    PG_INSPECTION_CRITERIA.map((criterion, i) => ({ criterion, result: i === 2 ? "PARTIAL" : "COMPLIANT", remarks: i === 2 ? "HEC Digital Library access in place; 18 of 20 recommended journals" : "Verified on site" })),
    rule,
  );
  const [scuInsp] = await db
    .insert(schema.inspections)
    .values({ applicationId: pga.id, institutionId: scu.id, inspector: "pcp.inspector", scheduledFor: "2025-05-20", scope: "Supervisor files with publication lists; research laboratories with equipment registers; journal subscriptions; thesis records.", status: "SUBMITTED", checklist: scuChecklist, summary: "Research laboratories and supervision adequate for an intake of 10; recommend approval.", submittedAt: at("2025-05-21T10:00:00Z"), createdBy: "pcp.coordinator" })
    .returning();
  await db.insert(schema.inspectionTeam).values({ inspectionId: scuInsp.id, username: "pcp.inspector", role: "LEAD" });
  await db.insert(schema.accreditationHistory).values({ programId: scuProg.id, year: 2025, status: "Accredited", validFrom: 2025, validUntil: 2028, intake: 10, decision: "Approved", applicationRef: "PGA-2025-0001" });
  await pgDocs(scu.id, pga.id, "PGA-2025-0001", "accreditation/2025/PGA-2025-0001", "MS/MPhil Pharmaceutics, Sindh Coastal University", scuNoc, "scu.poc", "VERIFIED");
  await fileDocument(db, {
    institutionId: scu.id,
    folder: "inspection-reports/PGA-2025-0001",
    docType: "Inspection report",
    fileName: "inspection-report.pdf",
    bytes: await samplePdf("Inspection report - PGA-2025-0001", ["MS/MPhil Pharmaceutics, inspected 2025-05-20", "Score 89% (pass mark 60%)"]),
    applicationId: pga.id,
    uploadedBy: "pcp.inspector",
  });
  const letter = await fileDocument(db, {
    institutionId: scu.id,
    folder: "accreditation/2025/PGA-2025-0001",
    docType: "Decision letter",
    fileName: "PGA-2025-0001-decision-approved.pdf",
    bytes: await decisionLetter({ decision: "APPROVED", ref: "PGA-2025-0001", kind: "ACCREDITATION", programType: "MPHIL", field: "Pharmaceutics", intake: 10, campus: scuCampus.name, inst: scu, note: pga.decisionNote, period: { from: 2025, until: 2028 }, signedBy: "Dr. Nadia Hussain", at: at("2025-08-20T10:00:00Z") }),
    applicationId: pga.id,
    uploadedBy: "pcp.secretary",
  });
  await db.update(schema.applications).set({ letterDocumentId: letter.id }).where(eq(schema.applications.id, pga.id));
  await fileDocument(db, {
    institutionId: scu.id,
    folder: "accreditation/2025/PGA-2025-0001",
    docType: "Accreditation certificate",
    fileName: `${certNo}.pdf`,
    bytes: await certificatePdf({ kind: "ACCREDITATION", validFrom: "2025-08-31", certNo, institution: scu.name, institutionCode: scu.code, city: scu.city, program: "MS/MPhil Pharmaceutics", intake: 10, issuedAt: at("2025-08-31T10:00:00Z"), validUntil: "2028-08-31", decisionNote: pga.decisionNote, hecNoc: scuNoc }),
    applicationId: pga.id,
    uploadedBy: "pcp.secretary",
  });
  await mail(`inst:${scu.code}`, `Accreditation certificate issued: ${certNo}`, "Your MS/MPhil Pharmaceutics accreditation is valid until 2028-08-31 for an intake of 10. Anyone can verify it by scanning its QR code.", "PGA-2025-0001", "/institution/applications/PGA-2025-0001", at("2025-08-31T10:00:00Z"));
  await audit(db, { actor: "system", action: "application.seeded", entity: "application", entityId: "PGA-2025-0001", details: { status: "NOC_ISSUED", certNo } });

  // ---------- PGA-2026-0001: Riverside, PhD Pharmacology, waiting for the technical officer ----------
  const ruh = inst.RUH;
  const ruhCampus = await mainCampus(ruh.id);
  const ruhNoc = "HEC/QAA/PG/2026/0231";
  await db.insert(schema.programs).values({ institutionId: ruh.id, type: "PHD", field: "Pharmacology", nocStatus: "NONE", approvedIntake: 0, accreditationStatus: "PENDING" });
  const [phd] = await db
    .insert(schema.applications)
    .values({
      ref: "PGA-2026-0001",
      institutionId: ruh.id,
      kind: "ACCREDITATION",
      programType: "PHD",
      field: "Pharmacology",
      status: "TECHNICAL_REVIEW",
      campusId: ruhCampus.id,
      data: {
        campus: ruhCampus.name,
        proposedIntake: 6,
        durationYears: 3,
        courseworkCredits: 18,
        thesisRequired: true,
        researchLabs: 3,
        researchLabList: "Pharmacology research lab, Animal house (licensed), Molecular pharmacology lab",
        equipment: "Organ bath system, ELISA reader, real-time PCR, rotarod, plethysmometer, HPLC",
        libraryJournals: 26,
        hecDigitalLibrary: true,
        hecNocNumber: ruhNoc,
        hecNocDate: "2026-06-18",
      },
      feeAmount: DEFAULT_PG_FEES["ACCREDITATION:PHD"],
      feePsid: "2026000001090101",
      feePaidAt: ago(9),
      feePaidBy: "ruh.finance",
      feeMethod: "Raast QR",
      assignedOfficer: "pcp.officer",
      submittedBy: "ruh.poc",
      submittedAt: ago(9),
      stageStartedAt: ago(3),
      stageDueAt: new Date(ago(3).getTime() + (DEFAULT_SLA.TECHNICAL_REVIEW ?? 14) * DAY),
      selfAssessment: [],
      createdBy: "ruh.dean",
      createdAt: ago(16),
      updatedAt: ago(3),
    })
    .returning();
  await supervise(phd.id, "ruh.dean", ago(12), [
    [aliKhan, { publications: 31, hecApproved: true, currentStudents: 2 }],
    [sadia, { publications: 9, hecApproved: false, currentStudents: 1 }],
    [kamal, { publications: 6, hecApproved: false, currentStudents: 0 }],
  ]);
  await pgDocs(ruh.id, phd.id, "PGA-2026-0001", "accreditation/2026/PGA-2026-0001", "PhD Pharmacology, Riverside University of Health Sciences", ruhNoc, "ruh.dean", "PENDING");
  const { checks } = await runChecks(phd.id);
  await db.update(schema.applications).set({ checks }).where(eq(schema.applications.id, phd.id));
  await db.insert(schema.applicationEvents).values([
    { applicationId: phd.id, fromStatus: null, toStatus: "DRAFT", actor: "ruh.dean", actorRole: "inst_principal", note: "PhD Pharmacology accreditation started", createdAt: ago(16) },
    { applicationId: phd.id, fromStatus: "DRAFT", toStatus: "SUBMITTED", actor: "ruh.poc", actorRole: "inst_poc", note: "Submitted with all checks passing and fee paid", createdAt: ago(9) },
    { applicationId: phd.id, fromStatus: "SUBMITTED", toStatus: "UNDER_SCRUTINY", actor: "pcp.officer", actorRole: "pcp_officer", note: "Initial scrutiny started", createdAt: ago(7) },
    { applicationId: phd.id, fromStatus: "UNDER_SCRUTINY", toStatus: "TECHNICAL_REVIEW", actor: "pcp.officer", actorRole: "pcp_officer", note: "Initial scrutiny passed; technical review started", createdAt: ago(3) },
  ]);
  await mail(`inst:${ruh.code}`, "Application PGA-2026-0001 received", "PCP has received your Accreditation application. You will be notified at each step.", "PGA-2026-0001", "/institution/applications/PGA-2026-0001", ago(9));
  await db.insert(schema.notifications).values([
    { audience: "role:pcp_technical", title: "Technical review: PGA-2026-0001", body: "RUH PhD Pharmacology accreditation passed initial scrutiny. Record the academic check, the PG proforma review and a check of each supervisor.", link: "/pcp/applications/PGA-2026-0001", createdAt: ago(3) },
    { audience: `inst:${ruh.code}`, title: "PGA-2026-0001 in technical review", body: "Initial scrutiny is complete. PCP is now checking the programme against the academic standards.", link: "/institution/applications/PGA-2026-0001", createdAt: ago(3) },
  ]);
  await audit(db, { actor: "system", action: "application.seeded", entity: "application", entityId: "PGA-2026-0001", details: { status: "TECHNICAL_REVIEW" } });

  // ---------- A score on every submitted inspection ----------
  const submitted = await db.select().from(schema.inspections).where(eq(schema.inspections.status, "SUBMITTED")).orderBy(asc(schema.inspections.id));
  const scored: string[] = [];
  for (const i of submitted) {
    const items = (i.checklist ?? []).some((c) => c.score !== undefined) ? (i.checklist ?? []) : scoreLines(i.checklist ?? [], rule);
    const t = scoreTotals(items, rule);
    await db.update(schema.inspections).set({ checklist: items }).where(eq(schema.inspections.id, i.id));
    await db.insert(schema.inspectionScores).values({ inspectionId: i.id, total: t.total, max: t.max, percent: t.percent, passPercent: t.passPercent, passed: t.passed, ruleVersion: 1, createdAt: i.submittedAt ?? new Date() }).onConflictDoNothing();
    const a = await db.query.applications.findFirst({ where: eq(schema.applications.id, i.applicationId) });
    scored.push(`${a?.ref} ${t.percent}%`);
  }

  const failing = checks.filter((c) => !c.ok).map((c) => c.detail);
  return `pg.rules, inspection.scoring and fees v${(fees?.version ?? 0) + 1}; 6 PhD supervisors; PGA-2025-0001 (SCU MS/MPhil Pharmaceutics, ${certNo}); PGA-2026-0001 (RUH PhD Pharmacology, technical review${failing.length ? `, CHECKS FAILING: ${failing.join(" | ")}` : ", checks passing"}); inspection scores: ${scored.join(", ")}`;
}
