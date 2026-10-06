import { eq, notInArray, sql } from "drizzle-orm";
import InstitutionsTable from "@/components/InstitutionsTable";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/session";

export default async function InstitutionsPage({ searchParams }: { searchParams: Promise<{ programme?: string }> }) {
  await requirePermission("pcp.app.view");
  const { programme } = await searchParams;
  const programs = await db.select().from(schema.programs);
  // ?programme=PHARMD|TECH: institutions with an approved NOC for that programme (the dashboard tiles open this list).
  const all = await db.select().from(schema.institutions).orderBy(schema.institutions.code);
  const insts = programme ? all.filter((i) => programs.some((p) => p.institutionId === i.id && p.type === programme.toUpperCase() && p.nocStatus === "APPROVED")) : all;
  const students = await db
    .select({ id: schema.students.institutionId, n: sql<number>`count(*)::int` })
    .from(schema.students)
    .where(notInArray(schema.students.status, ["GRADUATED", "WITHDRAWN"]))
    .groupBy(schema.students.institutionId);
  const faculty = await db
    .select({ id: schema.facultyLinks.institutionId, n: sql<number>`count(*)::int` })
    .from(schema.facultyLinks)
    .where(eq(schema.facultyLinks.status, "ACTIVE"))
    .groupBy(schema.facultyLinks.institutionId);
  return (
    <InstitutionsTable
      rows={insts.map((i) => ({
        code: i.code,
        name: i.name,
        city: i.city,
        province: i.province,
        sector: i.sector,
        status: i.status,
        students: students.find((s) => s.id === i.id)?.n ?? 0,
        faculty: faculty.find((f) => f.id === i.id)?.n ?? 0,
        programs: programs.filter((p) => p.institutionId === i.id).map((p) => ({ type: p.type, noc: p.nocStatus, acc: p.accreditationStatus, until: p.accreditationValidUntil })),
      }))}
    />
  );
}
