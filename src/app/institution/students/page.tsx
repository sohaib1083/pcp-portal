import { and, desc, eq, sql } from "drizzle-orm";
import StudentsView from "@/components/StudentsView";
import { db, schema } from "@/db";
import { maskCnic } from "@/lib/names";
import { lockedYears } from "@/lib/registry";
import { can } from "@/lib/roles";
import { requireInstitution } from "@/lib/session";

export default async function StudentsPage() {
  const { user, inst } = await requireInstitution("inst.students.view");
  const rows = await db
    .select()
    .from(schema.students)
    .where(eq(schema.students.institutionId, inst.id))
    .orderBy(desc(schema.students.enrollmentYear), desc(schema.students.id));
  const byYear = await db
    .select({ year: schema.students.enrollmentYear, type: schema.students.programType, n: sql<number>`count(*)::int` })
    .from(schema.students)
    .where(and(eq(schema.students.institutionId, inst.id)))
    .groupBy(schema.students.enrollmentYear, schema.students.programType)
    .orderBy(schema.students.enrollmentYear);
  const programs = await db.select().from(schema.programs).where(eq(schema.programs.institutionId, inst.id));
  const locked = await lockedYears(db, inst.id);

  return (
    <StudentsView
      canEdit={can(user.roles, "inst.students.edit")}
      intake={Object.fromEntries(programs.map((p) => [p.type, p.approvedIntake]))}
      approved={programs.filter((p) => p.nocStatus === "APPROVED").map((p) => p.type)}
      byYear={byYear}
      locked={locked.map((l) => ({ programType: l.programType, year: l.year, ref: l.ref, lockedAt: l.lockedAt?.toISOString() ?? null }))}
      rows={rows.map((s) => ({
        id: s.id,
        pcpId: s.pcpId,
        fullName: s.fullName,
        fatherName: s.fatherName,
        cnic: maskCnic(s.cnic),
        mobile: s.mobile,
        email: s.email,
        programType: s.programType,
        shift: s.shift,
        enrollmentYear: s.enrollmentYear,
        currentYear: s.currentYear,
        status: s.status,
        result: s.result,
        resultYear: s.resultYear,
        degreeVerified: s.degreeVerified,
        eligible: s.eligibleForRegistration,
        hasLogin: !!s.username,
      }))}
    />
  );
}
