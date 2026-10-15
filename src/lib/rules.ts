import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CheckResult } from "@/db/schema";
import { DEFAULT_SCORING, type ScoringRule } from "./inspection-scoring";
import { outstandingDues } from "./payments";
import { DEFAULT_PG_FEES, DEFAULT_PG_RULE, aType, inField, pgTypeRule, supervisorEligibility, supervisorsRequired, type PgRule } from "./pg";
import { CLOSED_STATUSES, PG_TYPES, PROGRAM_LABELS, SELF_ASSESSMENT_CRITERIA, SUPERVISOR_SUBJECT, UG_TYPES, isPg, programmeName } from "./workflow";

/** Teachers needed for one subject: max(min, ceil(intake / perIntake)). */
export type SubjectRule = { name: string; perIntake: number; min: number };

export type ProgramRule = {
  maxIntake: number;
  studentsPerFaculty: number;
  minPhdFaculty: number;
  minLabs: number;
  minClassrooms: number;
  minLibraryBooks: number;
  requiredDocs: string[];
  /** Per-subject faculty requirement by intake (guide section 4). */
  subjects?: SubjectRule[];
  /** A teacher counts for one programme or open case at a time unless this is raised. */
  maxTeacherLoad?: number;
  /** Documents for accreditation and renewal cases. */
  accreditationDocs?: string[];
  /** Length of an accreditation term in years. */
  accreditationYears?: number;
};

export type FeeRule = Record<string, number>;

export async function getRule<T>(key: string): Promise<{ value: T; version: number }> {
  const row = await db.query.rules.findFirst({ where: eq(schema.rules.key, key), orderBy: desc(schema.rules.version) });
  if (!row) throw new Error("Missing rule " + key);
  return { value: row.value as T, version: row.version };
}

export async function feeFor(kind: string, programType: string) {
  const { value } = await getRule<FeeRule>("fees");
  return value[`${kind}:${programType}`] ?? DEFAULT_PG_FEES[`${kind}:${programType}`] ?? 0;
}

/** The postgraduate rule (`pg.rules`): fields of study, proforma thresholds and supervisor eligibility. */
export async function getPgRule(): Promise<{ value: PgRule; version: number }> {
  try {
    return await getRule<PgRule>("pg.rules");
  } catch {
    return { value: DEFAULT_PG_RULE, version: 0 };
  }
}

/** The inspection scoring rule (`inspection.scoring`): maximum score, bands, weights and the pass mark. */
export async function getScoringRule(): Promise<{ value: ScoringRule; version: number }> {
  try {
    return await getRule<ScoringRule>("inspection.scoring");
  } catch {
    return { value: DEFAULT_SCORING, version: 0 };
  }
}

/** Length of an accreditation term for a programme type, from its own rule. */
export async function accreditationYearsFor(programType: string) {
  if (isPg(programType)) return pgTypeRule((await getPgRule()).value, programType).accreditationYears ?? 3;
  try {
    return (await getRule<ProgramRule>(`noc.${programType}`)).value.accreditationYears ?? 3;
  } catch {
    return 3;
  }
}

export function subjectRequirements(rule: ProgramRule, intake: number) {
  return (rule.subjects ?? []).map((s) => ({ name: s.name, required: Math.max(s.min, intake > 0 ? Math.ceil(intake / s.perIntake) : s.min) }));
}

export function requiredDocsFor(rule: ProgramRule, kind: string) {
  return kind === "NOC" ? rule.requiredDocs : (rule.accreditationDocs ?? ["Self-assessment evidence"]);
}

/** Documents a postgraduate case needs: the HEC NOC for the PG programme and the proforma evidence, every time. */
export function pgRequiredDocs(rule: PgRule, programType: string) {
  return pgTypeRule(rule, programType).requiredDocs;
}

/** Specialisations that teach a subject under another name. */
const SUBJECT_ALIAS: Record<string, string> = { "Clinical Pharmacy": "Pharmacy Practice" };

/**
 * A first assignment of teachers to subjects: every subject gets one teacher before any gets a second
 * (specialists first), then the remaining places are filled, then the rest go to their own subject.
 * The institution can change every line; this only saves typing.
 */
