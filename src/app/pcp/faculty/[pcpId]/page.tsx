import { notFound, redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import FacultyRecordView from "@/components/FacultyRecordView";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { maskCnic } from "@/lib/names";
import { facultyRequestRows } from "@/lib/people-data";
import { can } from "@/lib/roles";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** One faculty record as PCP's verification desk sees it, with the teacher's own login (RFP 4.1.2, 4.1.11). */
export default async function Page({ params }: { params: Promise<{ pcpId: string }> }) {
  const user = await requireUser("pcp");
  const canAct = can(user.roles, "pcp.faculty.verify");
  if (!canAct && !user.roles.includes("pcp_admin")) redirect("/home");
  const raw = decodeURIComponent((await params).pcpId).trim().toUpperCase();
  const digits = raw.replace(/\D/g, "");
  const pcpId = /^(PCP-)?FAC-?\d{1,6}$/.test(raw) || /^\d{1,6}$/.test(raw) ? `PCP-FAC-${digits.padStart(6, "0")}` : raw;
  if (pcpId !== raw) redirect(`/pcp/faculty/${pcpId}`);
  const p = await db.query.faculty.findFirst({ where: eq(schema.faculty.pcpId, pcpId) });
  if (!p) notFound();
  const [links, fcrs, account, requests] = await Promise.all([
    db
      .select({ l: schema.facultyLinks, inst: { code: schema.institutions.code, name: schema.institutions.name, shortCode: schema.institutions.shortCode } })
      .from(schema.facultyLinks)
      .innerJoin(schema.institutions, eq(schema.institutions.id, schema.facultyLinks.institutionId))
      .where(eq(schema.facultyLinks.facultyId, p.id))
      .orderBy(desc(schema.facultyLinks.startDate)),
    db
      .select({ r: schema.facultyChangeRequests, inst: schema.institutions.shortCode })
      .from(schema.facultyChangeRequests)
      .innerJoin(schema.institutions, eq(schema.institutions.id, schema.facultyChangeRequests.institutionId))
      .where(eq(schema.facultyChangeRequests.facultyId, p.id))
      .orderBy(desc(schema.facultyChangeRequests.createdAt)),
    db.query.facultyAccounts.findFirst({ where: eq(schema.facultyAccounts.facultyId, p.id) }),
    facultyRequestRows({ facultyId: p.id }),
  ]);
  await audit(db, { actor: user.username, action: "faculty.viewed", entity: "faculty", entityId: p.pcpId, details: { cnicShown: canAct } });
  return (
    <FacultyRecordView
      canAct={canAct}
      p={{ id: p.id, pcpId: p.pcpId, fullName: p.fullName, fatherName: p.fatherName, cnic: canAct ? p.cnic : maskCnic(p.cnic), qualification: p.qualification, specialization: p.specialization, designation: p.designation, pcpRegNo: p.pcpRegNo, verificationStatus: p.verificationStatus }}
      links={links.map(({ l, inst }) => ({ id: l.id, inst, programType: l.programType, status: l.status, startDate: l.startDate, endDate: l.endDate }))}
      changes={fcrs.map(({ r, inst }) => ({ id: r.id, ref: r.ref, kind: r.kind, status: r.status, inst, requestedBy: r.requestedBy, declaredByTeacher: (r.details as { declaredBy?: string }).declaredBy === "faculty", changes: ((r.details as { changes?: Record<string, { from: string | null; to: string | null }> }).changes ?? {}), createdAt: r.createdAt.toISOString(), decisionNote: r.decisionNote }))}
      account={account ? { username: account.username, createdBy: account.createdBy, createdAt: account.createdAt.toISOString() } : null}
      requests={requests}
    />
  );
}
