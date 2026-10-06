import { notFound, redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import CertificatePrint from "@/components/CertificatePrint";
import { db, schema } from "@/db";
import { certificateQrDataUrl, verifyUrl } from "@/lib/certificate";
import { requireUser } from "@/lib/session";
import { PROGRAM_LABELS } from "@/lib/workflow";

export default async function CertificatePage({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  const user = await requireUser();
  const app = await db.query.applications.findFirst({ where: eq(schema.applications.certificateNo, no) });
  if (!app) notFound();
  const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, app.institutionId) });
  if (!inst) notFound();
  if (user.kind === "institution" && user.institutionCode !== inst.code) redirect("/home");
  const acc = app.kind !== "NOC";
  const pdf = await db.query.documents.findFirst({ where: and(eq(schema.documents.applicationId, app.id), eq(schema.documents.docType, acc ? "Accreditation certificate" : "NOC certificate")), orderBy: desc(schema.documents.version) });
  // The term an accreditation certificate covers: from the history row written when it was issued.
  const hist = acc ? await db.query.accreditationHistory.findFirst({ where: eq(schema.accreditationHistory.applicationRef, app.ref), orderBy: desc(schema.accreditationHistory.id) }) : null;
  return (
    <CertificatePrint
      c={{
        no,
        kind: app.kind,
        term: hist ? `${hist.validFrom}–${hist.validUntil}` : null,
        institution: inst.name,
        code: inst.code,
        city: inst.city,
        province: inst.province,
        program: PROGRAM_LABELS[app.programType],
        intake: Number(app.data?.proposedIntake ?? 0),
        issuedAt: app.issuedAt?.toISOString() ?? null,
        validUntil: app.validUntil,
        note: app.decisionNote,
        qr: await certificateQrDataUrl(no),
        verifyUrl: verifyUrl(no),
        pdfId: pdf?.id ?? null,
        back: user.kind === "institution" ? `/institution/applications/${app.ref}` : `/pcp/applications/${app.ref}`,
      }}
    />
  );
}
