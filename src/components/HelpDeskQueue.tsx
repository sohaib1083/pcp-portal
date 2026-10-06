"use client";
import Link from "next/link";
import { useState } from "react";
import { Card, Col, Empty, Row, Segmented, Table, Tag } from "antd";
import { CheckCircleOutlined, CustomerServiceOutlined, FieldTimeOutlined, UserOutlined } from "@ant-design/icons";
import type { TicketRow } from "@/lib/council-data";
import { PageTitle, StatCard, timeAgo } from "./common";
import { ModuleStatus, SlaClock } from "./CouncilParts";
import ScreenGuide from "./ScreenGuide";

export const SOURCE_LABELS: Record<string, string> = { PUBLIC: "Public", INSTITUTION: "Institution", STUDENT: "Student", PHARMACIST: "Pharmacist" };
const SOURCE_COLORS: Record<string, string> = { PUBLIC: "default", INSTITUTION: "blue", STUDENT: "purple", PHARMACIST: "cyan" };
export const CATEGORY_COLORS: Record<string, string> = { Complaint: "red", Question: "green", "Technical issue": "orange", "Data correction": "gold" };

const active = (t: TicketRow) => t.status === "OPEN" || t.status === "IN_PROGRESS";

/** Overdue first (most overdue at the top), then the nearest deadline; finished tickets by most recent. */
function bySla(a: TicketRow, b: TicketRow) {
  if (active(a) !== active(b)) return active(a) ? -1 : 1;
  if (active(a)) return a.sla.msLeft - b.sla.msLeft;
  return (b.resolvedAt ?? b.createdAt).localeCompare(a.resolvedAt ?? a.createdAt);
}

export default function HelpDeskQueue({ rows, me }: { rows: TicketRow[]; me: string }) {
  const counts = {
    active: rows.filter(active).length,
    overdue: rows.filter((t) => t.sla.state === "OVERDUE").length,
    mine: rows.filter((t) => active(t) && t.assignedTo === me).length,
    done: rows.filter((t) => t.status === "RESOLVED" || t.status === "CLOSED"),
  };
  const met = counts.done.filter((t) => t.sla.state === "MET").length;
  const [view, setView] = useState<string>("active");
  const data = [...rows]
    .filter((t) => (view === "active" ? active(t) : view === "mine" ? active(t) && t.assignedTo === me : view === "resolved" ? t.status === "RESOLVED" : view === "closed" ? t.status === "CLOSED" : true))
    .sort(bySla);

  return (
    <>
      <PageTitle
        eyebrow="Casework"
        title="Help desk"
        sub="Questions and complaints from the public, institutions, students and pharmacists. Each ticket must be resolved within 5 working days; overdue tickets are listed first."
        extra={
          <ScreenGuide
            title="Help desk"
            steps={[
              "Tickets come from the public form at /help and from the Help desk screens of institutions, students and pharmacists.",
              "The **service level** column is the clock: 5 working days from the moment the ticket was raised. Overdue tickets are at the top.",
              "Open a ticket and **Assign** it, to yourself or a colleague. The assignee is notified.",
              "**Reply to requester** sends an email (and an in-app alert to signed-in users). An **internal note** stays inside PCP.",
              "**Resolve** with a short explanation for the requester, then **Close** once nothing more is needed.",
            ]}
          />
        }
      />
      <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
        <Col xs={12} lg={6}>
          <StatCard label="Open tickets" icon={<CustomerServiceOutlined />} value={counts.active} hint="Open or in progress" />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard label="Past the time limit" icon={<FieldTimeOutlined />} tone={counts.overdue ? "bad" : "brand"} value={counts.overdue} hint="More than 5 working days" />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard label="Assigned to you" icon={<UserOutlined />} tone="violet" value={counts.mine} hint="Open tickets you hold" />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard label="Resolved within the limit" icon={<CheckCircleOutlined />} tone="info" value={counts.done.length ? `${Math.round((met / counts.done.length) * 100)}%` : "—"} hint={`${met} of ${counts.done.length} resolved tickets`} />
        </Col>
      </Row>
      <Card
        styles={{ body: { padding: 0 } }}
        title="Queue"
        extra={
          <Segmented
            size="small"
            value={view}
            onChange={(v) => setView(String(v))}
            options={[
              { value: "active", label: `Open (${counts.active})` },
              { value: "mine", label: `Mine (${counts.mine})` },
              { value: "resolved", label: `Resolved (${rows.filter((t) => t.status === "RESOLVED").length})` },
              { value: "closed", label: `Closed (${rows.filter((t) => t.status === "CLOSED").length})` },
              { value: "all", label: `All (${rows.length})` },
            ]}
          />
        }
      >
        <Table
          rowKey="ref"
          dataSource={data}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          locale={{ emptyText: <Empty description={view === "mine" ? "No open tickets assigned to you." : "No tickets in this view."} /> }}
          onRow={(t) => ({ style: t.sla.state === "OVERDUE" ? { background: "#fffbfb", boxShadow: "inset 3px 0 0 #cf1322" } : undefined })}
          columns={[
            {
              title: "Ticket",
              dataIndex: "ref",
              render: (v, t) => (
                <Link href={`/pcp/helpdesk/${v}`} style={{ display: "inline-flex", flexDirection: "column", gap: 2, maxWidth: 420 }}>
                  <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>
                    {v}
                  </span>
                  <span style={{ color: "var(--ink)", fontWeight: 500 }}>{t.subject}</span>
                  <span>
                    <Tag color={CATEGORY_COLORS[t.category]} style={{ marginInlineEnd: 6 }}>
                      {t.category}
                    </Tag>
                    {t.replyCount ? <span className="faint" style={{ fontSize: 12 }}>{t.replyCount} repl{t.replyCount === 1 ? "y" : "ies"}</span> : <span className="faint" style={{ fontSize: 12 }}>No reply yet</span>}
                  </span>
                </Link>
              ),
            },
            {
              title: "From",
              render: (_, t) => (
                <span style={{ display: "inline-flex", flexDirection: "column", gap: 3 }}>
                  <span>{t.raisedBy}</span>
                  <span>
                    <Tag color={SOURCE_COLORS[t.source]} style={{ marginInlineEnd: 4 }}>
                      {SOURCE_LABELS[t.source]}
                    </Tag>
                    {t.inst ? <span className="faint" style={{ fontSize: 12 }}>{t.inst.shortCode}</span> : null}
                  </span>
                </span>
              ),
            },
            { title: "Status", dataIndex: "status", render: (v) => <ModuleStatus status={v} /> },
            { title: "Assigned to", dataIndex: "assignedName", render: (v) => v ?? <span className="faint">Unassigned</span> },
            { title: "Service level", render: (_, t) => <SlaClock sla={t.sla} dueAt={t.slaDueAt} /> },
            { title: "Raised", dataIndex: "createdAt", render: (v) => <span style={{ whiteSpace: "nowrap" }}>{timeAgo(v)}</span> },
          ]}
        />
      </Card>
    </>
  );
}
