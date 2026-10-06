import { and, desc, eq } from "drizzle-orm";
import FacultyView from "@/components/FacultyView";
import { db, schema } from "@/db";
import { maskCnic } from "@/lib/names";
import { can } from "@/lib/roles";
import { requireInstitution } from "@/lib/session";

export default async function FacultyPage() {
  const { user, inst } = await requireInstitution("inst.faculty.view");
  const rows = await db
    .select({
      linkId: schema.facultyLinks.id,
      programType: schema.facultyLinks.programType,
      linkStatus: schema.facultyLinks.status,
      startDate: schema.facultyLinks.startDate,
      endDate: schema.facultyLinks.endDate,
      pcpId: schema.faculty.pcpId,
      cnic: schema.faculty.cnic,
      fullName: schema.faculty.fullName,
      qualification: schema.faculty.qualification,
      specialization: schema.faculty.specialization,
      designation: schema.faculty.designation,
      verificationStatus: schema.faculty.verificationStatus,
    })
    .from(schema.facultyLinks)
    .innerJoin(schema.faculty, eq(schema.faculty.id, schema.facultyLinks.facultyId))
    .where(and(eq(schema.facultyLinks.institutionId, inst.id)))
    .orderBy(desc(schema.facultyLinks.status), desc(schema.facultyLinks.id));

  return (
    <FacultyView
      canEdit={can(user.roles, "inst.faculty.edit")}
      rows={rows.map((r) => ({ ...r, cnic: maskCnic(r.cnic) }))}
    />
  );
}
