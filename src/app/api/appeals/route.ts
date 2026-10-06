import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { nextModuleRef, notifyOn } from "@/lib/council";
import { appealBlocks } from "@/lib/council-data";
import { fileDocument } from "@/lib/letters";
import { can } from "@/lib/roles";
import { getUser } from "@/lib/session";

const MAX_BYTES = 10 * 1024 * 1024;
const OPEN = ["FILED", "UNDER_REVIEW", "ON_AGENDA"];

/**
 * File an appeal against a council decision (rejection or deferral), with grounds and evidence.
 * Multipart, so evidence up to 10 MB works. Head of institution or principal only, own institution only.
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user || user.kind !== "institution" || !user.institutionCode) return NextResponse.json({ error: "Sign in as an institution user." }, { status: 403 });
  if (!can(user.roles, "inst.appeal.file")) return NextResponse.json({ error: "Only the head of institution or the principal can file an appeal." }, { status: 403 });
  const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.code, user.institutionCode) });
  if (!inst) return NextResponse.json({ error: "Unknown institution" }, { status: 403 });

  const form = await req.formData();
  const caseRef = String(form.get("caseRef") ?? "");
  const grounds = String(form.get("grounds") ?? "").trim();
  const file = form.get("file");
  if (grounds.length < 20) return NextResponse.json({ error: "State your grounds of appeal in at least 20 characters." }, { status: 400 });
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Attach the evidence that supports your appeal." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "The evidence file is larger than 10 MB. Compress it or split it." }, { status: 400 });
  if (!["application/pdf", "image/png", "image/jpeg"].includes(file.type)) return NextResponse.json({ error: "Attach the evidence as a PDF, PNG or JPEG file." }, { status: 400 });

  const app = await db.query.applications.findFirst({ where: and(eq(schema.applications.ref, caseRef), eq(schema.applications.institutionId, inst.id)) });
  if (!app) return NextResponse.json({ error: "Choose one of your institution's cases." }, { status: 404 });
  if (!["REJECTED", "DEFERRED"].includes(app.status)) return NextResponse.json({ error: `Only a rejection or a deferral can be appealed. ${app.ref} is not one.` }, { status: 400 });
  const open = await db.query.appeals.findFirst({ where: and(eq(schema.appeals.applicationId, app.id), inArray(schema.appeals.status, OPEN)) });
  if (open) return NextResponse.json({ error: `${app.ref} already has an open appeal (${open.ref}).` }, { status: 400 });
  const prior = await db.select().from(schema.appeals).where(eq(schema.appeals.applicationId, app.id));
  const dismissed = prior.find((p) => appealBlocks(p, app.decidedAt));
  if (dismissed) return NextResponse.json({ error: `The council already heard an appeal on this decision (${dismissed.ref}, dismissed). A decision can be appealed once.` }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const result = await db.transaction(async (tx) => {
    const ref = await nextModuleRef(tx, "appeals", "APL", 4);
    const doc = await fileDocument(tx, {
      institutionId: inst.id,
      folder: `correspondence/appeals/${ref}`,
      docType: "Appeal evidence",
      fileName: file.name || "evidence.pdf",
      bytes,
      mimeType: file.type || "application/octet-stream",
      applicationId: app.id,
      uploadedBy: user.username,
      verificationStatus: "PENDING",
    });
    await tx.insert(schema.appeals).values({ ref, applicationId: app.id, institutionId: inst.id, grounds, evidenceDocumentId: doc.id, filedBy: user.username });
    await notifyOn(tx, "role:pcp_officer", `New appeal ${ref} on ${app.ref}`, `${inst.shortCode} appeals the council's ${app.status === "REJECTED" ? "rejection" : "deferral"} of ${app.ref}.`, `/pcp/appeals/${ref}`, "appeal", ref);
    await notifyOn(tx, `inst:${inst.code}`, `Appeal ${ref} received`, `PCP received your appeal against the decision on ${app.ref}. An officer reviews it before it goes to the council.`, `/institution/appeals/${ref}`, "appeal", ref);
    await audit(tx, { actor: user.username, action: "document.uploaded", entity: "document", entityId: doc.id, details: { folder: doc.folder, docType: doc.docType, sha256: doc.sha256 } });
    await audit(tx, { actor: user.username, action: "appeal.filed", entity: "appeal", entityId: ref, details: { case: app.ref, decision: app.status, evidence: doc.id } });
    return { ref, sha256: doc.sha256 };
  });
  return NextResponse.json({ ok: true, ref: result.ref, sha256: result.sha256 });
}
