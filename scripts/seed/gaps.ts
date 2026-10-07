// Seed data for the "further digitisation points" module (guide section 14). Runs last (see scripts/seed/index.ts).
// - Reference rules: retention.policy, kpi.targets, annual.returnDeadline
// - Simulated NADRA checks for every seeded faculty member, student and pharmacist, with three disagreements
//   waiting on PCP's Data verification screen (one of each kind of record)
// - Measures of success: cases decided in 2025 (loaded from paper files) with their deficiencies, and the 2023 and
//   2024 annual returns, some filed late
// - Retention: one stale draft application, one onboarding draft never submitted, and old expired one-time codes
import { and, asc, eq, inArray, isNull, like, ne, sql } from "drizzle-orm";
import { db, schema } from "../../src/db";
import type { AnnualFigures } from "../../src/db/modules/students";
import { audit } from "../../src/lib/audit";
import { simulateNadra } from "../../src/lib/nadra";
import { PROGRAMME_YEARS } from "../../src/lib/registry-shared";

const DAY = 86400000;
const NOW = Date.now();
const at = (iso: string) => new Date(iso);
const plus = (d: Date, days: number) => new Date(d.getTime() + days * DAY);

type Inst = typeof schema.institutions.$inferSelect;

async function seedRules() {
  const want = [
    {
      key: "retention.policy",
      value: { draftApplicationDays: 90, onboardingDraftDays: 90, expiredCodeDays: 1, unpaidChallanDays: 30 },
      description: "Retention schedule for temporary data (guide section 14). Academic and regulatory records are kept; only these drafts, codes and challans are cleared.",
    },
    {
      key: "kpi.targets",
      value: { nocDecisionDays: 60, accreditationDecisionDays: 90, deficiencySharePct: 30, onTimeSharePct: 90 },
      description: "Targets for the measures of success (guide section 14): days to decide, share returned for deficiency, share of annual returns on time.",
    },
    { key: "annual.returnDeadline", value: "31 October", description: "Deadline for the annual student return each year (guide section 8)." },
  ];
  let added = 0;
  for (const r of want) {
    if (await db.query.rules.findFirst({ where: eq(schema.rules.key, r.key) })) continue;
    await db.insert(schema.rules).values({ key: r.key, version: 1, value: r.value, description: r.description, effectiveFrom: "2026-07-01" });
    added++;
  }
  return added;
}

// ---------- Simulated NADRA checks ----------

/** A free CNIC with this prefix whose last four digits are `tail` (0000 not found, 1111 name differs). */
async function freeCnic(table: "faculty" | "students" | "pharmacists", prefix: string, tail: "0000" | "1111", start: number) {
  for (let n = start; n < start + 400; n++) {
    const c = `${prefix}-${String(n).padStart(4, "0")}${tail.slice(0, 3)}-${tail.slice(3)}`;
    const t = table === "faculty" ? schema.faculty : table === "students" ? schema.students : schema.pharmacists;
    const hit = await db.select({ id: t.id }).from(t).where(eq(t.cnic, c)).limit(1);
    if (!hit.length) return c;
  }
  throw new Error("no free CNIC");
}