export function suggestAssignment(faculty: { id: number; specialization: string; qualification: string }[], reqs: { name: string; required: number }[]) {
  const subjects = reqs.map((r) => r.name);
  if (!subjects.length) return [];
  const spec = (f: { specialization: string }) => SUBJECT_ALIAS[f.specialization] ?? f.specialization;
  const pool = [...faculty].sort((a, b) => (a.qualification === "PhD" ? 0 : 1) - (b.qualification === "PhD" ? 0 : 1));
  const out: { facultyId: number; subject: string }[] = [];
  const count = (s: string) => out.filter((o) => o.subject === s).length;
  const taken = new Set<number>();
  const fill = (cap: (r: { required: number }) => number, specialistsOnly: boolean) => {
    for (const r of reqs)
      for (const f of pool)
        if (!taken.has(f.id) && count(r.name) < cap(r) && (specialistsOnly ? spec(f) === r.name : true)) {
          out.push({ facultyId: f.id, subject: r.name });
          taken.add(f.id);
        }
  };
  fill((r) => Math.min(1, r.required), true);
  fill((r) => Math.min(1, r.required), false);
  fill((r) => r.required, true);
  fill((r) => r.required, false);
  for (const f of pool) {
    if (taken.has(f.id)) continue;
    const s = subjects.includes(spec(f)) ? spec(f) : [...reqs].sort((a, b) => count(a.name) / Math.max(1, a.required) - count(b.name) / Math.max(1, b.required))[0].name;
    out.push({ facultyId: f.id, subject: s });
    taken.add(f.id);
  }
  return out;
}

/**
 * Faculty linked to a case, with whether each is still active at the institution and where they are appointed.
 * The teacher-load count looks at open cases of the same level only: supervising a postgraduate programme
 * does not count against a teacher's undergraduate load, and the other way round.
 */
export async function caseFaculty(applicationId: number, institutionId: number, programType?: string) {
  const level = isPg(programType) ? [...PG_TYPES] : [...UG_TYPES];
  const rows = await db
    .select({
      facultyId: schema.applicationFaculty.facultyId,
      subject: schema.applicationFaculty.subject,
      details: schema.applicationFaculty.details,
      pcpId: schema.faculty.pcpId,
      fullName: schema.faculty.fullName,
      qualification: schema.faculty.qualification,
      specialization: schema.faculty.specialization,
      designation: schema.faculty.designation,
      verificationStatus: schema.faculty.verificationStatus,
      linkedAt: schema.applicationFaculty.createdAt,
    })
    .from(schema.applicationFaculty)
    .innerJoin(schema.faculty, eq(schema.faculty.id, schema.applicationFaculty.facultyId))
    .where(eq(schema.applicationFaculty.applicationId, applicationId))
    .orderBy(schema.applicationFaculty.subject, schema.faculty.fullName);
  const ids = rows.map((r) => r.facultyId);
  const links = ids.length
    ? await db
        .select({ facultyId: schema.facultyLinks.facultyId, programType: schema.facultyLinks.programType })
        .from(schema.facultyLinks)
        .where(and(inArray(schema.facultyLinks.facultyId, ids), eq(schema.facultyLinks.institutionId, institutionId), eq(schema.facultyLinks.status, "ACTIVE")))
    : [];
  const flags = ids.length
    ? await db
        .select({ recordId: schema.duplicateFlags.recordId })
        .from(schema.duplicateFlags)
        .where(and(eq(schema.duplicateFlags.status, "OPEN"), inArray(schema.duplicateFlags.recordId, ids)))
    : [];
  // Other open cases of the same institution each teacher is counted on (the permitted-load rule).
  const others = ids.length
    ? await db
        .select({ facultyId: schema.applicationFaculty.facultyId, ref: schema.applications.ref })
        .from(schema.applicationFaculty)
        .innerJoin(schema.applications, eq(schema.applications.id, schema.applicationFaculty.applicationId))
        .where(
          and(
            inArray(schema.applicationFaculty.facultyId, ids),
            ne(schema.applications.id, applicationId),
            eq(schema.applications.institutionId, institutionId),
            inArray(schema.applications.programType, level),
            sql`${schema.applications.status} not in (${sql.join(CLOSED_STATUSES.map((s) => sql`${s}`), sql`, `)})`,
          ),
        )
    : [];
  return rows.map((r) => ({
    ...r,
    activeHere: links.some((l) => l.facultyId === r.facultyId),
    appointedTo: links.find((l) => l.facultyId === r.facultyId)?.programType ?? null,
    openFlag: flags.some((f) => f.recordId === r.facultyId),
    otherCases: others.filter((o) => o.facultyId === r.facultyId).map((o) => o.ref),
  }));
}

