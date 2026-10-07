import { notFound, redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import PharmacistRecord from "@/components/PharmacistRecord";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { latestIdentity } from "@/lib/identity";
import { maskCnic } from "@/lib/names";
import { can } from "@/lib/roles";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("pcp");
  const canManage = can(user.roles, "pcp.pharmacists.manage");
  if (!canManage && !can(user.roles, "pcp.dashboard")) redirect("/home");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const p = await db.query.pharmacists.findFirst({ where: eq(schema.pharmacists.id, id) });
  if (!p) notFound();

  const [events, updates, docs, imp] = await Promise.all([
    db.select().from(schema.pharmacistEvents).where(eq(schema.pharmacistEvents.pharmacistId, id)).orderBy(desc(schema.pharmacistEvents.createdAt), desc(schema.pharmacistEvents.id)),
    db
      .select({ u: schema.practiceUpdates, doc: { id: schema.documents.id, fileName: schema.documents.fileName } })
      .from(schema.practiceUpdates)
      .leftJoin(schema.documents, eq(schema.documents.id, schema.practiceUpdates.evidenceDocumentId))
      .where(eq(schema.practiceUpdates.pharmacistId, id))
      .orderBy(desc(schema.practiceUpdates.submittedAt)),
    db.select().from(schema.documents).where(eq(schema.documents.pharmacistId, id)).orderBy(desc(schema.documents.uploadedAt)),
    p.importId ? db.query.pharmacistImports.findFirst({ where: eq(schema.pharmacistImports.id, p.importId) }) : null,
  ]);
  const nadra = (await latestIdentity("pharmacist", [p.id]))[p.id] ?? null;
  // Complete audit trail (guide section 14): who viewed a record, and whether they saw the full CNIC.
  await audit(db, { actor: user.username, action: "pharmacist.viewed", entity: "pharmacist", entityId: p.regNo, details: { cnicShown: canManage } });

  return (
    <PharmacistRecord
      canManage={canManage}
      nadra={nadra}
      p={{
        id: p.id,
        regNo: p.regNo,
        fullName: p.fullName,
        fatherName: p.fatherName,
        cnic: canManage ? p.cnic : maskCnic(p.cnic),
        gender: p.gender,
        university: p.university,
        graduationYear: p.graduationYear,
        category: p.category,
        council: p.council,
        issueDate: p.issueDate,
        validUntil: p.validUntil,
        status: p.status,
        practicePlace: p.practicePlace,
        designation: p.designation,
        practiceConfirmed: p.practiceConfirmed,
        practiceConfirmedAt: p.practiceConfirmedAt?.toISOString() ?? null,
        mobile: p.mobile,
        email: p.email,
        address: p.address,
        username: p.username,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      }}
      imported={imp ? { ref: imp.ref, fileName: imp.fileName, createdAt: imp.createdAt.toISOString() } : null}
      events={events.map((e) => ({ id: e.id, kind: e.kind, fromStatus: e.fromStatus, toStatus: e.toStatus, note: e.note, actor: e.actor, createdAt: e.createdAt.toISOString() }))}
      updates={updates.map(({ u, doc }) => ({ id: u.id, practicePlace: u.practicePlace, designation: u.designation, status: u.status, submittedAt: u.submittedAt.toISOString(), reviewedBy: u.reviewedBy, reviewedAt: u.reviewedAt?.toISOString() ?? null, reviewNote: u.reviewNote, evidence: doc?.id ? { id: doc.id, fileName: doc.fileName ?? "evidence" } : null }))}
      documents={docs.map((d) => ({ id: d.id, docType: d.docType, fileName: d.fileName, version: d.version, verificationStatus: d.verificationStatus, uploadedBy: d.uploadedBy, uploadedAt: d.uploadedAt.toISOString(), sha256: d.sha256 }))}
    />
  );
}
