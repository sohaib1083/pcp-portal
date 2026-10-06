import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import InspectionForm from "@/components/InspectionForm";
import { db, schema } from "@/db";
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
  if (insp.inspector !== user.username) redirect("/pcp/inspections");
  const app = await db.query.applications.findFirst({ where: eq(schema.applications.id, insp.applicationId) });
  const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, insp.institutionId) });
  const facultyCount = await db.$count(schema.facultyLinks, and(eq(schema.facultyLinks.institutionId, insp.institutionId), eq(schema.facultyLinks.programType, app?.programType ?? ""), eq(schema.facultyLinks.status, "ACTIVE")));
  return (
    <InspectionForm
      inspectionId={insp.id}
      status={insp.status}
      criteria={CRITERIA}
      context={{
        ref: app?.ref ?? "",
        program: app?.programType ?? "",
        inst: inst?.name ?? "",
        city: inst?.city ?? "",
        date: insp.scheduledFor,
        declaredIntake: Number(app?.data?.proposedIntake ?? 0),
        declaredLabs: Number(app?.data?.labs ?? 0),
        declaredBooks: Number(app?.data?.libraryBooks ?? 0),
        facultyOnRecord: facultyCount,
      }}
    />
  );
}
