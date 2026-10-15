"use client";
import Link from "next/link";
import { useState } from "react";
import { Alert, Button, Card, Segmented, Table, Tooltip } from "antd";
import { CloseOutlined, FilterOutlined, RiseOutlined } from "@ant-design/icons";
import { formatPKR, daysUntil } from "@/lib/format";
import { slaClock } from "@/lib/sla-view";
import { PROGRAM_LABELS } from "@/lib/workflow";
import { PageTitle, Pill, StatusDot, StatusTag, fmtDate, kindLabel, programmeLabel } from "./common";

type Row = {
  ref: string;
  kind: string;
  programType: string;
  field?: string;
  status: string;
  feeAmount: number;
  feePaid: boolean;
  submittedAt: string | null;
  updatedAt: string;
  stageDueAt: string | null;
  escalated: boolean;
  overdueDays: number;
  assignedOfficer: string | null;
  instName: string;
  instCode: string;
  province: string;
  holder: string;
  needsMe: boolean;
  openDeficiencies: number;
};

type Renewals = { days: number; rows: { name: string; code: string; province: string; type: string; field?: string; until: string; intake: number; status: string; caseRef: string | null; caseStatus: string | null }[] } | null;

export default function PcpQueue({ rows, showFees, filterLabel, renewals }: { rows: Row[]; showFees: boolean; filterLabel?: string | null; renewals?: Renewals }) {
  const closed = (r: Row) => ["NOC_ISSUED", "REJECTED"].includes(r.status);
  const [view, setView] = useState<string>(filterLabel ? "all" : rows.some((r) => r.needsMe) ? "mine" : "all");
  const data = view === "mine" ? rows.filter((r) => r.needsMe) : view === "closed" ? rows.filter(closed) : view === "open" ? rows.filter((r) => !closed(r)) : rows;
  const overdue = rows.filter((r) => r.overdueDays > 0).length;
  return (
    <>
      <PageTitle
        eyebrow="Casework"
        title={renewals ? `Renewals due within ${renewals.days} days` : "Applications"}
        sub={renewals ? "Programmes whose accreditation expires soon, and whether a renewal is already with PCP." : "Your work queue. Overdue cases come first. Each role acts only on the steps it owns, and every case shows who holds it."}
        extra={
          renewals ? null : (
            <Segmented
              value={view}
              onChange={(v) => setView(String(v))}
              options={[
                { value: "mine", label: `Needs my action (${rows.filter((r) => r.needsMe).length})` },
                { value: "open", label: `Open (${rows.filter((r) => !closed(r)).length})` },
                { value: "closed", label: `Closed (${rows.filter(closed).length})` },
                { value: "all", label: `All (${rows.length})` },
              ]}
            />
          )
        }
      />
      {filterLabel || renewals ? (
        <Alert
          type="info"
          showIcon
          icon={<FilterOutlined />}
          style={{ marginBottom: 14 }}
          title={renewals ? `Accreditation expiring by ${fmtDate(new Date(Date.now() + renewals.days * 86400000).toISOString())}` : `Showing cases: ${filterLabel}`}
          action={
            <Link href="/pcp/applications">
              <Button size="small" icon={<CloseOutlined />}>
                Clear filter
              </Button>
            </Link>
          }
        />
      ) : overdue ? (
        <Alert type="error" showIcon style={{ marginBottom: 14 }} title={`${overdue} case${overdue === 1 ? " is" : "s are"} past the stage time limit`} description="They are listed first. A reminder goes to whoever holds the case, then one escalation to the supervisor." action={<Link href="/pcp/applications?overdue=1"><Button size="small">Show only overdue</Button></Link>} />
      ) : null}
      {renewals ? (
        <Card styles={{ body: { padding: 0 } }}>
          <Table
            rowKey={(r) => `${r.code}-${r.type}-${r.field ?? ""}`}
            dataSource={renewals.rows}
            pagination={false}
            locale={{ emptyText: `No accreditation expires in the next ${renewals.days} days` }}
            columns={[
              { title: "Institution", render: (_, r) => <span>{r.name}<div className="faint" style={{ fontSize: 12 }}>{r.code} · {r.province}</div></span> },
              { title: "Programme", dataIndex: "type", render: (v: string, r) => programmeLabel(v, r.field) },
              { title: "Intake", dataIndex: "intake", align: "right" },
              { title: "Expires", dataIndex: "until", render: (v) => fmtDate(v) },
              { title: "Days left", dataIndex: "until", align: "right", render: (v) => { const d = daysUntil(v) ?? 0; return <b className="tnum" style={{ color: d <= 30 ? "#b4141f" : d <= 90 ? "#a15c00" : "var(--ink)" }}>{d < 0 ? `expired ${-d} days ago` : d}</b>; } },
              { title: "Renewal case", render: (_, r) => (r.caseRef ? <span><Link href={`/pcp/applications/${r.caseRef}`} className="mono">{r.caseRef}</Link> <StatusTag status={r.caseStatus!} /></span> : <span className="faint">Not filed yet (alerts sent at 180/120/90/60/30 days)</span>) },
            ]}
          />
        </Card>
      ) : (
        <Card styles={{ body: { padding: 0 } }}>
          <Table
            rowKey="ref"
            dataSource={data}
            pagination={{ pageSize: 15, hideOnSinglePage: true }}
            locale={{ emptyText: view === "mine" ? "Nothing waiting for you. Well done." : "No applications" }}
            rowClassName={(r) => (r.overdueDays > 0 ? "queue-overdue" : "")}
            columns={[
              {
                title: "Reference",
                dataIndex: "ref",
                render: (v, r) => (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    {r.needsMe ? <span title="Needs your action" style={{ width: 8, height: 8, borderRadius: 8, background: "#c8a24a", boxShadow: "0 0 0 3px #faf4e4" }} /> : <span style={{ width: 8 }} />}
                    <Link href={`/pcp/applications/${v}`} className="mono" style={{ fontWeight: 600, fontSize: 13 }}>
                      {v}
                    </Link>
                  </span>
                ),
              },
              { title: "Institution", render: (_, r) => <span>{r.instName}<div className="faint" style={{ fontSize: 12 }}>{r.instCode} · {r.province}</div></span> },
              {
                title: "Type",
                render: (_, r) => `${kindLabel(r.kind)} · ${programmeLabel(r.programType, r.field)}`,
                filters: Object.entries(PROGRAM_LABELS).map(([value, text]) => ({ value, text })),
                onFilter: (v, r) => r.programType === v,
              },
              { title: "Status", dataIndex: "status", render: (v) => <StatusTag status={v} /> },
              { title: "With", dataIndex: "holder", render: (v, r) => (closed(r) ? <span className="faint">Closed</span> : <b style={{ fontWeight: 500, color: r.needsMe ? "#8a6a1c" : "var(--ink-2)" }}>{r.needsMe ? "You" : v}</b>) },
              {
                title: "Time limit",
                dataIndex: "stageDueAt",
                sorter: (a, b) => String(a.stageDueAt ?? "9").localeCompare(String(b.stageDueAt ?? "9")),
                render: (v, r) => {
                  if (closed(r)) return <span className="faint">—</span>;
                  const c = slaClock(r.status, v);
                  if (!c) return <span className="faint">—</span>;
                  return (
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      {c.overdue ? (
                        <span data-testid="overdue-badge">
                          <StatusDot tone="bad">{c.text}</StatusDot>
                        </span>
                      ) : (
                        <span className="tnum" style={{ color: c.tone === "warn" ? "#a15c00" : "var(--ink-2)", fontSize: 13 }}>
                          {c.text}
                        </span>
                      )}
                      {r.escalated ? (
                        <Tooltip title="Escalated to the supervisor">
                          <RiseOutlined style={{ color: "#b4141f" }} />
                        </Tooltip>
                      ) : null}
                    </span>
                  );
                },
              },
              { title: "Submitted", dataIndex: "submittedAt", render: (v) => fmtDate(v), sorter: (a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)) },
              ...(showFees ? [{ title: "Fee", render: (_: unknown, r: Row) => <span className="tnum">{formatPKR(r.feeAmount)} {r.feePaid ? <Pill value="APPROVED" label="Paid" /> : <Pill value="REJECTED" label="Unpaid" />}</span> }] : []),
            ]}
          />
        </Card>
      )}
    </>
  );
}
