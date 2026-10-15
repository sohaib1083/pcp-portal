import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { fileCourtDocument, fileLetterDocument, shortDay } from "@/lib/governance";
import { can } from "@/lib/roles";
import { getActiveUser } from "@/lib/session";

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = /^(application\/pdf|image\/(jpeg|png))$/;
const COURT_DOCS = ["Petition", "Para-wise comments", "Reply", "Order", "Stay order", "Judgment", "Power of attorney", "Other court paper"];

/**
 * File a court paper (PCP's litigation file) or a scanned letter (the correspondence register) as a new version.
 * Multipart: target=court|letter, ref, docType, and for a court order orderId. Permission-checked and audited.
 */
export async function POST(req: Request) {
  const user = await getActiveUser();
  if (!user || user.kind !== "pcp") return NextResponse.json({ error: "Sign in as a PCP officer." }, { status: 403 });
  const form = await req.formData();
  const target = String(form.get("target") ?? "");
  const ref = String(form.get("ref") ?? "");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Attach the file." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: `${file.name} is larger than 10 MB. Scan at a lower resolution or split it.` }, { status: 400 });
  if (!TYPES.test(file.type)) return NextResponse.json({ error: "Attach a PDF, PNG or JPEG file." }, { status: 400 });
  const bytes = Buffer.from(await file.arrayBuffer());

  if (target === "court") {
    if (!can(user.roles, "pcp.litigation.manage")) return NextResponse.json({ error: "Only the legal officer or the Secretary files court papers." }, { status: 403 });
    const c = await db.query.courtCases.findFirst({ where: eq(schema.courtCases.ref, ref) });
    if (!c) return NextResponse.json({ error: `Court case ${ref} was not found.` }, { status: 404 });
    const orderId = form.get("orderId") ? Number(form.get("orderId")) : null;
    const order = orderId ? await db.query.courtOrders.findFirst({ where: and(eq(schema.courtOrders.id, orderId), eq(schema.courtOrders.courtCaseId, c.id)) }) : null;
    if (orderId && !order) return NextResponse.json({ error: "That order is not on this case." }, { status: 404 });
    const docType = order ? (order.kind === "STAY" ? "Stay order" : order.kind === "FINAL" ? "Judgment" : "Order") + ` of ${shortDay(order.orderDate)}` : String(form.get("docType") ?? "");
    if (!order && !COURT_DOCS.includes(docType)) return NextResponse.json({ error: `Choose the kind of paper: ${COURT_DOCS.join(", ")}.` }, { status: 400 });
    const doc = await db.transaction(async (tx) => {
      const d = await fileCourtDocument(tx, { ref: c.ref, docType, fileName: file.name || "court-paper.pdf", bytes, mimeType: file.type, uploadedBy: user.username });
      if (order) await tx.update(schema.courtOrders).set({ documentId: d.id }).where(eq(schema.courtOrders.id, order.id));
      await tx.update(schema.courtCases).set({ updatedAt: new Date() }).where(eq(schema.courtCases.id, c.id));
      await audit(tx, { actor: user.username, action: "litigation.document.filed", entity: "court_case", entityId: c.ref, details: { document: d.id, docType, version: d.version, sha256: d.sha256 } });
      return d;
    });
    return NextResponse.json({ ok: true, id: doc.id, version: doc.version, message: `${docType} filed as version ${doc.version}.` });
  }

  if (target === "letter") {
    const l = await db.query.correspondence.findFirst({ where: eq(schema.correspondence.ref, ref) });
    if (!l) return NextResponse.json({ error: `Letter ${ref} was not found.` }, { status: 404 });
    if (!can(user.roles, "pcp.correspondence.manage") && l.markedTo !== user.username) return NextResponse.json({ error: "Only a register keeper or the officer the letter is marked to can file its scan." }, { status: 403 });
    const docType = l.direction === "IN" ? "Scanned letter" : "Signed copy";
    const doc = await db.transaction(async (tx) => {
      const d = await fileLetterDocument(tx, l, { docType, fileName: file.name || `${l.ref}.pdf`, bytes, mimeType: file.type, uploadedBy: user.username });
      // An inward letter's scan is its document; an outward letter keeps its generated PDF and adds the signed copy.
      if (l.direction === "IN") await tx.update(schema.correspondence).set({ documentId: d.id, updatedAt: new Date() }).where(eq(schema.correspondence.id, l.id));
      await audit(tx, { actor: user.username, action: "correspondence.document.filed", entity: "correspondence", entityId: l.ref, details: { document: d.id, docType, version: d.version, sha256: d.sha256, folder: d.folder } });
      return d;
    });
    return NextResponse.json({ ok: true, id: doc.id, version: doc.version, message: `${docType} filed as version ${doc.version}${l.partyInstitutionId ? " in the institution's Correspondence folder" : ""}.` });
  }

  return NextResponse.json({ error: "Unknown target" }, { status: 400 });
}
