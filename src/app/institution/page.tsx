import { and, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import InstitutionDashboard from "@/components/InstitutionDashboard";
import { db, schema } from "@/db";
import { programmeCards } from "@/lib/programmes";
import { registryActions } from "@/lib/registry";
import { can } from "@/lib/roles";
import { requireInstitution } from "@/lib/session";
import { daysUntil, iso } from "@/lib/util";
import { isPg, programmeName } from "@/lib/workflow";

export default async function InstitutionHome({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { denied } = await searchParams;
  const { user, inst } = await requireInstitution("inst.dashboard");

  const programs = await db.select().from(schema.programs).where(eq(schema.programs.institutionId, inst.id));
  const cards = await programmeCards(inst.id);
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
    .select({ id: schema.applications.id, ref: schema.applications.ref, kind: schema.applications.kind, programType: schema.applications.programType, field: schema.applications.field, status: schema.applications.status, updatedAt: schema.applications.updatedAt })
    .from(schema.applications)
    .where(eq(schema.applications.institutionId, inst.id))
    .orderBy(desc(schema.applications.updatedAt));
  // Postgraduate programmes: the supervisors linked on the programme's latest case.
  const supervisorsOf = async (type: string, field: string) => {
    const last = apps.find((a) => a.programType === type && a.field === field);
    return last ? await db.$count(schema.applicationFaculty, eq(schema.applicationFaculty.applicationId, last.id)) : 0;
  };
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
    if (d !== null && d <= 180) actions.push({ text: `${p.type === "TECH" ? "Technician" : programmeName(p.type, p.field)} accreditation renewal due in ${d} days (expires ${p.accreditationValidUntil})`, level: d <= 90 ? "error" : "warning", link: "/institution/applications#programmes" });
  }
  if (outstanding[0].n > 0) actions.push({ text: `${outstanding[0].n} outstanding deficiencies`, level: "error", link: "/institution/applications" });

  return (
    <InstitutionDashboard
      denied={denied ?? null}
      userName={user.name}
      inst={{ name: inst.name, code: inst.code, status: inst.status, city: inst.city, province: inst.province, sector: inst.sector }}
      programs={await Promise.all(
        programs.map(async (p) => ({
          type: p.type,
          field: p.field,
          postgraduate: isPg(p.type),
          nocStatus: p.nocStatus,
          nocNumber: p.nocNumber,
          accreditationStatus: p.accreditationStatus,
          validUntil: p.accreditationValidUntil,
          intake: p.approvedIntake,
          students: studentCounts.find((s) => s.type === p.type)?.n ?? 0,
          faculty: isPg(p.type) ? await supervisorsOf(p.type, p.field) : (facultyCounts.find((f) => f.type === p.type)?.n ?? 0),
          card: cards.find((c) => c.type === p.type && c.field === p.field),
        })),
      )}
      canStart={can(user.roles, "inst.app.edit")}
      actions={actions}
      apps={apps.map((a) => ({ ref: a.ref, kind: a.kind, programType: a.programType, field: a.field, status: a.status, updatedAt: iso(a.updatedAt)! }))}
      notifications={notes.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, createdAt: iso(n.createdAt)! }))}
    />
  );
}
