import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import InspectionForm from "@/components/InspectionForm";
import { db, schema } from "@/db";
import { can } from "@/lib/roles";
import { requireUser } from "@/lib/session";

const CRITERIA = [
  "Faculty: qualified, full-time, as per submitted list",
  "Laboratories: equipment, chemicals and safety",
  "Library: books, journals and digital access",
  "Classrooms and building",
  "Student records and attendance",
  "Hospital / pharmacy practice linkage",
  "Governance and finances",
];

export default async function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser("pcp");
  const insp = await db.query.inspections.findFirst({ where: eq(schema.inspections.id, Number(id)) });
  if (!insp) notFound();
  const team = await db.select().from(schema.inspectionTeam).where(eq(schema.inspectionTeam.inspectionId, insp.id));
  const members = [insp.inspector, ...team.filter((t) => t.username !== insp.inspector).map((t) => t.username)];
  // The lead submits; members see the visit; coordinators may look.
  const isLead = insp.inspector === user.username;
  if (!isLead && !members.includes(user.username) && !can(user.roles, "pcp.inspection.schedule")) redirect("/pcp/inspections");
  const app = await db.query.applications.findFirst({ where: eq(schema.applications.id, insp.applicationId) });
  const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, insp.institutionId) });
  const linked = app ? await db.$count(schema.applicationFaculty, eq(schema.applicationFaculty.applicationId, app.id)) : 0;
  const facultyCount = linked || (await db.$count(schema.facultyLinks, and(eq(schema.facultyLinks.institutionId, insp.institutionId), eq(schema.facultyLinks.programType, app?.programType ?? ""), eq(schema.facultyLinks.status, "ACTIVE"))));
  const staff = await db.select().from(schema.staff);
  const name = (u: string) => staff.find((s) => s.username === u)?.displayName ?? u;
  return (
    <InspectionForm
      inspectionId={insp.id}
      status={insp.status}
      criteria={CRITERIA}
      canSubmit={isLead && user.roles.includes("pcp_inspector")}
      team={members.map((u, i) => ({ name: name(u), province: staff.find((s) => s.username === u)?.province ?? "", lead: i === 0 }))}
      report={insp.status === "SUBMITTED" ? { checklist: insp.checklist ?? [], summary: insp.summary } : null}
      context={{
        ref: app?.ref ?? "",
        program: app?.programType ?? "",
        inst: inst?.name ?? "",
        city: inst?.city ?? "",
        date: insp.scheduledFor,
        scope: insp.scope,
        declaredIntake: Number(app?.data?.proposedIntake ?? 0),
        declaredLabs: Number(app?.data?.labs ?? 0),
        declaredBooks: Number(app?.data?.libraryBooks ?? 0),
        facultyOnRecord: facultyCount,
      }}
    />
  );
}