const FIELD_NAMES: Record<string, string> = { campus: "campus", proposedIntake: "intake", classrooms: "classrooms", labs: "laboratories", libraryBooks: "library books" };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The automatic checks of guide section 4, driven by the versioned rules table. Each failure names the item and the rule. */
export async function runChecks(applicationId: number): Promise<{ checks: CheckResult[]; ruleVersion: number }> {
  const app = await db.query.applications.findFirst({ where: eq(schema.applications.id, applicationId) });
  if (!app) throw new Error("Application not found");
  const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, app.institutionId) });
  if (isPg(app.programType)) return runPgChecks(app, inst);
  const { value: rule, version } = await getRule<ProgramRule>(`noc.${app.programType}`);
  const d = app.data ?? {};
  const checks: CheckResult[] = [];
  const accreditation = app.kind !== "NOC";

  const missing = (["campus", "proposedIntake", "classrooms", "labs", "libraryBooks"] as const).filter((k) =>
    k === "campus" ? !app.campusId : d[k] === undefined || d[k] === null || (d[k] as unknown) === "",
  );
  checks.push({
    key: "fields",
    label: "Required fields completed",
    ok: missing.length === 0,
    detail: missing.length ? `Missing: ${missing.map((k) => FIELD_NAMES[k]).join(", ")}` : "Campus, intake, classrooms, laboratories and library filled in",
  });

  const intake = Number(d.proposedIntake ?? 0);
  checks.push({ key: "intake", label: "Student intake within limit", ok: intake > 0 && intake <= rule.maxIntake, detail: `Proposed ${intake}; limit ${rule.maxIntake}` });

  // Faculty: only teachers linked to this case by Faculty ID count, per subject.
  const linked = await caseFaculty(app.id, app.institutionId, app.programType);
  const counting = linked.filter((f) => f.activeHere);
  for (const s of subjectRequirements(rule, intake)) {
    const n = counting.filter((f) => f.subject === s.name).length;
    checks.push({
      key: `subject:${s.name}`,
      label: `Faculty for ${s.name}`,
      ok: n >= s.required,
      detail: `${s.name}: ${plural(n, "teacher")} linked, ${s.required} required for intake ${intake}.`,
    });
  }
  const needed = Math.ceil(intake / rule.studentsPerFaculty) || 1;
  checks.push({
    key: "faculty_count",
    label: "Faculty count",
    ok: counting.length >= needed,
    detail: `${counting.length} faculty linked to this case; ${needed} needed (1 per ${rule.studentsPerFaculty} students for intake ${intake})`,
  });
  const phd = counting.filter((f) => f.qualification === "PhD").length;
  checks.push({ key: "faculty_qualification", label: "Faculty qualifications", ok: phd >= rule.minPhdFaculty, detail: `${phd} PhD faculty linked; minimum ${rule.minPhdFaculty}` });

  const badRecord = linked.filter((f) => !f.activeHere || f.openFlag || f.verificationStatus === "FLAGGED" || f.verificationStatus === "REJECTED");
  const pending = linked.filter((f) => f.verificationStatus === "PENDING").length;
  checks.push({
    key: "duplicates",
    label: "Faculty records clear",
    ok: badRecord.length === 0,
    detail: badRecord.length
      ? badRecord
          .map((f) => `${f.fullName} (${f.pcpId}) ${!f.activeHere ? "is no longer active at your institution" : "is flagged as a possible duplicate; PCP must resolve it first"}`)
          .join("; ")
      : `No duplicate flags on linked faculty${pending ? `; ${pending} awaiting PCP verification` : ""}`,
  });

  const maxLoad = rule.maxTeacherLoad ?? 1;
  const over = counting
    .map((f) => {
      const elsewhere = f.appointedTo && f.appointedTo !== app.programType ? [`the ${PROGRAM_LABELS[f.appointedTo] ?? f.appointedTo} programme`] : [];
      return { f, also: [...elsewhere, ...f.otherCases] };
    })
    .filter((x) => 1 + x.also.length > maxLoad);
  checks.push({
    key: "load",
    label: "Teacher load",
    ok: over.length === 0,
    detail: over.length
      ? over.map(({ f, also }) => `${f.fullName} (${f.pcpId}) is also counted on ${also.join(" and ")}; permitted load is ${maxLoad} programme or open case`).join("; ")
      : `Every linked teacher is within the permitted load of ${maxLoad}`,
  });

  checks.push({ key: "labs", label: "Laboratory requirements", ok: Number(d.labs ?? 0) >= rule.minLabs, detail: `${d.labs ?? 0} labs; minimum ${rule.minLabs}` });
  checks.push({ key: "infrastructure", label: "Required infrastructure", ok: Number(d.classrooms ?? 0) >= rule.minClassrooms, detail: `${d.classrooms ?? 0} classrooms; minimum ${rule.minClassrooms}` });
  checks.push({ key: "library", label: "Library and resources", ok: Number(d.libraryBooks ?? 0) >= rule.minLibraryBooks, detail: `${d.libraryBooks ?? 0} books; minimum ${rule.minLibraryBooks}` });

  const docs = await db.selectDistinct({ docType: schema.documents.docType }).from(schema.documents).where(eq(schema.documents.applicationId, app.id));
  const have = new Set(docs.map((x) => x.docType));
  const reqDocs = requiredDocsFor(rule, app.kind);
  const missingDocs = reqDocs.filter((r) => !have.has(r));
  checks.push({ key: "documents", label: "Required documents uploaded", ok: missingDocs.length === 0, detail: missingDocs.length ? `Missing: ${missingDocs.join("; ")}` : `All ${reqDocs.length} uploaded` });

  if (accreditation) {
    const program = await db.query.programs.findFirst({ where: and(eq(schema.programs.institutionId, app.institutionId), eq(schema.programs.type, app.programType)) });
    checks.push({
      key: "noc",
      label: "Programme holds a NOC",
      ok: program?.nocStatus === "APPROVED",
      detail: program?.nocStatus === "APPROVED" ? `NOC ${program.nocNumber ?? ""}`.trim() : "Accreditation needs an approved NOC for this programme first",
    });
    const sa = app.selfAssessment ?? [];
    const unrated = SELF_ASSESSMENT_CRITERIA.filter((c) => !sa.some((x) => x.criterion === c && x.rating));
    const unexplained = sa.filter((x) => x.rating !== "MET" && !(x.comment ?? "").trim()).map((x) => x.criterion);
    checks.push({
      key: "self_assessment",
      label: "Self-assessment filed",
      ok: unrated.length === 0 && unexplained.length === 0,
      detail: unrated.length
        ? `${unrated.length} of ${SELF_ASSESSMENT_CRITERIA.length} criteria not rated yet`
        : unexplained.length
          ? `Add a comment for: ${unexplained.join("; ")}`
          : `All ${SELF_ASSESSMENT_CRITERIA.length} criteria rated`,
    });
    if (app.kind === "RENEWAL")
      checks.push({ key: "compliance", label: "Annual compliance confirmed", ok: !!d.complianceConfirmed, detail: d.complianceConfirmed ? "Confirmed by the institution" : "Confirm annual compliance for the current term" });
  }

  checks.push(await duesCheck(app.institutionId));
  checks.push(await regulatoryCheck(app, inst));

  return { checks, ruleVersion: version };
}

