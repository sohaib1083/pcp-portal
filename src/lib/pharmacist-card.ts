// Registration card: a card-sized PDF (85.6 x 54 mm, front and back) whose QR code opens the live public
// status (guide section 14: "every NOC, accreditation certificate, and registration card carries a QR code").
// The card is filed as a versioned document; a new version is issued only when what it shows changes.
import { createHash } from "node:crypto";
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "./audit";
import { fileDocument, publicUrl } from "./letters";
import { CATEGORY_LABELS, COUNCIL_INFO, STATUS_LABELS, isCouncil } from "./register";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;
type Pharmacist = typeof schema.pharmacists.$inferSelect;

const W = 242.65; // 85.6 mm
const H = 153.07; // 54 mm
const FOREST = rgb(0.04, 0.24, 0.18);
const BRAND = rgb(0.04, 0.43, 0.31);
const GOLD = rgb(0.78, 0.64, 0.29);
const INK = rgb(0.06, 0.12, 0.1);
const GREY = rgb(0.36, 0.42, 0.39);
const LIGHT = rgb(0.91, 0.95, 0.93);

export const cardStatusUrl = (regNo: string) => publicUrl(`/verify?reg=${encodeURIComponent(regNo)}`);

const councilName = (c: string) => (isCouncil(c) ? COUNCIL_INFO[c].name : c);
const day = (iso: string | null | undefined) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "-");
const safe = (s: string) => s.replace(/[–—]/g, "-").replace(/ · /g, " | ").replace(/[^\x20-\x7E]/g, "");

/** What the card shows. When this changes, a new card version is issued. */
export function cardFingerprint(p: Pharmacist) {
  const shown = {
    regNo: p.regNo,
    name: p.fullName,
    father: p.fatherName,
    category: p.category,
    council: p.council,
    issueDate: p.issueDate,
    validUntil: p.validUntil,
    status: p.status,
    practice: p.practiceConfirmed ? [p.practicePlace, p.designation] : null,
    url: cardStatusUrl(p.regNo),
  };
  return createHash("sha256").update(JSON.stringify(shown)).digest("hex");
}

function fit(text: string, font: PDFFont, size: number, max: number) {
  let s = safe(text);
  while (s.length > 3 && font.widthOfTextAtSize(s, size) > max) s = s.slice(0, -2);
  return s === safe(text) ? s : s.trimEnd() + "...";
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const w of safe(text).split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) > width && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function header(page: PDFPage, bold: PDFFont, font: PDFFont, right: string) {
  page.drawRectangle({ x: 0, y: H - 30, width: W, height: 30, color: FOREST });
  page.drawRectangle({ x: 0, y: H - 32, width: W, height: 2, color: GOLD });
  page.drawRectangle({ x: 9, y: H - 25, width: 20, height: 20, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 14, y: H - 20, width: 10, height: 10, color: BRAND });
  page.drawText("PHARMACY COUNCIL OF PAKISTAN", { x: 35, y: H - 14.5, size: 7, font: bold, color: rgb(1, 1, 1) });
  page.drawText("Pharmacist register  |  registration card", { x: 35, y: H - 23.5, size: 5.4, font, color: rgb(0.82, 0.9, 0.86) });
  page.drawText(right, { x: W - 9 - bold.widthOfTextAtSize(right, 6), y: H - 14.5, size: 6, font: bold, color: GOLD });
}

