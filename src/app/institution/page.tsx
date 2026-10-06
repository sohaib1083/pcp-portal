import { and, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import InstitutionDashboard from "@/components/InstitutionDashboard";
import { db, schema } from "@/db";
import { registryActions } from "@/lib/registry";
import { requireInstitution } from "@/lib/session";
import { daysUntil, iso } from "@/lib/util";

export default async function InstitutionHome({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { denied } = await searchParams;
  const { user, inst } = await requireInstitution("inst.dashboard");

  const programs = await db.select().from(schema.programs).where(eq(schema.programs.institutionId, inst.id));
  const studentCounts = await db
    .select({ type: schema.students.programType, n: sql<number>`count(*)::int` })
    .from(schema.students)
    .where(and(eq(schema.students.institutionId, inst.id), notInArray(schema.students.status, ["GRADUATED", "WITHDRAWN"])))
    .groupBy(schema.students.programType);
  const facultyCounts = await db
    .select({ type: schema.facultyLinks.programType, n: sql<number>`count(*)::int` })
    .from(schema.facultyLinks)
    .where(and(eq(schema.facultyLinks.institutionId, inst.id), eq(schema.facultyLinks.status, "ACTIVE")))
    .groupBy(schema.facultyLinks.programType);
  const pendingFaculty = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.facultyLinks)
    .innerJoin(schema.faculty, eq(schema.faculty.id, schema.facultyLinks.facultyId))
    .where(and(eq(schema.facultyLinks.institutionId, inst.id), eq(schema.facultyLinks.status, "ACTIVE"), ne(schema.faculty.verificationStatus, "VERIFIED")));
  const outstanding = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.deficiencies)
    .where(and(eq(schema.deficiencies.institutionId, inst.id), inArray(schema.deficiencies.status, ["OUTSTANDING", "REJECTED"])));
  const apps = await db
    .select({ ref: schema.applications.ref, kind: schema.applications.kind, programType: schema.applications.programType, status: schema.applications.status, updatedAt: schema.applications.updatedAt })
    .from(schema.applications)
    .where(eq(schema.applications.institutionId, inst.id))
    .orderBy(desc(schema.applications.updatedAt));
  const notes = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.audience, `inst:${inst.code}`))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(6);

  const actions: { text: string; level: "error" | "warning" | "info"; link?: string }[] = [];
  actions.push(...(await registryActions(db, inst.id))); // annual student update and annual faculty update, from their records
  if (pendingFaculty[0].n > 0) actions.push({ text: `${pendingFaculty[0].n} faculty record(s) awaiting PCP verification`, level: "info", link: "/institution/faculty" });
  for (const p of programs) {
    const d = daysUntil(p.accreditationValidUntil);
    if (d !== null && d <= 180) actions.push({ text: `${p.type === "PHARMD" ? "PharmD" : "Technician"} accreditation renewal due in ${d} days (expires ${p.accreditationValidUntil})`, level: d <= 90 ? "error" : "warning" });
  }
  if (outstanding[0].n > 0) actions.push({ text: `${outstanding[0].n} outstanding deficiencies`, level: "error", link: "/institution/applications" });

  return (
    <InstitutionDashboard
      denied={denied ?? null}
      userName={user.name}
      inst={{ name: inst.name, code: inst.code, status: inst.status, city: inst.city, province: inst.province, sector: inst.sector }}
      programs={programs.map((p) => ({
        type: p.type,
        nocStatus: p.nocStatus,
        nocNumber: p.nocNumber,
        accreditationStatus: p.accreditationStatus,
        validUntil: p.accreditationValidUntil,
        intake: p.approvedIntake,
        students: studentCounts.find((s) => s.type === p.type)?.n ?? 0,
        faculty: facultyCounts.find((f) => f.type === p.type)?.n ?? 0,
      }))}
      actions={actions}
      apps={apps.map((a) => ({ ...a, updatedAt: iso(a.updatedAt)! }))}
      notifications={notes.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, createdAt: iso(n.createdAt)! }))}
    />
  );
}
