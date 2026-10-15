// Read models for the /province pages. Every function takes the officer's province (from requireProvince) and
// returns plain data for one province only.
import { and, asc, desc, eq, ilike, inArray, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { maskCnic } from "./names";

type Inst = typeof schema.institutions.$inferSelect;

export async function provinceInstitutions(province: string) {
  return db.select().from(schema.institutions).where(eq(schema.institutions.province, province)).orderBy(asc(schema.institutions.name));
}

const n = sql<number>`count(*)::int`;

/** One row per institution: programmes, students on roll, active faculty, open cases and outstanding deficiencies. */
export async function institutionRows(insts: Inst[]) {
  const ids = insts.map((i) => i.id).concat(-1);
  const [progs, students, faculty, defs, cases] = await Promise.all([
    db.select().from(schema.programs).where(inArray(schema.programs.institutionId, ids)),
    db
      .select({ inst: schema.students.institutionId, n })
      .from(schema.students)
      .where(and(inArray(schema.students.institutionId, ids), notInArray(schema.students.status, ["GRADUATED", "WITHDRAWN"])))
      .groupBy(schema.students.institutionId),
    db
      .select({ inst: schema.facultyLinks.institutionId, n })
      .from(schema.facultyLinks)
      .where(and(inArray(schema.facultyLinks.institutionId, ids), eq(schema.facultyLinks.status, "ACTIVE")))
      .groupBy(schema.facultyLinks.institutionId),
    db
      .select({ inst: schema.deficiencies.institutionId, n })
      .from(schema.deficiencies)
      .where(and(inArray(schema.deficiencies.institutionId, ids), inArray(schema.deficiencies.status, ["OUTSTANDING", "REJECTED"])))
      .groupBy(schema.deficiencies.institutionId),
    db
      .select({ inst: schema.applications.institutionId, n })
      .from(schema.applications)
      .where(and(inArray(schema.applications.institutionId, ids), notInArray(schema.applications.status, ["DRAFT", "NOC_ISSUED", "REJECTED", "WITHDRAWN"])))
      .groupBy(schema.applications.institutionId),
  ]);
  const count = (xs: { inst: number; n: number }[], id: number) => xs.find((x) => x.inst === id)?.n ?? 0;
  return insts.map((i) => ({
    id: i.id,
    code: i.code,
    shortCode: i.shortCode,
    name: i.name,
    city: i.city,
    sector: i.sector,
    status: i.status,
    programmes: progs
      .filter((p) => p.institutionId === i.id)
      .sort((a, b) => a.type.localeCompare(b.type))
      .map((p) => ({ type: p.type, nocStatus: p.nocStatus, accreditationStatus: p.accreditationStatus, validUntil: p.accreditationValidUntil, intake: p.approvedIntake })),
    students: count(students, i.id),
    faculty: count(faculty, i.id),
    deficiencies: count(defs, i.id),
    openCases: count(cases, i.id),
  }));
}

export type ProvinceInstitutionRow = Awaited<ReturnType<typeof institutionRows>>[number];

/** Inspections at institutions in the province, newest first. */
export async function provinceInspectionRows(province: string) {
  const rows = await db
    .select({ i: schema.inspections, inst: { code: schema.institutions.code, shortCode: schema.institutions.shortCode, name: schema.institutions.name, city: schema.institutions.city }, app: { ref: schema.applications.ref, kind: schema.applications.kind, programType: schema.applications.programType } })
    .from(schema.inspections)
    .innerJoin(schema.institutions, eq(schema.institutions.id, schema.inspections.institutionId))
    .innerJoin(schema.applications, eq(schema.applications.id, schema.inspections.applicationId))
    .where(eq(schema.institutions.province, province))
    .orderBy(desc(schema.inspections.scheduledFor));
  return rows.map(({ i, inst, app }) => {
    const items = i.checklist ?? [];
    return {
      id: i.id,
      scheduledFor: i.scheduledFor,
      status: i.status,
      scope: i.scope,
      lead: i.inspector,
      submittedAt: i.submittedAt?.toISOString() ?? null,
      inst,
      app,
      compliant: items.filter((x) => x.result === "COMPLIANT").length,
      partial: items.filter((x) => x.result === "PARTIAL").length,
      nonCompliant: items.filter((x) => x.result === "NON_COMPLIANT").length,
      items: items.length,
    };
  });
}

/** Deficiencies at institutions in the province: outstanding first. */
export async function provinceDeficiencyRows(province: string) {
  const rows = await db
    .select({ d: schema.deficiencies, inst: { code: schema.institutions.code, shortCode: schema.institutions.shortCode, name: schema.institutions.name }, ref: schema.applications.ref })
    .from(schema.deficiencies)
    .innerJoin(schema.institutions, eq(schema.institutions.id, schema.deficiencies.institutionId))
    .innerJoin(schema.applications, eq(schema.applications.id, schema.deficiencies.applicationId))
    .where(eq(schema.institutions.province, province))
    .orderBy(asc(schema.deficiencies.dueDate));
  const order = (s: string) => (["OUTSTANDING", "REJECTED"].includes(s) ? 0 : s === "RESPONDED" ? 1 : 2);
  return rows
    .map(({ d, inst, ref }) => ({ id: d.id, ref: d.ref, caseRef: ref, criterion: d.criterion, requiredAction: d.requiredAction, dueDate: d.dueDate, status: d.status, inst }))
    .sort((a, b) => order(a.status) - order(b.status) || a.dueDate.localeCompare(b.dueDate));
}

/** The council's register (PCP's index of it), one page at a time. */
export async function councilRegister(council: string, f: { q?: string; status?: string; page: number }, pageSize = 20) {
  const P = schema.pharmacists;
  const conds: SQL[] = [eq(P.council, council)];
  const q = (f.q ?? "").trim();
  if (q) conds.push(or(ilike(P.fullName, `%${q}%`), ilike(P.regNo, `%${q}%`), ilike(P.university, `%${q}%`))!);
  if (f.status && ["ACTIVE", "DORMANT", "SUSPENDED", "CANCELLED"].includes(f.status)) conds.push(eq(P.status, f.status));
  const where = and(...conds);
  const [[{ total }], rows, byStatus] = await Promise.all([
    db.select({ total: n }).from(P).where(where),
    db
      .select({ id: P.id, regNo: P.regNo, fullName: P.fullName, category: P.category, status: P.status, validUntil: P.validUntil, university: P.university, practiceConfirmed: P.practiceConfirmed, practicePlace: P.practicePlace, designation: P.designation })
      .from(P)
      .where(where)
      .orderBy(asc(P.fullName), asc(P.regNo))
      .limit(pageSize)
      .offset((Math.max(1, f.page) - 1) * pageSize),
    db.select({ status: P.status, n }).from(P).where(eq(P.council, council)).groupBy(P.status),
  ]);
  return {
    total,
    pageSize,
    rows: rows.map((r) => ({ ...r, practicePlace: r.practiceConfirmed ? r.practicePlace : null, designation: r.practiceConfirmed ? r.designation : null })),
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s.n])) as Record<string, number>,
  };
}

