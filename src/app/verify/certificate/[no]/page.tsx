import { eq } from "drizzle-orm";
import CertificateVerify from "@/components/CertificateVerify";
import { db, schema } from "@/db";

/** The page a certificate's QR code opens. Public. */
export default async function VerifyCertificatePage({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  const app = await db.query.applications.findFirst({ where: eq(schema.applications.certificateNo, no) });
  const inst = app ? await db.query.institutions.findFirst({ where: eq(schema.institutions.id, app.institutionId) }) : null;
  const doc = app ? await db.query.documents.findFirst({ where: eq(schema.documents.fileName, `${no}.pdf`) }) : null;
  return (
    <CertificateVerify
      no={no}
      found={app && inst ? { institution: inst.name, code: inst.code, city: inst.city, programType: app.programType, intake: Number(app.data?.proposedIntake ?? 0), issuedAt: app.issuedAt?.toISOString() ?? null, validUntil: app.validUntil, sha256: doc?.sha256 ?? null } : null}
    />
  );
}
