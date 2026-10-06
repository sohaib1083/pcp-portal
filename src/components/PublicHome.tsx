"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Col, Row } from "antd";
import {
  ArrowRightOutlined,
  AuditOutlined,
  BankOutlined,
  CreditCardOutlined,
  IdcardOutlined,
  LockOutlined,
  LoginOutlined,
  QrcodeOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SolutionOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Logo } from "./common";

function Nav({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="pub-nav no-print">
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 12, color: "#fff" }}>
        <Logo size={38} />
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em" }}>PCP Digital Portal</div>
          <div className="pub-nav-sub" style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>Pharmacy Council of Pakistan · demo</div>
        </div>
      </Link>
      <div style={{ display: "flex", gap: 8 }}>
        <Link href="/verify" className="pub-nav-verify">
          <Button ghost icon={<SafetyCertificateOutlined />}>
            Verify
          </Button>
        </Link>
        <Link href={signedIn ? "/home" : "/login"}>
          <Button icon={<LoginOutlined />} style={{ background: "#fff", color: "#0a3d2e", borderColor: "#fff", fontWeight: 600 }}>
            {signedIn ? "My dashboard" : "Sign in"}
          </Button>
        </Link>
      </div>
    </div>
  );
}

export function PublicFooter() {
  return (
    <footer className="pub-foot no-print">
      <div className="pub-section" style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", padding: "20px 24px", fontSize: 12.5, color: "var(--muted)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo size={22} variant="dark" />
          PCP Digital Portal · working demo with fictional institutions, people and payments
        </span>
        <span>Not an official Pharmacy Council of Pakistan website · no SMS or email is sent</span>
      </div>
    </footer>
  );
}

/** Frame for inner public pages (sign-in, verification, certificate check). */
export function PublicFrame({ children, signedIn = false, title, sub }: { children: React.ReactNode; signedIn?: boolean; title?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="pub-wrap">
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
    </div>
  );
}

const SERVICES = [
  { icon: <BankOutlined />, title: "Institute accreditation", body: "NOC, accreditation and renewal applications with automatic checks, formal deficiencies and tracked deadlines." },
  { icon: <SolutionOutlined />, title: "Student enrolment verification", body: "Every student gets one PCP ID. Enrolment is compared with approved intake every year, and past years lock." },
  { icon: <TeamOutlined />, title: "Faculty verification", body: "One record per CNIC, active at one institution at a time. Near-duplicate names are flagged for PCP." },
  { icon: <CreditCardOutlined />, title: "Online forms & challans", body: "PSID challans and Raast QR payments, confirmed by the bank. No paper challans, no manual reconciliation." },
];

const FLOW = [
  ["Apply online", "Institution enters campus, intake, labs and library once"],
  ["Automatic checks", "PCP's rules run instantly: faculty, intake, documents"],
  ["Pay by Raast", "PSID challan and QR, confirmed by the bank"],
  ["Scrutiny", "Formal deficiencies with deadlines and evidence"],
  ["Inspection", "Checklist on a tablet, conflict of interest blocked"],
  ["Council & certificate", "Recorded decision, QR-verifiable NOC"],
];

const TRUST = [
  { icon: <IdcardOutlined />, title: "CNIC as the key", body: "NADRA-ready identity checks stop one teacher being counted at two colleges." },
  { icon: <AuditOutlined />, title: "Tamper-evident log", body: "Every action is hash-chained. Editing history breaks the chain visibly." },
  { icon: <QrcodeOutlined />, title: "QR-verified certificates", body: "Anyone can confirm a NOC is genuine by scanning it, in seconds." },
  { icon: <LockOutlined />, title: "Data stays in Pakistan", body: "Single sign-on with Keycloak, MFA for staff, hosted under the Cloud First Policy." },
];

