import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { redirect } from "next/navigation";
import InspectionsList from "@/components/InspectionsList";
import { db, schema } from "@/db";
import { can } from "@/lib/roles";
import { requireUser } from "@/lib/session";
import { iso } from "@/lib/util";

export default async function InspectionsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month } = await searchParams;
  const user = await requireUser("pcp");
  const isCoordinator = can(user.roles, "pcp.inspection.schedule");
  const canView = can(user.roles, "pcp.inspection.view");
  const isInspector = user.roles.includes("pcp_inspector");
  if (!canView && !isInspector) redirect("/home");
  const seeAll = canView && !isInspector;

  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : null;
  const range = m ? and(gte(schema.inspections.scheduledFor, `${m}-01`), lt(schema.inspections.scheduledFor, new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)).toISOString().slice(0, 10))) : undefined;
  const rows = await db
    .select({
      id: schema.inspections.id,
      inspector: schema.inspections.inspector,
      scheduledFor: schema.inspections.scheduledFor,
      status: schema.inspections.status,
      scope: schema.inspections.scope,
      ref: schema.applications.ref,
      appStatus: schema.applications.status,
      programType: schema.applications.programType,
      field: schema.applications.field,
      kind: schema.applications.kind,
      instName: schema.institutions.name,
      city: schema.institutions.city,
      province: schema.institutions.province,
    })
    .from(schema.inspections)
    .innerJoin(schema.applications, eq(schema.applications.id, schema.inspections.applicationId))
    .innerJoin(schema.institutions, eq(schema.institutions.id, schema.inspections.institutionId))
    .where(range)
    .orderBy(desc(schema.inspections.scheduledFor));
  const team = rows.length ? await db.select().from(schema.inspectionTeam).where(inArray(schema.inspectionTeam.inspectionId, rows.map((r) => r.id))) : [];
  const staff = await db.select().from(schema.staff);
  const names = Object.fromEntries(staff.map((s) => [s.username, s.displayName]));
  const provinces = Object.fromEntries(staff.map((s) => [s.username, s.province]));
  const membersOf = (r: (typeof rows)[number]) => [r.inspector, ...team.filter((t) => t.inspectionId === r.id && t.username !== r.inspector).map((t) => t.username)];

  // Cases whose technical review is done and that wait for a team.
  const ready = isCoordinator
    ? await db
        .select({ id: schema.applications.id, ref: schema.applications.ref, instName: schema.institutions.name, province: schema.institutions.province, programType: schema.applications.programType, field: schema.applications.field, kind: schema.applications.kind })
        .from(schema.applications)
        .innerJoin(schema.institutions, eq(schema.institutions.id, schema.applications.institutionId))
        .innerJoin(schema.technicalReviews, eq(schema.technicalReviews.applicationId, schema.applications.id))
        .where(eq(schema.applications.status, "TECHNICAL_REVIEW"))
    : [];

  const declarations = await db.select().from(schema.conflictDeclarations).where(isCoordinator ? undefined : eq(schema.conflictDeclarations.username, user.username)).orderBy(desc(schema.conflictDeclarations.id));
  const insts = await db.select({ id: schema.institutions.id, name: schema.institutions.name, shortCode: schema.institutions.shortCode, province: schema.institutions.province }).from(schema.institutions).orderBy(schema.institutions.name);

  const visible = rows
    .map((r) => {
      const members = membersOf(r);
      const myRole = r.inspector === user.username ? "LEAD" : members.includes(user.username) ? "MEMBER" : null;
      return {
        ...r,
        scope: r.scope ?? null,
        inspectorName: `${names[r.inspector] ?? r.inspector} (${provinces[r.inspector] ?? "-"})`,
        team: members.map((u, i) => ({ username: u, name: names[u] ?? u, role: i === 0 ? "LEAD" : "MEMBER" })),
        myRole,
        mine: !!myRole,
      };
    })
    .filter((r) => seeAll || isCoordinator || r.mine);

  return (
    <InspectionsList
      isCoordinator={isCoordinator}
      isInspector={isInspector}
      username={user.username}
      month={m}
      awaiting={[...new Map(ready.map((r) => [r.ref, r])).values()]}
      rows={visible}
      inspectors={staff.filter((s) => s.role === "pcp_inspector" && s.active).map((s) => ({ username: s.username, name: s.displayName, province: s.province ?? "" }))}
      institutions={insts}
      declarations={declarations.map((x) => ({ id: x.id, username: x.username, name: names[x.username] ?? x.username, institution: insts.find((i) => i.id === x.institutionId)?.name ?? String(x.institutionId), reason: x.reason, active: x.active, createdAt: iso(x.createdAt)! }))}
    />
  );
}
