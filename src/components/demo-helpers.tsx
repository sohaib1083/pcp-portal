"use client";
import { useState } from "react";
import { Button } from "antd";
import { FilePdfOutlined, ThunderboltOutlined } from "@ant-design/icons";

/** Presenter conveniences (autofill, sample files). Shown only in the demo build. */
export const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

export async function samplePdf(label: string): Promise<File> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({ x: 0, y: 782, width: 595, height: 60, color: rgb(0.04, 0.24, 0.18) });
  page.drawText("Riverside University of Health Sciences", { x: 40, y: 806, size: 14, font: bold, color: rgb(1, 1, 1) });
  page.drawText(label, { x: 40, y: 720, size: 20, font: bold, color: rgb(0.06, 0.12, 0.1) });
  page.drawText("Sample document generated for the PCP Digital Portal demo. Fictional data.", { x: 40, y: 690, size: 11, font, color: rgb(0.35, 0.42, 0.39) });
  page.drawText(`Generated ${new Date().toLocaleString("en-GB")}`, { x: 40, y: 670, size: 11, font, color: rgb(0.35, 0.42, 0.39) });
  const bytes = await doc.save();
  const name = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + ".pdf";
  return new File([bytes as BlobPart], name, { type: "application/pdf" });
}

export function FillDemo({ onClick, label = "Fill demo values" }: { onClick: () => void; label?: string }) {
  if (!DEMO) return null;
  return (
    <Button size="small" type="dashed" icon={<ThunderboltOutlined />} onClick={onClick} style={{ borderColor: "#e3c97f", color: "#8a6a1c", background: "#fffbf0" }}>
      {label}
    </Button>
  );
}

/** Generates a small PDF named after the document and hands it to the normal upload path. */
export function SamplePdfButton({ docLabel, onFile, label = "Attach sample PDF" }: { docLabel: string; onFile: (f: File) => Promise<void> | void; label?: string }) {
  const [busy, setBusy] = useState(false);
  if (!DEMO) return null;
  return (
    <Button
      size="small"
      icon={<FilePdfOutlined />}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onFile(await samplePdf(docLabel));
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </Button>
  );
}
