"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Card, Col, Collapse, Empty, Form, Input, Row, Select } from "antd";
import { SendOutlined } from "@ant-design/icons";
import { createTicket, followUpTicket } from "@/app/actions/helpdesk";
import type { TicketRow } from "@/lib/council-data";
import { PageTitle, fmtDate } from "./common";
import { ModuleStatus, SlaClock } from "./CouncilParts";
import { FillDemo } from "./demo-helpers";
import { Conversation } from "./TicketView";
import ScreenGuide from "./ScreenGuide";

const CATEGORIES = ["Question", "Complaint", "Technical issue", "Data correction"];

function FollowUp({ t }: { t: TicketRow }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  if (t.status === "CLOSED") return <div className="faint" style={{ fontSize: 12.5, marginTop: 10 }}>Closed. Raise a new ticket if you need more help.</div>;
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "flex-start" }}>
      <Input.TextArea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.status === "RESOLVED" ? "Not solved? Reply here and the ticket opens again" : "Add information for the help desk"} />
      <Button
        icon={<SendOutlined />}
        loading={pending}
        disabled={text.trim().length < 2}
        onClick={() =>
          start(async () => {
            const r = await followUpTicket(t.ref, text);
            message[r.ok ? "success" : "error"](r.message);
            if (r.ok) setText("");
            router.refresh();
          })
        }
      >
        Send
      </Button>
    </div>
  );
}

export default function HelpDeskSelf({ tickets, who, examples }: { tickets: TicketRow[]; who: "institution" | "student" | "pharmacist"; examples: { category: string; subject: string; message: string } }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm();
  const [pending, start] = useTransition();
  const [active, setActive] = useState<string[]>(tickets.filter((t) => t.status !== "CLOSED").slice(0, 2).map((t) => t.ref));

  // Links from alerts point at #TKT-...: open that ticket.
  useEffect(() => {
    const ref = decodeURIComponent(window.location.hash.slice(1));
    if (ref && tickets.some((t) => t.ref === ref)) {
      setActive((a) => (a.includes(ref) ? a : [...a, ref]));
      setTimeout(() => document.getElementById(ref)?.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
    }
  }, [tickets]);

  const submit = (v: { category: string; subject: string; message: string }) =>
    start(async () => {
      const r = await createTicket(v);
      message[r.ok ? "success" : "error"](r.message, r.ok ? 5 : 8);
      if (r.ok) {
        form.resetFields();
        if (r.ref) setActive((a) => [r.ref!, ...a]);
      }
      router.refresh();
    });

  const open = tickets.filter((t) => t.status === "OPEN" || t.status === "IN_PROGRESS").length;

  return (
    <>
      <PageTitle
        eyebrow={who === "institution" ? "With PCP" : "Help"}
        title="Help desk"
        sub="Ask PCP a question, report a problem or ask for a correction. Every ticket gets a reference and an answer within 5 working days."
        extra={
          <ScreenGuide
            title="Help desk"
            steps={[
              "Choose what your ticket is about, give it a short subject and describe the question or problem.",
              "Click **Raise ticket**. You get a reference (TKT-year-number) and the date by which PCP aims to answer.",
              "Replies from PCP appear under **Your tickets**, and also arrive by email and in your alerts.",
              "If a resolved ticket did not solve the problem, reply on it and it opens again.",
            ]}
            note={who === "institution" ? "Every user of your institution sees the institution's tickets." : undefined}
          />
        }
      />
      <Row gutter={18}>
        <Col xs={24} lg={10}>
          <Card size="small" title="Raise a ticket" style={{ marginBottom: 16 }} extra={<FillDemo onClick={() => form.setFieldsValue(examples)} />}>
            <Form form={form} layout="vertical" requiredMark={false} onFinish={submit} initialValues={{ category: "Question" }}>
              <Form.Item name="category" label="What is it about?" rules={[{ required: true, message: "Choose a category." }]}>
                <Select id="ticket-category" options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
              </Form.Item>
              <Form.Item name="subject" label="Subject" rules={[{ required: true, min: 5, message: "Give the ticket a subject of at least 5 characters." }]}>
                <Input id="ticket-subject" maxLength={120} placeholder="e.g. My record shows the wrong shift" />
              </Form.Item>
              <Form.Item name="message" label="Your message" rules={[{ required: true, min: 15, message: "Describe your question or problem in at least 15 characters." }]}>
                <Input.TextArea id="ticket-message" rows={5} maxLength={4000} placeholder="What happened, what you expected, and any reference numbers" />
              </Form.Item>
              <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={pending} block>
                Raise ticket
              </Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card size="small" title={`Your tickets${tickets.length ? ` · ${open} open` : ""}`} styles={{ body: { padding: tickets.length ? 8 : 16 } }}>
            {tickets.length ? (
              <Collapse
                ghost
                activeKey={active}
                onChange={(k) => setActive(Array.isArray(k) ? k.map(String) : [String(k)])}
                items={tickets.map((t) => ({
                  key: t.ref,
                  label: (
                    <div id={t.ref} style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ minWidth: 0 }}>
                        <span className="mono" style={{ fontWeight: 600, marginRight: 8 }}>
                          {t.ref}
                        </span>
                        <span style={{ fontWeight: 500 }}>{t.subject}</span>
                        <div className="faint" style={{ fontSize: 12 }}>
                          {t.category} · raised {fmtDate(t.createdAt)}
                          {t.raisedBy && who === "institution" ? ` by ${t.raisedBy}` : ""} · {t.replyCount} repl{t.replyCount === 1 ? "y" : "ies"}
                        </div>
                      </span>
                      <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                        <ModuleStatus status={t.status} />
                        {t.status === "OPEN" || t.status === "IN_PROGRESS" ? <SlaClock sla={t.sla} dueAt={t.slaDueAt} compact /> : null}
                      </span>
                    </div>
                  ),
                  children: (
                    <div style={{ paddingLeft: 4 }}>
                      <Conversation t={t} internal={false} />
                      <FollowUp t={t} />
                    </div>
                  ),
                }))}
              />
            ) : (
              <Empty description="No tickets yet. Raise one on the left." />
            )}
          </Card>
        </Col>
      </Row>
    </>
  );
}
