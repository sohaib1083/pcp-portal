"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Col, Row } from "antd";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  AuditOutlined,
  BankOutlined,
  CreditCardOutlined,
  IdcardOutlined,
  LockOutlined,
  LoginOutlined,
  MedicineBoxOutlined,
  QrcodeOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SolutionOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import type { Lang } from "@/lib/i18n";
import { Logo } from "./common";
import { LangScope, LangToggle, useLang } from "./PublicLang";

function Nav({ signedIn }: { signedIn: boolean }) {
  const { t, enabled } = useLang();
  return (
    <div className="pub-nav no-print">
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 12, color: "#fff", minWidth: 0 }}>
        <Logo size={38} />
        <div style={{ minWidth: 0 }}>
          <div className="pub-brand-text" style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em" }}>
            {t("nav.brand")}
          </div>
          <div className="pub-nav-sub" style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>
            {t("nav.sub")}
          </div>
        </div>
      </Link>
      <div className="pub-nav-actions">
        <Link href="/register" className="pub-nav-link pub-nav-wide">
          {t("nav.register")}
        </Link>
        <Link href="/help" className="pub-nav-link pub-nav-wide">
          {t("nav.help")}
        </Link>
        <Link href="/verify" className="pub-nav-verify">
          <Button ghost icon={<SafetyCertificateOutlined />}>
            {t("nav.verify")}
          </Button>
        </Link>
        {enabled ? <LangToggle /> : null}
        <Link href={signedIn ? "/home" : "/login"} className="pub-nav-signin">
          <Button icon={<LoginOutlined />} style={{ background: "#fff", color: "#0a3d2e", borderColor: "#fff", fontWeight: 600 }}>
            {signedIn ? t("nav.dashboard") : t("nav.signIn")}
          </Button>
        </Link>
      </div>
    </div>
  );
}

export function PublicFooter() {
  const { t } = useLang();
  return (
    <footer className="pub-foot no-print">
      <div className="pub-section" style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", padding: "20px 24px", fontSize: 12.5, color: "var(--muted)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo size={22} variant="dark" />
          {t("foot.demo")}
        </span>
        <span className="pub-foot-links">
          <Link href="/help">{t("nav.help")}</Link>
          <Link href="/register">{t("nav.register")}</Link>
          <Link href="/privacy" data-testid="footer-privacy">{t("foot.privacy")}</Link>
        </span>
        <span>{t("foot.official")}</span>
      </div>
    </footer>
  );
}

/**
 * Frame for inner public pages (sign-in, verification, certificate check).
 * Pass `lang` to offer English and Urdu (the header then shows the language toggle); without it the page is English only.
 */
