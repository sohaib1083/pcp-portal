"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Card, Col, Input, Row, Segmented, Select, Tag, Typography } from "antd";
import { CheckCircleOutlined, LockOutlined, MailOutlined, SendOutlined, UserAddOutlined } from "@ant-design/icons";
import { assignTicket, closeTicket, replyTicket, resolveTicket } from "@/app/actions/helpdesk";
import type { ActionResult } from "@/app/actions/faculty";
import type { TicketRow } from "@/lib/council-data";
import { Avatar, KV, fmtDate, timeAgo } from "./common";
import { ModuleStatus, SlaClock } from "./CouncilParts";
import { FillDemo } from "./demo-helpers";
import { CATEGORY_COLORS, SOURCE_LABELS } from "./HelpDeskQueue";
import ScreenGuide from "./ScreenGuide";

/** The conversation on a ticket: the request, then replies. Internal notes are shown only when `internal` is on. */
export function Conversation({ t, internal }: { t: TicketRow; internal: boolean }) {
  const items = [{ id: 0, author: t.raisedBy ?? "Requester", fromPcp: false, body: t.body, internal: false, createdAt: t.createdAt }, ...t.replies.filter((r) => internal || !r.internal)];
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {items.map((r) => (
        <div key={r.id} className={r.internal ? "ticket-note" : "ticket-msg"} style={{ display: "flex", gap: 10, flexDirection: r.fromPcp ? "row-reverse" : "row" }}>
          <Avatar name={r.author} size={30} />
          <div
            style={{
              maxWidth: "82%",
              background: r.internal ? "#fffaf0" : r.fromPcp ? "#f3f9f6" : "#fff",
              border: `1px ${r.internal ? "dashed" : "solid"} ${r.internal ? "#f0d48a" : r.fromPcp ? "#cfe6da" : "var(--line)"}`,
              borderRadius: 12,
              padding: "10px 12px",
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginBottom: 4 }}>
              <b style={{ fontSize: 13 }}>{r.author}</b>
              {r.internal ? (
                <Tag color="gold" icon={<LockOutlined />} style={{ margin: 0 }}>
                  Internal note
                </Tag>
              ) : r.fromPcp ? (
                <span className="faint" style={{ fontSize: 12 }}>PCP help desk</span>
              ) : null}
              <span className="faint" style={{ fontSize: 12 }}>
                {fmtDate(r.createdAt, true)} · {timeAgo(r.createdAt)}
              </span>
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{r.body}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TicketView({ t, me, staff }: { t: TicketRow; me: string; staff: { username: string; name: string; role: string }[] }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const [resolution, setResolution] = useState("");
  const [assignee, setAssignee] = useState<string | undefined>(t.assignedTo ?? undefined);
  const open = t.status === "OPEN" || t.status === "IN_PROGRESS";
  const canWrite = t.status !== "CLOSED";

  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      message[r.ok ? (r.level === "warning" ? "warning" : "success") : "error"](r.message, r.ok ? 4 : 8);
      if (r.ok) after?.();
      router.refresh();
    });

  return (
    <>
      <Card style={{ marginBottom: 18 }} styles={{ body: { padding: "20px 22px" } }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="pcp-eyebrow">
              <Link href="/pcp/helpdesk" style={{ color: "inherit" }}>
                Help desk
              </Link>{" "}
              · {SOURCE_LABELS[t.source]} {t.category.toLowerCase()}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h1 className="pcp-page-title" style={{ fontSize: 22 }}>
                {t.subject}
              </h1>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
              <span className="mono" style={{ fontWeight: 600 }}>
                {t.ref}
              </span>
              <ModuleStatus status={t.status} />
              <Tag color={CATEGORY_COLORS[t.category]} style={{ margin: 0 }}>
                {t.category}
              </Tag>
              <span className="muted" style={{ fontSize: 13 }}>
                from {t.raisedBy}
                {t.inst ? ` · ${t.inst.name}` : ""}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <ScreenGuide
              title="Answering a ticket"
              steps={[
                "Read the request. The clock at the top shows the time left of the 5 working days.",
                "**Assign** the ticket so everyone knows who holds it. The first reply assigns it to you automatically.",
                "Choose **Reply to requester** to answer by email (and in-app for signed-in users), or **Internal note** for PCP colleagues only.",
                "When it is answered, **Resolve** with a short explanation. A reply from the requester reopens it; **Close** ends it.",
              ]}
            />
            <SlaClock sla={t.sla} dueAt={t.slaDueAt} />
          </div>
        </div>
      </Card>

      <Row gutter={18}>
        <Col xs={24} lg={15}>
          <Card size="small" title="Conversation" style={{ marginBottom: 16 }} extra={<span className="faint" style={{ fontSize: 12 }}>{t.noteCount ? `${t.noteCount} internal note${t.noteCount === 1 ? "" : "s"} (PCP only)` : "Replies are emailed to the requester"}</span>}>
            <Conversation t={t} internal />
            {canWrite ? (
              <div style={{ borderTop: "1px solid var(--line-2)", marginTop: 16, paddingTop: 14, display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Segmented
                    value={mode}
                    onChange={(v) => setMode(v as "reply" | "note")}
                    options={[
                      { value: "reply", label: "Reply to requester", icon: <MailOutlined /> },
                      { value: "note", label: "Internal note", icon: <LockOutlined /> },
                    ]}
                  />
                  <FillDemo
                    onClick={() =>
                      setText(
                        mode === "reply"
                          ? "Thank you for writing to PCP. We have checked the register: the college you mention is not approved by PCP for a Pharm.D programme. We have written to the college and to the provincial authorities. Students should check any institution on the public verification page before paying fees."
                          : "Checked the register: no NOC or onboarding request for this college. Forwarded to the registration section for a notice.",
                      )
                    }
                  />
                </div>
                <Input.TextArea id="ticket-reply" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === "reply" ? `Your reply to ${t.raisedBy}. It is emailed${t.contactEmail ? ` to ${t.contactEmail}` : ""}.` : "Visible to PCP staff only"} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {mode === "reply" ? (t.contactEmail ? `Email to ${t.contactEmail}${t.source !== "PUBLIC" ? " and an in-app alert" : ""}` : "In-app alert to the requester") : "The requester does not see internal notes."}
                  </span>
                  <Button type={mode === "reply" ? "primary" : "default"} icon={mode === "reply" ? <SendOutlined /> : <LockOutlined />} loading={pending} disabled={text.trim().length < 2} onClick={() => run(() => replyTicket(t.ref, text, mode === "note"), () => setText(""))}>
                    {mode === "reply" ? "Send reply" : "Add internal note"}
                  </Button>
                </div>
              </div>
            ) : (
              <Typography.Paragraph type="secondary" style={{ marginTop: 14, marginBottom: 0 }}>
                This ticket is closed.
              </Typography.Paragraph>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={9}>
          <Card
            size="small"
            title="Your next step"
            style={{ marginBottom: 16, borderColor: canWrite ? "#95d5b2" : undefined, boxShadow: canWrite ? "0 0 0 3px #e8f3ee" : undefined }}
            styles={{ body: { background: canWrite ? "#fbfdfc" : undefined } }}
          >
            {canWrite ? (
              <div style={{ display: "grid", gap: 14 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <b>Assign</b>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Select
                      style={{ flex: 1 }}
                      placeholder="Choose a colleague"
                      value={assignee}
                      onChange={setAssignee}
                      showSearch={{ optionFilterProp: "label" }}
                      options={staff.map((s) => ({ value: s.username, label: s.username === me ? `${s.name} (you)` : s.name }))}
                    />
                    <Button icon={<UserAddOutlined />} loading={pending} disabled={!assignee || assignee === t.assignedTo} onClick={() => run(() => assignTicket(t.ref, assignee!))}>
                      Assign
                    </Button>
                  </div>
                  {t.assignedTo !== me ? (
                    <Button type="link" size="small" style={{ justifySelf: "start", padding: 0 }} onClick={() => run(() => assignTicket(t.ref, me))}>
                      Assign to me
                    </Button>
                  ) : null}
                </div>
                {open ? (
                  <div style={{ display: "grid", gap: 6, borderTop: "1px solid var(--line-2)", paddingTop: 12 }}>
                    <b>Resolve</b>
                    <Input.TextArea id="ticket-resolution" rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="How it was resolved, in words the requester understands" />
                    <Button type="primary" icon={<CheckCircleOutlined />} loading={pending} disabled={resolution.trim().length < 10} onClick={() => run(() => resolveTicket(t.ref, resolution), () => setResolution(""))}>
                      Resolve and tell the requester
                    </Button>
                  </div>
                ) : null}
                {t.status === "RESOLVED" ? (
                  <div style={{ display: "grid", gap: 6, borderTop: "1px solid var(--line-2)", paddingTop: 12 }}>
                    <span className="muted" style={{ fontSize: 12.5 }}>Resolved {fmtDate(t.resolvedAt, true)}. A reply from the requester reopens it.</span>
                    <Button loading={pending} onClick={() => run(() => closeTicket(t.ref))}>
                      Close ticket
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <Typography.Text type="secondary">Closed. Nothing more to do.</Typography.Text>
            )}
          </Card>
          <Card size="small" title="Details">
            <KV
              rows={[
                ["Reference", <span key="r" className="mono">{t.ref}</span>],
                ["Source", SOURCE_LABELS[t.source]],
                ["Category", t.category],
                ["Name", t.contactName ?? t.raisedBy],
                ["Email", t.contactEmail ?? "—"],
                ["Mobile", t.contactMobile ?? "—"],
                ["Institution", t.inst ? `${t.inst.name} (${t.inst.shortCode})` : "—"],
                ["Assigned to", t.assignedName ?? "Unassigned"],
                ["Raised", fmtDate(t.createdAt, true)],
                ["Time limit", fmtDate(t.slaDueAt, true)],
                ["Resolved", t.resolvedAt ? fmtDate(t.resolvedAt, true) : "—"],
              ]}
            />
          </Card>
        </Col>
      </Row>
    </>
  );
}
