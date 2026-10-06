import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { fileDocument } from "@/lib/letters";
import { requiredDocs } from "@/lib/onboarding";
import { getUser } from "@/lib/session";

const MAX_BYTES = 10 * 1024 * 1024;

/** An applicant uploads a legal document to their own onboarding request (before an Institution ID exists). */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user || !user.roles.includes("inst_applicant")) return NextResponse.json({ error: "Only an institution applicant can upload here" }, { status: 403 });
  const request = await db.query.onboardingRequests.findFirst({ where: eq(schema.onboardingRequests.applicantUsername, user.username) });
  if (!request) return NextResponse.json({ error: "No registration is linked to your account" }, { status: 404 });
  if (!["DRAFT", "RETURNED"].includes(request.status)) return NextResponse.json({ error: "Your request is with PCP or closed, so documents cannot change now" }, { status: 400 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "The file is larger than 10 MB. Upload a smaller scan." }, { status: 400 });
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isImage = /^image\/(png|jpeg)$/.test(file.type);
  if (!isPdf && !isImage) return NextResponse.json({ error: "Upload a PDF, JPG or PNG file" }, { status: 400 });
  const docType = String(form.get("docType") ?? "");
  if (!(await requiredDocs()).includes(docType)) return NextResponse.json({ error: "Unknown document type" }, { status: 400 });

  const doc = await fileDocument(db, {
    onboardingId: request.id,
    folder: "legal-documents",
    docType,
    fileName: file.name,
    bytes: Buffer.from(await file.arrayBuffer()),
    mimeType: isPdf ? "application/pdf" : file.type,
    uploadedBy: user.username,
    verificationStatus: "PENDING",
  });
  await audit(db, { actor: user.username, action: "document.uploaded", entity: "document", entityId: doc.id, details: { onboarding: request.ref, docType, version: doc.version, sha256: doc.sha256 } });
  return NextResponse.json({ ok: true, id: doc.id, version: doc.version, sha256: doc.sha256 });
}
