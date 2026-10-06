import { desc, eq } from "drizzle-orm";
import InspectionsList from "@/components/InspectionsList";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function InspectionsPage() {
  const user = await requireUser("pcp");
  const isCoordinator = user.roles.includes("pcp_officer");
  const isInspector = user.roles.includes("pcp_inspector");
  if (!isCoordinator && !isInspector) redirect("/home");

  const rows = await db
    .select({
      id: schema.inspections.id,
      inspector: schema.inspections.inspector,
      scheduledFor: schema.inspections.scheduledFor,
      status: schema.inspections.status,
      ref: schema.applications.ref,
      appStatus: schema.applications.status,
      programType: schema.applications.programType,
      instName: schema.institutions.name,
      city: schema.institutions.city,
      province: schema.institutions.province,
    })
    .from(schema.inspections)
    .innerJoin(schema.applications, eq(schema.applications.id, schema.inspections.applicationId))
    .innerJoin(schema.institutions, eq(schema.institutions.id, schema.inspections.institutionId))
    .orderBy(desc(schema.inspections.scheduledFor));
  const staff = await db.select().from(schema.staff);
  const names = Object.fromEntries(staff.map((s) => [s.username, `${s.displayName} (${s.province})`]));

  const awaiting = isCoordinator
    ? await db
        .select({ ref: schema.applications.ref, instName: schema.institutions.name, province: schema.institutions.province, programType: schema.applications.programType })
        .from(schema.applications)
        .innerJoin(schema.institutions, eq(schema.institutions.id, schema.applications.institutionId))
        .where(eq(schema.applications.status, "UNDER_SCRUTINY"))
    : [];

  return (
    <InspectionsList
      isCoordinator={isCoordinator}
      awaiting={awaiting}
      rows={(isCoordinator ? rows : rows.filter((r) => r.inspector === user.username)).map((r) => ({ ...r, inspectorName: names[r.inspector] ?? r.inspector, mine: r.inspector === user.username }))}
    />
  );
}
