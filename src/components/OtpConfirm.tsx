"use client";
// Step-up confirmation with a one-time code (guide section 12). Usage:
//   const { withOtp, otpModal } = useOtp();
//   withOtp(`decision:${ref}`, "Record the council decision", (code) => run(() => recordDecision(ref, "APPROVED", note, code)));
//   ...render {otpModal}
import { useState } from "react";
import { Alert, App, Input, Modal } from "antd";
import { SafetyOutlined } from "@ant-design/icons";
import { requestOtp } from "@/app/actions/otp";

type Pending = { purpose: string; title: string; action: (code: string) => void | Promise<void>; sentTo?: string; demoCode?: string };

export function useOtp() {
  const { message } = App.useApp();
  const [pending, setPending] = useState<Pending | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const withOtp = async (purpose: string, title: string, action: (code: string) => void | Promise<void>) => {
    const r = await requestOtp(purpose);
    if (!r.ok) return message.error(r.message);
    setCode(r.demoCode); // demo: filled in for you; production: typed from the SMS
    setPending({ purpose, title, action, sentTo: r.sentTo, demoCode: r.demoCode });
  };

  const otpModal = (
    <Modal
      open={!!pending}
      title={
        <span>
          <SafetyOutlined style={{ color: "var(--brand)", marginRight: 8 }} />
          Confirm with a one-time code
        </span>
      }
      okText="Confirm"
      confirmLoading={busy}
      onCancel={() => setPending(null)}
      onOk={async () => {
        if (!pending) return;
        setBusy(true);
        try {
          await pending.action(code);
          setPending(null);
        } finally {
          setBusy(false);
        }
      }}
      destroyOnHidden
    >
      <p style={{ marginTop: 0 }}>
        <b>{pending?.title}</b> needs a one-time code. We sent it by SMS to <span className="mono">{pending?.sentTo}</span>.
      </p>
      <Input id="otp-code" size="large" value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} inputMode="numeric" style={{ letterSpacing: "0.3em", fontWeight: 600, maxWidth: 200 }} />
      <Alert type="info" showIcon style={{ marginTop: 12 }} title={`Demo: no SMS is sent, so the code ${pending?.demoCode ?? ""} is filled in for you. It is also in Messages.`} />
    </Modal>
  );
  return { withOtp, otpModal };
}
