import { and, desc, eq, inArray, ne } from "drizzle-orm";
import FacultyView from "@/components/FacultyView";
import { db, schema } from "@/db";
import { latestIdentity } from "@/lib/identity";
import { maskCnic } from "@/lib/names";
import { isVerifiedLink, thisYear } from "@/lib/registry";
import { facultyUpdateDue } from "@/lib/registry-shared";
import { can } from "@/lib/roles";
import { requireInstitution } from "@/lib/session";

const ORDER: Record<string, number> = { REQUESTED: 0, ACTIVE: 1, ENDED: 2, DECLINED: 3, WITHDRAWN: 4 };

export default async function FacultyPage() {
  const { user, inst } = await requireInstitution("inst.faculty.view");
  const rows = await db
    .select({
      linkId: schema.facultyLinks.id,
      facultyId: schema.faculty.id,
      programType: schema.facultyLinks.programType,
      linkStatus: schema.facultyLinks.status,
      startDate: schema.facultyLinks.startDate,
      endDate: schema.facultyLinks.endDate,
      pcpId: schema.faculty.pcpId,
      cnic: schema.faculty.cnic,
      fullName: schema.faculty.fullName,
      fatherName: schema.faculty.fatherName,
      qualification: schema.faculty.qualification,
      specialization: schema.faculty.specialization,
      designation: schema.faculty.designation,
      pcpRegNo: schema.faculty.pcpRegNo,
      verificationStatus: schema.faculty.verificationStatus,
    })
    .from(schema.facultyLinks)
    .innerJoin(schema.faculty, eq(schema.faculty.id, schema.facultyLinks.facultyId))
    .where(eq(schema.facultyLinks.institutionId, inst.id))
    .orderBy(desc(schema.facultyLinks.id));
  rows.sort((a, b) => (ORDER[a.linkStatus] ?? 9) - (ORDER[b.linkStatus] ?? 9));

  const facultyIds = [...new Set(rows.map((r) => r.facultyId))];
  // Change history raised by this institution; appointments elsewhere are shown without naming the institution.
  const history = await db.select().from(schema.facultyChangeRequests).where(eq(schema.facultyChangeRequests.institutionId, inst.id)).orderBy(desc(schema.facultyChangeRequests.createdAt));
  const elsewhere = facultyIds.length
    ? await db
        .select({ facultyId: schema.facultyLinks.facultyId, status: schema.facultyLinks.status, startDate: schema.facultyLinks.startDate, endDate: schema.facultyLinks.endDate })
        .from(schema.facultyLinks)
        .where(and(inArray(schema.facultyLinks.facultyId, facultyIds), ne(schema.facultyLinks.institutionId, inst.id), inArray(schema.facultyLinks.status, ["ACTIVE", "ENDED"])))
    : [];
  const programmes = (await db.select({ type: schema.programs.type }).from(schema.programs).where(eq(schema.programs.institutionId, inst.id))).map((p) => p.type);
  const confirmations = await db
    .select()
    .from(schema.facultyAnnualConfirmations)
    .where(eq(schema.facultyAnnualConfirmations.institutionId, inst.id))
    .orderBy(desc(schema.facultyAnnualConfirmations.year));
  const year = thisYear();
  const current = confirmations.find((c) => c.year === year);
  const nadra = await latestIdentity("faculty", facultyIds);

  return (
    <FacultyView
      canEdit={can(user.roles, "inst.faculty.edit")}
      canConfirm={can(user.roles, "inst.app.submit")}
      programmes={programmes}
      rows={rows.map((r) => {
        const pending = history.find((h) => h.linkId === r.linkId && h.status === "PENDING");
        return {
          ...r,
          cnic: maskCnic(r.cnic),
          verified: isVerifiedLink({ status: r.linkStatus }, r),
          pendingChange: pending ? { ref: pending.ref, kind: pending.kind } : null,
          nadra: nadra[r.facultyId] ?? null,
        };
      })}
      history={history
        .filter((h) => facultyIds.includes(h.facultyId))
        .map((h) => ({
          id: h.id,
          facultyId: h.facultyId,
          ref: h.ref,
          kind: h.kind,
          status: h.status,
          changes: ((h.details as { changes?: Record<string, { from: string | null; to: string | null }> }).changes ?? {}) as Record<string, { from: string | null; to: string | null }>,
          category: ((h.details as { category?: string }).category ?? null) as string | null,
          reason: h.reason,
          requestedBy: h.requestedBy,
          createdAt: h.createdAt.toISOString(),
          decidedBy: h.decidedBy,
          decidedAt: h.decidedAt?.toISOString() ?? null,
          decisionNote: h.decisionNote,
        }))}
      elsewhere={elsewhere}
      annual={{
        year,
        due: facultyUpdateDue(year),
        confirmed: current ? { by: current.confirmedBy, at: current.confirmedAt.toISOString(), activeCount: current.activeCount, note: current.note } : null,
        previous: confirmations.filter((c) => c.year !== year).map((c) => ({ year: c.year, by: c.confirmedBy, at: c.confirmedAt.toISOString(), activeCount: c.activeCount })),
      }}
    />
  );
}
