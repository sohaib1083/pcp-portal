"use client";
// Public self-registration (guide section 3, step "Create account"): account, then email and mobile codes.
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Col, Form, Input, Row } from "antd";
import { CheckCircleFilled, KeyOutlined, LoginOutlined, MailOutlined, MobileOutlined, ReloadOutlined, SafetyOutlined } from "@ant-design/icons";
import { loginAction } from "@/app/actions/auth";
import { registerInstitution, resendCodes, verifyAccount } from "@/app/actions/onboarding";
import { FillDemo } from "./demo-helpers";

const HOW = [
  ["Create your account", "The person who will run the institution's account registers with an official email and mobile."],
  ["Verify email and mobile", "We send a 6-digit code to each. Both must match."],
  ["Complete the checklist", "Profile and affiliation, campus and programmes, legal documents. Save and return any time."],
  ["PCP verifies", "A registration officer accepts, returns with a reason, or rejects with grounds."],
  ["Institution ID issued", "Approval issues your PCP-UNI ID and opens the institution portal."],
];

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: "#fff", borderRadius: 20, border: "1px solid var(--line)", boxShadow: "var(--shadow-md)", padding: 26, ...style }}>{children}</div>;
}

function HowItWorks() {
  return (
    <Card style={{ height: "100%" }}>
      <div className="pcp-eyebrow">How registration works</div>
      <ol style={{ listStyle: "none", margin: "12px 0 0", padding: 0 }}>
        {HOW.map(([t, d], i) => (
          <li key={t} style={{ display: "flex", gap: 12, marginBottom: 16 }}>
            <span className="pub-flow-n" style={{ flex: "none", marginBottom: 0 }}>{i + 1}</span>
            <span>
              <b style={{ display: "block", fontSize: 14 }}>{t}</b>
              <span className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>{d}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="muted" style={{ fontSize: 12.5, borderTop: "1px solid var(--line-2)", paddingTop: 12 }}>
        Nothing else opens until PCP approves the institution. A second campus is added inside the same registration, not as a second account.
      </div>
    </Card>
  );
}

export function RegisterForm() {
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const fillDemo = () => {
    const n = Math.floor(1000 + Math.random() * 9000);
    form.setFieldsValue({
      fullName: "Dr. Kamran Shah",
      designation: "Principal",
      email: `kamran.shah${n}@mehran-pharmacy.demo`,
      mobile: `0300-${String(1000000 + Math.floor(Math.random() * 8999999))}`,
      username: `mcp.head${n}`,
      password: "Demo@1234",
      confirm: "Demo@1234",
    });
  };

  return (
    <Row gutter={[20, 20]}>
      <Col xs={24} lg={15}>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            <div>
              <div className="pcp-eyebrow">Step 1 of 5</div>
              <h2 style={{ margin: 0, fontSize: 20, letterSpacing: "-0.01em" }}>Create the institution&apos;s account</h2>
              <div className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>Use your own details. You become the Head of institution account once PCP approves.</div>
            </div>
            <FillDemo onClick={fillDemo} />
          </div>
          {error ? <Alert type="error" showIcon style={{ marginBottom: 16 }} title="We could not create the account" description={error} /> : null}
          <Form
            form={form}
            layout="vertical"
            requiredMark="optional"
            onFinish={(v) =>
              start(async () => {
                setError(null);
                const r = await registerInstitution(v);
                if (r.ok && "ref" in r && r.ref) {
                  message.success(r.message);
                  router.push(`/register/verify?ref=${r.ref}`);
                } else setError(r.message);
              })
            }
          >
            <Row gutter={14}>
              <Col xs={24} md={14}>
                <Form.Item name="fullName" label="Applicant full name" rules={[{ required: true, min: 3, message: "Enter your full name" }]}>
                  <Input placeholder="e.g. Dr. Rehana Baloch" autoComplete="name" />
                </Form.Item>
              </Col>
              <Col xs={24} md={10}>
                <Form.Item name="designation" label="Designation" rules={[{ required: true, message: "Enter your designation" }]}>
                  <Input placeholder="e.g. Principal" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={14}>
              <Col xs={24} md={14}>
                <Form.Item name="email" label="Official email" rules={[{ required: true, type: "email", message: "Enter a valid official email address" }]} extra="We send a 6-digit code here.">
                  <Input prefix={<MailOutlined className="faint" />} placeholder="name@institution.edu.pk" autoComplete="email" />
                </Form.Item>
              </Col>
              <Col xs={24} md={10}>
                <Form.Item name="mobile" label="Mobile number" rules={[{ required: true, pattern: /^03\d{2}-\d{7}$/, message: "Enter it as 03xx-xxxxxxx" }]} extra="We send a second code by SMS.">
                  <Input prefix={<MobileOutlined className="faint" />} placeholder="03xx-xxxxxxx" maxLength={12} inputMode="tel" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              name="username"
              label="Username"
              normalize={(v: string) => v?.toLowerCase()}
              rules={[{ required: true, pattern: /^[a-z0-9][a-z0-9._-]{2,40}$/, message: "3 or more lowercase letters, digits, dots or dashes" }]}
              extra="You sign in with this username."
            >
              <Input placeholder="e.g. ivc.head" autoComplete="username" />
            </Form.Item>
            <Row gutter={14}>
              <Col xs={24} md={12}>
                <Form.Item
                  name="password"
                  label="Password"
                  rules={[
                    { required: true, message: "Choose a password" },
                    { min: 8, message: "At least 8 characters" },
                    { pattern: /(?=.*[A-Za-z])(?=.*\d)/, message: "Use at least one letter and one digit" },
                  ]}
                >
                  <Input.Password autoComplete="new-password" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="confirm"
                  label="Confirm password"
                  dependencies={["password"]}
                  rules={[
                    { required: true, message: "Type the password again" },
                    ({ getFieldValue }) => ({ validator: (_, v) => (!v || v === getFieldValue("password") ? Promise.resolve() : Promise.reject(new Error("The two passwords do not match"))) }),
                  ]}
                >
                  <Input.Password autoComplete="new-password" />
                </Form.Item>
              </Col>
            </Row>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span className="muted" style={{ fontSize: 13 }}>
                Already registered? <Link href="/login">Sign in</Link>
              </span>
              <Button type="primary" size="large" htmlType="submit" loading={pending} icon={<SafetyOutlined />}>
                Create account and send codes
              </Button>
            </div>
          </Form>
        </Card>
      </Col>
      <Col xs={24} lg={9}>
        <HowItWorks />
      </Col>
    </Row>
  );
}

export type VerifyInfo = {
  ref: string;
  username: string | null; // shown only to the browser that registered
  name: string;
  emailMasked: string;
  mobileMasked: string;
  emailVerified: boolean;
  mobileVerified: boolean;
  demo: { email: string | null; mobile: string | null } | null;
};

export function VerifyAccount({ info }: { info: VerifyInfo }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [emailCode, setEmailCode] = useState("");
  const [mobileCode, setMobileCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const done = info.emailVerified && info.mobileVerified;

  const row = (icon: React.ReactNode, label: string, to: string, verified: boolean, value: string, set: (v: string) => void, id: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderTop: "1px solid var(--line-2)", flexWrap: "wrap" }}>
      <span style={{ width: 38, height: 38, borderRadius: 10, display: "grid", placeItems: "center", background: verified ? "var(--good-50)" : "var(--brand-50)", color: verified ? "var(--good)" : "var(--brand)", fontSize: 17, flex: "none" }}>
        {verified ? <CheckCircleFilled /> : icon}
      </span>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div className="muted mono" style={{ fontSize: 12.5 }}>{to}</div>
      </div>
      {verified ? (
        <span style={{ color: "var(--good)", fontWeight: 600 }}>Verified</span>
      ) : (
        <Input id={id} aria-label={label} value={value} onChange={(e) => set(e.target.value.replace(/\D/g, ""))} maxLength={6} inputMode="numeric" placeholder="6-digit code" style={{ width: 170, letterSpacing: "0.25em", fontWeight: 600 }} />
      )}
    </div>
  );

  return (
    <Row gutter={[20, 20]}>
      <Col xs={24} lg={15}>
        <Card>
          <div className="pcp-eyebrow">Step 2 of 5 · Registration {info.ref}</div>
          <h2 style={{ margin: "0 0 4px", fontSize: 20, letterSpacing: "-0.01em" }}>{done ? "Your account is verified" : "Verify your email and mobile"}</h2>
          <div className="muted" style={{ fontSize: 13.5, marginBottom: 14 }}>
            {done ? (
              info.username ? (
                <>Sign in as <b className="mono">{info.username}</b> with the password you chose to continue with the checklist.</>
              ) : (
                <>Sign in with the username and password you chose to continue with the checklist.</>
              )
            ) : (
              <>Enter the two codes we sent. They are valid for 30 minutes.</>
            )}
          </div>
          {!done && info.demo ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 14, background: "#fffbf0", borderColor: "#f0e2bb" }}
              title="Demo: no real email or SMS is sent"
              description={
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span>
                    Email code <b className="mono" style={{ fontSize: 14 }}>{info.demo.email ?? "—"}</b> · SMS code <b className="mono" style={{ fontSize: 14 }}>{info.demo.mobile ?? "—"}</b>. Both are also stored in the message outbox.
                  </span>
                  <FillDemo
                    label="Fill demo codes"
                    onClick={() => {
                      setEmailCode(info.demo?.email ?? "");
                      setMobileCode(info.demo?.mobile ?? "");
                    }}
                  />
                </div>
              }
            />
          ) : null}
          {error ? <Alert type="error" showIcon style={{ marginBottom: 14 }} title={error} /> : null}
          {row(<MailOutlined />, "Email code", info.emailMasked, info.emailVerified, emailCode, setEmailCode, "email-code")}
          {row(<MobileOutlined />, "Mobile code (SMS)", info.mobileMasked, info.mobileVerified, mobileCode, setMobileCode, "mobile-code")}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", borderTop: "1px solid var(--line-2)", paddingTop: 16 }}>
            {done ? (
              <span className="muted" style={{ fontSize: 13 }}>Keycloak, PCP&apos;s sign-in service, will ask for your password.</span>
            ) : (
              <Button
                type="link"
                icon={<ReloadOutlined />}
                style={{ paddingLeft: 0 }}
                loading={pending}
                onClick={() =>
                  start(async () => {
                    const r = await resendCodes(info.ref);
                    message[r.ok ? "success" : "error"](r.message);
                    setEmailCode("");
                    setMobileCode("");
                    router.refresh();
                  })
                }
              >
                Send new codes
              </Button>
            )}
            {done ? (
              <form action={loginAction}>
                {info.username ? <input type="hidden" name="username" value={info.username} /> : null}
                <input type="hidden" name="next" value="/onboarding" />
                <Button type="primary" size="large" htmlType="submit" icon={<LoginOutlined />}>
                  Sign in to continue
                </Button>
              </form>
            ) : (
              <Button
                type="primary"
                size="large"
                icon={<KeyOutlined />}
                loading={pending}
                disabled={(!info.emailVerified && emailCode.length !== 6) || (!info.mobileVerified && mobileCode.length !== 6)}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const r = await verifyAccount(info.ref, emailCode, mobileCode);
                    if (r.ok) message.success(r.message);
                    else setError(r.message);
                    router.refresh();
                  })
                }
              >
                Verify codes
              </Button>
            )}
          </div>
        </Card>
      </Col>
      <Col xs={24} lg={9}>
        <HowItWorks />
      </Col>
    </Row>
  );
}

export function UnknownRegistration() {
  return (
    <Card>
      <h2 style={{ marginTop: 0, fontSize: 20 }}>We could not find that registration</h2>
      <p className="muted">Check the link in your email, or start again.</p>
      <Link href="/register">
        <Button type="primary">Register your institution</Button>
      </Link>
    </Card>
  );
}
