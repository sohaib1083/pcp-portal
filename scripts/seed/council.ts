// Seed data for the council module. Runs after the core seed (see scripts/seed/index.ts).
// - CM-<year>-06: a past, CLOSED meeting with minutes, deciding two seeded cases (a rejection and a deferral)
// - CM-<year>-07: a PLANNED meeting next week with the seeded COUNCIL_REVIEW case on its agenda
// - APL-<year>-0001: an appeal FILED against the seeded rejection (the deferral stays appealable for the demo)
// - Help desk tickets from the public, an institution, a student and a pharmacist, in every state, one overdue
import { and, eq, sql } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db, schema } from "../../src/db";
import type { ChecklistItem } from "../../src/db/schema";
import { audit } from "../../src/lib/audit";
import { addWorkingDays, fileMinutes, nextModuleRef, TICKET_SLA_DAYS } from "../../src/lib/council";
import { fileDocument, publicUrl, renderLetter } from "../../src/lib/letters";
import { sendEmail } from "../../src/lib/messages";

const DAY = 86400000;
const now = Date.now();
const daysAgo = (n: number, hour = 10) => {
  const d = new Date(now - n * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Next free case reference for a prefix (highest number + 1). */
async function nextCaseRef(prefix: string, year: number) {
  const like = `${prefix}-${year}-%`;
  const res = await db.execute(sql`select coalesce(max(nullif(regexp_replace(ref, '^.*-', ''), '')::int), 0) as n from applications where ref like ${like}`);
  return `${prefix}-${year}-${String(Number((res.rows[0] as { n: number }).n) + 1).padStart(4, "0")}`;
}

/** A plain evidence PDF from the institution (no PCP letterhead). */
async function institutionPdf(institution: string, title: string, lines: string[]) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({ x: 0, y: 782, width: 595, height: 60, color: rgb(0.12, 0.2, 0.36) });
  page.drawText(institution, { x: 40, y: 806, size: 14, font: bold, color: rgb(1, 1, 1) });
  page.drawText("DEMO DOCUMENT - fictional data", { x: 40, y: 760, size: 9, font, color: rgb(0.7, 0.1, 0.1) });
  page.drawText(title, { x: 40, y: 720, size: 18, font: bold });
  lines.forEach((l, i) => page.drawText(l, { x: 40, y: 686 - i * 20, size: 11, font }));
  return Buffer.from(await pdf.save());
}

const CRITERIA = [
  "Faculty: qualified, full-time, as per submitted list",
  "Laboratories: equipment, chemicals and safety",
  "Library: books, journals and digital access",
  "Classrooms and building",
  "Student records and attendance",
  "Hospital / pharmacy practice linkage",
  "Governance and finances",
];

type CaseSeed = {
  inst: typeof schema.institutions.$inferSelect;
  kind: "NOC" | "ACCREDITATION";
  programType: "PHARMD" | "TECH";
  decision: "REJECTED" | "DEFERRED";
  submittedDaysAgo: number;
  inspector: string;
  results: Record<number, [ChecklistItem["result"], string]>;
  inspectionSummary: string;
  recommendation: string;
  note: string;
  deferUntil?: string;
  data: Record<string, unknown>;
  fee: number;
};

async function seedDecidedCase(c: CaseSeed, decidedAt: Date) {
  const year = new Date(now).getFullYear();
  const ref = await nextCaseRef(c.kind === "NOC" ? "NOC" : "ACC", year);
  const poc = `${c.inst.shortCode.toLowerCase()}.poc`;
  const submitted = daysAgo(c.submittedDaysAgo);
  const inspected = daysAgo(c.submittedDaysAgo - 40);
  const forwarded = daysAgo(c.submittedDaysAgo - 52);
  const [app] = await db
    .insert(schema.applications)
    .values({
      ref,
      institutionId: c.inst.id,
      kind: c.kind,
      programType: c.programType,
      status: c.decision,
      data: c.data,
      checks: [{ key: "all", label: "Automatic checks", ok: true, detail: "All checks passed at submission" }],
      feeAmount: c.fee,
      feePsid: `2026${String(c.inst.id).padStart(5, "0")}${String(c.submittedDaysAgo * 7919).padStart(8, "0")}`,
      feePaidAt: submitted,
      feePaidBy: poc,
      feeMethod: "Raast QR (demo)",
      assignedOfficer: "pcp.officer",
      submittedBy: poc,
      submittedAt: submitted,
      decision: c.decision,
      decisionNote: c.note,
      decisionGrounds: c.decision === "REJECTED" ? c.note : null,
      deferUntil: c.deferUntil ?? null,
      decidedAt,
      selfAssessment:
        c.kind === "ACCREDITATION"
          ? [
              { criterion: "Faculty", rating: "MET", comment: "4 faculty for intake 60" },
              { criterion: "Laboratories", rating: "PARTLY", comment: "Dispensing lab safety audit in progress" },
              { criterion: "Library", rating: "MET", comment: "620 books, 8 journals" },
            ]
          : null,
      createdBy: poc,
      createdAt: submitted,
      updatedAt: decidedAt,
    })
    .returning();
  const ev = (from: string | null, to: string, actor: string, role: string, note: string, at: Date) => ({ applicationId: app.id, fromStatus: from, toStatus: to, actor, actorRole: role, note, createdAt: at });
  await db.insert(schema.applicationEvents).values([
    ev("DRAFT", "SUBMITTED", poc, "inst_poc", "Submitted with fee paid", submitted),
    ev("SUBMITTED", "UNDER_SCRUTINY", "pcp.officer", "pcp_officer", "Initial scrutiny started", daysAgo(c.submittedDaysAgo - 3)),
    ev("UNDER_SCRUTINY", "INSPECTION_SCHEDULED", "pcp.officer", "pcp_officer", `Inspection on ${ymd(inspected)}`, daysAgo(c.submittedDaysAgo - 20)),
    ev("INSPECTION_SCHEDULED", "INSPECTION_SUBMITTED", c.inspector, "pcp_inspector", "Digital checklist submitted", inspected),
    ev("INSPECTION_SUBMITTED", "COUNCIL_REVIEW", "pcp.officer", "pcp_officer", `Recommendation: ${c.recommendation}`, forwarded),
    ev("COUNCIL_REVIEW", c.decision, "pcp.secretary", "pcp_secretary", `Council decision: ${c.note}`, decidedAt),
  ]);
  if (c.kind === "NOC" && c.decision === "REJECTED") {
    const prog = await db.query.programs.findFirst({ where: and(eq(schema.programs.institutionId, c.inst.id), eq(schema.programs.type, c.programType)) });
    if (prog) await db.update(schema.programs).set({ nocStatus: "REJECTED" }).where(eq(schema.programs.id, prog.id));
    else await db.insert(schema.programs).values({ institutionId: c.inst.id, type: c.programType, nocStatus: "REJECTED" });
  }
  const checklist = CRITERIA.map((criterion, i) => ({ criterion, result: c.results[i]?.[0] ?? "COMPLIANT", remarks: c.results[i]?.[1] ?? "Verified on site" })) as ChecklistItem[];
  await db.insert(schema.inspections).values({ applicationId: app.id, institutionId: c.inst.id, inspector: c.inspector, scheduledFor: ymd(inspected), status: "SUBMITTED", checklist, summary: c.inspectionSummary, submittedAt: inspected, createdBy: "pcp.officer" });
  const report = await renderLetter({
    kind: "Inspection report",
    refNo: ref,
    date: inspected,
    to: { name: c.inst.name, lines: [`${c.inst.city}, ${c.inst.province}`] },
    subject: `Inspection report for ${ref}`,
    paragraphs: [c.inspectionSummary],
    table: checklist.map((x) => [x.criterion.split(":")[0], `${x.result.replace("_", " ")}. ${x.remarks}`]),
  });
  await fileDocument(db, { institutionId: c.inst.id, folder: `inspection-reports/${ref}`, docType: "Inspection report", fileName: "inspection-report.pdf", bytes: report, applicationId: app.id, uploadedBy: c.inspector });
  const letter = await renderLetter({
    kind: "Decision letter",
    refNo: ref,
    date: decidedAt,
    to: { name: c.inst.name, lines: [`${c.inst.city}, ${c.inst.province}`, c.inst.code] },
    subject: `Council decision on ${ref}: ${c.decision === "REJECTED" ? "rejected" : "deferred"}`,
    paragraphs:
      c.decision === "REJECTED"
        ? ["The council considered your application with the inspection report and the officer's recommendation, and rejected it.", `Grounds: ${c.note}`, "You may appeal this decision through the institution portal, with your grounds and evidence."]
        : ["The council considered your application and deferred its decision.", `Reason: ${c.note}`, `The case returns to the council on ${c.deferUntil}. You may appeal the deferral through the institution portal.`],
    table: [
      ["Case", ref],
      ["Decision", c.decision === "REJECTED" ? "Rejected" : `Deferred until ${c.deferUntil}`],
    ],
    signatory: { name: "Dr. Nadia Hussain", title: "Secretary, Pharmacy Council of Pakistan", signedAt: decidedAt },
    qrUrl: publicUrl(`/institution/applications/${ref}`),
  });
  const doc = await fileDocument(db, { institutionId: c.inst.id, folder: c.kind === "NOC" ? `noc-applications/${ref}` : `accreditation/${year}/${ref}`, docType: "Decision letter", fileName: `decision-${ref}.pdf`, bytes: letter, applicationId: app.id, uploadedBy: "pcp.secretary" });
  await db.update(schema.applications).set({ letterDocumentId: doc.id }).where(eq(schema.applications.id, app.id));
  await db.insert(schema.notifications).values({ audience: `inst:${c.inst.code}`, title: `Council decision on ${ref}: ${c.decision.toLowerCase()}`, body: c.note, link: `/institution/applications/${ref}`, createdAt: decidedAt });
  await audit(db, { actor: "system", action: "application.seeded", entity: "application", entityId: ref, details: { status: c.decision } });
  return { app, recommendation: c.recommendation };
}

export default async function seedCouncil(): Promise<string | void> {
  const insts = await db.select().from(schema.institutions);
  const by = (s: string) => insts.find((i) => i.shortCode === s)!;
  const GMI = by("GMI");
  const FRU = by("FRU");
  if (!GMI || !FRU) return "core institutions missing; skipped";

  // ---- Two decided cases from the last council meeting ----
  const pastDate = daysAgo(19, 11);
  const gmi = await seedDecidedCase(
    {
      inst: GMI,
      kind: "NOC",
      programType: "PHARMD",
      decision: "REJECTED",
      submittedDaysAgo: 110,
      inspector: "pcp.inspector",
      results: { 0: ["NON_COMPLIANT", "No PhD faculty linked to Pharm.D; 2 required for intake 50"], 1: ["NON_COMPLIANT", "2 of the 4 required laboratories in place"], 2: ["PARTIAL", "1,600 books; 6 journal subscriptions"] },
      inspectionSummary: "Faculty and laboratories fall short of the Pharm.D standard for the requested intake. Building and governance are adequate.",
      recommendation: "Recommend rejection: faculty below the minimum for intake 50 and two laboratories missing.",
      note: "Faculty below the minimum for intake 50 (no PhD faculty linked, 2 required) and 2 of 4 required laboratories missing at inspection.",
      data: { campus: "Jutial campus, Gilgit", proposedIntake: 50, classrooms: 5, labs: 2, labList: "Pharmaceutics, Pharmacognosy", libraryBooks: 1600, libraryJournals: 6, buildingAreaSqft: 30000 },
      fee: 1000000,
    },
    pastDate,
  );
  const deferUntil = ymd(new Date(now + 42 * DAY));
  const fru = await seedDecidedCase(
    {
      inst: FRU,
      kind: "ACCREDITATION",
      programType: "TECH",
      decision: "DEFERRED",
      submittedDaysAgo: 95,
      inspector: "pcp.inspector2",
      results: { 1: ["PARTIAL", "Dispensing laboratory safety audit not yet done"] },
      inspectionSummary: "Programme runs as approved. The dispensing laboratory still lacks its safety audit; everything else is compliant.",
      recommendation: "Recommend deferral until the dispensing laboratory safety audit is filed.",
      note: "The institution must file the safety audit of the dispensing laboratory before the council decides.",
      deferUntil,
      data: { campus: "City campus, Multan", proposedIntake: 60, classrooms: 4, labs: 3, labList: "Dispensing, Pharmaceutics, Microbiology", libraryBooks: 620, libraryJournals: 8, buildingAreaSqft: 18000 },
      fee: 200000,
    },
    pastDate,
  );

  // ---- CM-xx-06: closed, with minutes ----
  const year = pastDate.getUTCFullYear();
  const [past] = await db
    .insert(schema.councilMeetings)
    .values({ ref: `CM-${year}-06`, title: `Council meeting 6 of ${year}`, meetingDate: ymd(pastDate), status: "CLOSED", createdBy: "pcp.secretary", createdAt: daysAgo(40), startedAt: pastDate, closedAt: new Date(pastDate.getTime() + 3 * 3600000) })
    .returning();
  await db.insert(schema.councilItems).values([
    { meetingId: past.id, applicationId: gmi.app.id, position: 1, recommendation: gmi.recommendation, draftDecision: "REJECTED", decision: "REJECTED", decisionNote: gmi.app.decisionNote, decidedBy: "pcp.secretary", decidedAt: pastDate },
    { meetingId: past.id, applicationId: fru.app.id, position: 2, recommendation: fru.recommendation, draftDecision: "DEFERRED", decision: "DEFERRED", decisionNote: fru.app.decisionNote, deferUntil, decidedBy: "pcp.secretary", decidedAt: new Date(pastDate.getTime() + 1800000) },
  ]);
  const minutes = await fileMinutes(db, past.id, { username: "pcp.secretary", name: "Dr. Nadia Hussain" });
  await db.update(schema.councilMeetings).set({ minutesDocumentId: minutes.id }).where(eq(schema.councilMeetings.id, past.id));
  await audit(db, { actor: "pcp.secretary", action: "council.meeting.closed", entity: "council_meeting", entityId: past.ref, details: { items: 2, minutes: minutes.id, seeded: true } });

  // ---- CM-xx-07: planned for next week, with the case awaiting a council decision ----
  const nextDate = new Date(now + 7 * DAY);
  const nextYear = nextDate.getUTCFullYear();
  const [planned] = await db
    .insert(schema.councilMeetings)
    .values({ ref: `CM-${nextYear}-${nextYear === year ? "07" : "01"}`, title: `Council meeting ${nextYear === year ? 7 : 1} of ${nextYear}`, meetingDate: ymd(nextDate), status: "PLANNED", createdBy: "pcp.secretary", createdAt: daysAgo(5) })
    .returning();
  const ready = await db.select().from(schema.applications).where(eq(schema.applications.status, "COUNCIL_REVIEW"));
  let pos = 0;
  for (const a of ready) {
    const insp = await db.query.inspections.findFirst({ where: and(eq(schema.inspections.applicationId, a.id), eq(schema.inspections.status, "SUBMITTED")) });
    const rec = a.ref === "NOC-2026-0005" || insp?.summary?.includes("recommend approval") ? `Recommend approval for an intake of ${a.data?.proposedIntake ?? 60}, with a condition that library journals reach 20 subscriptions within 6 months.` : null;
    await db.insert(schema.councilItems).values({ meetingId: planned.id, applicationId: a.id, position: ++pos, recommendation: rec });
    const inst = insts.find((i) => i.id === a.institutionId);
    if (inst) await db.insert(schema.notifications).values({ audience: `inst:${inst.code}`, title: `${a.ref} is on the council agenda`, body: `The council will consider ${a.ref} at its meeting ${planned.ref}.`, link: `/institution/applications/${a.ref}` });
  }
  await audit(db, { actor: "pcp.secretary", action: "council.meeting.created", entity: "council_meeting", entityId: planned.ref, details: { date: planned.meetingDate, items: pos, seeded: true } });

  // ---- An appeal filed against the rejection ----
  const appealRef = await nextModuleRef(db, "appeals", "APL", 4);
  const filedAt = daysAgo(4, 9);
  const evidence = await fileDocument(db, {
    institutionId: GMI.id,
    folder: `correspondence/appeals/${appealRef}`,
    docType: "Appeal evidence",
    fileName: "appointment-letters-pharmd-faculty.pdf",
    bytes: await institutionPdf(GMI.name, "Appointment letters: Pharm.D faculty", [
      "Dr. Shazia Karim, PhD Pharmacology, Assistant Professor, joined 1 September",
      "Dr. Farman Ali, PhD Pharmaceutics, Assistant Professor, joined 1 September",
      "Laboratory works order: Pharmacology and Pharmaceutical Chemistry labs,",
      "completion certificate dated 10 September.",
    ]),
    applicationId: gmi.app.id,
    uploadedBy: "gmi.poc",
    verificationStatus: "PENDING",
  });
  await db.insert(schema.appeals).values({
    ref: appealRef,
    applicationId: gmi.app.id,
    institutionId: GMI.id,
    grounds:
      "Two PhD faculty (Pharmacology and Pharmaceutics) joined on 1 September, before the council met, and the two missing laboratories were completed on 10 September. Their appointment letters and the completion certificate were not before the council. We ask the council to decide the case again on the current facts.",
    evidenceDocumentId: evidence.id,
    filedBy: "gmi.poc",
    createdAt: filedAt,
  });
  await db.insert(schema.notifications).values([
    { audience: "role:pcp_officer", title: `New appeal ${appealRef} on ${gmi.app.ref}`, body: `GMI appeals the council's rejection of ${gmi.app.ref}.`, link: `/pcp/appeals/${appealRef}`, createdAt: filedAt },
    { audience: `inst:${GMI.code}`, title: `Appeal ${appealRef} received`, body: `PCP received your appeal against the decision on ${gmi.app.ref}.`, link: `/institution/appeals/${appealRef}`, createdAt: filedAt },
  ]);
  await audit(db, { actor: "gmi.poc", action: "appeal.filed", entity: "appeal", entityId: appealRef, details: { case: gmi.app.ref, decision: "REJECTED", evidence: evidence.id } });

  // ---- Help desk tickets ----
  type T = {
    source: string;
    category: string;
    subject: string;
    body: string;
    name: string;
    email: string | null;
    mobile?: string;
    inst?: string;
    username?: string;
    status: string;
    assignedTo?: string;
    createdDaysAgo: number;
    hour?: number;
    resolvedAfterDays?: number;
    replies?: { author: string; body: string; internal?: boolean; afterHours: number }[];
  };
  const tickets: T[] = [
    {
      source: "PUBLIC",
      category: "Complaint",
      subject: "A college in Multan advertises a Pharm.D programme without approval",
      body: "A college near Bosan Road in Multan is advertising admissions to a Pharm.D programme for this year. I could not find it in the PCP verification search. Please check before students pay fees.",
      name: "Kamran Shah",
      email: "kamran.shah@example.com",
      mobile: "0301 4567890",
      status: "OPEN",
      createdDaysAgo: 9,
    },
    {
      source: "PUBLIC",
      category: "Question",
      subject: "Is Five Rivers University's technician programme still accredited?",
      body: "My daughter has an offer for the Pharmacy Technician programme at Five Rivers University. The public search shows the accreditation expires in November. Will her admission be valid if it is not renewed?",
      name: "Rubina Aslam",
      email: "rubina.aslam@example.com",
      status: "IN_PROGRESS",
      assignedTo: "pcp.officer",
      createdDaysAgo: 2,
      inst: "FRU",
      replies: [
        { author: "pcp.officer", body: "Checked: FRU's renewal is with the council and was deferred for a lab safety audit. Students admitted under a valid accreditation keep their status.", internal: true, afterHours: 3 },
        { author: "pcp.officer", body: "Thank you for asking. The programme's accreditation is valid until 30 November and its renewal is under review by the council. Students admitted while the accreditation is valid are not affected. We will confirm once the council decides.", afterHours: 5 },
      ],
    },
    {
      source: "INSTITUTION",
      category: "Technical issue",
      subject: "Building plan upload fails",
      body: "Our building plan scan is 14 MB and the upload fails on the NOC application. Is there another way to send it?",
      name: "Prof. Ayesha Khan",
      email: "ruh.poc@demo.pcp.local",
      inst: "RUH",
      username: "ruh.poc",
      status: "RESOLVED",
      assignedTo: "pcp.registration",
      createdDaysAgo: 12,
      resolvedAfterDays: 1,
      replies: [{ author: "pcp.registration", body: "The limit is 10 MB per file. Please save the plan as a PDF at 150 dpi, or upload it in two parts named Part 1 and Part 2. Both parts stay on the case file.", afterHours: 20 }],
    },
    {
      source: "INSTITUTION",
      category: "Data correction",
      subject: "Wrong city on our institution profile",
      body: "Our profile shows Karachi as the city of our Clifton campus address, but the correspondence address should be Block 5, Clifton. Please correct the address line.",
      name: "Farhan Siddiqui",
      email: "ccp.poc@demo.pcp.local",
      inst: "CCP",
      username: "ccp.poc",
      status: "OPEN",
      createdDaysAgo: 0,
      hour: 6,
    },
    {
      source: "STUDENT",
      category: "Data correction",
      subject: "My shift shows Evening instead of Morning",
      body: "My PCP student record shows the Evening shift, but I am enrolled in the Morning shift. My university ID card is attached in my university's records.",
      name: "Areeba Noor",
      email: "student.ruh@demo.pcp.local",
      inst: "RUH",
      username: "student.ruh",
      status: "IN_PROGRESS",
      assignedTo: "pcp.verification",
      createdDaysAgo: 3,
      replies: [{ author: "pcp.verification", body: "We have asked Riverside University to confirm your shift in its next student data update. We will tell you when the record is corrected.", afterHours: 26 }],
    },
    {
      source: "PHARMACIST",
      category: "Question",
      subject: "How do I change my practice place?",
      body: "I have moved from a community pharmacy in Lahore to a hospital pharmacy in Rawalpindi. How do I update my practice place?",
      name: "Ali Raza",
      email: "pharm.ali@demo.pcp.local",
      username: "pharm.ali",
      status: "CLOSED",
      assignedTo: "pcp.registration",
      createdDaysAgo: 20,
      resolvedAfterDays: 2,
      replies: [{ author: "pcp.registration", body: "Open My registration, choose Update practice details, enter the hospital pharmacy and attach the appointment letter. The change shows once verified.", afterHours: 30 }],
    },
    {
      source: "PHARMACIST",
      category: "Complaint",
      subject: "Registration card not received after renewal",
      body: "I renewed my registration and paid the fee, but I have not received the new registration card.",
      name: "Sana Memon",
      email: "pharm.sana@demo.pcp.local",
      username: "pharm.sana",
      status: "OPEN",
      createdDaysAgo: 4,
    },
    {
      source: "PUBLIC",
      category: "Question",
      subject: "Fee for a Pharmacy Technician NOC",
      body: "What is the fee for a Pharmacy Technician NOC application, and can it be paid through Raast?",
      name: "Imran Qadir",
      email: "imran.qadir@example.com",
      status: "RESOLVED",
      assignedTo: "pcp.accounts",
      createdDaysAgo: 6,
      resolvedAfterDays: 1,
      replies: [{ author: "pcp.accounts", body: "The Pharmacy Technician NOC fee is PKR 500,000. The portal issues a PSID challan, which you can pay through Raast, internet banking or at a bank branch. The receipt is generated automatically.", afterHours: 22 }],
    },
  ];
  let overdue = 0;
  for (const t of tickets) {
    const ref = await nextModuleRef(db, "tickets", "TKT", 4);
    const createdAt = daysAgo(t.createdDaysAgo, t.hour ?? 8);
    const slaDueAt = addWorkingDays(createdAt, TICKET_SLA_DAYS);
    const resolvedAt = t.resolvedAfterDays ? new Date(createdAt.getTime() + t.resolvedAfterDays * DAY) : null;
    if (["OPEN", "IN_PROGRESS"].includes(t.status) && slaDueAt.getTime() < now) overdue++;
    const inst = t.inst ? by(t.inst) : null;
    const [row] = await db
      .insert(schema.tickets)
      .values({
        ref,
        source: t.source,
        category: t.category,
        subject: t.subject,
        body: t.body,
        contactName: t.name,
        contactEmail: t.email,
        contactMobile: t.mobile ?? null,
        institutionId: inst?.id ?? null,
        username: t.username ?? null,
        status: t.status,
        assignedTo: t.assignedTo ?? null,
        slaDueAt,
        resolvedAt,
        createdAt,
      })
      .returning();
    for (const r of t.replies ?? [])
      await db.insert(schema.ticketReplies).values({ ticketId: row.id, author: r.author, body: r.body, internal: !!r.internal, createdAt: new Date(createdAt.getTime() + r.afterHours * 3600000) });
    if (t.source === "PUBLIC" && t.email)
      await sendEmail(db, { to: t.email, toName: t.name, subject: `We received your ${t.category.toLowerCase()}: ${ref}`, body: `Dear ${t.name},\n\nYour reference is ${ref}. We aim to resolve it within ${TICKET_SLA_DAYS} working days.`, entity: "ticket", entityRef: ref });
    await audit(db, { actor: t.username ?? "public", action: "ticket.created", entity: "ticket", entityId: ref, details: { source: t.source, category: t.category, seeded: true } });
  }

  return `2 council meetings (${past.ref} closed with minutes, ${planned.ref} planned with ${pos} case), decided cases ${gmi.app.ref} (rejected) and ${fru.app.ref} (deferred), appeal ${appealRef} filed, ${tickets.length} tickets (${overdue} overdue)`;
}
