import { desc, eq } from "drizzle-orm";
import DocumentsView from "@/components/DocumentsView";
import { db, schema } from "@/db";
import { can } from "@/lib/roles";
import { requireInstitution } from "@/lib/session";
import { DEFAULT_FOLDERS } from "@/lib/storage";

export default async function InstitutionDocumentsPage() {
  const { user, inst } = await requireInstitution("inst.documents.view");
  const docs = await db.select().from(schema.documents).where(eq(schema.documents.institutionId, inst.id)).orderBy(desc(schema.documents.uploadedAt));
  const staff = await db.select().from(schema.staff);
  const names = Object.fromEntries(staff.map((s) => [s.username, s.displayName]));
  return (
    <DocumentsView
      title="Documents"
      sub="Your institution's document folders. Other institutions cannot see them."
      root={inst.code}
      defaults={DEFAULT_FOLDERS}
      uploadable={can(user.roles, "inst.documents.upload")}
      docs={docs.map((d) => ({
        id: d.id,
        folder: d.folder,
        docType: d.docType,
        fileName: d.fileName,
        version: d.version,
        sizeBytes: d.sizeBytes,
        sha256: d.sha256,
        verificationStatus: d.verificationStatus,
        uploadedBy: names[d.uploadedBy] ?? d.uploadedBy,
        uploadedAt: d.uploadedAt.toISOString(),
      }))}
    />
  );
}