async function seedIdentity(inst: Record<string, Inst>) {
  // Three records NADRA disagrees with, so the Data verification screen has work on it.
  const [fac] = await db
    .select({ id: schema.faculty.id })
    .from(schema.faculty)
    .innerJoin(schema.facultyLinks, and(eq(schema.facultyLinks.facultyId, schema.faculty.id), eq(schema.facultyLinks.status, "ACTIVE")))
    .where(and(eq(schema.facultyLinks.institutionId, inst.RUH.id), ne(schema.faculty.pcpId, "PCP-FAC-000001")))
    .orderBy(asc(schema.faculty.id))
    .offset(4)
    .limit(1);
  if (fac) await db.update(schema.faculty).set({ cnic: await freeCnic("faculty", "17301", "1111", 4570) }).where(eq(schema.faculty.id, fac.id));
  const [stu] = await db
    .select({ id: schema.students.id })
    .from(schema.students)
    .where(and(eq(schema.students.institutionId, inst.RUH.id), eq(schema.students.enrollmentYear, 2026), isNull(schema.students.username)))
    .orderBy(asc(schema.students.id))
    .offset(6)
    .limit(1);
  if (stu) await db.update(schema.students).set({ cnic: await freeCnic("students", "17301", "0000", 7020) }).where(eq(schema.students.id, stu.id));
  const [ph] = await db.select({ id: schema.pharmacists.id, cnic: schema.pharmacists.cnic }).from(schema.pharmacists).where(isNull(schema.pharmacists.username)).orderBy(asc(schema.pharmacists.id)).offset(5).limit(1);
  if (ph) await db.update(schema.pharmacists).set({ cnic: await freeCnic("pharmacists", ph.cnic.slice(0, 5), "1111", 3180) }).where(eq(schema.pharmacists.id, ph.id));

  const loaded = new Date(NOW - 21 * DAY); // the data-cleaning pass when records were loaded
  const recent = new Date(NOW - 3 * DAY);
  const people = [
    ...(await db.select({ id: schema.faculty.id, ref: schema.faculty.pcpId, cnic: schema.faculty.cnic, name: schema.faculty.fullName }).from(schema.faculty)).map((x) => ({ ...x, type: "faculty" })),
    ...(await db.select({ id: schema.students.id, ref: schema.students.pcpId, cnic: schema.students.cnic, name: schema.students.fullName }).from(schema.students)).map((x) => ({ ...x, type: "student" })),
    ...(await db.select({ id: schema.pharmacists.id, ref: schema.pharmacists.regNo, cnic: schema.pharmacists.cnic, name: schema.pharmacists.fullName }).from(schema.pharmacists)).map((x) => ({ ...x, type: "pharmacist" })),
  ];
  const rows = people.map((p) => {
    const r = simulateNadra({ cnic: p.cnic, name: p.name });
    const open = r.status !== "MATCH";
    const checkedAt = open ? recent : loaded;
    return {
      entityType: p.type,
      entityId: p.id,
      cnic: p.cnic,
      nameSent: p.name,
      status: r.status,
      nadraName: r.nadraName,
      txnId: r.txnId.replace(/SIM-NADRA-\d{8}/, `SIM-NADRA-${checkedAt.toISOString().slice(0, 10).replace(/-/g, "")}`),
      source: "SEED",
      checkedBy: "system",
      checkedAt,
      reviewStatus: open ? "OPEN" : null,
      _ref: p.ref,
    };
  });
  for (let i = 0; i < rows.length; i += 500) await db.insert(schema.identityChecks).values(rows.slice(i, i + 500).map(({ _ref, ...r }) => (void _ref, r)));
  const open = rows.filter((r) => r.reviewStatus === "OPEN");
  if (open.length)
    await db.insert(schema.notifications).values([
      { audience: "role:pcp_verification", title: `${open.length} NADRA checks need a decision`, body: `Simulated NADRA check: ${open.map((o) => `${o._ref} ${o.status === "NOT_FOUND" ? "not found" : `name differs ("${o.nadraName}")`}`).join("; ")}.`, link: "/pcp/verification?tab=nadra", createdAt: recent },
      { audience: "role:pcp_officer", title: `${open.length} NADRA checks need a decision`, body: "Name differences and CNICs NADRA does not know are on the Data verification screen.", link: "/pcp/verification?tab=nadra", createdAt: recent },
    ]);
  await audit(db, { actor: "system", action: "identity.nadra.seeded", entity: "system", entityId: "seed", details: { simulated: true, checks: rows.length, open: open.map((o) => o._ref) } });
  return { checks: rows.length, open: open.map((o) => `${o._ref} (${o.status === "NOT_FOUND" ? "not found" : "name differs"})`) };
}

// ---------- Measures of success: decided cases and their deficiencies ----------

type Def = { criterion: string; action: string; evidence: string; raised: number; responded: number };
type CaseSeed = {
  ref: string;
  s: string;
  kind: "NOC" | "RENEWAL";
  type: "PHARMD" | "TECH";
  submitted: string;
  decided: string;
  decision: "APPROVED" | "REJECTED";
  note: string;
  intake: number;
  defs?: Def[];
  cert?: { no: string; issued: string; validUntil: string; historyYear: number };
};

const FEES: Record<string, number> = { "NOC:PHARMD": 1000000, "NOC:TECH": 500000, "RENEWAL:PHARMD": 300000, "RENEWAL:TECH": 200000 };

