import { desc, eq } from "drizzle-orm";
import PharmacistPortal, { NotLinked } from "@/components/PharmacistPortal";
import { db, schema } from "@/db";
import { maskCnic } from "@/lib/names";
import { cardQrDataUrl, cardStatusUrl } from "@/lib/pharmacist-card";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** A registered pharmacist's own record (guide section 2): see it, update practice details, get the card. */
export default async function Page() {
  const user = await requireUser("pharmacist");
  const p = await db.query.pharmacists.findFirst({ where: eq(schema.pharmacists.username, user.username) });
  if (!p) return <NotLinked />;
  const updates = await db
    .select({ u: schema.practiceUpdates, doc: { id: schema.documents.id, fileName: schema.documents.fileName } })
    .from(schema.practiceUpdates)
    .leftJoin(schema.documents, eq(schema.documents.id, schema.practiceUpdates.evidenceDocumentId))
    .where(eq(schema.practiceUpdates.pharmacistId, p.id))
    .orderBy(desc(schema.practiceUpdates.submittedAt));
  const card = p.cardDocumentId ? await db.query.documents.findFirst({ where: eq(schema.documents.id, p.cardDocumentId) }) : null;

  return (
    <PharmacistPortal
      p={{
        regNo: p.regNo,
        fullName: p.fullName,
        fatherName: p.fatherName,
        cnic: maskCnic(p.cnic),
        university: p.university,
        graduationYear: p.graduationYear,
        category: p.category,
        council: p.council,
        issueDate: p.issueDate,
        validUntil: p.validUntil,
        status: p.status,
        practicePlace: p.practiceConfirmed ? p.practicePlace : null,
        designation: p.practiceConfirmed ? p.designation : null,
        practiceConfirmedAt: p.practiceConfirmedAt?.toISOString() ?? null,
        mobile: p.mobile,
        email: p.email,
      }}
      updates={updates.map(({ u, doc }) => ({ id: u.id, practicePlace: u.practicePlace, designation: u.designation, status: u.status, submittedAt: u.submittedAt.toISOString(), reviewedAt: u.reviewedAt?.toISOString() ?? null, reviewNote: u.reviewNote, evidence: doc?.id ? { id: doc.id, fileName: doc.fileName ?? "evidence" } : null }))}
      card={{ qr: await cardQrDataUrl(p.regNo), url: cardStatusUrl(p.regNo), version: card?.version ?? null, issuedAt: card?.uploadedAt.toISOString() ?? null }}
    />
  );
}
