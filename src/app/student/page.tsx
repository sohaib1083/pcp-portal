import { eq } from "drizzle-orm";
import StudentPortalView from "@/components/StudentPortalView";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { maskCnic } from "@/lib/names";
import { requireUser } from "@/lib/session";

/** The student's own record, read-only. The student is found by their login (students.username). */
export default async function StudentPage() {
  const user = await requireUser("student");
  const s = await db.query.students.findFirst({ where: eq(schema.students.username, user.username) });
  if (!s) return <StudentPortalView name={user.name} record={null} />;
  const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, s.institutionId) });
  await audit(db, { actor: user.username, action: "student.record.viewed", entity: "student", entityId: s.pcpId });
  return (
    <StudentPortalView
      name={user.name}
      record={{
        pcpId: s.pcpId,
        fullName: s.fullName,
        fatherName: s.fatherName,
        cnic: maskCnic(s.cnic),
        institution: inst?.name ?? "",
        institutionCode: inst?.code ?? "",
        city: inst?.city ?? "",
        programType: s.programType,
        shift: s.shift,
        enrollmentYear: s.enrollmentYear,
        currentYear: s.currentYear,
        status: s.status,
        result: s.result,
        resultYear: s.resultYear,
        degreeVerified: s.degreeVerified,
        eligible: s.eligibleForRegistration,
      }}
    />
  );
}
