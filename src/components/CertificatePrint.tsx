"use client";
import Link from "next/link";
import { Button, Space } from "antd";
import { ArrowLeftOutlined, FilePdfOutlined, PrinterOutlined } from "@ant-design/icons";
import { Logo, fmtDate } from "./common";

type C = { no: string; kind?: string; term?: string | null; institution: string; code: string; city: string; province: string; program: string; intake: number; issuedAt: string | null; validUntil: string | null; note: string | null; qr: string; verifyUrl: string; pdfId: number | null; back: string };

export default function CertificatePrint({ c }: { c: C }) {
  const acc = !!c.kind && c.kind !== "NOC";
  return (
    <div style={{ background: "linear-gradient(180deg,#0a3d2e 0,#0a3d2e 220px,#eef2f0 220px)", minHeight: "100vh", padding: 24 }}>
      <Space className="no-print" style={{ marginBottom: 16 }}>
        <Link href={c.back}><Button icon={<ArrowLeftOutlined />}>Back</Button></Link>
        <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>Print</Button>
        {c.pdfId ? <a href={`/api/documents/${c.pdfId}`} target="_blank" rel="noreferrer"><Button icon={<FilePdfOutlined />}>Signed PDF</Button></a> : null}
      </Space>
      <div style={{ maxWidth: 780, margin: "0 auto", background: "#fffdf8", border: "6px double #0b6e4f", outline: "1px solid #c8a24a", outlineOffset: -14, padding: "48px 56px", fontFamily: "Georgia, serif", boxShadow: "0 24px 60px rgba(0,0,0,.18)" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
          <Logo size={54} variant="dark" />
        </div>
        <div style={{ textAlign: "center", color: "#0b6e4f", fontSize: 26, fontWeight: 700, letterSpacing: 1 }}>PHARMACY COUNCIL OF PAKISTAN</div>
        <div style={{ textAlign: "center", color: "#b00", fontSize: 12, marginTop: 4 }}>DEMO CERTIFICATE · fictional data · not a real {acc ? "accreditation" : "NOC"}</div>
        <div style={{ textAlign: "center", fontSize: 30, margin: "28px 0 8px" }}>{acc ? "Accreditation Certificate" : "No Objection Certificate"}</div>
        <div style={{ textAlign: "center", fontFamily: "monospace", fontSize: 15 }}>{c.no}</div>
        {acc ? (
          <p style={{ fontSize: 17, lineHeight: 1.7, marginTop: 28 }}>
            This is to certify that the <b>{c.program}</b> programme of <b>{c.institution}</b> ({c.code}), {c.city}, {c.province}, is <b>accredited</b> by the Pharmacy Council of Pakistan{c.term ? <> for the term <b>{c.term}</b></> : null} with an annual intake of <b>{c.intake}</b> students.
          </p>
        ) : (
          <p style={{ fontSize: 17, lineHeight: 1.7, marginTop: 28 }}>
            This is to certify that the Pharmacy Council of Pakistan has <b>no objection</b> to <b>{c.institution}</b> ({c.code}), {c.city}, {c.province}, offering the <b>{c.program}</b> program with an approved annual intake of <b>{c.intake}</b> students.
          </p>
        )}
        {c.note ? <p style={{ fontSize: 14, color: "#444" }}>Council note: {c.note}</p> : null}
        <table style={{ fontSize: 15, marginTop: 12 }}>
          <tbody>
            <tr><td style={{ paddingRight: 24, color: "#666" }}>Issued</td><td>{fmtDate(c.issuedAt)}</td></tr>
            <tr><td style={{ paddingRight: 24, color: "#666" }}>Valid until</td><td>{fmtDate(c.validUntil)}</td></tr>
          </tbody>
        </table>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 48 }}>
          <div style={{ textAlign: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.qr} alt="Verification QR code" width={140} height={140} />
            <div style={{ fontSize: 11, color: "#555" }}>Scan to verify</div>
            <div style={{ fontSize: 10, color: "#888", fontFamily: "monospace" }}>{c.verifyUrl}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ borderTop: "1px solid #333", width: 240, paddingTop: 6 }}>Secretary</div>
            <div style={{ fontSize: 13 }}>Pharmacy Council of Pakistan</div>
            <div style={{ fontSize: 11, color: "#777" }}>Digitally signed (production: NIFT certificate)</div>
          </div>
        </div>
      </div>
    </div>
  );
}
