"use client";
import Link from "next/link";
import { useState } from "react";
import { Card, Segmented, Table } from "antd";
import { formatPKR } from "@/lib/format";
import { PageTitle, Pill, StatusTag, fmtDate, kindLabel, programLabel } from "./common";

type Row = {
  ref: string;
  kind: string;
  programType: string;
  status: string;
  feeAmount: number;
  feePaid: boolean;
  feePaidAt: string | null;
  submittedAt: string | null;
  updatedAt: string;
  assignedOfficer: string | null;
  instName: string;
  instCode: string;
  province: string;
  needsMe: boolean;
};

const WITH: Record<string, string> = {
  SUBMITTED: "Officer",
  UNDER_SCRUTINY: "Officer",
  DEFICIENCY_RAISED: "Institution",
  RESPONDED: "Officer",
  INSPECTION_SCHEDULED: "Inspector",
  INSPECTION_SUBMITTED: "Officer",
  COUNCIL_REVIEW: "Secretary",
  APPROVED: "Secretary",
  DEFERRED: "Officer",
};

export default function PcpQueue({ rows, showFees }: { rows: Row[]; showFees: boolean }) {
  const [view, setView] = useState<string>(rows.some((r) => r.needsMe) ? "mine" : "all");
  const closed = (r: Row) => ["NOC_ISSUED", "REJECTED"].includes(r.status);
  const data = view === "mine" ? rows.filter((r) => r.needsMe) : view === "closed" ? rows.filter(closed) : view === "open" ? rows.filter((r) => !closed(r)) : rows;
  return (
    <>
      <PageTitle
        eyebrow="Casework"
        title="Applications"
        sub="Your work queue. Each role acts only on the steps it owns, and every case shows who holds it."
        extra={
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
        }
      />
      <Card styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="ref"
          dataSource={data}
          pagination={{ pageSize: 15, hideOnSinglePage: true }}
          locale={{ emptyText: view === "mine" ? "Nothing waiting for you. Well done." : "No applications" }}
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
            { title: "Type", render: (_, r) => `${kindLabel(r.kind)} · ${programLabel(r.programType)}` },
            { title: "Status", dataIndex: "status", render: (v) => <StatusTag status={v} /> },
            { title: "With", dataIndex: "status", render: (v, r) => (closed(r) ? <span className="faint">Closed</span> : <b style={{ fontWeight: 500, color: r.needsMe ? "#8a6a1c" : "var(--ink-2)" }}>{r.needsMe ? "You" : WITH[v] ?? "—"}</b>) },
            { title: "Submitted", dataIndex: "submittedAt", render: (v) => fmtDate(v), sorter: (a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)) },
            {
              title: "Days open",
              align: "right",
              render: (_, r) => {
                if (!r.submittedAt || closed(r)) return <span className="faint">—</span>;
                const d = Math.floor((Date.now() - new Date(r.submittedAt).getTime()) / 86400000);
                return <span className="tnum" style={{ color: d > 30 ? "#b4141f" : d > 14 ? "#a15c00" : "var(--ink)", fontWeight: 600 }}>{d}</span>;
              },
            },
            ...(showFees ? [{ title: "Fee", render: (_: unknown, r: Row) => <span className="tnum">{formatPKR(r.feeAmount)} {r.feePaid ? <Pill value="APPROVED" label="Paid" /> : <Pill value="REJECTED" label="Unpaid" />}</span> }] : []),
          ]}
        />
      </Card>
    </>
  );
}
