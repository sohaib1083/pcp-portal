// Seed data for the workflow module (NOC, accreditation and renewal cases). Runs after the core seed.
// Adds: the service-level rule, campus and faculty links on every seeded case, inspection scope and teams,
// technical reviews, a stage clock on every open case (one of them overdue), a deferred renewal with a
// return date and its decision letter, and the closed 2024 renewal that Riverside's next renewal is prepared from.
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db, schema } from "../../src/db";
import type { ChecklistItem, SelfAssessmentItem } from "../../src/db/schema";
import { audit } from "../../src/lib/audit";
import { certificatePdf } from "../../src/lib/certificate";
import { decisionLetter } from "../../src/lib/decision-letters";
import { fileDocument, renderLetter } from "../../src/lib/letters";
import { resolveAudience } from "../../src/lib/messages";
import { getRule, subjectRequirements, suggestAssignment, type ProgramRule } from "../../src/lib/rules";
import { runRenewalAlerts } from "../../src/lib/renewals";
import { DEFAULT_SLA, runSlaChecks } from "../../src/lib/sla";
import { SELF_ASSESSMENT_CRITERIA, TECHNICAL_REVIEW_CRITERIA } from "../../src/lib/workflow";

const DAY = 86400000;
const now = Date.now();
const ago = (d: number) => new Date(now - d * DAY);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const endOfDay = (d: string) => new Date(`${d}T23:59:59+05:00`);

const CRITERIA = [
  "Faculty: qualified, full-time, as per submitted list",
  "Laboratories: equipment, chemicals and safety",
  "Library: books, journals and digital access",
  "Classrooms and building",
  "Student records and attendance",
  "Hospital / pharmacy practice linkage",
  "Governance and finances",
];
const SCOPE = "Faculty files and appointment letters for every linked teacher; laboratories with equipment registers; library stock and journal subscriptions; student records for the current intake.";

/** Store an email on the case with the date it was sent (the outbox; nothing leaves the demo). */
async function mail(audience: string, subject: string, body: string, ref: string, link: string, at: Date) {
  const to = await resolveAudience(db, audience);
  const rows = to
    .filter((r) => r.email)
    .map((r) => ({
      channel: "EMAIL",
      toAddress: r.email!,
      toName: r.name,
      audience,
      subject,
      body: `${body}\n\nOpen: http://localhost:8088${link}\n\nPharmacy Council of Pakistan · demo · this message was not actually sent`,
      entity: "application",
      entityRef: ref,
      link,
      institutionId: r.institutionId,
      createdAt: at,
    }));
  if (rows.length) await db.insert(schema.messages).values(rows);
}

async function samplePdf(title: string, lines: string[]) {
  return renderLetter({ kind: "Institution document", refNo: title, subject: title, paragraphs: lines });
}