/** Practice updates waiting for the council's validation, and the latest ones it decided with PCP's outcome. */
export async function validationQueue(council: string) {
  const P = schema.pharmacists;
  const U = schema.practiceUpdates;
  const waiting = await db
    .select({ u: U, p: { id: P.id, regNo: P.regNo, fullName: P.fullName, status: P.status, practicePlace: P.practicePlace, designation: P.designation, practiceConfirmed: P.practiceConfirmed }, doc: { id: schema.documents.id, fileName: schema.documents.fileName } })
    .from(U)
    .innerJoin(P, eq(P.id, U.pharmacistId))
    .leftJoin(schema.documents, eq(schema.documents.id, U.evidenceDocumentId))
    .where(and(eq(U.status, "WITH_COUNCIL"), eq(P.council, council)))
    .orderBy(asc(U.submittedAt));
  const decided = await db
    .select({ v: schema.provincialValidations, u: U, p: { id: P.id, regNo: P.regNo, fullName: P.fullName } })
    .from(schema.provincialValidations)
    .innerJoin(U, eq(U.id, schema.provincialValidations.entityId))
    .innerJoin(P, eq(P.id, U.pharmacistId))
    .where(and(eq(schema.provincialValidations.entity, "PRACTICE_UPDATE"), eq(schema.provincialValidations.council, council)))
    .orderBy(desc(schema.provincialValidations.decidedAt))
    .limit(15);
  return {
    waiting: waiting.map(({ u, p, doc }) => ({
      id: u.id,
      practicePlace: u.practicePlace,
      designation: u.designation,
      submittedAt: u.submittedAt.toISOString(),
      evidence: doc?.id ? { id: doc.id, fileName: doc.fileName ?? "evidence" } : null,
      pharmacist: { id: p.id, regNo: p.regNo, fullName: p.fullName, status: p.status, current: p.practiceConfirmed ? `${p.designation}, ${p.practicePlace}` : null },
    })),
    decided: decided.map(({ v, u, p }) => ({
      id: v.id,
      decision: v.status,
      note: v.note,
      decidedBy: v.decidedBy,
      decidedAt: v.decidedAt.toISOString(),
      practicePlace: u.practicePlace,
      designation: u.designation,
      pcpStatus: u.status,
      pcpNote: v.status === "VALIDATED" ? u.reviewNote : null,
      pharmacist: p,
    })),
  };
}

