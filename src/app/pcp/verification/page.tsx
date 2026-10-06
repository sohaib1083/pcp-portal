import { and, desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import VerificationView from "@/components/VerificationView";
import { db, schema } from "@/db";
import { maskCnic } from "@/lib/names";
import { requireUser } from "@/lib/session";

export default async function VerificationPage() {
  const user = await requireUser("pcp");
  const canAct = user.roles.includes("pcp_officer");
  if (!canAct && !user.roles.includes("pcp_admin")) redirect("/home");

  const flags = await db.select().from(schema.duplicateFlags).where(eq(schema.duplicateFlags.status, "OPEN")).orderBy(desc(schema.duplicateFlags.score));
  const ids = [...new Set(flags.flatMap((f) => [f.recordId, f.matchRecordId]))];
  const people = ids.length ? await db.select().from(schema.faculty).where(inArray(schema.faculty.id, ids)) : [];
  const links = ids.length
    ? await db
        .select({ facultyId: schema.facultyLinks.facultyId, inst: schema.institutions.name, code: schema.institutions.shortCode, programType: schema.facultyLinks.programType, status: schema.facultyLinks.status })
        .from(schema.facultyLinks)
        .innerJoin(schema.institutions, eq(schema.institutions.id, schema.facultyLinks.institutionId))
        .where(inArray(schema.facultyLinks.facultyId, ids))
    : [];
  const person = (id: number) => {
    const p = people.find((x) => x.id === id)!;
    const l = links.filter((x) => x.facultyId === id);
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
      status: p.verificationStatus,
      institutions: l.map((x) => `${x.code} · ${x.programType} · ${x.status}`),
    };
  };

  const pending = await db
    .select({ id: schema.faculty.id, pcpId: schema.faculty.pcpId, fullName: schema.faculty.fullName, qualification: schema.faculty.qualification, designation: schema.faculty.designation, inst: schema.institutions.shortCode, createdAt: schema.faculty.createdAt })
    .from(schema.faculty)
    .innerJoin(schema.facultyLinks, and(eq(schema.facultyLinks.facultyId, schema.faculty.id), eq(schema.facultyLinks.status, "ACTIVE")))
    .innerJoin(schema.institutions, eq(schema.institutions.id, schema.facultyLinks.institutionId))
    .where(eq(schema.faculty.verificationStatus, "PENDING"))
    .orderBy(desc(schema.faculty.createdAt));

  return (
    <VerificationView
      canAct={canAct}
      flags={flags.map((f) => ({ id: f.id, score: f.score, reason: f.reason, record: person(f.recordId), match: person(f.matchRecordId) }))}
      pending={pending.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() }))}
    />
  );
}
