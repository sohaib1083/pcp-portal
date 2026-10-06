// Report exports: Excel (exceljs), PDF (pdf-lib, headed like the letters from renderLetter) and CSV.
// Guide section 14: "Export to Excel and PDF".
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatCell, type Cell, type Report, type ReportCol } from "./report-types";

export type ExportMeta = { filters: string; generatedBy: string; generatedAt?: Date };
export type ExportTable = { title: string; sub?: string; columns: ReportCol[]; rows: { cells: Record<string, Cell>; flag?: "bad" | "warn" | null; total?: boolean }[]; notes?: string[] };

export const toTable = (r: Report): ExportTable => ({ title: r.title, sub: r.sub, columns: r.columns, rows: r.rows, notes: r.notes });

const NUMERIC = new Set(["int", "pct", "num", "money"]);

// ---------- CSV ----------

export function tableCsv(t: ExportTable) {
  const data = t.rows.map((r) => t.columns.map((c) => {
    const v = r.cells[c.key];
    if (v === null || v === undefined) return "";
    if (typeof v === "number" && c.type === "pct") return Math.round(v * 1000) / 10; // percent
    return v;
  }));
  const fields = t.columns.map((c) => (c.type === "pct" ? `${c.title} (%)` : c.title));
  return "﻿" + Papa.unparse({ fields, data }, { newline: "\r\n" });
}

// ---------- Excel ----------

export async function tableXlsx(t: ExportTable, meta: ExportMeta) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PCP Digital Portal (demo)";
  wb.created = meta.generatedAt ?? new Date();
  const ws = wb.addWorksheet(t.title.replace(/[\\/?*[\]:]/g, " ").slice(0, 31), { views: [{ state: "frozen", ySplit: 7 }] });
  const n = t.columns.length;
  const head = (row: number, text: string, font: Partial<ExcelJS.Font>) => {
    ws.mergeCells(row, 1, row, Math.max(n, 1));
    const c = ws.getCell(row, 1);
    c.value = text;
    c.font = font;
    c.alignment = { wrapText: true, vertical: "top" };
  };
  head(1, `Pharmacy Council of Pakistan · ${t.title}`, { bold: true, size: 14, color: { argb: "FF0A3D2E" } });
  head(2, t.sub ?? "", { size: 10, color: { argb: "FF5B6B64" } });
  head(3, `Filters: ${meta.filters || "none"}`, { size: 10 });
  head(4, `Generated ${(meta.generatedAt ?? new Date()).toISOString().replace("T", " ").slice(0, 16)} UTC by ${meta.generatedBy}`, { size: 10, color: { argb: "FF5B6B64" } });
  head(5, "DEMO: fictional data, not an official statistic", { size: 9, color: { argb: "FFB4141F" } });
  ws.getRow(2).height = 28;

  const header = ws.getRow(7);
  t.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.type === "pct" ? `${c.title} (%)` : c.title;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B6E4F" } };
    cell.alignment = { vertical: "middle", horizontal: NUMERIC.has(c.type ?? "") ? "right" : "left", wrapText: true };
  });
  header.height = 22;

  t.rows.forEach((r, ri) => {
    const row = ws.getRow(8 + ri);
    t.columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const v = r.cells[c.key];
      if (v === null || v === undefined || v === "") cell.value = null;
      else if (c.type === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
        cell.value = new Date(`${v.slice(0, 10)}T00:00:00Z`);
        cell.numFmt = "dd mmm yyyy";
      } else if (typeof v === "number") {
        cell.value = v;
        cell.numFmt = c.type === "pct" ? "0%" : c.type === "num" ? "0.0" : c.type === "code" || c.type === "text" ? "0" : "#,##0";
      } else cell.value = v;
      if (r.total) cell.font = { bold: true };
      if (r.flag) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: r.flag === "bad" ? "FFFFF1F0" : "FFFFF7E6" } };
    });
  });
  if (t.rows.length) ws.autoFilter = { from: { row: 7, column: 1 }, to: { row: 7 + t.rows.length, column: n } };
  t.columns.forEach((c, i) => {
    const longest = Math.max(c.title.length, ...t.rows.map((r) => formatCell(r.cells[c.key], c.type).length));
    ws.getColumn(i + 1).width = Math.min(48, Math.max(10, longest + 2));
  });
  let y = 9 + t.rows.length;
  for (const note of t.notes ?? []) {
    head(y++, note, { italic: true, size: 9, color: { argb: "FF5B6B64" } });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- PDF ----------

const GREEN = rgb(0.04, 0.24, 0.18);
const EMERALD = rgb(0.04, 0.43, 0.31);
const GREY = rgb(0.36, 0.42, 0.39);
const LINE = rgb(0.85, 0.88, 0.86);

/** Standard PDF fonts only draw Latin-1: replace the few symbols the portal uses, drop the rest. */
const safe = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/·/g, "-")
    .replace(/→/g, "->")
    .replace(/•/g, "*")
    .replace(/[^\x20-\x7E]/g, "");