const CASES: CaseSeed[] = [
  {
    ref: "RNW-2024-0002",
    s: "CCP",
    kind: "RENEWAL",
    type: "PHARMD",
    submitted: "2024-10-07T09:30:00Z",
    decided: "2025-01-23T11:00:00Z",
    decision: "APPROVED",
    note: "Accreditation renewed for intake 80, 1 Feb 2025 to 31 Jan 2028.",
    intake: 80,
    defs: [{ criterion: "Faculty", action: "Replace the two Pharmaceutics lecturers who left in August 2024", evidence: "Appointment letters + CVs", raised: 21, responded: 44 }],
    cert: { no: "ACR-PHARMD-2025-0001", issued: "2025-01-31T10:00:00Z", validUntil: "2028-01-31", historyYear: 2025 },
  },
  {
    ref: "NOC-2025-0001",
    s: "BVU",
    kind: "NOC",
    type: "PHARMD",
    submitted: "2025-01-13T09:00:00Z",
    decided: "2025-04-24T11:00:00Z",
    decision: "REJECTED",
    note: "Faculty below the minimum for intake 60 at inspection: 1 PhD faculty member linked, 2 required.",
    intake: 60,
    defs: [{ criterion: "Library", action: "Raise journal subscriptions to 20 and add the e-library licence", evidence: "Subscription invoices", raised: 18, responded: 40 }],
  },
  {
    ref: "NOC-2025-0002",
    s: "NHC",
    kind: "NOC",
    type: "PHARMD",
    submitted: "2025-02-24T09:00:00Z",
    decided: "2025-06-26T11:00:00Z",
    decision: "REJECTED",
    note: "Two of the four required laboratories were not ready at inspection.",
    intake: 60,
    defs: [
      { criterion: "Faculty", action: "Link two more Pharmacology teachers by Faculty ID", evidence: "Appointment letters + CVs", raised: 12, responded: 35 },
      { criterion: "Laboratories", action: "Provide the Pharmacognosy laboratory inventory", evidence: "Inventory + photographs", raised: 12, responded: 35 },
    ],
  },
  {
    ref: "RNW-2025-0001",
    s: "RBU",
    kind: "RENEWAL",
    type: "TECH",
    submitted: "2025-02-17T09:00:00Z",
    decided: "2025-06-12T11:00:00Z",
    decision: "APPROVED",
    note: "Accreditation renewed for intake 50, 1 Jul 2025 to 30 Jun 2028.",
    intake: 50,
    cert: { no: "ACR-TECH-2025-0001", issued: "2025-06-25T10:00:00Z", validUntil: "2028-06-30", historyYear: 2025 },
  },
  {
    ref: "NOC-2025-0003",
    s: "SCU",
    kind: "NOC",
    type: "TECH",
    submitted: "2025-03-10T09:00:00Z",
    decided: "2025-07-17T11:00:00Z",
    decision: "REJECTED",
    note: "Building approval for the technician block was not in place.",
    intake: 40,
    defs: [{ criterion: "Building", action: "Submit the approved building plan for the technician block", evidence: "Approved building plan", raised: 20, responded: 44 }],
  },
  {
    ref: "NOC-2025-0004",
    s: "FRU",
    kind: "NOC",
    type: "PHARMD",
    submitted: "2025-04-21T09:00:00Z",
    decided: "2025-07-31T11:00:00Z",
    decision: "REJECTED",
    note: "Faculty count below the rule for the requested intake of 80.",
    intake: 80,
  },
  {
    ref: "NOC-2025-0005",
    s: "CCP",
    kind: "NOC",
    type: "TECH",
    submitted: "2025-05-12T09:00:00Z",
    decided: "2025-08-14T11:00:00Z",
    decision: "REJECTED",
    note: "Laboratory equipment below the technician standard.",
    intake: 40,
  },
  {
    ref: "RNW-2025-0002",
    s: "SCU",
    kind: "RENEWAL",
    type: "PHARMD",
    submitted: "2025-08-18T09:00:00Z",
    decided: "2025-12-04T11:00:00Z",
    decision: "APPROVED",
    note: "Accreditation renewed for intake 100, 30 Sep 2026 to 30 Sep 2029.",
    intake: 100,
    defs: [{ criterion: "Library", action: "Add 400 titles to the pharmacy practice section", evidence: "Purchase invoices", raised: 15, responded: 37 }],
    cert: { no: "ACR-PHARMD-2025-0002", issued: "2025-12-15T10:00:00Z", validUntil: "2029-09-30", historyYear: 2026 },
  },
];

async function nextDefRef(year: number) {
  const res = await db.execute(sql`select coalesce(max(split_part(ref, '-', 3)::int), 0) as n from deficiencies where ref like ${`DF-${year}-%`}`);
  return `DF-${year}-${String(Number((res.rows[0] as { n: number }).n) + 1).padStart(5, "0")}`;
}