export default async function seedWorkflow(): Promise<string | void> {
  await db.insert(schema.rules).values({
    key: "sla.stages",
    version: 1,
    effectiveFrom: "2026-01-01",
    description: "Service levels: days allowed per case stage. A case past its limit gets a reminder, then one escalation to the supervisor.",
    value: DEFAULT_SLA,
  });

  const insts = await db.select().from(schema.institutions);
  const inst = Object.fromEntries(insts.map((i) => [i.shortCode, i]));
  const campuses = await db.select().from(schema.campuses);
  const mainCampus = (id: number) => campuses.find((c) => c.institutionId === id && c.isMain)!;
  const rules: Record<string, ProgramRule> = {
    PHARMD: (await getRule<ProgramRule>("noc.PHARMD")).value,
    TECH: (await getRule<ProgramRule>("noc.TECH")).value,
  };

  /** Link the programme's own faculty to subjects, as the institution would have before submitting. */
  const linkFaculty = async (appId: number, institutionId: number, programType: string, intake: number, by: string, at: Date) => {
    const pool = await db
      .select({ id: schema.faculty.id, specialization: schema.faculty.specialization, qualification: schema.faculty.qualification })
      .from(schema.facultyLinks)
      .innerJoin(schema.faculty, eq(schema.faculty.id, schema.facultyLinks.facultyId))
      .where(and(eq(schema.facultyLinks.institutionId, institutionId), eq(schema.facultyLinks.programType, programType), eq(schema.facultyLinks.status, "ACTIVE"), inArray(schema.faculty.verificationStatus, ["VERIFIED", "PENDING"])))
      .orderBy(asc(schema.faculty.id));
    const links = suggestAssignment(pool, subjectRequirements(rules[programType], intake));
    if (links.length) await db.insert(schema.applicationFaculty).values(links.map((l) => ({ applicationId: appId, facultyId: l.facultyId, subject: l.subject, createdBy: by, createdAt: at })));
    return links.length;
  };

  // ---------- The cases from the core seed: campus, intake that fits the per-subject rule, faculty, clock ----------
  const apps = await db.select().from(schema.applications);
  const byRef = Object.fromEntries(apps.map((a) => [a.ref, a]));
  // Intake 50 for the PharmD NOCs fits the colleges' faculty under the per-subject rule (7 teachers).
  const intakeFix: Record<string, number> = { "NOC-2026-0001": 50, "NOC-2026-0003": 50, "NOC-2026-0005": 50 };
  const clocks: Record<string, { start: Date; due: Date }> = {
    "NOC-2026-0001": { start: ago(22), due: ago(8) }, // overdue scrutiny: reminder, then escalation
    "NOC-2026-0002": { start: ago(8), due: endOfDay("2026-10-28") },
    "NOC-2026-0003": { start: ago(6), due: new Date(endOfDay("2026-10-15").getTime() + DEFAULT_SLA.INSPECTION_SCHEDULED * DAY) },
    "NOC-2026-0004": { start: ago(10), due: new Date(endOfDay("2026-10-12").getTime() + DEFAULT_SLA.INSPECTION_SCHEDULED * DAY) },
    "NOC-2026-0005": { start: ago(16), due: new Date(ago(16).getTime() + DEFAULT_SLA.COUNCIL_REVIEW * DAY) },
    "ACC-2026-0001": { start: ago(1), due: new Date(ago(1).getTime() + DEFAULT_SLA.SUBMITTED * DAY) },
  };
  let linked = 0;
  for (const a of apps) {
    const c = mainCampus(a.institutionId);
    const intake = intakeFix[a.ref] ?? Number(a.data?.proposedIntake ?? 0);
    const clock = clocks[a.ref];
    await db
      .update(schema.applications)
      .set({
        campusId: c.id,
        data: { ...a.data, campus: c.name, proposedIntake: intake },
        ...(clock ? { stageStartedAt: clock.start, stageDueAt: clock.due } : {}),
        ...(a.ref === "ACC-2026-0001" ? { submittedAt: ago(1), feePaidAt: ago(1) } : {}),
      })
      .where(eq(schema.applications.id, a.id));
    linked += await linkFaculty(a.id, a.institutionId, a.programType, intake, a.createdBy, a.submittedAt ?? ago(30));
    if (clock) await db.update(schema.applicationEvents).set({ createdAt: clock.start }).where(and(eq(schema.applicationEvents.applicationId, a.id), ne(schema.applicationEvents.toStatus, "SUBMITTED")));
  }
  await db.update(schema.applicationEvents).set({ createdAt: ago(1) }).where(and(eq(schema.applicationEvents.applicationId, byRef["ACC-2026-0001"].id), eq(schema.applicationEvents.toStatus, "SUBMITTED")));

  // RBU's accreditation was filed with a self-assessment and its two accreditation documents.
  const rbuSelf: SelfAssessmentItem[] = SELF_ASSESSMENT_CRITERIA.map((criterion, i) => ({ criterion, rating: i === 4 ? "PARTLY" : "MET", comment: i === 4 ? "Journal subscriptions renewed for 18 of 24 titles; the rest by December." : "" }));
  await db.update(schema.applications).set({ selfAssessment: rbuSelf }).where(eq(schema.applications.ref, "ACC-2026-0001"));
  for (const docType of ["Self-assessment evidence", "Annual compliance statement"])
    await fileDocument(db, { institutionId: inst.RBU.id, folder: "accreditation/2026/ACC-2026-0001", docType, fileName: `${docType.toLowerCase().replace(/\W+/g, "-")}.pdf`, bytes: await samplePdf(`${docType} - ACC-2026-0001`, [`${docType} for Ravi Bank University, PharmD.`]), applicationId: byRef["ACC-2026-0001"].id, uploadedBy: "rbu.poc", verificationStatus: "PENDING" });

  // Inspections: what to prepare, and the teams (no member from the institution's own province).
  const insps = await db.select().from(schema.inspections);
  for (const i of insps) {
    await db.update(schema.inspections).set({ scope: SCOPE }).where(eq(schema.inspections.id, i.id));
    const sindhOrBalochistan = [inst.SCU.id, inst.BVU.id].includes(i.institutionId);
    await db.insert(schema.inspectionTeam).values([
      { inspectionId: i.id, username: i.inspector, role: "LEAD" },
      ...(sindhOrBalochistan ? [{ inspectionId: i.id, username: i.inspector === "pcp.inspector" ? "pcp.inspector2" : "pcp.inspector", role: "MEMBER" }] : []),
    ]);
  }

  // Technical reviews for the cases that have passed that stage.
  const reviewed = ["NOC-2026-0003", "NOC-2026-0004", "NOC-2026-0005", "NOC-2025-0007"];
  for (const ref of reviewed) {
    const a = byRef[ref];
    await db.insert(schema.technicalReviews).values({
      applicationId: a.id,
      reviewer: "pcp.officer",
      items: TECHNICAL_REVIEW_CRITERIA.map((criterion, i) => ({ criterion, result: ref === "NOC-2026-0005" && i === 3 ? "PARTLY" : "MEETS", remarks: ref === "NOC-2026-0005" && i === 3 ? "Journal subscriptions below target" : "" })),
      summary: "Meets the academic standards for the requested intake; proceed to inspection.",
      outcome: "PROCEED",
      createdAt: ago(20),
    });
  }

  // Messages on the seeded cases, dated when they were sent.
  for (const a of apps.filter((x) => x.submittedAt)) {
    const code = insts.find((i) => i.id === a.institutionId)!.code;
    await mail(`inst:${code}`, `Application ${a.ref} received`, "PCP has received your application. You will be notified at each step.", a.ref, `/institution/applications/${a.ref}`, a.ref === "ACC-2026-0001" ? ago(1) : a.submittedAt!);
  }
  await mail(`inst:${inst.CCP.code}`, "Deficiency DF-2026-00001 on NOC-2026-0002", "Faculty: Appoint a qualified lecturer for the technician program. Respond by 2026-10-28.", "NOC-2026-0002", "/institution/applications/NOC-2026-0002", ago(8));
  await mail(`inst:${inst.FRU.code}`, "Inspection scheduled for NOC-2026-0003", `PCP will inspect your institution on 2026-10-15 with a team of 1. Please prepare: ${SCOPE}`, "NOC-2026-0003", "/institution/applications/NOC-2026-0003", ago(6));
  await mail(`inst:${inst.SCU.code}`, "Inspection scheduled for NOC-2026-0004", `PCP will inspect your institution on 2026-10-12 with a team of 2. Please prepare: ${SCOPE}`, "NOC-2026-0004", "/institution/applications/NOC-2026-0004", ago(10));

  // ---------- Riverside's closed 2024 renewal: the record its next renewal is prepared from ----------
  const ruhPharmd = (await db.query.programs.findFirst({ where: and(eq(schema.programs.institutionId, inst.RUH.id), eq(schema.programs.type, "PHARMD")) }))!;
  const ruhCampus = mainCampus(inst.RUH.id);
  const [old] = await db
    .insert(schema.applications)
    .values({
      ref: "RNW-2024-0001",
      institutionId: inst.RUH.id,
      kind: "RENEWAL",
      programType: "PHARMD",
      status: "NOC_ISSUED",
      campusId: ruhCampus.id,
      data: { campus: ruhCampus.name, proposedIntake: 100, classrooms: 10, labs: 6, labList: "Pharmaceutics, Pharmacology, Pharmaceutical Chemistry, Pharmacognosy, Microbiology, Physiology", libraryBooks: 4200, libraryJournals: 28, buildingAreaSqft: 52000, complianceConfirmed: true },
      checks: [{ key: "all", label: "Automatic checks", ok: true, detail: "All checks passed at submission" }],
      feeAmount: 300000,
      feePsid: "2024000000000001",
      feePaidAt: new Date("2023-11-02T09:00:00Z"),
      feePaidBy: "ruh.poc",
      feeMethod: "Bank branch (PSID challan)",
      assignedOfficer: "pcp.officer",
      submittedBy: "ruh.poc",
      submittedAt: new Date("2023-11-02T10:00:00Z"),
      decision: "APPROVED",
      decidedAt: new Date("2024-02-20T10:00:00Z"),
      certificateNo: "ACR-PHARMD-2024-0001",
      issuedAt: new Date("2024-03-10T10:00:00Z"),
      validUntil: "2027-03-15",
      selfAssessment: SELF_ASSESSMENT_CRITERIA.map((criterion) => ({ criterion, rating: "MET", comment: "" })),
      createdBy: "ruh.poc",
      createdAt: new Date("2023-10-20T10:00:00Z"),
    })
    .returning();
  await db.insert(schema.applicationEvents).values([
    { applicationId: old.id, fromStatus: "DRAFT", toStatus: "SUBMITTED", actor: "ruh.poc", actorRole: "inst_poc", note: "Submitted with fee paid", createdAt: new Date("2023-11-02T10:00:00Z") },
    { applicationId: old.id, fromStatus: "COUNCIL_REVIEW", toStatus: "APPROVED", actor: "pcp.secretary", actorRole: "pcp_secretary", note: "Council decision: approved", createdAt: new Date("2024-02-20T10:00:00Z") },
    { applicationId: old.id, fromStatus: "APPROVED", toStatus: "NOC_ISSUED", actor: "pcp.secretary", actorRole: "pcp_secretary", note: "Certificate ACR-PHARMD-2024-0001 issued", createdAt: new Date("2024-03-10T10:00:00Z") },
  ]);
  linked += await linkFaculty(old.id, inst.RUH.id, "PHARMD", 100, "ruh.poc", new Date("2023-11-01T10:00:00Z"));
  await db.update(schema.accreditationHistory).set({ applicationRef: "RNW-2024-0001" }).where(and(eq(schema.accreditationHistory.programId, ruhPharmd.id), eq(schema.accreditationHistory.year, 2024)));
  const cert = await certificatePdf({ kind: "RENEWAL", validFrom: "2024-03-15", certNo: "ACR-PHARMD-2024-0001", institution: inst.RUH.name, institutionCode: inst.RUH.code, city: inst.RUH.city, program: "PharmD", intake: 100, issuedAt: new Date("2024-03-10T10:00:00Z"), validUntil: "2027-03-15" });
  await fileDocument(db, { institutionId: inst.RUH.id, folder: "accreditation/2024/RNW-2024-0001", docType: "Accreditation certificate", fileName: "ACR-PHARMD-2024-0001.pdf", bytes: cert, applicationId: old.id, uploadedBy: "pcp.secretary" });

  // ---------- A deferred renewal with a reason and a return date (guide section 4: defer is not a silent hold) ----------
  const fru = inst.FRU;
  const fruCampus = mainCampus(fru.id);
  const deferUntil = ymd(new Date(now + 30 * DAY));
  const grounds = "Two of the four technician lecturers are on contracts that end in December. Upload their renewed appointment letters and the laboratory safety audit before the Council considers the renewal.";
  const fruSelf: SelfAssessmentItem[] = SELF_ASSESSMENT_CRITERIA.map((criterion, i) => ({ criterion, rating: i === 1 ? "PARTLY" : "MET", comment: i === 1 ? "Two lecturer contracts are being renewed." : "" }));
  const [rnw] = await db
    .insert(schema.applications)
    .values({
      ref: "RNW-2026-0001",
      institutionId: fru.id,
      kind: "RENEWAL",
      programType: "TECH",
      status: "DEFERRED",
      campusId: fruCampus.id,
      data: { campus: fruCampus.name, proposedIntake: 60, classrooms: 5, labs: 3, labList: "Dispensing, Pharmaceutics, Pharmacology", libraryBooks: 900, libraryJournals: 8, buildingAreaSqft: 18000, complianceConfirmed: true },
      checks: [{ key: "all", label: "Automatic checks", ok: true, detail: "All checks passed at submission" }],
      feeAmount: 200000,
      feePsid: "2026000000000777",
      feePaidAt: ago(70),
      feePaidBy: "fru.poc",
      feeMethod: "Raast QR",
      assignedOfficer: "pcp.officer",
      submittedBy: "fru.poc",
      submittedAt: ago(70),
      decision: "DEFERRED",
      decisionGrounds: grounds,
      decisionNote: grounds,
      deferUntil,
      decidedAt: ago(12),
      stageStartedAt: ago(12),
      stageDueAt: endOfDay(deferUntil),
      selfAssessment: fruSelf,
      renewalOf: "NOC-TECH-2013-0015",
      createdBy: "fru.poc",
      createdAt: ago(75),
    })
    .returning();
  const steps: [string, string, string, string, number, string][] = [
    ["DRAFT", "SUBMITTED", "fru.poc", "inst_poc", 70, "Submitted with all checks passing and fee paid"],
    ["SUBMITTED", "UNDER_SCRUTINY", "pcp.officer", "pcp_officer", 66, "Initial scrutiny started"],
    ["UNDER_SCRUTINY", "TECHNICAL_REVIEW", "pcp.officer", "pcp_officer", 58, "Initial scrutiny passed; technical review started"],
    ["TECHNICAL_REVIEW", "TECHNICAL_REVIEW", "pcp.officer", "pcp_officer", 50, "Technical review recorded: meets the standards; proceed to inspection"],
    ["TECHNICAL_REVIEW", "INSPECTION_SCHEDULED", "pcp.coordinator", "pcp_coordinator", 48, "Inspection on " + ymd(ago(35)) + "; team of 1"],
    ["INSPECTION_SCHEDULED", "INSPECTION_SUBMITTED", "pcp.inspector2", "pcp_inspector", 34, "Digital checklist submitted"],
    ["INSPECTION_SUBMITTED", "COUNCIL_REVIEW", "pcp.officer", "pcp_officer", 30, "Recommendation: renew for intake 60 once the lecturer contracts are confirmed"],
    ["COUNCIL_REVIEW", "DEFERRED", "pcp.secretary", "pcp_secretary", 12, `Council decision: deferred until ${deferUntil}: ${grounds}`],
  ];
  await db.insert(schema.applicationEvents).values(steps.map(([fromStatus, toStatus, actor, actorRole, d, note]) => ({ applicationId: rnw.id, fromStatus, toStatus, actor, actorRole, note, createdAt: ago(d) })));
  linked += await linkFaculty(rnw.id, fru.id, "TECH", 60, "fru.poc", ago(72));
  await db.insert(schema.technicalReviews).values({ applicationId: rnw.id, reviewer: "pcp.officer", items: TECHNICAL_REVIEW_CRITERIA.map((criterion) => ({ criterion, result: "MEETS", remarks: "" })), summary: "Meets the standards; proceed to inspection.", outcome: "PROCEED", createdAt: ago(50) });
  const [insp] = await db
    .insert(schema.inspections)
    .values({
      applicationId: rnw.id,
      institutionId: fru.id,
      inspector: "pcp.inspector2",
      scheduledFor: ymd(ago(35)),
      scope: SCOPE,
      status: "SUBMITTED",
      submittedAt: ago(34),
      createdBy: "pcp.coordinator",
      summary: "Facilities adequate. Two lecturer contracts end in December; recommend renewal once confirmed.",
      checklist: CRITERIA.map((c, i) => ({ criterion: c, result: i === 0 ? "PARTIAL" : "COMPLIANT", remarks: i === 0 ? "Two contracts end in December" : "Verified on site" })) as ChecklistItem[],
    })
    .returning();
  await db.insert(schema.inspectionTeam).values({ inspectionId: insp.id, username: "pcp.inspector2", role: "LEAD" });
  for (const docType of ["Self-assessment evidence", "Annual compliance statement"])
    await fileDocument(db, { institutionId: fru.id, folder: "accreditation/2026/RNW-2026-0001", docType, fileName: `${docType.toLowerCase().replace(/\W+/g, "-")}.pdf`, bytes: await samplePdf(`${docType} - RNW-2026-0001`, [`${docType} for Five Rivers University, Pharmacy Technician.`]), applicationId: rnw.id, uploadedBy: "fru.poc" });
  const letterPdf = await decisionLetter({
    decision: "DEFERRED",
    ref: "RNW-2026-0001",
    kind: "RENEWAL",
    programType: "TECH",
    intake: 60,
    campus: fruCampus.name,
    inst: fru,
    grounds,
    deferUntil,
    signedBy: "Dr. Nadia Hussain",
    at: ago(12),
  });
  const letter = await fileDocument(db, { institutionId: fru.id, folder: "accreditation/2026/RNW-2026-0001", docType: "Decision letter", fileName: "RNW-2026-0001-decision-deferred.pdf", bytes: letterPdf, applicationId: rnw.id, uploadedBy: "pcp.secretary" });
  await db.update(schema.applications).set({ letterDocumentId: letter.id }).where(eq(schema.applications.id, rnw.id));
  await mail(`inst:${fru.code}`, "Application RNW-2026-0001 received", "PCP has received your Renewal application. You will be notified at each step.", "RNW-2026-0001", "/institution/applications/RNW-2026-0001", ago(70));
  await mail(`inst:${fru.code}`, `Council decision on RNW-2026-0001: deferred until ${deferUntil}`, `Reason: ${grounds}. The decision letter is in your case file.`, "RNW-2026-0001", "/institution/applications/RNW-2026-0001", ago(12));
  await db.insert(schema.notifications).values({ audience: `inst:${fru.code}`, title: `Council decision on RNW-2026-0001: deferred until ${deferUntil}`, body: `Reason: ${grounds}`, link: "/institution/applications/RNW-2026-0001", createdAt: ago(12) });
  await audit(db, { actor: "system", action: "application.seeded", entity: "application", entityId: "RNW-2026-0001", details: { status: "DEFERRED", deferUntil } });

  // Run the daily jobs once so the demo opens with today's renewal alerts and the overdue case already escalated.
  const alerts = await runRenewalAlerts();
  const sla = await runSlaChecks();

  return `${alerts.sent} renewal alerts, ${sla.reminders} SLA reminders and ${sla.escalations} escalations sent; sla.stages rule, ${linked} case faculty links, ${reviewed.length + 1} technical reviews, inspection teams, RNW-2024-0001 (closed) and RNW-2026-0001 (deferred to ${deferUntil}); NOC-2026-0001 is overdue`;
}
