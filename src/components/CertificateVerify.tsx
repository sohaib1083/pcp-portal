"use client";
import Link from "next/link";
import { Button, Typography } from "antd";
import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, SearchOutlined } from "@ant-design/icons";
import { PublicFrame } from "./PublicHome";
import { fmtDate, programLabel } from "./common";
import { daysUntil } from "@/lib/format";

type Found = { institution: string; code: string; city: string; programType: string; intake: number; issuedAt: string | null; validUntil: string | null; sha256: string | null };

export default function CertificateVerify({ no, found }: { no: string; found: Found | null }) {
  const valid = found && (daysUntil(found.validUntil) ?? -1) >= 0;
  const tone = found ? (valid ? { c: "#0d7a3d", bg: "#e9f7ef", bd: "#c9ecd8", icon: <CheckCircleFilled /> } : { c: "#a15c00", bg: "#fff7e6", bd: "#ffe1a8", icon: <ExclamationCircleFilled /> }) : { c: "#b4141f", bg: "#fff1f0", bd: "#ffccc7", icon: <CloseCircleFilled /> };
  const title = found ? (valid ? "Genuine certificate: valid" : "Genuine certificate: expired") : "No such certificate";
  return (
    <PublicFrame title="Certificate check" sub="The result of scanning a PCP certificate's QR code.">
      <div style={{ maxWidth: 760, margin: "0 auto", background: "#fff", borderRadius: 20, border: "1px solid var(--line)", boxShadow: "var(--shadow-md)", overflow: "hidden" }}>
        <div style={{ background: tone.bg, borderBottom: `1px solid ${tone.bd}`, padding: "28px 28px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 52, color: tone.c, lineHeight: 1 }}>{tone.icon}</div>
          <h2 data-testid="verify-result" style={{ margin: "12px 0 4px", fontSize: 24, letterSpacing: "-0.02em", color: tone.c }}>
            {title}
          </h2>
          <div className="mono" style={{ fontSize: 14, color: "var(--ink-2)" }}>
            {no}
          </div>
        </div>
        {found ? (
          <div style={{ padding: "22px 28px 26px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", rowGap: 12, columnGap: 16, fontSize: 14 }}>
              <span className="muted">Institution</span>
              <span>
                <b>{found.institution}</b> <span className="mono muted">{found.code}</span>
              </span>
              <span className="muted">City</span>
              <span>{found.city}</span>
              <span className="muted">Program</span>
              <span>{programLabel(found.programType)}</span>
              <span className="muted">Approved annual intake</span>
              <span>{found.intake} students</span>
              <span className="muted">Issued</span>
              <span>{fmtDate(found.issuedAt)}</span>
              <span className="muted">Valid until</span>
              <span>{fmtDate(found.validUntil)}</span>
              {found.sha256 ? (
                <>
                  <span className="muted">PDF fingerprint (SHA-256)</span>
                  <Typography.Text className="mono" copyable style={{ fontSize: 11, wordBreak: "break-all" }}>
                    {found.sha256}
                  </Typography.Text>
                </>
              ) : null}
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: "18px 0 0" }}>
              Compare the fingerprint with the PDF you were given: any edit to the file changes it.
            </p>
          </div>
        ) : (
          <div style={{ padding: "22px 28px 26px", textAlign: "center" }}>
            <p style={{ margin: "0 0 16px", color: "var(--ink-2)" }}>
              <b>{no}</b> was not issued by PCP. The document may be forged; report it to PCP.
            </p>
            <Link href="/verify">
              <Button icon={<SearchOutlined />}>Search institutions instead</Button>
            </Link>
          </div>
        )}
      </div>
    </PublicFrame>
  );
}