async function seedCases(inst: Record<string, Inst>) {
  const made: string[] = [];
  for (const c of CASES) {
    if (await db.query.applications.findFirst({ where: eq(schema.applications.ref, c.ref) })) continue;
    if (c.cert && (await db.query.applications.findFirst({ where: eq(schema.applications.certificateNo, c.cert.no) }))) continue;
    const i = inst[c.s];
    const campus = await db.query.campuses.findFirst({ where: and(eq(schema.campuses.institutionId, i.id), eq(schema.campuses.isMain, true)) });
    const poc = `${c.s.toLowerCase()}.poc`;
    const submitted = at(c.submitted);
    const decided = at(c.decided);
    const approved = c.decision === "APPROVED";
    const [app] = await db
      .insert(schema.applications)
      .values({
        ref: c.ref,
        institutionId: i.id,
        kind: c.kind,
        programType: c.type,
        status: approved ? "NOC_ISSUED" : "REJECTED",
        campusId: campus?.id ?? null,
        data: { campus: campus?.name ?? `Main campus, ${i.city}`, proposedIntake: c.intake, classrooms: 6, labs: c.type === "PHARMD" ? 5 : 3, libraryBooks: c.type === "PHARMD" ? 2400 : 800, libraryJournals: 12, buildingAreaSqft: 30000 },
        checks: [{ key: "all", label: "Automatic checks", ok: true, detail: "Loaded from the paper file; checks recorded by the officer" }],
        feeAmount: FEES[`${c.kind}:${c.type}`] ?? 0,
        feePsid: `${c.submitted.slice(0, 4)}${String(i.id).padStart(5, "0")}${c.submitted.slice(5, 7)}${c.submitted.slice(8, 10)}${String(c.intake).padStart(4, "0")}`,
        feePaidAt: submitted,
        feePaidBy: poc,
        feeMethod: "Bank branch (PSID challan)",
        assignedOfficer: "pcp.officer",
        submittedBy: poc,
        submittedAt: submitted,
        decision: c.decision,
        decisionNote: c.note,
        decisionGrounds: approved ? null : c.note,
        decidedAt: decided,
        ...(c.cert ? { certificateNo: c.cert.no, issuedAt: at(c.cert.issued), validUntil: c.cert.validUntil } : {}),
        createdBy: poc,
        createdAt: new Date(submitted.getTime() - 5 * DAY),
        updatedAt: c.cert ? at(c.cert.issued) : decided,
      })
      .returning();
    const ev = (from: string | null, to: string, actor: string, role: string, note: string, when: Date) => ({ applicationId: app.id, fromStatus: from, toStatus: to, actor, actorRole: role, note, createdAt: when });
    const steps = [ev("DRAFT", "SUBMITTED", poc, "inst_poc", "Submitted with fee paid (loaded from the paper file)", submitted), ev("SUBMITTED", "UNDER_SCRUTINY", "pcp.officer", "pcp_officer", "Initial scrutiny started", plus(submitted, 3))];
    let t = 3;
    for (const [k, d] of (c.defs ?? []).entries()) {
      const raised = plus(submitted, d.raised);
      const responded = plus(submitted, d.responded);
      const ref = await nextDefRef(raised.getUTCFullYear());
      await db.insert(schema.deficiencies).values({
        ref,
        applicationId: app.id,
        institutionId: i.id,
        criterion: d.criterion,
        requiredAction: d.action,
        evidenceRequired: d.evidence,
        dueDate: plus(raised, 30).toISOString().slice(0, 10),
        status: "ACCEPTED",
        responseNote: "Evidence uploaded",
        respondedBy: poc,
        respondedAt: responded,
        reviewedBy: "pcp.officer",
        reviewNote: "Accepted",
        raisedBy: "pcp.officer",
        createdAt: raised,
      });
      if (k === 0) steps.push(ev("UNDER_SCRUTINY", "DEFICIENCY_RAISED", "pcp.officer", "pcp_officer", `${ref}: ${d.criterion}`, raised), ev("DEFICIENCY_RAISED", "RESPONDED", poc, "inst_poc", "Response and evidence submitted", responded), ev("RESPONDED", "UNDER_SCRUTINY", "pcp.officer", "pcp_officer", "All deficiencies resolved", plus(responded, 3)));
      t = d.responded + 3;
    }
    const span = Math.round((decided.getTime() - submitted.getTime()) / DAY);
    const insp = Math.max(t + 10, Math.round(span * 0.55));
    steps.push(
      ev("UNDER_SCRUTINY", "INSPECTION_SCHEDULED", "pcp.officer", "pcp_officer", "Inspection scheduled", plus(submitted, insp - 12)),
      ev("INSPECTION_SCHEDULED", "INSPECTION_SUBMITTED", "pcp.inspector", "pcp_inspector", "Inspection report received", plus(submitted, insp)),
      ev("INSPECTION_SUBMITTED", "COUNCIL_REVIEW", "pcp.officer", "pcp_officer", "Forwarded to the council", plus(submitted, insp + 8)),
      ev("COUNCIL_REVIEW", c.decision, "pcp.secretary", "pcp_secretary", `Council decision: ${c.note}`, decided),
    );
    if (c.cert) steps.push(ev("APPROVED", "NOC_ISSUED", "pcp.secretary", "pcp_secretary", `Certificate ${c.cert.no} issued`, at(c.cert.issued)));
    await db.insert(schema.applicationEvents).values(steps);
    if (c.cert) {
      const prog = await db.query.programs.findFirst({ where: and(eq(schema.programs.institutionId, i.id), eq(schema.programs.type, c.type)) });
      if (prog) await db.update(schema.accreditationHistory).set({ applicationRef: c.ref }).where(and(eq(schema.accreditationHistory.programId, prog.id), eq(schema.accreditationHistory.year, c.cert.historyYear)));
    }
    await audit(db, { actor: "system", action: "application.seeded", entity: "application", entityId: c.ref, details: { status: approved ? "NOC_ISSUED" : "REJECTED", loadedFromPaper: true } });
    made.push(c.ref);
  }
  return made;
}