/** Illustration of the end state: a QR-verifiable NOC plus the checks that got it there. */
function HeroVisual() {
  const chip = (icon: React.ReactNode, text: string, c: string, bg: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", borderRadius: 12, padding: "10px 14px", boxShadow: "0 14px 34px rgba(0,0,0,.22)", fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>
      <span style={{ width: 28, height: 28, borderRadius: 8, display: "grid", placeItems: "center", background: bg, color: c }}>{icon}</span>
      {text}
    </div>
  );
  return (
    <div className="pub-hero-visual" aria-hidden="true">
      <div style={{ position: "relative", background: "#fff", color: "var(--ink)", borderRadius: 18, padding: 22, boxShadow: "0 30px 70px rgba(0,0,0,.35)", transform: "rotate(-1.5deg)" }}>
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
          {["Apply", "Checks", "Fee", "Scrutiny", "Inspect", "Council", "NOC"].map((t) => (
            <div key={t} style={{ flex: 1, textAlign: "center" }}>
              <div style={{ height: 4, borderRadius: 4, background: "var(--brand)" }} />
              <div className="faint" style={{ fontSize: 10, marginTop: 4 }}>{t}</div>
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
      <div style={{ position: "absolute", left: -36, top: -22 }}>{chip(<IdcardOutlined />, "CNIC active elsewhere: blocked", "#b4141f", "#fff1f0")}</div>
      <div style={{ position: "absolute", right: -18, bottom: -26 }}>{chip(<CreditCardOutlined />, "Raast payment confirmed", "#0d7a3d", "#e9f7ef")}</div>
    </div>
  );
}

export default function PublicHome({ signedIn, stats }: { signedIn: boolean; stats: { institutions: number; programs: number; faculty: number; certificates: number } }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const go = () => router.push(`/verify?q=${encodeURIComponent(q.trim())}`);
  return (
    <div className="pub-wrap">
      <div className="pub-hero" style={{ paddingBottom: 56 }}>
        <Nav signedIn={signedIn} />
        <div className="pub-inner" style={{ paddingTop: 36 }}>
          <div className="pub-hero-grid">
          <div>
          <span className="pub-kicker">
            <SafetyCertificateOutlined /> The four promised e-services, live on one platform
          </span>
          <h1 className="pub-h1">One registry for pharmacy education in Pakistan</h1>
          <p className="pub-lead">
            Institutions apply for NOCs and accreditation online. PCP scrutinises, inspects and decides in one tracked workflow. Anyone can verify an institution or a
            certificate.
          </p>
          <form
            className="pub-search"
            onSubmit={(e) => {
              e.preventDefault();
              go();
            }}
          >
            <SearchOutlined style={{ color: "var(--faint)", fontSize: 18, marginLeft: 10, alignSelf: "center" }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Verify an institution: name or PCP ID (e.g. PCP-UNI-000101)" aria-label="Institution name or PCP ID" />
            <Button type="primary" size="large" htmlType="submit">
              Verify
            </Button>
          </form>
          <div style={{ marginTop: 14, fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
            Try{" "}
            <a style={{ color: "#f3e7c6" }} onClick={() => router.push("/verify?q=Riverside")}>
              Riverside
            </a>{" "}
            or{" "}
            <a style={{ color: "#f3e7c6" }} onClick={() => router.push("/verify?q=PCP-UNI-000103")}>
              PCP-UNI-000103
            </a>
          </div>
          </div>
          <HeroVisual />
          </div>
          <div className="pub-stats">
            {[
              [stats.institutions, "Institutions on the registry"],
              [stats.programs, "Programs with an approved NOC"],
              [stats.faculty, "Faculty with a PCP ID"],
              [stats.certificates, "Certificates issued online"],
            ].map(([v, l]) => (
              <div key={String(l)} className="pub-stat">
                <div className="pub-stat-v tnum">{v}</div>
                <div className="pub-stat-l">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <section className="pub-section" style={{ padding: "56px 24px 8px" }}>
        <div className="pcp-eyebrow">What institutions get</div>
        <h2 className="pub-h2">Every e-service PCP announced, in one place</h2>
        <p className="muted" style={{ margin: "0 0 22px", maxWidth: 680 }}>
          Enter faculty and students once and reuse them for NOC, accreditation, renewal and verification.
        </p>
        <Row gutter={[16, 16]}>
          {SERVICES.map((s) => (
            <Col key={s.title} xs={24} sm={12} lg={6}>
              <div className="pub-card">
                <div className="pub-card-icon">{s.icon}</div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </Col>
          ))}
        </Row>
      </section>

      <section className="pub-section" style={{ padding: "48px 24px 8px" }}>
        <div className="pcp-eyebrow">How a NOC moves</div>
        <h2 className="pub-h2">From application to verified certificate</h2>
        <p className="muted" style={{ margin: "0 0 22px", maxWidth: 680 }}>
          Every step has an owner and a deadline, and the institution always sees who holds its file.
        </p>
        <div className="pub-flow">
          {FLOW.map(([t, d], i) => (
            <div key={t} className="pub-flow-step">
              <div className="pub-flow-n">{i + 1}</div>
              <b>{t}</b>
              <span>{d}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="pub-section" style={{ padding: "48px 24px 56px" }}>
        <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 20, padding: 28, boxShadow: "var(--shadow-sm)" }}>
          <Row gutter={[28, 24]} align="middle">
            <Col xs={24} lg={8}>
              <div className="pcp-eyebrow">Built for trust</div>
              <h2 className="pub-h2">Records the National Assembly can rely on</h2>
              <p className="muted" style={{ margin: "0 0 16px" }}>Duplicate checks, an audit trail and public verification are built in from day one.</p>
              <Link href={signedIn ? "/home" : "/login"}>
                <Button type="primary" size="large" icon={<ArrowRightOutlined />} iconPlacement="end">
                  {signedIn ? "Go to my dashboard" : "Explore the portal"}
                </Button>
              </Link>
            </Col>
            <Col xs={24} lg={16}>
              <Row gutter={[16, 16]}>
                {TRUST.map((t) => (
                  <Col key={t.title} xs={24} sm={12}>
                    <div style={{ display: "flex", gap: 12 }}>
                      <div className="pub-card-icon" style={{ marginBottom: 0, flex: "none" }}>
                        {t.icon}
                      </div>
                      <div>
                        <b style={{ fontSize: 15 }}>{t.title}</b>
                        <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.5, marginTop: 2 }}>
                          {t.body}
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
    </div>
  );
}
