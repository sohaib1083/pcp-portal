import { and, desc, eq, inArray, isNotNull, lte, ne, notInArray, sql } from "drizzle-orm";
import ExecutiveDashboard from "@/components/ExecutiveDashboard";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/session";
import { iso } from "@/lib/util";

const count = (rows: { n: number }[]) => rows[0]?.n ?? 0;

export const metadata = { title: "Executive dashboard" };

export default async function PcpDashboard() {
  const user = await requirePermission("pcp.dashboard");
  const n = sql<number>`count(*)::int`;
  const in90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

  const kpis = {
    institutions: count(await db.select({ n }).from(schema.institutions)),
    pharmd: count(await db.select({ n }).from(schema.programs).where(and(eq(schema.programs.type, "PHARMD"), eq(schema.programs.nocStatus, "APPROVED")))),
    tech: count(await db.select({ n }).from(schema.programs).where(and(eq(schema.programs.type, "TECH"), eq(schema.programs.nocStatus, "APPROVED")))),
    pendingNoc: count(await db.select({ n }).from(schema.applications).where(and(eq(schema.applications.kind, "NOC"), notInArray(schema.applications.status, ["DRAFT", "NOC_ISSUED", "REJECTED"])))),
    pendingAcc: count(await db.select({ n }).from(schema.applications).where(and(eq(schema.applications.kind, "ACCREDITATION"), notInArray(schema.applications.status, ["DRAFT", "NOC_ISSUED", "REJECTED"])))),
    renewals90: count(await db.select({ n }).from(schema.programs).where(and(isNotNull(schema.programs.accreditationValidUntil), lte(schema.programs.accreditationValidUntil, in90)))),
    pendingInspections: count(await db.select({ n }).from(schema.inspections).where(eq(schema.inspections.status, "SCHEDULED"))),
    deficiencies: count(await db.select({ n }).from(schema.deficiencies).where(inArray(schema.deficiencies.status, ["OUTSTANDING", "REJECTED"]))),
    awaitingDecision: count(await db.select({ n }).from(schema.applications).where(eq(schema.applications.status, "COUNCIL_REVIEW"))),
    faculty: count(await db.select({ n }).from(schema.facultyLinks).where(eq(schema.facultyLinks.status, "ACTIVE"))),
    students: count(await db.select({ n }).from(schema.students).where(notInArray(schema.students.status, ["GRADUATED", "WITHDRAWN"]))),
    duplicates: count(await db.select({ n }).from(schema.duplicateFlags).where(eq(schema.duplicateFlags.status, "OPEN"))),
    pharmacists: count(await db.select({ n }).from(schema.pharmacists)),
    pharmacistsActive: count(await db.select({ n }).from(schema.pharmacists).where(eq(schema.pharmacists.status, "ACTIVE"))),
  };

  const byProvince = await db.select({ k: schema.institutions.province, n }).from(schema.institutions).groupBy(schema.institutions.province);
  const bySector = await db.select({ k: schema.institutions.sector, n }).from(schema.institutions).groupBy(schema.institutions.sector);
  const nocStatus = await db.select({ k: schema.programs.nocStatus, n }).from(schema.programs).groupBy(schema.programs.nocStatus);
  const accStatus = await db.select({ k: schema.programs.accreditationStatus, n }).from(schema.programs).groupBy(schema.programs.accreditationStatus);
  const enrol = await db
    .select({ year: schema.students.enrollmentYear, type: schema.students.programType, n })
    .from(schema.students)
    .groupBy(schema.students.enrollmentYear, schema.students.programType)
    .orderBy(schema.students.enrollmentYear);
  const graduates = await db.select({ year: schema.students.enrollmentYear, n }).from(schema.students).where(eq(schema.students.status, "GRADUATED")).groupBy(schema.students.enrollmentYear).orderBy(schema.students.enrollmentYear);
  const facultyQual = await db
    .select({ k: schema.faculty.qualification, n })
    .from(schema.faculty)
    .innerJoin(schema.facultyLinks, eq(schema.facultyLinks.facultyId, schema.faculty.id))
    .where(eq(schema.facultyLinks.status, "ACTIVE"))
    .groupBy(schema.faculty.qualification);

  // Unusual patterns: enrolment above approved intake (the draft asks PCP to spot these)
  const over = await db.execute(sql`
    select i.short_code, i.name, s.program_type, s.enrollment_year, count(*)::int as enrolled, p.approved_intake
    from students s join institutions i on i.id = s.institution_id
    join programs p on p.institution_id = s.institution_id and p.type = s.program_type
    group by i.short_code, i.name, s.program_type, s.enrollment_year, p.approved_intake
    having count(*) > p.approved_intake order by enrolled desc limit 5`);

  const audiences = [`user:${user.username}`, ...user.roles.map((x) => `role:${x}`)];
  const notes = await db.select().from(schema.notifications).where(inArray(schema.notifications.audience, audiences)).orderBy(desc(schema.notifications.createdAt)).limit(6);

  // Pipeline: where every open case sits right now
  const pipeline = await db.select({ k: schema.applications.status, n }).from(schema.applications).where(ne(schema.applications.status, "DRAFT")).groupBy(schema.applications.status);
  // Watchlist: accreditation expiring within 180 days
  const in180 = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
  const renewals = await db
    .select({ name: schema.institutions.name, code: schema.institutions.code, type: schema.programs.type, until: schema.programs.accreditationValidUntil })
    .from(schema.programs)
    .innerJoin(schema.institutions, eq(schema.institutions.id, schema.programs.institutionId))
    .where(and(isNotNull(schema.programs.accreditationValidUntil), lte(schema.programs.accreditationValidUntil, in180)))
    .orderBy(schema.programs.accreditationValidUntil);

  return (
    <ExecutiveDashboard
      kpis={kpis}
      byProvince={byProvince}
      bySector={bySector}
      nocStatus={nocStatus}
      accStatus={accStatus}
      enrol={enrol}
      graduates={graduates}
      facultyQual={facultyQual}
      overIntake={over.rows as { short_code: string; name: string; program_type: string; enrollment_year: number; enrolled: number; approved_intake: number }[]}
      pipeline={pipeline}
      renewals={renewals.map((r) => ({ ...r, until: r.until! }))}
      notifications={notes.map((x) => ({ id: x.id, title: x.title, body: x.body, link: x.link, createdAt: iso(x.createdAt)! }))}
    />
  );
}
