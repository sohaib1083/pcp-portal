import { desc, eq } from "drizzle-orm";
import CertificateVerify from "@/components/CertificateVerify";
import { db, schema } from "@/db";
import { getLang } from "@/lib/i18n-server";

/** The page a certificate's QR code opens. Public. */
export default async function VerifyCertificatePage({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  const app = await db.query.applications.findFirst({ where: eq(schema.applications.certificateNo, no) });
  const inst = app ? await db.query.institutions.findFirst({ where: eq(schema.institutions.id, app.institutionId) }) : null;
  const doc = app ? await db.query.documents.findFirst({ where: eq(schema.documents.fileName, `${no}.pdf`), orderBy: desc(schema.documents.version) }) : null;
  const hist = app && app.kind !== "NOC" ? await db.query.accreditationHistory.findFirst({ where: eq(schema.accreditationHistory.applicationRef, app.ref), orderBy: desc(schema.accreditationHistory.id) }) : null;
  return (
    <CertificateVerify
      lang={await getLang()}
      no={no}
      found={app && inst ? { kind: app.kind, term: hist ? `${hist.validFrom}–${hist.validUntil}` : null, institution: inst.name, code: inst.code, city: inst.city, programType: app.programType, intake: Number(app.data?.proposedIntake ?? 0), issuedAt: app.issuedAt?.toISOString() ?? null, validUntil: app.validUntil, sha256: doc?.sha256 ?? null } : null}
    />
  );
}
