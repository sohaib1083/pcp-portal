import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export function verifyUrl(certNo: string) {
  return `${process.env.PUBLIC_BASE_URL ?? "http://localhost:8088"}/verify/certificate/${certNo}`;
}

export async function certificateQrDataUrl(certNo: string) {
  return QRCode.toDataURL(verifyUrl(certNo), { width: 220, margin: 1 });
}

/** NOC or accreditation certificate PDF with a QR code pointing at the public verification page. */
export async function certificatePdf(o: {
  kind?: string; // NOC (default) | ACCREDITATION | RENEWAL
  validFrom?: string;
  certNo: string;
  institution: string;
  institutionCode: string;
  city: string;
  program: string;
  intake: number;
  issuedAt: Date;
  validUntil: string;
  decisionNote?: string | null;
}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const green = rgb(0.04, 0.43, 0.31);
  page.drawRectangle({ x: 24, y: 24, width: 547, height: 794, borderColor: green, borderWidth: 3 });
  page.drawText("PHARMACY COUNCIL OF PAKISTAN", { x: 140, y: 760, size: 18, font: bold, color: green });
  const acc = !!o.kind && o.kind !== "NOC";
  const title = acc ? "Accreditation Certificate" : "No Objection Certificate";
  page.drawText(`DEMO CERTIFICATE - fictional data, not a real ${acc ? "accreditation" : "NOC"}`, { x: 140, y: 740, size: 10, font, color: rgb(0.7, 0.1, 0.1) });
  page.drawText(title, { x: (595 - bold.widthOfTextAtSize(title, 22)) / 2, y: 690, size: 22, font: bold });
  const lines = [
    ["Certificate no.", o.certNo],
    ["Institution", `${o.institution} (${o.institutionCode})`],
    ["City", o.city],
    ["Program", o.program],
    [acc ? "Accredited annual intake" : "Approved annual intake", String(o.intake)],
    ...(acc ? [["Type", o.kind === "RENEWAL" ? "Renewal of accreditation" : "First accreditation"], ["Accredited from", o.validFrom ?? o.issuedAt.toISOString().slice(0, 10)]] : []),
    ["Issued", o.issuedAt.toISOString().slice(0, 10)],
    ["Valid until", o.validUntil],
  ];
  lines.forEach(([k, v], i) => {
    page.drawText(k, { x: 70, y: 630 - i * 28, size: 12, font, color: rgb(0.35, 0.35, 0.35) });
    page.drawText(v, { x: 240, y: 630 - i * 28, size: 12, font: bold });
  });
  if (o.decisionNote) page.drawText(`Council note: ${o.decisionNote}`.slice(0, 90), { x: 70, y: 620 - lines.length * 28, size: 10, font });
  const png = await QRCode.toBuffer(verifyUrl(o.certNo), { width: 300, margin: 1 });
  const img = await pdf.embedPng(png);
  page.drawImage(img, { x: 70, y: 150, width: 150, height: 150 });
  page.drawText("Scan to verify this certificate", { x: 70, y: 135, size: 10, font });
  page.drawText("Secretary, Pharmacy Council of Pakistan", { x: 320, y: 190, size: 11, font: bold });
  page.drawText("Digitally signed (demo; production uses a NIFT certificate)", { x: 300, y: 172, size: 8, font });
  return Buffer.from(await pdf.save());
}