// ---------- Measures of success: earlier annual returns ----------

/** Figures for a past year from the student records (enrolment that year; results estimated like the 2025 returns). */
async function figuresFor(institutionId: number, type: string, year: number): Promise<AnnualFigures> {
  const len = PROGRAMME_YEARS[type] ?? 5;
  const rows = await db.select({ y: schema.students.enrollmentYear }).from(schema.students).where(and(eq(schema.students.institutionId, institutionId), eq(schema.students.programType, type), sql`${schema.students.enrollmentYear} <= ${year}`));
  const sat = rows.filter((r) => r.y <= year - 1);
  const graduated = rows.filter((r) => r.y + len === year).length;
  const failed = Math.round(sat.length * 0.06);
  const passed = sat.length - failed;
  return { enrolled: rows.length, promoted: Math.max(0, passed - graduated), passed, failed, repeat: failed, graduated, withdrawn: 0 };
}

// When each programme filed its 2023 and 2024 return (the deadline is 31 October). Late ones are past it.
const FILED: Record<number, Record<string, string>> = {
  2023: { "RUH:PHARMD": "2023-10-19", "RBU:PHARMD": "2023-10-25", "RBU:TECH": "2023-11-03", "CCP:PHARMD": "2023-11-08", "BVU:TECH": "2023-11-21", "FRU:TECH": "2023-10-27", "SCU:PHARMD": "2023-10-30" },
  2024: { "RUH:PHARMD": "2024-10-15", "RBU:PHARMD": "2024-10-22", "RBU:TECH": "2024-10-22", "CCP:PHARMD": "2024-10-28", "BVU:TECH": "2024-11-12", "FRU:TECH": "2024-11-05", "SCU:PHARMD": "2024-10-24" },
};

async function seedReturns(inst: Record<string, Inst>) {
  let n = 0;
  for (const [y, list] of Object.entries(FILED)) {
    const year = Number(y);
    for (const [key, day] of Object.entries(list)) {
      const [s, type] = key.split(":");
      const i = inst[s];
      if (!i) continue;
      const ref = `AR-${year}-${s}-${type}`;
      if (await db.query.annualReturns.findFirst({ where: eq(schema.annualReturns.ref, ref) })) continue;
      const submittedAt = at(`${day}T09:00:00Z`);
      const reviewedAt = plus(submittedAt, 24);
      await db.insert(schema.annualReturns).values({
        ref,
        institutionId: i.id,
        programType: type,
        year,
        status: "ACCEPTED",
        figures: await figuresFor(i.id, type, year),
        note: "Loaded from the paper return",
        dueDate: `${year}-10-31`,
        submittedBy: s === "RUH" ? "ruh.exam" : `${s.toLowerCase()}.poc`,
        submittedAt,
        reviewedBy: "pcp.verification",
        reviewedAt,
        reviewNote: day > `${year}-10-31` ? `Accepted. Filed after the 31 October deadline.` : "Figures match the result notification",
        lockedAt: reviewedAt,
        createdAt: plus(submittedAt, -10),
      });
      n++;
    }
  }
  return n;
}