type AppRow = typeof schema.applications.$inferSelect;
type InstRow = typeof schema.institutions.$inferSelect | undefined;

async function duesCheck(institutionId: number): Promise<CheckResult> {
  const dues = await outstandingDues(db, institutionId);
  const owed = dues.reduce((a, x) => a + x.amount, 0);
  return {
    key: "dues",
    label: "No outstanding dues",
    ok: dues.length === 0,
    detail: dues.length ? `Rs ${owed.toLocaleString("en-PK")} outstanding: ${dues.map((x) => x.description).join("; ")}. Pay it under Payments and dues.` : "No dues outstanding",
  };
}

/** Regulatory bar: a rejection for the same programme in the last 12 months, unless an appeal against it was upheld. */
async function regulatoryCheck(app: AppRow, inst: InstRow): Promise<CheckResult> {
  const since = new Date(Date.now() - 365 * 86400000);
  const rejected = await db
    .select({ id: schema.applications.id, ref: schema.applications.ref, decidedAt: schema.applications.decidedAt })
    .from(schema.applications)
    .where(
      and(
        eq(schema.applications.institutionId, app.institutionId),
        eq(schema.applications.programType, app.programType),
        eq(schema.applications.field, app.field ?? ""),
        eq(schema.applications.status, "REJECTED"),
        ne(schema.applications.id, app.id),
        gte(schema.applications.decidedAt, since),
      ),
    );
  const upheld = rejected.length
    ? await db.select({ applicationId: schema.appeals.applicationId }).from(schema.appeals).where(and(inArray(schema.appeals.applicationId, rejected.map((r) => r.id)), eq(schema.appeals.status, "UPHELD")))
    : [];
  const bars = rejected.filter((r) => !upheld.some((u) => u.applicationId === r.id));
  const instOk = inst?.status === "ACTIVE";
  return {
    key: "regulatory",
    label: "No regulatory bar",
    ok: instOk && bars.length === 0,
    detail: !instOk
      ? `Institution status: ${inst?.status ?? "unknown"}`
      : bars.length
        ? `${bars.map((b) => b.ref).join(", ")} was rejected on ${bars[0].decidedAt?.toISOString().slice(0, 10)}; a new ${programmeName(app.programType, app.field)} case opens 12 months after a rejection unless an appeal is upheld`
        : "Institution active; no rejection in the last 12 months",
  };
}

