"use client";
import { Alert, Button, Col, Row, Typography } from "antd";
import { ArrowRightOutlined, KeyOutlined, PlayCircleOutlined, SafetyOutlined } from "@ant-design/icons";
import { loginAction, quickSignInAction } from "@/app/actions/auth";
import { MORE_PERSONAS, PERSONAS, type Persona } from "@/lib/demo-story";
import { Avatar } from "./common";
import { PublicFrame } from "./PublicHome";

function PersonaCard({ p, next, quick }: { p: Persona; next: string; quick: boolean }) {
  const first = p.username === "pcp.admin" ? "Admin" : p.name.replace(/^(Dr|Prof)\.\s+/, "").split(" ")[0];
  return (
    <div data-username={p.username} className="pub-card" style={{ display: "flex", flexDirection: "column", gap: 12, padding: 18 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Avatar name={p.name} size={42} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 650, fontSize: 15 }}>{p.name}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
            {p.role} · <span className="mono">{p.username}</span>
          </div>
        </div>
      </div>
      <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5, flex: 1 }}>
        <span className="faint">{p.org}.</span> {p.blurb}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", borderTop: "1px solid var(--line-2)", paddingTop: 12 }}>
        <div className="persona-actions" style={{ display: "flex", gap: 6, width: "100%", justifyContent: "space-between" }}>
          <form action={loginAction}>
            <input type="hidden" name="username" value={p.username} />
            <input type="hidden" name="next" value={next} />
            <Button htmlType="submit" type={quick ? "text" : "primary"} size="small" icon={<KeyOutlined />}>
              Sign in with Keycloak
            </Button>
          </form>
          {quick ? (
            <form action={quickSignInAction}>
              <input type="hidden" name="username" value={p.username} />
              <input type="hidden" name="next" value={next} />
              <Button htmlType="submit" type="primary" size="small" icon={<ArrowRightOutlined />} iconPlacement="end">
                Enter as {first}
              </Button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function LoginView({ next, quick, error }: { next: string; quick: boolean; error: { user: string } | null }) {
  const inst = PERSONAS.filter((p) => p.side === "institution");
  const pcp = PERSONAS.filter((p) => p.side === "pcp");
  return (
    <PublicFrame title="Choose who you are" sub="Every role sees a different portal. Pick a demo persona to step into their seat. Sign-in, roles and the institution scope all come from Keycloak.">
      <div style={{ background: "#fff", borderRadius: 20, border: "1px solid var(--line)", boxShadow: "var(--shadow-md)", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 }}>
            <SafetyOutlined style={{ color: "var(--brand)", fontSize: 18 }} />
            <span>
              Password for every demo account: <Typography.Text code copyable>Demo@1234</Typography.Text>
              {quick ? <span className="muted"> · or use one-click entry</span> : null}
            </span>
          </div>
          {quick ? (
            <Button icon={<PlayCircleOutlined />} onClick={() => window.dispatchEvent(new Event("pcp-guide-open"))} style={{ borderColor: "#e3c97f", color: "#7a5b12", background: "#fffbf0", fontWeight: 600 }}>
              Start the guided demo
            </Button>
          ) : null}
        </div>
        {error ? (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 18 }}
            message={`Could not enter as ${error.user}`}
            description="Keycloak refused the sign-in: the account may be disabled or must set a new password first. Use “Sign in with Keycloak” instead."
          />
        ) : null}
        <div className="pcp-eyebrow">Institutions</div>
        <Row gutter={[14, 14]} style={{ marginBottom: 22 }}>
          {inst.map((p) => (
            <Col key={p.username} xs={24} md={12}>
              <PersonaCard p={p} next={next} quick={quick} />
            </Col>
          ))}
        </Row>
        <div className="pcp-eyebrow">Pharmacy Council of Pakistan</div>
        <Row gutter={[14, 14]}>
          {pcp.map((p) => (
            <Col key={p.username} xs={24} md={12} lg={8}>
              <PersonaCard p={p} next={next} quick={quick} />
            </Col>
          ))}
        </Row>
        <div className="pcp-eyebrow" style={{ marginTop: 26 }}>More roles from PCP&apos;s working guide</div>
        <Row gutter={[14, 14]}>
          {MORE_PERSONAS.map((p) => (
            <Col key={p.username} xs={24} md={12} lg={8}>
              <PersonaCard p={p} next={next} quick={quick} />
            </Col>
          ))}
        </Row>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--line)" }}>
          <span className="muted" style={{ fontSize: 13 }}>
            Every institution has a Head account (e.g. <code>rbu.poc</code>, <code>scu.poc</code>) who adds the institution&apos;s own staff. New institutions register themselves and PCP approves them.
          </span>
          <form action={loginAction}>
            <input type="hidden" name="next" value={next} />
            <Button htmlType="submit" icon={<KeyOutlined />}>
              Sign in with another account
            </Button>
          </form>
        </div>
      </div>
    </PublicFrame>
  );
}
