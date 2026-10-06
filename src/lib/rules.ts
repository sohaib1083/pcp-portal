import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CheckResult } from "@/db/schema";

export type ProgramRule = {
  maxIntake: number;
  studentsPerFaculty: number;
  minPhdFaculty: number;
  minLabs: number;
  minClassrooms: number;
  minLibraryBooks: number;
  requiredDocs: string[];
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

/** The automatic checks from PCP's draft, driven by the versioned rules table. */
export async function runChecks(applicationId: number): Promise<{ checks: CheckResult[]; ruleVersion: number }> {
  const app = await db.query.applications.findFirst({ where: eq(schema.applications.id, applicationId) });
  if (!app) throw new Error("Application not found");
  const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, app.institutionId) });
  const { value: rule, version } = await getRule<ProgramRule>(`noc.${app.programType}`);
  const d = app.data ?? {};
  const checks: CheckResult[] = [];

  const missing = (["campus", "proposedIntake", "classrooms", "labs", "libraryBooks"] as const).filter(
    (k) => d[k] === undefined || d[k] === null || d[k] === "",
  );
  checks.push({
    key: "fields",
    label: "Required fields completed",
    ok: missing.length === 0,
    detail: missing.length ? `Missing: ${missing.join(", ")}` : "All required fields present",
  });

  const intake = Number(d.proposedIntake ?? 0);
  checks.push({
    key: "intake",
    label: "Student intake within limit",
    ok: intake > 0 && intake <= rule.maxIntake,
    detail: `Proposed ${intake}; limit ${rule.maxIntake}`,
  });

  const fac = await db
    .select({ id: schema.faculty.id, qualification: schema.faculty.qualification, status: schema.faculty.verificationStatus })
    .from(schema.facultyLinks)
    .innerJoin(schema.faculty, eq(schema.faculty.id, schema.facultyLinks.facultyId))
    .where(
      and(
        eq(schema.facultyLinks.institutionId, app.institutionId),
        eq(schema.facultyLinks.programType, app.programType),
        eq(schema.facultyLinks.status, "ACTIVE"),
      ),
    );
  const needed = Math.ceil(intake / rule.studentsPerFaculty) || 1;
  checks.push({
    key: "faculty_count",
    label: "Faculty count",
    ok: fac.length >= needed,
    detail: `${fac.length} active faculty linked; ${needed} needed (1 per ${rule.studentsPerFaculty} students)`,
  });

  const phd = fac.filter((f) => f.qualification === "PhD").length;
  checks.push({
    key: "faculty_qualification",
    label: "Faculty qualifications",
    ok: phd >= rule.minPhdFaculty,
    detail: `${phd} PhD faculty; minimum ${rule.minPhdFaculty}`,
  });

  const facIds = fac.map((f) => f.id);
  const openFlags = facIds.length
    ? await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.duplicateFlags)
        .where(and(eq(schema.duplicateFlags.status, "OPEN"), inArray(schema.duplicateFlags.recordId, facIds)))
    : [{ n: 0 }];
  const pending = fac.filter((f) => f.status === "PENDING").length;
  checks.push({
    key: "duplicates",
    label: "No duplicate faculty",
    ok: (openFlags[0]?.n ?? 0) === 0,
    detail:
      (openFlags[0]?.n ?? 0) > 0
        ? `${openFlags[0].n} faculty record(s) flagged as possible duplicates; PCP must resolve them`
        : `No open duplicate flags${pending ? `; ${pending} awaiting PCP verification` : ""}`,
  });

  checks.push({
    key: "labs",
    label: "Laboratory requirements",
    ok: Number(d.labs ?? 0) >= rule.minLabs,
    detail: `${d.labs ?? 0} labs; minimum ${rule.minLabs}`,
  });
  checks.push({
    key: "infrastructure",
    label: "Required infrastructure",
    ok: Number(d.classrooms ?? 0) >= rule.minClassrooms,
    detail: `${d.classrooms ?? 0} classrooms; minimum ${rule.minClassrooms}`,
  });
  checks.push({
    key: "library",
    label: "Library and resources",
    ok: Number(d.libraryBooks ?? 0) >= rule.minLibraryBooks,
    detail: `${d.libraryBooks ?? 0} books; minimum ${rule.minLibraryBooks}`,
  });

  const docs = await db
    .selectDistinct({ docType: schema.documents.docType })
    .from(schema.documents)
    .where(eq(schema.documents.applicationId, app.id));
  const have = new Set(docs.map((x) => x.docType));
  const missingDocs = rule.requiredDocs.filter((r) => !have.has(r));
  checks.push({
    key: "documents",
    label: "Required documents uploaded",
    ok: missingDocs.length === 0,
    detail: missingDocs.length ? `Missing: ${missingDocs.join("; ")}` : `All ${rule.requiredDocs.length} uploaded`,
  });

  checks.push({
    key: "regulatory",
    label: "Previous regulatory status",
    ok: inst?.status === "ACTIVE",
    detail: `Institution status: ${inst?.status ?? "unknown"}`,
  });

  return { checks, ruleVersion: version };
}

export async function refreshChecks(ref: string) {
  const app = await db.query.applications.findFirst({ where: eq(schema.applications.ref, ref) });
  if (!app) return;
  const { checks } = await runChecks(app.id);
  await db.update(schema.applications).set({ checks, updatedAt: new Date() }).where(eq(schema.applications.id, app.id));
}
