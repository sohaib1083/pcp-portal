import { desc, eq, inArray } from "drizzle-orm";
import FacultySelfView, { FacultyNotLinked } from "@/components/FacultySelfView";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { maskCnic } from "@/lib/names";
import { facultyForUser } from "@/lib/people";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** A teacher's own record (RFP 4.1.2, 4.1.11): Faculty ID, qualifications, verification, institutional links and requests. */
export default async function FacultyPage() {
  const user = await requireUser("faculty");
  const p = await facultyForUser(user.username);
  if (!p) return <FacultyNotLinked name={user.name} />;
  const [links, requests, fcrs, insts, progs] = await Promise.all([
    db
      .select({ l: schema.facultyLinks, inst: { code: schema.institutions.code, shortCode: schema.institutions.shortCode, name: schema.institutions.name, city: schema.institutions.city } })
      .from(schema.facultyLinks)
      .innerJoin(schema.institutions, eq(schema.institutions.id, schema.facultyLinks.institutionId))
      .where(eq(schema.facultyLinks.facultyId, p.id))
      .orderBy(desc(schema.facultyLinks.startDate), desc(schema.facultyLinks.id)),
    db.select().from(schema.facultyRequests).where(eq(schema.facultyRequests.facultyId, p.id)).orderBy(desc(schema.facultyRequests.createdAt)),
    db
      .select({ r: schema.facultyChangeRequests, inst: { shortCode: schema.institutions.shortCode, name: schema.institutions.name } })
      .from(schema.facultyChangeRequests)
      .innerJoin(schema.institutions, eq(schema.institutions.id, schema.facultyChangeRequests.institutionId))
      .where(eq(schema.facultyChangeRequests.facultyId, p.id))
      .orderBy(desc(schema.facultyChangeRequests.createdAt)),
    db.select({ id: schema.institutions.id, code: schema.institutions.code, shortCode: schema.institutions.shortCode, name: schema.institutions.name, city: schema.institutions.city, status: schema.institutions.status }).from(schema.institutions).orderBy(schema.institutions.name),
    db.select({ institutionId: schema.programs.institutionId, type: schema.programs.type }).from(schema.programs),
  ]);
  const docIds = requests.map((r) => r.evidenceDocumentId).filter((x): x is number => !!x);
  const docs = docIds.length ? await db.select({ id: schema.documents.id, fileName: schema.documents.fileName }).from(schema.documents).where(inArray(schema.documents.id, docIds)) : [];
  await audit(db, { actor: user.username, action: "faculty.self.viewed", entity: "faculty", entityId: p.pcpId });
  const fcrByRef = new Map(fcrs.map((f) => [f.r.ref, f.r]));
  return (
    <FacultySelfView
      me={{ pcpId: p.pcpId, fullName: p.fullName, fatherName: p.fatherName, cnic: maskCnic(p.cnic), qualification: p.qualification, specialization: p.specialization, designation: p.designation, pcpRegNo: p.pcpRegNo, verificationStatus: p.verificationStatus }}
      links={links.map(({ l, inst }) => ({ id: l.id, inst, programType: l.programType, status: l.status, startDate: l.startDate, endDate: l.endDate }))}
      requests={requests.map((r) => {
        const fcr = r.details.fcrRef ? fcrByRef.get(r.details.fcrRef) : undefined;
        return {
          id: r.id,
          ref: r.ref,
          kind: r.kind,
          status: r.kind === "ATTACHMENT" ? (fcr?.status ?? "PENDING") : r.status,
          details: r.details,
          note: r.note,
          createdAt: r.createdAt.toISOString(),
          decidedBy: r.kind === "ATTACHMENT" ? (fcr?.decidedBy ?? null) : r.decidedBy,
          decidedAt: (r.kind === "ATTACHMENT" ? fcr?.decidedAt : r.decidedAt)?.toISOString() ?? null,
          decisionNote: r.kind === "ATTACHMENT" ? (fcr?.decisionNote ?? null) : r.decisionNote,
          evidence: r.evidenceDocumentId ? { id: r.evidenceDocumentId, fileName: docs.find((d) => d.id === r.evidenceDocumentId)?.fileName ?? "evidence" } : null,
        };
      })}
      registry={fcrs
        .filter((f) => !(f.r.details as { declaredBy?: string }).declaredBy)
        .map(({ r, inst }) => ({ id: r.id, ref: r.ref, kind: r.kind, status: r.status, inst: inst.name, reason: r.reason, changes: ((r.details as { changes?: Record<string, { from: string | null; to: string | null }> }).changes ?? {}), createdAt: r.createdAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null, decisionNote: r.decisionNote }))}
      institutions={insts.filter((i) => i.status === "ACTIVE").map((i) => ({ code: i.code, shortCode: i.shortCode, name: i.name, city: i.city, programmes: progs.filter((x) => x.institutionId === i.id).map((x) => x.type) }))}
    />
  );
}
