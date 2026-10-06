// Letters and receipts as PDFs: one layout for every decision letter, receipt and registration card,
// so wording and look stay consistent (guide section 14: "standard decision letters from templates").
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { putFileAt } from "./storage";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export type LetterInput = {
  kind: string; // e.g. "Decision letter", "Payment receipt", "Registration card"
  refNo: string;
  date?: Date;
  to?: { name: string; lines?: string[] };
  subject: string;
  paragraphs: string[];
  table?: [string, string][];
  signatory?: { name: string; title: string; signedAt?: Date };
  qrUrl?: string; // live status page the QR opens
  qrCaption?: string;
};

const GREEN = rgb(0.04, 0.24, 0.18);
const EMERALD = rgb(0.04, 0.43, 0.31);
const GREY = rgb(0.36, 0.42, 0.39);

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) > width && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/** Strip characters the standard PDF fonts cannot draw. */
const pdfSafe = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "");

export async function renderLetter(o: LetterInput): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page: PDFPage = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const date = o.date ?? new Date();

  // Letterhead
  page.drawRectangle({ x: 0, y: 772, width: 595, height: 70, color: GREEN });
  page.drawRectangle({ x: 40, y: 790, width: 34, height: 34, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 48, y: 798, width: 18, height: 18, color: EMERALD });
  page.drawText("PHARMACY COUNCIL OF PAKISTAN", { x: 88, y: 812, size: 15, font: bold, color: rgb(1, 1, 1) });
  page.drawText("PCP Digital Portal  |  Islamabad", { x: 88, y: 796, size: 9.5, font, color: rgb(0.85, 0.92, 0.88) });
  page.drawText(pdfSafe(o.kind).toUpperCase(), { x: 595 - 40 - bold.widthOfTextAtSize(pdfSafe(o.kind).toUpperCase(), 9), y: 812, size: 9, font: bold, color: rgb(0.89, 0.79, 0.5) });
  page.drawText("DEMO - fictional data, not an official document", { x: 40, y: 752, size: 8.5, font, color: rgb(0.7, 0.1, 0.1) });

  let y = 720;
  page.drawText(`Ref: ${pdfSafe(o.refNo)}`, { x: 40, y, size: 10, font: bold });
  const ds = date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  page.drawText(ds, { x: 555 - font.widthOfTextAtSize(ds, 10), y, size: 10, font });
  y -= 28;
  if (o.to) {
    page.drawText(pdfSafe(o.to.name), { x: 40, y, size: 10.5, font: bold });
    y -= 14;
    for (const l of o.to.lines ?? []) {
      page.drawText(pdfSafe(l), { x: 40, y, size: 10, font, color: GREY });
      y -= 13;
    }
    y -= 14;
  }
  for (const l of wrap(`Subject: ${pdfSafe(o.subject)}`, bold, 11.5, 515)) {
    page.drawText(l, { x: 40, y, size: 11.5, font: bold });
    y -= 16;
  }
  y -= 8;
  for (const p of o.paragraphs) {
    for (const l of wrap(pdfSafe(p), font, 10.5, 515)) {
      page.drawText(l, { x: 40, y, size: 10.5, font, lineHeight: 14 });
      y -= 14.5;
    }
    y -= 8;
  }
  if (o.table?.length) {
    y -= 4;
    for (const [k, v] of o.table) {
      page.drawLine({ start: { x: 40, y: y + 12 }, end: { x: 555, y: y + 12 }, thickness: 0.4, color: rgb(0.85, 0.88, 0.86) });
      page.drawText(pdfSafe(k), { x: 46, y, size: 9.5, font, color: GREY });
      const vl = wrap(pdfSafe(v), bold, 9.5, 330);
      vl.forEach((l, i) => page.drawText(l, { x: 220, y: y - i * 12, size: 9.5, font: bold }));
      y -= 18 + (vl.length - 1) * 12;
    }
    page.drawLine({ start: { x: 40, y: y + 12 }, end: { x: 555, y: y + 12 }, thickness: 0.4, color: rgb(0.85, 0.88, 0.86) });
  }

  // QR and signature
  const baseY = 90;
  if (o.qrUrl) {
    const png = await QRCode.toBuffer(o.qrUrl, { width: 260, margin: 1 });
    const img = await pdf.embedPng(png);
    page.drawImage(img, { x: 40, y: baseY, width: 96, height: 96 });
    page.drawText(pdfSafe(o.qrCaption ?? "Scan to check the live status"), { x: 40, y: baseY - 12, size: 8, font, color: GREY });
    page.drawText(pdfSafe(o.qrUrl).slice(0, 80), { x: 40, y: baseY - 23, size: 6.5, font, color: GREY });
  }
  if (o.signatory) {
    page.drawLine({ start: { x: 340, y: baseY + 40 }, end: { x: 555, y: baseY + 40 }, thickness: 0.8, color: GREY });
    page.drawText(pdfSafe(o.signatory.name), { x: 340, y: baseY + 26, size: 10.5, font: bold });
    page.drawText(pdfSafe(o.signatory.title), { x: 340, y: baseY + 13, size: 9.5, font });
    const at = (o.signatory.signedAt ?? date).toISOString().replace("T", " ").slice(0, 16);
    page.drawText(`Digitally signed ${at} UTC (demo; production: NIFT certificate)`, { x: 340, y: baseY, size: 7, font, color: GREY });
  }
  page.drawText("Pharmacy Council of Pakistan · PCP Digital Portal demo", { x: 40, y: 30, size: 7.5, font, color: GREY });
  return Buffer.from(await pdf.save());
}

