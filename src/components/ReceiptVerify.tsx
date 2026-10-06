"use client";
import Link from "next/link";
import { Button, Typography } from "antd";
import { CheckCircleFilled, CloseCircleFilled, SearchOutlined } from "@ant-design/icons";
import { formatPKR } from "@/lib/format";
import { PublicFrame } from "./PublicHome";
import { fmtDate } from "./common";

type Found = { amount: number; paidAt: string; purpose: string; payer: string; reconciled: boolean; cancelled: boolean; sha256: string | null };

/** Public receipt check: genuine or not, with no personal data (guide sections 9 and 14). */
export default function ReceiptVerify({ no, found }: { no: string; found: Found | null }) {
  const tone = found ? { c: "#0d7a3d", bg: "#e9f7ef", bd: "#c9ecd8", icon: <CheckCircleFilled /> } : { c: "#b4141f", bg: "#fff1f0", bd: "#ffccc7", icon: <CloseCircleFilled /> };
  return (
    <PublicFrame title="Receipt check" sub="The result of scanning the QR code on a PCP payment receipt.">
      <div style={{ maxWidth: 760, margin: "0 auto", background: "#fff", borderRadius: 20, border: "1px solid var(--line)", boxShadow: "var(--shadow-md)", overflow: "hidden" }}>
        <div style={{ background: tone.bg, borderBottom: `1px solid ${tone.bd}`, padding: "28px 28px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 52, color: tone.c, lineHeight: 1 }}>{tone.icon}</div>
          <h2 data-testid="verify-result" style={{ margin: "12px 0 4px", fontSize: 24, letterSpacing: "-0.02em", color: tone.c }}>
            {found ? "Genuine receipt" : "Receipt not found"}
          </h2>
          <div className="mono" style={{ fontSize: 14, color: "var(--ink-2)" }}>
            {no}
          </div>
        </div>
        {found ? (
          <div style={{ padding: "22px 28px 26px" }}>
            <div data-testid="receipt-facts" style={{ display: "grid", gridTemplateColumns: "minmax(140px, 200px) 1fr", rowGap: 12, columnGap: 16, fontSize: 14 }}>
              <span className="muted">Amount</span>
              <b className="tnum">{formatPKR(found.amount)}</b>
              <span className="muted">Paid on</span>
              <span>{fmtDate(found.paidAt)}</span>
              <span className="muted">For</span>
              <span>{found.purpose}</span>
              <span className="muted">Paid by</span>
              <span>{found.payer}</span>
              <span className="muted">Received by PCP</span>
              <span>{found.reconciled ? "Yes. The payment is matched to PCP's bank statement." : "Confirmed by the bank. PCP's reconciliation with the bank statement is pending."}</span>
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
              Check that the amount, date and purpose match the receipt you were given. The payer&apos;s name is partly hidden on purpose; this page shows no personal data.
            </p>
          </div>
        ) : (
          <div style={{ padding: "22px 28px 26px", textAlign: "center" }}>
            <p style={{ margin: "0 0 16px", color: "var(--ink-2)" }}>
              PCP has no receipt numbered <b>{no}</b>. The receipt may be forged or the number mistyped. Report a suspect receipt to PCP.
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
