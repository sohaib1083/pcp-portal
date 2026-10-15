"use client";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Input } from "antd";
import { LogoutOutlined, ReloadOutlined, SafetyOutlined } from "@ant-design/icons";
import { logoutAction } from "@/app/actions/auth";
import { confirmSigninCode, sendSigninCode } from "@/app/actions/people";
import { Avatar } from "./common";
import { PublicFrame } from "./PublicHome";

/** The officer's second sign-in step: a one-time code by SMS. In the demo the code is shown and filled in. */
export default function SigninCodeView({ name, role, next }: { name: string; role: string; next: string }) {
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sentOnce = useRef(false);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await sendSigninCode();
      if (!r.ok) return setError(r.message);
      setSentTo(r.sentTo ?? null);
      setDemoCode(r.demoCode ?? null);
      if (r.demoCode) setCode(r.demoCode); // demo: filled in for you; production: typed from the SMS
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (sentOnce.current) return;
    sentOnce.current = true;
    void send();
  }, []);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await confirmSigninCode(code, next);
      if (!r.ok) return setError(r.message);
      window.location.assign(r.next ?? next); // a full load, so the area's layout checks the code again
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicFrame title="One more step" sub="Officers sign in with a password and a one-time code.">
      <div data-testid="signin-code" style={{ maxWidth: 460, margin: "0 auto", background: "#fff", borderRadius: 20, border: "1px solid var(--line)", boxShadow: "var(--shadow-md)", padding: 24 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
          <Avatar name={name} size={42} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 650, fontSize: 15 }}>{name}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>{role}</div>
          </div>
        </div>
        <p style={{ marginTop: 0, fontSize: 14 }}>
          <SafetyOutlined style={{ color: "var(--brand)", marginRight: 6 }} />
          {sentTo ? (
            <>
              We sent a 6-digit code by SMS to <span className="mono">{sentTo}</span>. Enter it to open your workspace.
            </>
          ) : (
            "Sending your code…"
          )}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void confirm();
          }}
        >
          <label htmlFor="signin-code" className="muted" style={{ fontSize: 12.5, display: "block", marginBottom: 4 }}>
            One-time code
          </label>
          <Input
            id="signin-code"
            size="large"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
            style={{ letterSpacing: "0.3em", fontWeight: 600, maxWidth: 220 }}
          />
          {demoCode ? <Alert type="info" showIcon style={{ marginTop: 12 }} title={`Demo: no SMS is sent, so the code ${demoCode} is filled in for you. It is also in Messages.`} /> : null}
          {error ? <Alert type="error" showIcon style={{ marginTop: 12 }} title={error} /> : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
            <Button type="primary" htmlType="submit" size="large" loading={busy} disabled={code.length !== 6}>
              Continue
            </Button>
            <Button size="large" icon={<ReloadOutlined />} onClick={() => void send()} disabled={busy}>
              Send a new code
            </Button>
          </div>
        </form>
        <form action={logoutAction} style={{ marginTop: 18, borderTop: "1px solid var(--line-2)", paddingTop: 12 }}>
          <Button htmlType="submit" type="link" icon={<LogoutOutlined />} style={{ paddingInline: 0 }}>
            Not you? Sign out
          </Button>
        </form>
      </div>
    </PublicFrame>
  );
}