export async function councilFileRows(council: string) {
  const rows = await db.select().from(schema.councilFiles).where(eq(schema.councilFiles.council, council)).orderBy(desc(schema.councilFiles.submittedAt)).limit(30);
  return rows.map((f) => ({ id: f.id, ref: f.ref, fileName: f.fileName, totalRows: f.totalRows, readyRows: f.readyRows, errorRows: f.errorRows, note: f.note, status: f.status, submittedBy: f.submittedBy, submittedAt: f.submittedAt.toISOString(), decidedBy: f.decidedBy, decidedAt: f.decidedAt?.toISOString() ?? null, decisionNote: f.decisionNote, importRef: f.importRef }));
}

/** One register entry as the council sees it: CNIC masked; history and every update with both decisions. */
export async function councilPharmacistRecord(p: typeof schema.pharmacists.$inferSelect) {
  const [events, updates, validations, imp] = await Promise.all([
    db.select().from(schema.pharmacistEvents).where(eq(schema.pharmacistEvents.pharmacistId, p.id)).orderBy(desc(schema.pharmacistEvents.createdAt), desc(schema.pharmacistEvents.id)),
    db.select().from(schema.practiceUpdates).where(eq(schema.practiceUpdates.pharmacistId, p.id)).orderBy(desc(schema.practiceUpdates.submittedAt)),
    db.select().from(schema.provincialValidations).where(eq(schema.provincialValidations.entity, "PRACTICE_UPDATE")),
    p.importId ? db.query.pharmacistImports.findFirst({ where: eq(schema.pharmacistImports.id, p.importId) }) : null,
  ]);
  return {
    p: {
      id: p.id,
      regNo: p.regNo,
      fullName: p.fullName,
      fatherName: p.fatherName,
      cnic: maskCnic(p.cnic),
      university: p.university,
      graduationYear: p.graduationYear,
      category: p.category,
      council: p.council,
      issueDate: p.issueDate,
      validUntil: p.validUntil,
      status: p.status,
      practicePlace: p.practiceConfirmed ? p.practicePlace : null,
      designation: p.practiceConfirmed ? p.designation : null,
      practiceConfirmedAt: p.practiceConfirmedAt?.toISOString() ?? null,
      hasLogin: !!p.username,
    },
    imported: imp ? { ref: imp.ref, fileName: imp.fileName, createdAt: imp.createdAt.toISOString() } : null,
    events: events.map((e) => ({ id: e.id, kind: e.kind, fromStatus: e.fromStatus, toStatus: e.toStatus, note: e.note, actor: e.actor, createdAt: e.createdAt.toISOString() })),
    updates: updates.map((u) => {
      const v = validations.find((x) => x.entityId === u.id);
      return {
        id: u.id,
        practicePlace: u.practicePlace,
        designation: u.designation,
        status: u.status,
        submittedAt: u.submittedAt.toISOString(),
        council: v ? { decision: v.status, by: v.decidedBy, at: v.decidedAt.toISOString(), note: v.note } : null,
        reviewedBy: u.reviewedBy,
        reviewedAt: u.reviewedAt?.toISOString() ?? null,
        reviewNote: u.reviewNote,
      };
    }),
  };
}