export function PublicFrame({ children, signedIn = false, title, sub, lang }: { children: React.ReactNode; signedIn?: boolean; title?: React.ReactNode; sub?: React.ReactNode; lang?: Lang }) {
  const body = (
    <>
      <div className="pub-hero" style={{ paddingBottom: title ? 96 : 72 }}>
        <Nav signedIn={signedIn} />
        {title ? (
          <div className="pub-inner" style={{ paddingTop: 18 }}>
            <h1 style={{ margin: 0, fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" }}>{title}</h1>
            {sub ? <p style={{ margin: "8px 0 0", color: "rgba(255,255,255,0.75)", fontSize: 15, maxWidth: 720 }}>{sub}</p> : null}
          </div>
        ) : null}
      </div>
      <div className="pub-section" style={{ marginTop: -64, position: "relative", zIndex: 3, paddingBottom: 48 }}>
        {children}
      </div>
      <PublicFooter />
    </>
  );
  return lang ? (
    <LangScope lang={lang} className="pub-wrap">
      {body}
    </LangScope>
  ) : (
    <div className="pub-wrap">{body}</div>
  );
}

const SERVICES = [
  { icon: <BankOutlined />, key: "accreditation" },
  { icon: <SolutionOutlined />, key: "students" },
  { icon: <TeamOutlined />, key: "faculty" },
  { icon: <CreditCardOutlined />, key: "payments" },
] as const;

const FLOW = ["1", "2", "3", "4", "5", "6"] as const;

const TRUST = [
  { icon: <IdcardOutlined />, key: "cnic" },
  { icon: <AuditOutlined />, key: "log" },
  { icon: <QrcodeOutlined />, key: "qr" },
  { icon: <LockOutlined />, key: "data" },
] as const;

/** Illustration of the end state: a QR-verifiable NOC plus the checks that got it there. */
function HeroVisual() {
  const { t } = useLang();
  const chip = (icon: React.ReactNode, text: string, c: string, bg: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", borderRadius: 12, padding: "10px 14px", boxShadow: "0 14px 34px rgba(0,0,0,.22)", fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>
      <span style={{ width: 28, height: 28, borderRadius: 8, display: "grid", placeItems: "center", background: bg, color: c }}>{icon}</span>
      {text}
    </div>
  );
  return (
    <div className="pub-hero-visual" aria-hidden="true">
      {/* The certificate itself is an English document, so its face stays in English. */}
      <div lang="en" dir="ltr" style={{ position: "relative", background: "#fff", color: "var(--ink)", borderRadius: 18, padding: 22, boxShadow: "0 30px 70px rgba(0,0,0,.35)", transform: "rotate(-1.5deg)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Logo size={30} variant="dark" />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--brand)" }}>NO OBJECTION CERTIFICATE</span>
          </span>
          <span className="pcp-status" style={{ color: "#0d7a3d", background: "#e9f7ef", borderColor: "#c9ecd8" }}>
            <span className="pcp-status-dot" /> Genuine · valid
          </span>
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, marginTop: 16, letterSpacing: "-0.01em" }}>Riverside University of Health Sciences</div>
        <div className="muted" style={{ fontSize: 13 }}>Pharmacy Technician · approved intake 60 · example</div>
        <div style={{ display: "flex", gap: 6, margin: "18px 0" }}>
          {["Apply", "Checks", "Fee", "Scrutiny", "Inspect", "Council", "NOC"].map((s) => (
            <div key={s} style={{ flex: 1, textAlign: "center" }}>
              <div style={{ height: 4, borderRadius: 4, background: "var(--brand)" }} />
              <div className="faint" style={{ fontSize: 10, marginTop: 4 }}>{s}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center", paddingTop: 14, borderTop: "1px dashed var(--line)" }}>
          <div style={{ width: 64, height: 64, borderRadius: 8, background: "repeating-conic-gradient(#0a3d2e 0 25%, #fff 0 50%) 0 0/12px 12px", border: "4px solid #fff", outline: "1px solid var(--line)" }} />
          <div style={{ fontSize: 12.5 }}>
            <b>Scan to verify</b>
            <div className="muted">QR + SHA-256 fingerprint. Anyone can check it, without signing in.</div>
          </div>
        </div>
      </div>
      <div style={{ position: "absolute", left: -36, top: -22 }}>{chip(<IdcardOutlined />, t("visual.blocked"), "#b4141f", "#fff1f0")}</div>
      <div style={{ position: "absolute", right: -18, bottom: -26 }}>{chip(<CreditCardOutlined />, t("visual.paid"), "#0d7a3d", "#e9f7ef")}</div>
    </div>
  );
}

export default function PublicHome({ signedIn, stats, lang = "en" }: { signedIn: boolean; stats: { institutions: number; programs: number; faculty: number; certificates: number }; lang?: Lang }) {
  return (
    <LangScope lang={lang} className="pub-wrap">
      <HomeBody signedIn={signedIn} stats={stats} />
    </LangScope>
  );
}

function HomeBody({ signedIn, stats }: { signedIn: boolean; stats: { institutions: number; programs: number; faculty: number; certificates: number } }) {
  const router = useRouter();
  const { t, rtl } = useLang();
  const [q, setQ] = useState("");
  const go = () => router.push(`/verify?q=${encodeURIComponent(q.trim())}`);
  return (
    <>
      <div className="pub-hero" style={{ paddingBottom: 56 }}>
        <Nav signedIn={signedIn} />
        <div className="pub-inner" style={{ paddingTop: 36 }}>
          <div className="pub-hero-grid">
          <div>
          <span className="pub-kicker">
            <SafetyCertificateOutlined /> {t("home.kicker")}
          </span>
          <h1 className="pub-h1">{t("home.h1")}</h1>
          <p className="pub-lead">{t("home.lead")}</p>
          <form
            className="pub-search"
            onSubmit={(e) => {
              e.preventDefault();
              go();
            }}
          >
            <SearchOutlined style={{ color: "var(--faint)", fontSize: 18, marginInlineStart: 10, alignSelf: "center" }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("home.searchPlaceholder")} aria-label={t("home.searchLabel")} />
            <Button type="primary" size="large" htmlType="submit">
              {t("home.verifyButton")}
            </Button>
          </form>
          <div style={{ marginTop: 14, fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
            {t("home.try")}{" "}
            <a style={{ color: "#f3e7c6" }} onClick={() => router.push("/verify?q=Riverside")}>
              <bdi>Riverside</bdi>
            </a>{" "}
            {t("home.or")}{" "}
            <a style={{ color: "#f3e7c6" }} onClick={() => router.push("/verify?q=PCP-UNI-000103")}>
              <bdi>PCP-UNI-000103</bdi>
            </a>
          </div>
          <div className="pub-hero-cta">
            <Link href="/register">
              <Button ghost size="large" icon={<BankOutlined />}>
                {t("home.registerCta")}
              </Button>
            </Link>
            <span>{t("home.registerHint")}</span>
          </div>
          </div>
          <HeroVisual />
          </div>
          <div className="pub-stats">
            {(
              [
                [stats.institutions, t("home.stat.institutions")],
                [stats.programs, t("home.stat.programs")],
                [stats.faculty, t("home.stat.faculty")],
                [stats.certificates, t("home.stat.certificates")],
              ] as const
            ).map(([v, l]) => (
              <div key={String(l)} className="pub-stat">
                <div className="pub-stat-v tnum">{v}</div>
                <div className="pub-stat-l">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <section className="pub-section" style={{ padding: "56px 24px 8px" }}>
        <div className="pcp-eyebrow">{t("home.services.eyebrow")}</div>
        <h2 className="pub-h2">{t("home.services.h2")}</h2>
        <p className="muted" style={{ margin: "0 0 22px", maxWidth: 680 }}>
          {t("home.services.sub")}
        </p>
        <Row gutter={[16, 16]}>
          {SERVICES.map((s) => (
            <Col key={s.key} xs={24} sm={12} lg={6}>
              <div className="pub-card">
                <div className="pub-card-icon">{s.icon}</div>
                <h3>{t(`svc.${s.key}.t`)}</h3>
                <p>{t(`svc.${s.key}.b`)}</p>
              </div>
            </Col>
          ))}
        </Row>
        <div className="pub-service-strip" data-testid="pharmacist-service">
          <div className="pub-card-icon">
            <MedicineBoxOutlined />
          </div>
          <div style={{ flex: "1 1 320px", minWidth: 0 }}>
            <h3>
              {t("svc.pharmacist.t")} <span className="pub-tag">{t("svc.pharmacist.tag")}</span>
            </h3>
            <p>{t("svc.pharmacist.b")}</p>
          </div>
          <Link href="/verify?tab=pharmacist">
            <Button type="primary" size="large" icon={<SearchOutlined />}>
              {t("svc.pharmacist.cta")}
            </Button>
          </Link>
        </div>
      </section>

      <section className="pub-section" style={{ padding: "48px 24px 8px" }}>
        <div className="pcp-eyebrow">{t("home.flow.eyebrow")}</div>
        <h2 className="pub-h2">{t("home.flow.h2")}</h2>
        <p className="muted" style={{ margin: "0 0 22px", maxWidth: 680 }}>
          {t("home.flow.sub")}
        </p>
        <div className="pub-flow">
          {FLOW.map((n, i) => (
            <div key={n} className="pub-flow-step">
              <div className="pub-flow-n">{i + 1}</div>
              <b>{t(`flow.${n}.t`)}</b>
              <span>{t(`flow.${n}.b`)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="pub-section" style={{ padding: "48px 24px 56px" }}>
        <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 20, padding: 28, boxShadow: "var(--shadow-sm)" }}>
          <Row gutter={[28, 24]} align="middle">
            <Col xs={24} lg={8}>
              <div className="pcp-eyebrow">{t("home.trust.eyebrow")}</div>
              <h2 className="pub-h2">{t("home.trust.h2")}</h2>
              <p className="muted" style={{ margin: "0 0 16px" }}>{t("home.trust.sub")}</p>
              <Link href={signedIn ? "/home" : "/login"}>
                <Button type="primary" size="large" icon={rtl ? <ArrowLeftOutlined /> : <ArrowRightOutlined />} iconPlacement="end">
                  {signedIn ? t("home.trust.dashboard") : t("home.trust.explore")}
                </Button>
              </Link>
            </Col>
            <Col xs={24} lg={16}>
              <Row gutter={[16, 16]}>
                {TRUST.map((x) => (
                  <Col key={x.key} xs={24} sm={12}>
                    <div style={{ display: "flex", gap: 12 }}>
                      <div className="pub-card-icon" style={{ marginBottom: 0, flex: "none" }}>
                        {x.icon}
                      </div>
                      <div>
                        <b style={{ fontSize: 15 }}>{t(`trust.${x.key}.t`)}</b>
                        <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.5, marginTop: 2 }}>
                          {t(`trust.${x.key}.b`)}
                        </div>
                      </div>
                    </div>
                  </Col>
                ))}
              </Row>
            </Col>
          </Row>
        </div>
      </section>
      <PublicFooter />
    </>
  );
}
