"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Alert, App, Button, Col, Form, Input, Result, Row, Select } from "antd";
import { ClockCircleOutlined, MailOutlined, NumberOutlined, SafetyCertificateOutlined, SendOutlined } from "@ant-design/icons";
import { createPublicTicket } from "@/app/actions/helpdesk";
import { fmtDate } from "./common";
import { FillDemo } from "./demo-helpers";
import { PublicFrame } from "./PublicHome";
import ScreenGuide from "./ScreenGuide";

const CATEGORIES = [
  { value: "Question", label: "Question" },
  { value: "Complaint", label: "Complaint" },
  { value: "Technical issue", label: "Problem with this website" },
  { value: "Data correction", label: "A record is wrong" },
];

export default function HelpPublic({ institutions, signedIn }: { institutions: { id: number; name: string; city: string }[]; signedIn: boolean }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<{ ref: string; email: string; dueAt: string } | null>(null);

  const submit = (v: Record<string, unknown>) =>
    start(async () => {
      const r = await createPublicTicket(v);
      if (!r.ok || !r.ref) {
        message.error(r.message, 8);
        return;
      }
      setDone({ ref: r.ref, email: String(v.email), dueAt: r.dueAt! });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

  return (
    <PublicFrame signedIn={signedIn} title="Help desk" sub="Ask the Pharmacy Council of Pakistan a question or make a complaint. You get a reference number and an email acknowledgement, and an answer within 5 working days.">
      <div style={{ background: "#fff", borderRadius: 20, border: "1px solid var(--line)", boxShadow: "var(--shadow-md)", padding: 24 }}>
        {done ? (
          <Result
            status="success"
            title={
              <span>
                Your reference is{" "}
                <span className="mono" id="ticket-ref" style={{ fontSize: 22 }}>
                  {done.ref}
                </span>
              </span>
            }
            subTitle={`We emailed an acknowledgement to ${done.email}. PCP aims to answer by ${fmtDate(done.dueAt)}. Replies come to the same email address; quote ${done.ref} if you write again.`}
            extra={[
              <Button
                key="again"
                onClick={() => {
                  form.resetFields();
                  setDone(null);
                }}
              >
                Ask something else
              </Button>,
              <Link key="verify" href="/verify">
                <Button type="primary" icon={<SafetyCertificateOutlined />}>
                  Verify an institution
                </Button>
              </Link>,
            ]}
          />
        ) : (
          <Row gutter={[32, 24]}>
            <Col xs={24} lg={15}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 650 }}>Write to PCP</h2>
                <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <ScreenGuide
                    title="Contacting PCP"
                    steps={[
                      "Fill in your name, email and, if you like, a mobile number.",
                      "Choose whether it is a question, a complaint, a website problem or a record that is wrong. Pick the institution if it is about one.",
                      "Write your message and click **Send to PCP**. You see your reference at once and get it by email.",
                      "PCP aims to answer within 5 working days. The answer comes by email; quote your reference if you write again.",
                    ]}
                  />
                  <FillDemo
                    onClick={() =>
                      form.setFieldsValue({
                        name: "Saima Tariq",
                        email: "saima.tariq@example.com",
                        mobile: "0321 5550123",
                        category: "Question",
                        institutionId: institutions.find((i) => i.name.startsWith("Northern Hills"))?.id,
                        message: "Northern Hills College of Pharmacy says its Pharm.D programme is approved for this year's admissions. The public search shows the NOC as pending. Can I apply safely?",
                      })
                    }
                  />
                </span>
              </div>
              <Form form={form} layout="vertical" requiredMark={false} onFinish={submit}>
                <Row gutter={12}>
                  <Col xs={24} md={12}>
                    <Form.Item name="name" label="Your name" rules={[{ required: true, min: 3, message: "Enter your full name." }]}>
                      <Input id="help-name" autoComplete="name" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="email" label="Email" rules={[{ required: true, type: "email", message: "Enter a valid email address, for example name@example.com." }]}>
                      <Input id="help-email" type="email" autoComplete="email" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="mobile" label="Mobile (optional)" rules={[{ pattern: /^((\+92|0)3\d{2}[\s-]?\d{7})?$/, message: "Enter a Pakistani mobile number, for example 0300 1234567." }]}>
                      <Input id="help-mobile" autoComplete="tel" placeholder="0300 1234567" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="category" label="What is it about?" rules={[{ required: true, message: "Choose what this is about." }]}>
                      <Select id="help-category" placeholder="Choose" options={CATEGORIES} />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item name="institutionId" label="Institution (optional)" extra="If your message is about a college or university, choose it here.">
                  <Select id="help-institution" allowClear showSearch={{ optionFilterProp: "label" }} placeholder="Start typing a name" options={institutions.map((i) => ({ value: i.id, label: `${i.name}, ${i.city}` }))} />
                </Form.Item>
                <Form.Item name="message" label="Your message" rules={[{ required: true, min: 15, message: "Describe your question or complaint in at least 15 characters." }]}>
                  <Input.TextArea id="help-message" rows={6} maxLength={4000} showCount placeholder="What happened, when, and any reference or certificate numbers" />
                </Form.Item>
                <Button type="primary" htmlType="submit" size="large" icon={<SendOutlined />} loading={pending}>
                  Send to PCP
                </Button>
              </Form>
            </Col>
            <Col xs={24} lg={9}>
              <div style={{ background: "var(--bg)", borderRadius: 14, padding: 18, display: "grid", gap: 16 }}>
                <b style={{ fontSize: 15 }}>What happens next</b>
                {[
                  [<NumberOutlined key="i" />, "A reference at once", "You see a ticket reference (TKT-year-number) as soon as you send."],
                  [<MailOutlined key="i" />, "An email acknowledgement", "The same reference arrives by email. Answers come there too."],
                  [<ClockCircleOutlined key="i" />, "An answer within 5 working days", "Each ticket has a clock; PCP sees overdue tickets first."],
                ].map(([icon, title, text], i) => (
                  <div key={i} style={{ display: "flex", gap: 12 }}>
                    <span className="pub-card-icon" style={{ margin: 0, width: 36, height: 36, fontSize: 16, flex: "none" }}>
                      {icon}
                    </span>
                    <div>
                      <div style={{ fontWeight: 600 }}>{title}</div>
                      <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.5 }}>{text}</div>
                    </div>
                  </div>
                ))}
                <Alert type="info" showIcon title={<span>Checking an institution or a certificate? The <Link href="/verify">public verification page</Link> answers at once.</span>} />
              </div>
            </Col>
          </Row>
        )}
      </div>
    </PublicFrame>
  );
}
