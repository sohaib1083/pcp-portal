import { desc, eq } from "drizzle-orm";
import QRCode from "qrcode";
import StudentPortalView from "@/components/StudentPortalView";
import StudentRequests from "@/components/StudentRequests";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { maskCnic } from "@/lib/names";
import { studentCheckUrl } from "@/lib/people";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The student's own record, and their requests and certificates (RFP 4.1.2). The student is found by their login (students.username). */
export default async function StudentPage() {
  const user = await requireUser("student");
  const s = await db.query.students.findFirst({ where: eq(schema.students.username, user.username) });
  if (!s) return <StudentPortalView name={user.name} record={null} />;
  const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, s.institutionId) });
  const requests = await db.select().from(schema.studentRequests).where(eq(schema.studentRequests.studentId, s.id)).orderBy(desc(schema.studentRequests.createdAt));
  await audit(db, { actor: user.username, action: "student.record.viewed", entity: "student", entityId: s.pcpId });
  return (
    <>
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
      <StudentRequests
        student={{ fullName: s.fullName, fatherName: s.fatherName, shift: s.shift, status: s.status, degreeVerified: s.degreeVerified, institution: inst?.shortCode ?? "your institution" }}
        requests={await Promise.all(
          requests.map(async (r) => ({
            id: r.id,
            ref: r.ref,
            kind: r.kind,
            status: r.status,
            details: r.details,
            reason: r.reason,
            createdAt: r.createdAt.toISOString(),
            institutionBy: r.institutionBy,
            institutionAt: r.institutionAt?.toISOString() ?? null,
            institutionNote: r.institutionNote,
            pcpAt: r.pcpAt?.toISOString() ?? null,
            pcpNote: r.pcpNote,
            certificateNo: r.certificateNo,
            certificateDocumentId: r.certificateDocumentId,
            evidenceDocumentId: r.evidenceDocumentId,
            checkUrl: r.certificateNo ? studentCheckUrl(r.certificateNo) : null,
            qr: r.certificateNo ? await QRCode.toDataURL(studentCheckUrl(r.certificateNo), { width: 220, margin: 1 }) : null,
          })),
        )}
      />
    </>
  );
}
