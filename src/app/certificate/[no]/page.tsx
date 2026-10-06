import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
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
  const pdf = await db.query.documents.findFirst({ where: and(eq(schema.documents.applicationId, app.id), eq(schema.documents.docType, "NOC certificate")) });
  return (
    <CertificatePrint
      c={{
        no,
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
