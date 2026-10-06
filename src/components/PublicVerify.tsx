"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Empty, Input, Tabs } from "antd";
import {
  BankOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  EnvironmentOutlined,
  ExclamationCircleFilled,
  LockOutlined,
  MinusCircleFilled,
  QrcodeOutlined,
  QuestionCircleFilled,
  UserOutlined,
} from "@ant-design/icons";
import { richText, tryTranslate, translator, type Lang } from "@/lib/i18n";
import { COUNCIL_INFO, COUNCILS, isCouncil, validityLapsed } from "@/lib/register";
import { PublicFrame } from "./PublicHome";
import { Pill, StatusDot, fmtDate, programLabel } from "./common";

type Result = { code: string; name: string; city: string; province: string; status: string; programs: { type: string; noc: string; nocNumber: string | null; acc: string; until: string | null }[] };

/** The only pharmacist fields the public may see (guide section 9). */
export type PublicPharmacist = { name: string; regNo: string; category: string; status: string; validUntil: string | null; council: string };

export default function PublicVerify({
  q,
  reg,
  tab = "",
  results,
  searched,
  lang = "en",
  pharmacist = null,
  regResult = null,
  checkedAt = "",
}: {
  q: string;
  reg: string;
  tab?: string;
  results: Result[];
  searched: boolean;
  lang?: Lang;
  pharmacist?: PublicPharmacist | null;
  regResult?: "found" | "notfound" | "badformat" | null;
  checkedAt?: string;
}) {
  const router = useRouter();
  const t = translator(lang);
  const [cert, setCert] = useState("");
  // Status words: English keeps the existing labels; Urdu uses the dictionary.
  const pill = (v: string) => <Pill value={v} label={lang === "ur" ? tryTranslate(lang, `st.${v}`, v) : undefined} />;
  const prog = (p: string) => (lang === "ur" ? tryTranslate(lang, `prog.${p}`, programLabel(p)) : programLabel(p));
  const lookup = (v: string) => {
    const s = v.trim();
    if (s) router.push(`/verify?reg=${encodeURIComponent(s)}`);
  };
  const initial = reg || tab === "pharmacist" ? "pharmacist" : tab === "certificate" ? "certificate" : "institution";
  return (
    <PublicFrame lang={lang} title={t("verify.title")} sub={t("verify.sub")}>
      <div className="pub-panel">
        <Tabs
          size="large"
          defaultActiveKey={initial}
          items={[
            {
              key: "institution",
              label: (
                <span>
                  <BankOutlined /> {t("verify.tab.institution")}
                </span>
              ),
              children: (
                <>
                  <Input.Search
                    size="large"
                    defaultValue={q}
                    placeholder={t("verify.inst.placeholder")}
                    enterButton={t("verify.button")}
                    onSearch={(v) => router.push(`/verify?q=${encodeURIComponent(v)}`)}
                    style={{ maxWidth: 640, marginBottom: 20 }}
                  />
                  {searched && results.length === 0 ? <Empty description={t("verify.inst.empty")} /> : null}
                  <div style={{ display: "grid", gap: 14 }}>
                    {results.map((r) => (
                      <div key={r.code} style={{ border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "14px 18px", background: "#fafcfb", borderBottom: "1px solid var(--line)" }}>
                          <div>
                            <div style={{ fontWeight: 650, fontSize: 16 }}>{r.name}</div>
                            <div className="muted" style={{ fontSize: 13 }}>
                              <span className="mono">{r.code}</span> · <EnvironmentOutlined /> {r.city}, {r.province}
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                            {t("verify.inst.status")} {pill(r.status)}
                          </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", gap: 1, background: "var(--line)" }}>
                          {r.programs.map((p) => (
                            <div key={p.type} style={{ background: "#fff", padding: "14px 18px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, marginBottom: 8 }}>
                                {p.noc === "APPROVED" ? <CheckCircleFilled style={{ color: "var(--good)" }} /> : null}
                                {prog(p.type)}
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", rowGap: 6, fontSize: 13 }}>
                                <span className="muted">{t("verify.inst.noc")}</span>
                                <span>
                                  {pill(p.noc)} {p.nocNumber ? <span className="mono">{p.nocNumber}</span> : null}
                                </span>
                                <span className="muted">{t("verify.inst.acc")}</span>
                                <span>{pill(p.acc)}</span>
                                <span className="muted">{t("verify.validUntil")}</span>
                                <span><bdi>{fmtDate(p.until)}</bdi></span>
                              </div>
                            </div>
                          ))}
                          {r.programs.length === 0 ? (
                            <div style={{ background: "#fff", padding: 18 }} className="muted">
                              {t("verify.inst.noPrograms")}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ),
            },
            {
              key: "certificate",
              label: (
                <span>
                  <QrcodeOutlined /> {t("verify.tab.certificate")}
                </span>
              ),
              children: (
                <div style={{ maxWidth: 640 }}>
                  <p className="muted" style={{ marginTop: 0 }}>
                    {t("verify.cert.intro")}
                  </p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Input size="large" value={cert} onChange={(e) => setCert(e.target.value)} placeholder={t("verify.cert.placeholder")} />
                    <Button size="large" type="primary" disabled={!cert.trim()} onClick={() => router.push(`/verify/certificate/${encodeURIComponent(cert.trim())}`)}>
                      {t("verify.cert.check")}
                    </Button>
                  </div>
                </div>
              ),
            },
            {
              key: "pharmacist",
              label: (
                <span>
                  <UserOutlined /> {t("verify.tab.pharmacist")}
                </span>
              ),
              children: (
                <>
                  <p className="muted" style={{ marginTop: 0, maxWidth: 760 }}>
                    {t("ph.intro")}
                  </p>
                  <Input.Search size="large" defaultValue={reg} placeholder={t("ph.placeholder")} enterButton={t("verify.button")} onSearch={lookup} style={{ maxWidth: 640, marginBottom: 10 }} />
                  <div className="ph-formats">
                    <span>{t("ph.formats")}:</span>
                    {COUNCILS.map((c) => (
                      <span key={c}>
                        <code className="ltr">{COUNCIL_INFO[c].pattern}</code> {t(`council.${c}`).replace(/ (Pharmacy Council|فارمیسی کونسل)$/, "")}
                      </span>
                    ))}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--muted)", margin: "-6px 0 18px" }}>
                    {t("home.try")}{" "}
                    <a onClick={() => lookup("PPC-A-031457")}>
                      <bdi>PPC-A-031457</bdi>
                    </a>{" "}
                    {t("home.or")}{" "}
                    <a onClick={() => lookup("SPC-A-2014-00187")}>
                      <bdi>SPC-A-2014-00187</bdi>
                    </a>
                  </div>
                  {regResult ? <PharmacistResult lang={lang} reg={reg} p={pharmacist} result={regResult} checkedAt={checkedAt} /> : null}
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 16, maxWidth: 760, fontSize: 12.5, color: "var(--muted)" }}>
                    <LockOutlined style={{ marginTop: 3, color: "var(--brand)" }} />
                    <span>{t("ph.privacy")}</span>
                  </div>
                </>
              ),
            },
          ]}
        />
      </div>
    </PublicFrame>
  );
}

const TONE = {
  good: { c: "#0d7a3d", bg: "#e9f7ef", bd: "#c9ecd8" },
  warn: { c: "#a15c00", bg: "#fff7e6", bd: "#ffe1a8" },
  bad: { c: "#b4141f", bg: "#fff1f0", bd: "#ffccc7" },
  none: { c: "#55625c", bg: "#f6f8f7", bd: "#e1e6e3" },
};

/** The public answer for one registration number, in plain words. */
function PharmacistResult({ lang, reg, p, result, checkedAt }: { lang: Lang; reg: string; p: PublicPharmacist | null; result: "found" | "notfound" | "badformat"; checkedAt: string }) {
  const t = translator(lang);
  const lapsed = !!p && p.status === "ACTIVE" && validityLapsed(p.validUntil);
  const state = !p ? "NONE" : lapsed ? "LAPSED" : (p.status as "ACTIVE" | "DORMANT" | "SUSPENDED" | "CANCELLED");
  const tone = state === "ACTIVE" ? TONE.good : state === "LAPSED" || state === "DORMANT" ? TONE.warn : state === "NONE" ? TONE.none : TONE.bad;
  const icon =
    state === "ACTIVE" ? <CheckCircleFilled /> : state === "LAPSED" || state === "DORMANT" ? <ExclamationCircleFilled /> : state === "SUSPENDED" ? <MinusCircleFilled /> : state === "CANCELLED" ? <CloseCircleFilled /> : <QuestionCircleFilled />;
  const council = p && isCouncil(p.council) ? t(`council.${p.council}`) : (p?.council ?? "");
  const date = <bdi>{p?.validUntil ? fmtDate(p.validUntil) : ""}</bdi>;
  const say = !p
    ? t(result === "badformat" ? "ph.say.BADFORMAT" : "ph.say.NONE")
    : richText(lang, state === "ACTIVE" && !p.validUntil ? "ph.say.ACTIVE_OPEN" : `ph.say.${state as "ACTIVE" | "LAPSED" | "DORMANT" | "SUSPENDED" | "CANCELLED"}`, { council, date }).map((x, i) => <span key={i}>{x}</span>);
  const statusTone = state === "ACTIVE" ? "good" : state === "LAPSED" || state === "DORMANT" ? "warn" : "bad";
  return (
    <div className="ph-result" data-testid="pharmacist-result" data-status={state}>
      <div className="ph-result-head" style={{ background: tone.bg, borderColor: tone.bd }}>
        <span className="ph-result-icon" style={{ color: tone.c }}>
          {icon}
        </span>
        <div style={{ minWidth: 0 }}>
          <h2 className="ph-result-title" data-testid="pharmacist-status" style={{ color: tone.c }}>
            {t(`ph.head.${state}`)}
          </h2>
          <p className="ph-result-say">{say}</p>
        </div>
      </div>
      <div className="ph-result-body">
        {p ? (
          <div className="pub-kv">
            <span className="muted">{t("ph.name")}</span>
            <b style={{ fontSize: 15 }}>{p.name}</b>
            <span className="muted">{t("ph.regNo")}</span>
            <span className="mono" style={{ fontSize: 13.5 }}>
              {p.regNo}
            </span>
            <span className="muted">{t("ph.category")}</span>
            <span>{tryTranslate(lang, `ph.cat.${p.category}`, p.category)}</span>
            <span className="muted">{t("ph.status")}</span>
            <span>
              <StatusDot tone={statusTone}>{lapsed ? t("ph.head.LAPSED") : tryTranslate(lang, `st.${p.status}`, p.status)}</StatusDot>
            </span>
            <span className="muted">{t("ph.validUntil")}</span>
            <span>{p.validUntil ? <bdi>{fmtDate(p.validUntil)}</bdi> : t("ph.noExpiry")}</span>
          </div>
        ) : (
          <div style={{ fontSize: 14 }}>
            <span className="muted">{t("ph.regNo")}: </span>
            <span className="mono" style={{ fontSize: 13.5 }}>
              {reg}
            </span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 16, paddingTop: 12, borderTop: "1px dashed var(--line)", fontSize: 12.5 }}>
          <span className="faint">{richText(lang, "ph.checked", { time: <bdi key="t">{checkedAt}</bdi> })}</span>
          <Link href="/help">{t("ph.report")}</Link>
        </div>
      </div>
    </div>
  );
}
