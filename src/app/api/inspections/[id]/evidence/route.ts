import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { fileDocument } from "@/lib/letters";
import { can } from "@/lib/roles";
import { getUser } from "@/lib/session";

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;

/**
 * A photo or document for one checklist line, sent by the team lead when the report goes in
 * (straight away when online, or later from the tablet's queue). Filed in the case's inspection folder.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user || !can(user.roles, "pcp.inspection.submit")) return NextResponse.json({ error: "Only an inspection lead can add evidence" }, { status: 403 });
  const insp = await db.query.inspections.findFirst({ where: eq(schema.inspections.id, Number((await params).id)) });
  if (!insp) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
  if (insp.inspector !== user.username) return NextResponse.json({ error: "Only the team lead adds evidence to this visit" }, { status: 403 });
  if (insp.status !== "SCHEDULED") return NextResponse.json({ error: "This inspection report has already been submitted" }, { status: 409 });
  const app = await db.query.applications.findFirst({ where: eq(schema.applications.id, insp.applicationId) });
  if (!app) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file");
  const line = Number(form.get("line"));
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: `${file.name} is larger than 10 MB` }, { status: 400 });
  if (!TYPES.test(file.type)) return NextResponse.json({ error: `${file.name}: send a photo (JPEG, PNG, WebP, HEIC) or a PDF` }, { status: 400 });
  if (!Number.isInteger(line) || line < 1) return NextResponse.json({ error: "Missing checklist line" }, { status: 400 });

  const doc = await fileDocument(db, {
    institutionId: insp.institutionId,
    folder: `inspection-reports/${app.ref}/evidence`,
    docType: `Line ${line}: ${file.name}`.slice(0, 80),
    fileName: file.name,
    bytes: Buffer.from(await file.arrayBuffer()),
    mimeType: file.type,
    applicationId: app.id,
    uploadedBy: user.username,
  });
  await audit(db, { actor: user.username, action: "inspection.evidence_added", entity: "application", entityId: app.ref, details: { inspection: insp.id, line, file: file.name, document: doc.id } });
  return NextResponse.json({ ok: true, id: doc.id, name: file.name });
}
