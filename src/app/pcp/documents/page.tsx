import { desc, eq } from "drizzle-orm";
import DocumentsView from "@/components/DocumentsView";
import { db, schema } from "@/db";
import { verifyDocument } from "@/app/actions/pcp";
import { can } from "@/lib/roles";
import { requirePermission } from "@/lib/session";
import { DEFAULT_FOLDERS } from "@/lib/storage";

export default async function PcpDocumentsPage({ searchParams }: { searchParams: Promise<{ inst?: string }> }) {
  const user = await requirePermission("pcp.documents.view");
  const { inst: code } = await searchParams;
  const insts = await db.select().from(schema.institutions).orderBy(schema.institutions.code);
  const inst = insts.find((i) => i.code === code) ?? insts[0];
  const docs = await db.select().from(schema.documents).where(eq(schema.documents.institutionId, inst.id)).orderBy(desc(schema.documents.uploadedAt));
  const staff = await db.select().from(schema.staff);
  const names = Object.fromEntries(staff.map((s) => [s.username, s.displayName]));
  return (
    <DocumentsView
      title="Documents"
      sub={`${inst.name}: the institution's folder tree. PCP roles see all institutions; every download is logged.`}
      root={inst.code}
      defaults={DEFAULT_FOLDERS}
      uploadable={false}
      institutions={insts.map((i) => ({ code: i.code, name: i.name }))}
      selectedInstitution={inst.code}
      onVerify={can(user.roles, "pcp.documents.verify") ? verifyDocument : undefined}
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
