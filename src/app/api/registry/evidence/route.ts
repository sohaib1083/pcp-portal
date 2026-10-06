import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { fileDocument } from "@/lib/letters";
import { can } from "@/lib/roles";
import { getUser } from "@/lib/session";

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ["application/pdf", "image/png", "image/jpeg"];

/**
 * Result evidence for the annual student update and for correction requests.
 * Filed under the institution's student documents as a new version; never overwrites an earlier file.
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user || user.kind !== "institution" || !user.institutionCode) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  if (!can(user.roles, "inst.annual.file")) return NextResponse.json({ error: "Only the examination officer or the head of institution files annual returns" }, { status: 403 });
  const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.code, user.institutionCode) });
  if (!inst) return NextResponse.json({ error: "Unknown institution" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  const ref = String(form.get("ref") ?? "");
  const kind = String(form.get("kind") ?? "annual-return");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "The file is larger than 10 MB. Compress it and upload again." }, { status: 400 });
  if (!TYPES.includes(file.type)) return NextResponse.json({ error: "Upload a PDF, PNG or JPEG file." }, { status: 400 });
  if (!new RegExp(`^AR-\\d{4}-${inst.shortCode}-(PHARMD|TECH)$`).test(ref)) return NextResponse.json({ error: "Unknown annual return" }, { status: 400 });

  const doc = await fileDocument(db, {
    institutionId: inst.id,
    folder: `student-documents/annual-returns/${ref}`,
    docType: kind === "correction" ? "Correction evidence" : "Result evidence",
    fileName: file.name,
    bytes: Buffer.from(await file.arrayBuffer()),
    mimeType: file.type,
    uploadedBy: user.username,
    verificationStatus: "PENDING",
  });
  await audit(db, { actor: user.username, action: "document.uploaded", entity: "document", entityId: doc.id, details: { folder: doc.folder, docType: doc.docType, version: doc.version, sha256: doc.sha256 } });
  return NextResponse.json({ ok: true, id: doc.id, fileName: doc.fileName, version: doc.version });
}
