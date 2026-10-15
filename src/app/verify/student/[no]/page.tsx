import { eq } from "drizzle-orm";
import StudentCertificateVerify from "@/components/StudentCertificateVerify";
import { db, schema } from "@/db";
import { isStudentCertificateNo } from "@/lib/people-shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Check a student certificate" };

/**
 * The page a student certificate's QR code opens. Public. It shows only name, student ID, institution,
 * programme and status, read live from the register: never the CNIC, phone, email or father's name.
 */
export default async function Page({ params }: { params: Promise<{ no: string }> }) {
  const no = decodeURIComponent((await params).no).trim().toUpperCase().slice(0, 30);
  const r = isStudentCertificateNo(no) ? await db.query.studentRequests.findFirst({ where: eq(schema.studentRequests.certificateNo, no) }) : null;
  const s = r ? await db.query.students.findFirst({ where: eq(schema.students.id, r.studentId) }) : null;
  const inst = s ? await db.query.institutions.findFirst({ where: eq(schema.institutions.id, s.institutionId) }) : null;
  return (
    <StudentCertificateVerify
      no={no}
      found={
        r && s && inst && r.status === "ISSUED"
          ? { kind: r.kind, issuedAt: r.pcpAt?.toISOString() ?? null, name: s.fullName, studentId: s.pcpId, institution: inst.name, institutionCode: inst.code, city: inst.city, programType: s.programType, status: s.status, eligible: s.eligibleForRegistration, degreeVerified: s.degreeVerified }
          : null
      }
    />
  );
}