export async function registrationCardPdf(p: Pharmacist, printedAt = new Date()): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Registration card ${p.regNo}`);
  pdf.setSubject("PCP Digital Portal demo - fictional data");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.CourierBold);
  const url = cardStatusUrl(p.regNo);
  const qr = await pdf.embedPng(await QRCode.toBuffer(url, { width: 240, margin: 1, color: { dark: "#0a3d2e", light: "#ffffff" } }));

  // ---------- Front ----------
  const front = pdf.addPage([W, H]);
  front.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
  header(front, bold, font, `CATEGORY ${p.category}`);
  front.drawText(fit(p.fullName, bold, 10.5, 150), { x: 10, y: H - 47, size: 10.5, font: bold, color: INK });
  front.drawText(fit(`Father: ${p.fatherName}`, font, 6, 150), { x: 10, y: H - 56, size: 6, font, color: GREY });
  const rows: [string, string, PDFFont, number][] = [
    ["Registration no.", p.regNo, mono, 7.6],
    ["Category", CATEGORY_LABELS[p.category] ?? p.category, font, 6.4],
    ["Issuing council", councilName(p.council), font, 6.4],
    ["Issued  |  valid until", `${day(p.issueDate)}  |  ${day(p.validUntil)}`, font, 6.4],
  ];
  let y = H - 70;
  for (const [k, v, f, s] of rows) {
    front.drawText(k.toUpperCase(), { x: 10, y, size: 4.6, font: bold, color: GREY });
    front.drawText(fit(v, f, s, 152), { x: 10, y: y - 8, size: s, font: f, color: INK });
    y -= 17.5;
  }
  // QR: opens the live public status
  front.drawRectangle({ x: W - 72, y: 26, width: 63, height: 63, color: rgb(1, 1, 1), borderColor: LIGHT, borderWidth: 0.8 });
  front.drawImage(qr, { x: W - 69.5, y: 28.5, width: 58, height: 58 });
  const cap = "Scan for live status";
  front.drawText(cap, { x: W - 40.5 - font.widthOfTextAtSize(cap, 5) / 2, y: 19.5, size: 5, font, color: GREY });
  const st = `Status when printed: ${STATUS_LABELS[p.status] ?? p.status}`;
  front.drawText(st, { x: W - 40.5 - bold.widthOfTextAtSize(st, 4.6) / 2, y: 92.5, size: 4.6, font: bold, color: p.status === "ACTIVE" ? BRAND : rgb(0.7, 0.1, 0.1) });
  front.drawRectangle({ x: 0, y: 0, width: W, height: 12, color: LIGHT });
  front.drawText("DEMO - fictional data, not an official card", { x: 10, y: 4, size: 4.8, font: bold, color: rgb(0.7, 0.1, 0.1) });
  const printed = `Printed ${printedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  front.drawText(printed, { x: W - 10 - font.widthOfTextAtSize(printed, 4.8), y: 4, size: 4.8, font, color: GREY });

  // ---------- Back ----------
  const back = pdf.addPage([W, H]);
  back.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
  header(back, bold, font, p.regNo);
  y = H - 44;
  const para = (text: string, f = font, size = 5.8, color = INK) => {
    for (const l of wrap(text, f, size, W - 20)) {
      back.drawText(l, { x: 10, y, size, font: f, color });
      y -= size + 2.4;
    }
    y -= 3;
  };
  para(`This card shows an entry in PCP's index of the provincial pharmacy registers. The ${councilName(p.council)} issued this registration and renews it.`);
  para("A registration can be renewed, made dormant, suspended or cancelled after this card was printed. Always check the live status:", font, 5.8, INK);
  para(url, bold, 5.6, BRAND);
  back.drawText("PRACTICE PLACE (CONFIRMED BY PCP)", { x: 10, y, size: 4.6, font: bold, color: GREY });
  y -= 8;
  para(p.practiceConfirmed && p.practicePlace ? `${p.designation ?? ""}, ${p.practicePlace}` : "Not confirmed yet. The pharmacist can add it from the PCP portal.", p.practiceConfirmed ? bold : font, 5.8, p.practiceConfirmed ? INK : GREY);
  back.drawLine({ start: { x: 150, y: 24 }, end: { x: W - 10, y: 24 }, thickness: 0.5, color: GREY });
  back.drawText("Registrar, PCP (demo signature)", { x: 150, y: 17, size: 4.8, font, color: GREY });
  back.drawText("If found, return to PCP, Islamabad.", { x: 10, y: 17, size: 4.8, font, color: GREY });
  back.drawRectangle({ x: 0, y: 0, width: W, height: 9, color: FOREST });
  back.drawText("PCP Digital Portal demo  |  public screens show no CNIC, phone, email or address", { x: 10, y: 3, size: 4.2, font, color: rgb(0.82, 0.9, 0.86) });
  return Buffer.from(await pdf.save());
}

/** The current card document for a pharmacist: reuses the filed card, or files a new version when the details changed. */
export async function ensureCard(exec: Executor, p: Pharmacist, actor: string) {
  const fp = cardFingerprint(p);
  if (p.cardDocumentId && p.cardFingerprint === fp) {
    const doc = await exec.query.documents.findFirst({ where: eq(schema.documents.id, p.cardDocumentId) });
    if (doc) return { doc, issued: false };
  }
  const bytes = await registrationCardPdf(p);
  const doc = await fileDocument(exec, { pharmacistId: p.id, folder: "registration-card", docType: "Registration card", fileName: `registration-card-${p.regNo}.pdf`, bytes, uploadedBy: actor, verificationStatus: "VERIFIED" });
  await exec.update(schema.pharmacists).set({ cardDocumentId: doc.id, cardFingerprint: fp }).where(eq(schema.pharmacists.id, p.id));
  await exec.insert(schema.pharmacistEvents).values({ pharmacistId: p.id, kind: "CARD", note: `Registration card version ${doc.version} issued (status ${STATUS_LABELS[p.status] ?? p.status}).`, actor });
  await audit(exec, { actor, action: "pharmacist.card.issued", entity: "pharmacist", entityId: p.regNo, details: { documentId: doc.id, version: doc.version, sha256: doc.sha256 } });
  return { doc, issued: true };
}

/** Data URL of the card's QR code, for the on-screen card preview. */
export async function cardQrDataUrl(regNo: string) {
  return QRCode.toDataURL(cardStatusUrl(regNo), { width: 240, margin: 1, color: { dark: "#0a3d2e", light: "#ffffff" } });
}
