"use client";
import Link from "next/link";
import { Button, Typography } from "antd";
import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, SearchOutlined } from "@ant-design/icons";
import { PublicFrame } from "./PublicHome";
import { fmtDate, programLabel } from "./common";
import { daysUntil } from "@/lib/format";
import { richText, translator, tryTranslate, type Lang } from "@/lib/i18n";

type Found = { kind?: string; term?: string | null; institution: string; code: string; city: string; programType: string; field?: string | null; hecNoc?: string | null; intake: number; issuedAt: string | null; validUntil: string | null; sha256: string | null };

export default function CertificateVerify({ no, found, lang = "en" }: { no: string; found: Found | null; lang?: Lang }) {
  const t = translator(lang);
  const valid = found && (daysUntil(found.validUntil) ?? -1) >= 0;
  const tone = found ? (valid ? { c: "#0d7a3d", bg: "#e9f7ef", bd: "#c9ecd8", icon: <CheckCircleFilled /> } : { c: "#a15c00", bg: "#fff7e6", bd: "#ffe1a8", icon: <ExclamationCircleFilled /> }) : { c: "#b4141f", bg: "#fff1f0", bd: "#ffccc7", icon: <CloseCircleFilled /> };
  const acc = !!found?.kind && found.kind !== "NOC";
  const what = t(acc ? "cert.whatAcc" : "cert.whatNoc");
  const title = found ? (valid ? t("cert.valid", { what }) : t("cert.expired", { what })) : t("cert.none");
  return (
    <PublicFrame lang={lang} title={t("cert.title")} sub={t("cert.sub")}>
      <div style={{ maxWidth: 760, margin: "0 auto", background: "#fff", borderRadius: 20, border: "1px solid var(--line)", boxShadow: "var(--shadow-md)", overflow: "hidden" }}>
        <div style={{ background: tone.bg, borderBottom: `1px solid ${tone.bd}`, padding: "28px 28px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 52, color: tone.c, lineHeight: 1 }}>{tone.icon}</div>
          <h2 data-testid="verify-result" style={{ margin: "12px 0 4px", fontSize: 24, letterSpacing: "-0.02em", color: tone.c }}>
            {title}
          </h2>
          <div className="mono" style={{ fontSize: 14, color: "var(--ink-2)", wordBreak: "break-all" }}>
            {no}
          </div>
        </div>
        {found ? (
          <div style={{ padding: "22px 28px 26px" }}>
            <div className="pub-kv">
              <span className="muted">{t("cert.institution")}</span>
              <span>
                <b>{found.institution}</b> <span className="mono muted">{found.code}</span>
              </span>
              <span className="muted">{t("cert.city")}</span>
              <span>{found.city}</span>
              <span className="muted">{t("cert.program")}</span>
              <span data-testid="verify-programme">{lang === "ur" ? tryTranslate(lang, `prog.${found.programType}`, programLabel(found.programType)) : programLabel(found.programType)}</span>
              {found.field ? (
                <>
                  <span className="muted">{t("cert.field")}</span>
                  <span data-testid="verify-field">{lang === "ur" ? tryTranslate(lang, `pgfield.${found.field}`, found.field) : found.field}</span>
                </>
              ) : null}
              {found.hecNoc ? (
                <>
                  <span className="muted">{t("cert.hecNoc")}</span>
                  <span className="mono">{found.hecNoc}</span>
                </>
              ) : null}
              <span className="muted">{t("cert.kind")}</span>
              <span>{t(acc ? (found.kind === "RENEWAL" ? "cert.kindRenewal" : "cert.kindAcc") : "cert.kindNoc")}</span>
              {acc && found.term ? (
                <>
                  <span className="muted">{t("cert.term")}</span>
                  <span><bdi>{found.term}</bdi></span>
                </>
              ) : null}
              <span className="muted">{t(acc ? "cert.intakeAcc" : "cert.intake")}</span>
              <span>{t("cert.students", { n: found.intake })}</span>
              <span className="muted">{t("cert.issued")}</span>
              <span><bdi>{fmtDate(found.issuedAt)}</bdi></span>
              <span className="muted">{t("cert.validUntil")}</span>
              <span><bdi>{fmtDate(found.validUntil)}</bdi></span>
              {found.sha256 ? (
                <>
                  <span className="muted">{t("cert.fingerprint")}</span>
                  <Typography.Text className="mono" copyable style={{ fontSize: 11, wordBreak: "break-all" }}>
                    {found.sha256}
                  </Typography.Text>
                </>
              ) : null}
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: "18px 0 0" }}>
              {t("cert.compare")}
            </p>
          </div>
        ) : (
          <div style={{ padding: "22px 28px 26px", textAlign: "center" }}>
            <p style={{ margin: "0 0 16px", color: "var(--ink-2)" }}>
              {richText(lang, "cert.forged", { no: <b key="no">{no}</b> })}
            </p>
            <Link href="/verify">
              <Button icon={<SearchOutlined />}>{t("cert.searchInstead")}</Button>
            </Link>
          </div>
        )}
      </div>
    </PublicFrame>
  );
}