function fit(text: string, font: PDFFont, size: number, width: number) {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let s = text;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}...`, size) > width) s = s.slice(0, -1);
  return `${s}...`;
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) > width && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

export async function tablePdf(t: ExportTable, meta: ExportMeta) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${t.title} (PCP demo)`);
  pdf.setAuthor("Pharmacy Council of Pakistan · PCP Digital Portal demo");
  pdf.setCreator("PCP Digital Portal");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 842;
  const H = 595;
  const M = 36;
  const usable = W - 2 * M;
  const size = 8.5;
  const at = meta.generatedAt ?? new Date();

  // Column widths: natural width of the content, shrunk proportionally if the table is too wide.
  const text = (r: ExportTable["rows"][number], c: ReportCol) => safe(formatCell(r.cells[c.key], c.type));
  const natural = t.columns.map((c) =>
    Math.min(260, Math.max(bold.widthOfTextAtSize(safe(c.title), size), ...t.rows.slice(0, 400).map((r) => (r.total ? bold : font).widthOfTextAtSize(text(r, c), size))) + 12),
  );
  const totalW = natural.reduce((a, b) => a + b, 0);
  // Too wide: trim the widest column a point at a time, so short columns (IDs, statuses, numbers) stay whole.
  const widths = [...natural];
  if (totalW > usable) {
    let excess = totalW - usable;
    while (excess > 0) {
      const i = widths.indexOf(Math.max(...widths));
      if (widths[i] <= 40) break;
      widths[i] -= 1;
      excess -= 1;
    }
    if (excess > 0) widths.forEach((w, i) => (widths[i] = (w / (usable + excess)) * usable));
  } else widths.forEach((w, i) => (widths[i] = w + (usable - totalW) / widths.length));

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const letterhead = (first: boolean) => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: H - 58, width: W, height: 58, color: GREEN });
    page.drawRectangle({ x: M, y: H - 47, width: 34, height: 34, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: M + 8, y: H - 39, width: 18, height: 18, color: EMERALD });
    page.drawText("PHARMACY COUNCIL OF PAKISTAN", { x: M + 48, y: H - 28, size: 14, font: bold, color: rgb(1, 1, 1) });
    page.drawText("PCP Digital Portal  |  Islamabad", { x: M + 48, y: H - 42, size: 9, font, color: rgb(0.85, 0.92, 0.88) });
    const kind = "REPORT";
    page.drawText(kind, { x: W - M - bold.widthOfTextAtSize(kind, 9), y: H - 28, size: 9, font: bold, color: rgb(0.89, 0.79, 0.5) });
    page.drawText("DEMO - fictional data, not an official statistic", { x: M, y: H - 72, size: 8, font, color: rgb(0.7, 0.1, 0.1) });
    const ds = at.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    page.drawText(ds, { x: W - M - font.widthOfTextAtSize(ds, 9), y: H - 72, size: 9, font });
    y = H - 94;
    if (first) {
      page.drawText(safe(t.title), { x: M, y, size: 15, font: bold, color: rgb(0.06, 0.12, 0.1) });
      y -= 16;
      for (const l of wrap(safe(t.sub ?? ""), font, 9.5, usable)) {
        page.drawText(l, { x: M, y, size: 9.5, font, color: GREY });
        y -= 12;
      }
      y -= 2;
      for (const l of wrap(safe(`Filters: ${meta.filters || "none"}   |   Generated ${at.toISOString().replace("T", " ").slice(0, 16)} UTC by ${meta.generatedBy}`), font, 8.5, usable)) {
        page.drawText(l, { x: M, y, size: 8.5, font, color: GREY });
        y -= 11;
      }
      y -= 8;
    } else {
      page.drawText(`${safe(t.title)} (continued)`, { x: M, y, size: 11, font: bold });
      y -= 18;
    }
    tableHeader();
  };

  const tableHeader = () => {
    page.drawRectangle({ x: M, y: y - 5, width: usable, height: 18, color: rgb(0.91, 0.95, 0.93) });
    let x = M;
    t.columns.forEach((c, i) => {
      const label = fit(safe(c.title), bold, size, widths[i] - 8);
      const right = NUMERIC.has(c.type ?? "");
      page.drawText(label, { x: right ? x + widths[i] - 4 - bold.widthOfTextAtSize(label, size) : x + 4, y, size, font: bold, color: rgb(0.04, 0.24, 0.18) });
      x += widths[i];
    });
    y -= 18;
  };

  letterhead(true);
  if (!t.rows.length) {
    page.drawText("No rows match these filters.", { x: M + 4, y, size: 9.5, font, color: GREY });
    y -= 16;
  }
  for (const r of t.rows) {
    if (y < 52) letterhead(false);
    if (r.flag) page.drawRectangle({ x: M, y: y - 4, width: usable, height: 15, color: r.flag === "bad" ? rgb(1, 0.945, 0.94) : rgb(1, 0.97, 0.9) });
    let x = M;
    const f = r.total ? bold : font;
    t.columns.forEach((c, i) => {
      const s = fit(text(r, c), f, size, widths[i] - 8);
      const right = NUMERIC.has(c.type ?? "");
      page.drawText(s, { x: right ? x + widths[i] - 4 - f.widthOfTextAtSize(s, size) : x + 4, y, size, font: f, color: rgb(0.06, 0.12, 0.1) });
      x += widths[i];
    });
    page.drawLine({ start: { x: M, y: y - 5 }, end: { x: M + usable, y: y - 5 }, thickness: 0.4, color: LINE });
    y -= 15;
  }
  y -= 8;
  for (const note of t.notes ?? []) {
    for (const l of wrap(safe(note), font, 8, usable)) {
      if (y < 40) letterhead(false);
      page.drawText(l, { x: M, y, size: 8, font, color: GREY });
      y -= 11;
    }
  }
  pages.forEach((p, i) => {
    p.drawText("Pharmacy Council of Pakistan - PCP Digital Portal demo", { x: M, y: 20, size: 7.5, font, color: GREY });
    const pn = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pn, { x: W - M - font.widthOfTextAtSize(pn, 7.5), y: 20, size: 7.5, font, color: GREY });
  });
  return Buffer.from(await pdf.save());
}