// ---------- Retention: stale drafts and expired codes ----------

async function seedStale(inst: Record<string, Inst>) {
  const out: string[] = [];
  // A Pharmacy Technician NOC that Northern Hills started in June 2025 and never finished.
  if (!(await db.query.applications.findFirst({ where: eq(schema.applications.ref, "NOC-2025-0006") }))) {
    const campus = await db.query.campuses.findFirst({ where: and(eq(schema.campuses.institutionId, inst.NHC.id), eq(schema.campuses.isMain, true)) });
    const created = at("2025-06-16T10:00:00Z");
    const [app] = await db
      .insert(schema.applications)
      .values({ ref: "NOC-2025-0006", institutionId: inst.NHC.id, kind: "NOC", programType: "TECH", status: "DRAFT", campusId: campus?.id ?? null, data: { campus: campus?.name, proposedIntake: 30 }, feeAmount: 500000, createdBy: "nhc.poc", createdAt: created, updatedAt: at("2025-06-18T15:30:00Z") })
      .returning();
    await db.insert(schema.applicationEvents).values({ applicationId: app.id, fromStatus: null, toStatus: "DRAFT", actor: "nhc.poc", actorRole: "inst_poc", note: "Draft started", createdAt: created });
    out.push("NOC-2025-0006 (draft untouched since 18 Jun 2025)");
  }
  // An institution that started registering in November 2025 and never submitted (no portal account is left for it).
  if (!(await db.query.onboardingRequests.findFirst({ where: like(schema.onboardingRequests.ref, "REG-2025-%") }))) {
    const created = at("2025-11-03T08:00:00Z");
    const [req] = await db
      .insert(schema.onboardingRequests)
      .values({
        ref: "REG-2025-0004",
        status: "DRAFT",
        applicantUsername: "kpi.applicant.2025",
        applicantName: "Asif Mehmood",
        applicantDesignation: "Registrar",
        email: "registrar@kohat-pharmacy.demo",
        mobile: "0333-9100457",
        emailVerifiedAt: created,
        profile: { name: "Kohat Institute of Pharmacy", province: "Khyber Pakhtunkhwa", city: "Kohat", sector: "Private" },
        createdAt: created,
        updatedAt: at("2025-11-04T12:00:00Z"),
      })
      .returning();
    await db.insert(schema.onboardingEvents).values({ requestId: req.id, fromStatus: null, toStatus: "DRAFT", actor: "kpi.applicant.2025", note: "Account created", createdAt: created });
    out.push("REG-2025-0004 (onboarding draft never submitted)");
  }
  // One-time codes from earlier sessions, long expired.
  const old = [40, 33, 21, 12, 5].map((d) => new Date(NOW - d * DAY));
  await db.insert(schema.otpChallenges).values(
    old.map((d, k) => ({
      username: ["pcp.secretary", "ruh.poc", "pcp.verification", "pcp.accounts", "pcp.admin"][k],
      purpose: ["decision:NOC-2025-0007", "payment:2025000110000000123", "decision:AR-2025-RUH-PHARMD", "reconcile:STMT-2026-0001", "rule:fees"][k],
      codeHash: "0".repeat(64),
      sentTo: "0300-0000000",
      expiresAt: new Date(d.getTime() + 10 * 60000),
      usedAt: k % 2 ? null : new Date(d.getTime() + 60000),
      createdAt: d,
    })),
  );
  out.push(`${old.length} expired one-time codes`);
  return out;
}

export default async function seedGaps(): Promise<string | void> {
  const inst: Record<string, Inst> = Object.fromEntries((await db.select().from(schema.institutions)).map((i) => [i.shortCode, i]));
  if (!inst.RUH || !inst.NHC) return "core institutions missing; skipped";
  const rules = await seedRules();
  const identity = await seedIdentity(inst);
  const cases = await seedCases(inst);
  const returns = await seedReturns(inst);
  const stale = await seedStale(inst);
  const open = await db.select({ n: sql<number>`count(*)::int` }).from(schema.identityChecks).where(inArray(schema.identityChecks.reviewStatus, ["OPEN"]));
  return `${rules} rules; ${identity.checks} simulated NADRA checks, ${open[0].n} waiting for PCP (${identity.open.join(", ")}); ${cases.length} decided cases (${cases.join(", ")}); ${returns} earlier annual returns; stale: ${stale.join(", ")}`;
}
