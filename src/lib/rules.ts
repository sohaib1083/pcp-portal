import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CheckResult } from "@/db/schema";
import { outstandingDues } from "./payments";
import { CLOSED_STATUSES, PROGRAM_LABELS, SELF_ASSESSMENT_CRITERIA } from "./workflow";

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
  return value[`${kind}:${programType}`] ?? 0;
}

export function subjectRequirements(rule: ProgramRule, intake: number) {
  return (rule.subjects ?? []).map((s) => ({ name: s.name, required: Math.max(s.min, intake > 0 ? Math.ceil(intake / s.perIntake) : s.min) }));
}

export function requiredDocsFor(rule: ProgramRule, kind: string) {
  return kind === "NOC" ? rule.requiredDocs : (rule.accreditationDocs ?? ["Self-assessment evidence"]);
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

/** Faculty linked to a case, with whether each is still active at the institution and where they are appointed. */
export async function caseFaculty(applicationId: number, institutionId: number) {
  const rows = await db
    .select({
      facultyId: schema.applicationFaculty.facultyId,
      subject: schema.applicationFaculty.subject,
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
  const linked = await caseFaculty(app.id, app.institutionId);
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

  const dues = await outstandingDues(db, app.institutionId);
  const owed = dues.reduce((a, x) => a + x.amount, 0);
  checks.push({
    key: "dues",
    label: "No outstanding dues",
    ok: dues.length === 0,
    detail: dues.length ? `Rs ${owed.toLocaleString("en-PK")} outstanding: ${dues.map((x) => x.description).join("; ")}. Pay it under Payments and dues.` : "No dues outstanding",
  });

  // Regulatory bar: a rejection for the same programme in the last 12 months, unless an appeal against it was upheld.
  const since = new Date(Date.now() - 365 * 86400000);
  const rejected = await db
    .select({ id: schema.applications.id, ref: schema.applications.ref, decidedAt: schema.applications.decidedAt })
    .from(schema.applications)
    .where(
      and(
        eq(schema.applications.institutionId, app.institutionId),
        eq(schema.applications.programType, app.programType),
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
  checks.push({
    key: "regulatory",
    label: "No regulatory bar",
    ok: instOk && bars.length === 0,
    detail: !instOk
      ? `Institution status: ${inst?.status ?? "unknown"}`
      : bars.length
        ? `${bars.map((b) => b.ref).join(", ")} was rejected on ${bars[0].decidedAt?.toISOString().slice(0, 10)}; a new ${PROGRAM_LABELS[app.programType]} case opens 12 months after a rejection unless an appeal is upheld`
        : "Institution active; no rejection in the last 12 months",
  });

  return { checks, ruleVersion: version };
}

export async function refreshChecks(ref: string) {
  const app = await db.query.applications.findFirst({ where: eq(schema.applications.ref, ref) });
  if (!app) return [];
  const { checks } = await runChecks(app.id);
  await db.update(schema.applications).set({ checks, updatedAt: new Date() }).where(eq(schema.applications.id, app.id));
  return checks;
}