/**
 * File a generated or uploaded PDF in the right folder, as a new version, and record it.
 * Owner is an institution (by id), an onboarding request (by id) or a pharmacist (by id).
 */
export async function fileDocument(
  exec: Executor,
  o: {
    institutionId?: number | null;
    onboardingId?: number | null;
    pharmacistId?: number | null;
    folder: string;
    docType: string;
    fileName: string;
    bytes: Buffer;
    mimeType?: string;
    applicationId?: number | null;
    deficiencyId?: number | null;
    uploadedBy: string;
    verificationStatus?: string;
  },
) {
  let prefix = "misc";
  if (o.institutionId) {
    const inst = await exec.query.institutions.findFirst({ where: eq(schema.institutions.id, o.institutionId) });
    prefix = `institutions/${inst?.code ?? o.institutionId}`;
  } else if (o.onboardingId) {
    const req = await exec.query.onboardingRequests.findFirst({ where: eq(schema.onboardingRequests.id, o.onboardingId) });
    prefix = `onboarding/${req?.ref ?? o.onboardingId}`;
  } else if (o.pharmacistId) {
    const ph = await exec.query.pharmacists.findFirst({ where: eq(schema.pharmacists.id, o.pharmacistId) });
    prefix = `pharmacists/${ph?.regNo ?? o.pharmacistId}`;
  }
  const owner = o.institutionId
    ? eq(schema.documents.institutionId, o.institutionId)
    : o.onboardingId
      ? eq(schema.documents.onboardingId, o.onboardingId)
      : eq(schema.documents.pharmacistId, o.pharmacistId ?? -1);
  const [{ v }] = await exec
    .select({ v: sql<number>`coalesce(max(version),0)::int` })
    .from(schema.documents)
    .where(and(owner, eq(schema.documents.folder, o.folder), eq(schema.documents.docType, o.docType)));
  const version = v + 1;
  const stored = await putFileAt(prefix, o.folder, version, o.fileName, o.bytes);
  const [doc] = await exec
    .insert(schema.documents)
    .values({
      institutionId: o.institutionId ?? null,
      onboardingId: o.onboardingId ?? null,
      pharmacistId: o.pharmacistId ?? null,
      folder: stored.folder,
      docType: o.docType,
      fileName: o.fileName,
      storageKey: stored.key,
      version,
      sizeBytes: o.bytes.length,
      mimeType: o.mimeType ?? "application/pdf",
      sha256: stored.sha256,
      verificationStatus: o.verificationStatus ?? "VERIFIED",
      applicationId: o.applicationId ?? null,
      deficiencyId: o.deficiencyId ?? null,
      uploadedBy: o.uploadedBy,
    })
    .returning();
  return doc;
}

export function publicUrl(path: string) {
  return `${process.env.PUBLIC_BASE_URL ?? "http://localhost:8088"}${path}`;
}
