// Read models for the request queues (institution Students page, PCP Data verification).
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { FacultyRequestRow, StudentRequestRow } from "@/components/PeopleQueues";

/** Student requests, newest first; for an institution user pass its id so only its own students are returned. */
export async function studentRequestRows(o: { institutionId?: number; limit?: number } = {}): Promise<StudentRequestRow[]> {
  const conds: SQL[] = [];
  if (o.institutionId) conds.push(eq(schema.studentRequests.institutionId, o.institutionId));
  const rows = await db
    .select({ r: schema.studentRequests, s: schema.students, inst: { shortCode: schema.institutions.shortCode, name: schema.institutions.name } })
    .from(schema.studentRequests)
    .innerJoin(schema.students, eq(schema.students.id, schema.studentRequests.studentId))
    .innerJoin(schema.institutions, eq(schema.institutions.id, schema.studentRequests.institutionId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.studentRequests.updatedAt))
    .limit(o.limit ?? 200);
  return rows.map(({ r, s, inst }) => ({
    id: r.id,
    ref: r.ref,
    kind: r.kind,
    status: r.status,
    details: r.details,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
    student: { pcpId: s.pcpId, fullName: s.fullName, fatherName: s.fatherName, status: s.status, degreeVerified: s.degreeVerified, programType: s.programType, shift: s.shift, enrollmentYear: s.enrollmentYear, currentYear: s.currentYear, resultYear: s.resultYear },
    inst,
    evidenceDocumentId: r.evidenceDocumentId,
    institutionBy: r.institutionBy,
    institutionAt: r.institutionAt?.toISOString() ?? null,
    institutionNote: r.institutionNote,
    pcpBy: r.pcpBy,
    pcpAt: r.pcpAt?.toISOString() ?? null,
    pcpNote: r.pcpNote,
    certificateNo: r.certificateNo,
    certificateDocumentId: r.certificateDocumentId,
  }));
}

/** Teachers' own profile updates and verification requests (attachment declarations live in the registry's change requests). */
export async function facultyRequestRows(o: { facultyId?: number } = {}): Promise<FacultyRequestRow[]> {
  const rows = await db
    .select({ r: schema.facultyRequests, f: schema.faculty })
    .from(schema.facultyRequests)
    .innerJoin(schema.faculty, eq(schema.faculty.id, schema.facultyRequests.facultyId))
    .where(and(inArray(schema.facultyRequests.kind, ["PROFILE", "VERIFICATION"]), ...(o.facultyId ? [eq(schema.facultyRequests.facultyId, o.facultyId)] : [])))
    .orderBy(desc(schema.facultyRequests.createdAt))
    .limit(200);
  const ids = [...new Set(rows.map((x) => x.f.id))].concat(-1);
  const active = await db
    .select({ facultyId: schema.facultyLinks.facultyId, name: schema.institutions.name })
    .from(schema.facultyLinks)
    .innerJoin(schema.institutions, eq(schema.institutions.id, schema.facultyLinks.institutionId))
    .where(and(inArray(schema.facultyLinks.facultyId, ids), eq(schema.facultyLinks.status, "ACTIVE")));
  const docIds = rows.map((x) => x.r.evidenceDocumentId).filter((x): x is number => !!x).concat(-1);
  const docs = await db.select({ id: schema.documents.id, fileName: schema.documents.fileName }).from(schema.documents).where(inArray(schema.documents.id, docIds));
  return rows.map(({ r, f }) => ({
    id: r.id,
    ref: r.ref,
    kind: r.kind,
    status: r.status,
    details: r.details,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    requestedBy: r.requestedBy,
    person: { pcpId: f.pcpId, fullName: f.fullName, fatherName: f.fatherName, qualification: f.qualification, specialization: f.specialization, designation: f.designation, pcpRegNo: f.pcpRegNo, verificationStatus: f.verificationStatus, currentInst: active.find((a) => a.facultyId === f.id)?.name ?? null },
    evidence: r.evidenceDocumentId ? { id: r.evidenceDocumentId, fileName: docs.find((d) => d.id === r.evidenceDocumentId)?.fileName ?? "evidence" } : null,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
  }));
}
