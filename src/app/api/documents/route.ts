import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { can } from "@/lib/roles";
import { getUser } from "@/lib/session";
import { DEFAULT_FOLDERS, putFile } from "@/lib/storage";
import { refreshChecks } from "@/lib/rules";

const MAX_BYTES = 10 * 1024 * 1024;

/** Upload a document into the institution's folder tree. Institution users only, own institution only. */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user || user.kind !== "institution" || !user.institutionCode) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  if (!can(user.roles, "inst.documents.upload") && !can(user.roles, "inst.app.edit") && !can(user.roles, "inst.deficiency.respond"))
    return NextResponse.json({ error: "Your role cannot upload documents" }, { status: 403 });
  const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.code, user.institutionCode) });
  if (!inst) return NextResponse.json({ error: "Unknown institution" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 400 });
  const docType = String(form.get("docType") ?? "Other").slice(0, 80);
  const appRef = form.get("applicationRef") ? String(form.get("applicationRef")) : null;
  const deficiencyId = form.get("deficiencyId") ? Number(form.get("deficiencyId")) : null;
  let folder = String(form.get("folder") ?? "correspondence");

  let applicationId: number | null = null;
  if (appRef) {
    const app = await db.query.applications.findFirst({ where: and(eq(schema.applications.ref, appRef), eq(schema.applications.institutionId, inst.id)) });
    if (!app) return NextResponse.json({ error: "Application not found" }, { status: 404 });
    if (app.status !== "DRAFT" && !deficiencyId) return NextResponse.json({ error: "Submitted applications accept documents only as deficiency evidence" }, { status: 400 });
    applicationId = app.id;
    folder = app.kind === "ACCREDITATION" ? `accreditation/${new Date().getFullYear()}/${app.ref}` : `noc-applications/${app.ref}`;
  }
  if (deficiencyId) {
    const def = await db.query.deficiencies.findFirst({ where: and(eq(schema.deficiencies.id, deficiencyId), eq(schema.deficiencies.institutionId, inst.id)) });
    if (!def) return NextResponse.json({ error: "Deficiency not found" }, { status: 404 });
    folder = `${folder}/${def.ref}`;
  }
  if (!appRef && !DEFAULT_FOLDERS.includes(folder.split("/")[0])) return NextResponse.json({ error: "Unknown folder" }, { status: 400 });

  const [{ v }] = await db
    .select({ v: sql<number>`coalesce(max(version),0)::int` })
    .from(schema.documents)
    .where(and(eq(schema.documents.institutionId, inst.id), eq(schema.documents.folder, folder), eq(schema.documents.docType, docType)));
  const version = v + 1;
  const bytes = Buffer.from(await file.arrayBuffer());
  const stored = await putFile(inst.code, folder, version, file.name, bytes);
  const [doc] = await db
    .insert(schema.documents)
    .values({
      institutionId: inst.id,
      folder: stored.folder,
      docType,
      fileName: file.name,
      storageKey: stored.key,
      version,
      sizeBytes: bytes.length,
      mimeType: file.type || "application/octet-stream",
      sha256: stored.sha256,
      applicationId,
      deficiencyId,
      uploadedBy: user.username,
    })
    .returning();
  await audit(db, { actor: user.username, action: "document.uploaded", entity: "document", entityId: doc.id, details: { folder: stored.folder, docType, version, sha256: stored.sha256 } });
  if (appRef && !deficiencyId) await refreshChecks(appRef);
  return NextResponse.json({ ok: true, id: doc.id, version, sha256: stored.sha256 });
}