const PG_FIELD_NAMES: Record<string, string> = {
  campus: "campus",
  proposedIntake: "annual intake",
  durationYears: "duration",
  courseworkCredits: "coursework credit hours",
  researchLabs: "research laboratories",
  libraryJournals: "journals",
  hecNocNumber: "HEC NOC number",
};

/**
 * The automatic checks of a postgraduate case (RFP 4.1.10), from the `pg.rules` rule: the PG proforma, the
 * supervisors linked by Faculty ID and their eligibility, PhD depth in the field, the HEC NOC, dues and bars.
 * Each failure names the item and the rule, e.g. "PhD Pharmacology: 1 eligible supervisor linked, 2 required for intake 6."
 */
async function runPgChecks(app: AppRow, inst: InstRow): Promise<{ checks: CheckResult[]; ruleVersion: number }> {
  const { value: rule, version } = await getPgRule();
  const r = pgTypeRule(rule, app.programType);
  const label = PROGRAM_LABELS[app.programType] ?? app.programType;
  const name = programmeName(app.programType, app.field);
  const d = app.data ?? {};
  const checks: CheckResult[] = [];
  const num = (v: unknown) => Number(v ?? 0);

  const missing = (Object.keys(PG_FIELD_NAMES) as (keyof typeof PG_FIELD_NAMES)[]).filter((k) =>
    k === "campus" ? !app.campusId : d[k as keyof typeof d] === undefined || d[k as keyof typeof d] === null || d[k as keyof typeof d] === "",
  );
  checks.push({
    key: "fields",
    label: "PG proforma completed",
    ok: missing.length === 0 && !!app.field,
    detail: !app.field ? "Pick the field of study" : missing.length ? `Missing: ${missing.map((k) => PG_FIELD_NAMES[k]).join(", ")}` : "Campus, intake, duration, coursework, research laboratories, journals and the HEC NOC number filled in",
  });

  const intake = num(d.proposedIntake);
  checks.push({ key: "intake", label: "Annual intake within limit", ok: intake > 0 && intake <= r.maxIntake, detail: `Proposed ${intake}; limit ${r.maxIntake} for ${aType(app.programType)} programme` });
  checks.push({ key: "duration", label: "Programme duration", ok: num(d.durationYears) >= r.minDurationYears, detail: `${num(d.durationYears)} years; minimum ${r.minDurationYears} for ${label}` });
  checks.push({ key: "coursework", label: "Coursework credit hours", ok: num(d.courseworkCredits) >= r.minCourseworkCredits, detail: `${num(d.courseworkCredits)} credit hours of coursework; minimum ${r.minCourseworkCredits} for ${label}` });
  checks.push({
    key: "thesis",
    label: "Thesis requirement",
    ok: !r.thesisRequired || !!d.thesisRequired,
    detail: r.thesisRequired ? (d.thesisRequired ? "A research thesis is part of the programme" : `${label} needs a research thesis; tick it on the proforma`) : "Thesis optional",
  });
  const labsOk = num(d.researchLabs) >= r.minResearchLabs;
  const equipOk = !!(d.equipment ?? "").trim();
  checks.push({
    key: "research_labs",
    label: "Research laboratories and equipment",
    ok: labsOk && equipOk,
    detail: !labsOk ? `${num(d.researchLabs)} research laboratories; minimum ${r.minResearchLabs} for ${label}` : equipOk ? `${num(d.researchLabs)} research laboratories; equipment listed` : "List the major research equipment",
  });
  const journalsOk = num(d.libraryJournals) >= r.minJournals;
  const hecOk = !r.hecDigitalLibrary || !!d.hecDigitalLibrary;
  checks.push({
    key: "pg_library",
    label: "Library and journal access",
    ok: journalsOk && hecOk,
    detail: !journalsOk ? `${num(d.libraryJournals)} journals; minimum ${r.minJournals} for ${label}` : hecOk ? `${num(d.libraryJournals)} journals${r.hecDigitalLibrary ? " and HEC Digital Library access" : ""}` : `${label} needs HEC Digital Library access`,
  });

  // Supervisors: only faculty linked to this case by Faculty ID count.
  const linked = (await caseFaculty(app.id, app.institutionId, app.programType)).filter((f) => f.subject === SUPERVISOR_SUBJECT);
  const active = linked.filter((f) => f.activeHere && !f.openFlag && f.verificationStatus !== "FLAGGED" && f.verificationStatus !== "REJECTED");
  const judged = active.map((f) => ({ f, e: supervisorEligibility(f, app.programType, r) }));
  const eligible = judged.filter((x) => x.e.eligible).length;
  const required = supervisorsRequired(r, intake);
  checks.push({
    key: "supervisors",
    label: "Eligible supervisors",
    ok: eligible >= required,
    detail: `${name}: ${eligible} eligible supervisor${eligible === 1 ? "" : "s"} linked, ${required} required for intake ${intake}.`,
  });
  const notEligible = judged.filter((x) => !x.e.eligible);
  checks.push({
    key: "supervisor_eligibility",
    label: "Supervisor eligibility",
    ok: linked.length > 0 && notEligible.length === 0,
    detail: !linked.length
      ? "No supervisors linked yet. Link each one by Faculty ID."
      : notEligible.length
        ? notEligible.map((x) => `${x.f.fullName} (${x.f.pcpId}) ${x.e.reasons.join("; ")}`).join(". ")
        : `Every linked supervisor meets the ${label} rule (${r.supervisorQualification}, ${r.minPublications} publications${r.hecApprovedCounts ? " or HEC-approved" : ""}, at most ${r.maxStudentsPerSupervisor} students each)`,
  });
  const phdInField = active.filter((f) => f.qualification === "PhD" && !!app.field && inField(rule, app.field, f.specialization)).length;
  checks.push({
    key: "phd_in_field",
    label: "PhD faculty in the field",
    ok: phdInField >= r.minPhdFacultyInField,
    detail: `${app.field || "Field"}: ${phdInField} PhD faculty linked, ${r.minPhdFacultyInField} required for ${aType(app.programType)} programme.`,
  });

  const badRecord = linked.filter((f) => !f.activeHere || f.openFlag || f.verificationStatus === "FLAGGED" || f.verificationStatus === "REJECTED");
  checks.push({
    key: "duplicates",
    label: "Supervisor records clear",
    ok: badRecord.length === 0,
    detail: badRecord.length
      ? badRecord.map((f) => `${f.fullName} (${f.pcpId}) ${!f.activeHere ? "is no longer active at your institution" : "is flagged as a possible duplicate; PCP must resolve it first"}`).join("; ")
      : "No duplicate flags on linked supervisors",
  });

  const docs = await db.selectDistinct({ docType: schema.documents.docType }).from(schema.documents).where(eq(schema.documents.applicationId, app.id));
  const have = new Set(docs.map((x) => x.docType));
  const reqDocs = r.requiredDocs;
  const missingDocs = reqDocs.filter((x) => !have.has(x));
  checks.push({ key: "documents", label: "Required documents uploaded", ok: missingDocs.length === 0, detail: missingDocs.length ? `Missing: ${missingDocs.join("; ")}` : `All ${reqDocs.length} uploaded, including the HEC NOC` });

  if (app.kind === "RENEWAL")
    checks.push({ key: "compliance", label: "Annual compliance confirmed", ok: !!d.complianceConfirmed, detail: d.complianceConfirmed ? "Confirmed by the institution" : "Confirm annual compliance for the current term" });

  checks.push(await duesCheck(app.institutionId));
  checks.push(await regulatoryCheck(app, inst));
  return { checks, ruleVersion: version };
}

export async function refreshChecks(ref: string) {
  const app = await db.query.applications.findFirst({ where: eq(schema.applications.ref, ref) });
  if (!app) return [];
  const { checks } = await runChecks(app.id);
  await db.update(schema.applications).set({ checks, updatedAt: new Date() }).where(eq(schema.applications.id, app.id));
  return checks;
}
