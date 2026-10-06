import { and, desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import VerificationView from "@/components/VerificationView";
import { db, schema } from "@/db";
import { maskCnic } from "@/lib/names";
import { can } from "@/lib/roles";
import { requireUser } from "@/lib/session";

export default async function VerificationPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const user = await requireUser("pcp");
  const canAct = can(user.roles, "pcp.faculty.verify");
  if (!canAct && !user.roles.includes("pcp_admin")) redirect("/home");

  const flags = await db.select().from(schema.duplicateFlags).where(eq(schema.duplicateFlags.status, "OPEN")).orderBy(desc(schema.duplicateFlags.score));
  const requests = await db.select().from(schema.facultyChangeRequests).orderBy(desc(schema.facultyChangeRequests.createdAt));
  const open = requests.filter((r) => r.status === "PENDING");
  const ids = [...new Set([...flags.flatMap((f) => [f.recordId, f.matchRecordId]), ...requests.map((r) => r.facultyId)])];
  const people = ids.length ? await db.select().from(schema.faculty).where(inArray(schema.faculty.id, ids)) : [];
  const links = ids.length
    ? await db
        .select({
          id: schema.facultyLinks.id,
          facultyId: schema.facultyLinks.facultyId,
          inst: schema.institutions.name,
          code: schema.institutions.shortCode,
          programType: schema.facultyLinks.programType,
          status: schema.facultyLinks.status,
          startDate: schema.facultyLinks.startDate,
          endDate: schema.facultyLinks.endDate,
        })
        .from(schema.facultyLinks)
        .innerJoin(schema.institutions, eq(schema.institutions.id, schema.facultyLinks.institutionId))
        .where(inArray(schema.facultyLinks.facultyId, ids))
    : [];
  const institutions = Object.fromEntries((await db.select({ id: schema.institutions.id, name: schema.institutions.name, code: schema.institutions.shortCode }).from(schema.institutions)).map((i) => [i.id, i]));
  const person = (id: number) => {
    const p = people.find((x) => x.id === id)!;
    const l = links.filter((x) => x.facultyId === id && x.status !== "WITHDRAWN");
    // The verification officer sees full CNICs; everyone else sees masked ones.
    return {
      id: p.id,
      pcpId: p.pcpId,
      fullName: p.fullName,
      fatherName: p.fatherName,
      cnic: canAct ? p.cnic : maskCnic(p.cnic),
      qualification: p.qualification,
      specialization: p.specialization,
      designation: p.designation,
      pcpRegNo: p.pcpRegNo,
      status: p.verificationStatus,
      institutions: l.map((x) => `${x.code} · ${x.programType} · ${x.status}`),
      appointments: l
        .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
        .map((x) => ({ inst: x.inst, code: x.code, programType: x.programType, status: x.status, startDate: x.startDate, endDate: x.endDate })),
    };
  };

  const pending = await db
    .select({ id: schema.faculty.id, pcpId: schema.faculty.pcpId, fullName: schema.faculty.fullName, qualification: schema.faculty.qualification, designation: schema.faculty.designation, inst: schema.institutions.shortCode, createdAt: schema.faculty.createdAt })
    .from(schema.faculty)
    .innerJoin(schema.facultyLinks, and(eq(schema.facultyLinks.facultyId, schema.faculty.id), eq(schema.facultyLinks.status, "ACTIVE")))
    .innerJoin(schema.institutions, eq(schema.institutions.id, schema.facultyLinks.institutionId))
    .where(eq(schema.faculty.verificationStatus, "PENDING"))
    .orderBy(desc(schema.faculty.createdAt));

  const request = (r: (typeof requests)[number]) => {
    const link = links.find((l) => l.id === r.linkId);
    const flagged = flags.some((f) => f.recordId === r.facultyId);
    return {
      id: r.id,
      ref: r.ref,
      kind: r.kind,
      status: r.status,
      changes: ((r.details as { changes?: Record<string, { from: string | null; to: string | null }> }).changes ?? {}) as Record<string, { from: string | null; to: string | null }>,
      category: ((r.details as { category?: string }).category ?? null) as string | null,
      reason: r.reason,
      requestedBy: r.requestedBy,
      createdAt: r.createdAt.toISOString(),
      decidedBy: r.decidedBy,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionNote: r.decisionNote,
      inst: institutions[r.institutionId]?.name ?? "",
      instCode: institutions[r.institutionId]?.code ?? "",
      programType: link?.programType ?? null,
      linkStatus: link?.status ?? null,
      flagged,
      person: person(r.facultyId),
    };
  };

  return (
    <VerificationView
      canAct={canAct}
      tab={tab ?? null}
      flags={flags.map((f) => ({ id: f.id, score: f.score, reason: f.reason, record: person(f.recordId), match: person(f.matchRecordId) }))}
      pending={pending.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() }))}
      linkRequests={open.filter((r) => r.kind === "NEW_LINK").map(request)}
      changeRequests={open.filter((r) => r.kind !== "NEW_LINK").map(request)}
      decided={requests.filter((r) => ["APPROVED", "REJECTED"].includes(r.status)).slice(0, 20).map(request)}
    />
  );
}
