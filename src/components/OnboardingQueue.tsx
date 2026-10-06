"use client";
import Link from "next/link";
import { useState } from "react";
import { Card, Col, Progress, Row, Segmented, Table, Tag } from "antd";
import { BankOutlined, ClockCircleOutlined, RollbackOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { ONBOARDING_STATUS_LABELS, ONBOARDING_STATUS_TONE, PROGRAMME_LABELS } from "@/lib/onboarding-steps";
import { PageTitle, Person, StatCard, StatusDot, fmtDate } from "./common";

type Row = {
  ref: string;
  status: string;
  name: string | null;
  city: string | null;
  province: string | null;
  sector: string | null;
  applicantName: string;
  applicantDesignation: string | null;
  campuses: number;
  programmes: string[];
  stepsDone: number;
  stepsTotal: number;
  submittedAt: string | null;
  updatedAt: string;
  institutionCode: string | null;
};

const days = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null);

export default function OnboardingQueue({ rows }: { rows: Row[] }) {
  const waiting = rows.filter((r) => r.status === "SUBMITTED");
  const [view, setView] = useState<string>(waiting.length ? "SUBMITTED" : "all");
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const decided = (r: Row) => r.status === "APPROVED" || r.status === "REJECTED";
  const data = view === "all" ? rows : view === "decided" ? rows.filter(decided) : rows.filter((r) => r.status === view);
  const oldest = Math.max(0, ...waiting.map((r) => days(r.submittedAt) ?? 0));

  return (
    <>
      <PageTitle
        eyebrow="Casework"
        title="Institution onboarding"
        sub="Self-registered institutions. Check the profile, campuses and legal documents, then approve, return with a reason, or reject. Approval issues the Institution ID."
      />
      <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
        <Col xs={12} lg={6}>
          <StatCard label="Waiting for PCP" value={waiting.length} icon={<ClockCircleOutlined />} tone="info" hint={waiting.length ? `Oldest waiting ${oldest} day${oldest === 1 ? "" : "s"}` : "Nothing waiting"} />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard label="Returned to applicant" value={count("RETURNED")} icon={<RollbackOutlined />} tone="warn" hint="Fixing the points PCP raised" />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard label="Still filling the checklist" value={count("DRAFT")} icon={<BankOutlined />} tone="neutral" hint="Not submitted yet" />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard label="Approved" value={count("APPROVED")} icon={<SafetyCertificateOutlined />} tone="brand" hint="Institution ID issued" />
        </Col>
      </Row>
      <Card
        title="Registrations"
        extra={
          <Segmented
            value={view}
            onChange={(v) => setView(String(v))}
            options={[
              { value: "SUBMITTED", label: `Waiting for PCP (${waiting.length})` },
              { value: "RETURNED", label: `Returned (${count("RETURNED")})` },
              { value: "DRAFT", label: `Drafts (${count("DRAFT")})` },
              { value: "decided", label: `Decided (${rows.filter(decided).length})` },
              { value: "all", label: `All (${rows.length})` },
            ]}
          />
        }
        styles={{ body: { padding: 0 } }}
      >
        <Table
          rowKey="ref"
          dataSource={data}
          pagination={{ pageSize: 15, hideOnSinglePage: true }}
          locale={{ emptyText: view === "SUBMITTED" ? "Nothing waiting for PCP." : "No registrations" }}
          columns={[
            {
              title: "Reference",
              dataIndex: "ref",
              render: (v, r) => (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
                  {r.status === "SUBMITTED" ? <span title="Waiting for PCP" style={{ width: 8, height: 8, borderRadius: 8, background: "#c8a24a", boxShadow: "0 0 0 3px #faf4e4" }} /> : <span style={{ width: 8 }} />}
                  <Link href={`/pcp/onboarding/${v}`} className="mono" style={{ fontWeight: 600, fontSize: 13 }}>
                    {v}
                  </Link>
                </span>
              ),
            },
            {
              title: "Institution",
              render: (_, r) =>
                r.name ? (
                  <span>
                    <Link href={`/pcp/onboarding/${r.ref}`} style={{ color: "var(--ink)", fontWeight: 500 }}>
                      {r.name}
                    </Link>
                    <div className="faint" style={{ fontSize: 12 }}>
                      {r.city}, {r.province} · {r.sector} · {r.campuses} campus{r.campuses === 1 ? "" : "es"}
                      {r.institutionCode ? <> · <span className="mono">{r.institutionCode}</span></> : null}
                    </div>
                  </span>
                ) : (
                  <span className="faint">Profile not filled in yet</span>
                ),
            },
            { title: "Programmes", render: (_, r) => (r.programmes.length ? r.programmes.map((p) => <Tag key={p}>{p === "PHARMD" ? "PharmD" : "Technician"}</Tag>) : <span className="faint">—</span>) },
            { title: "Applicant", render: (_, r) => <Person name={r.applicantName} sub={r.applicantDesignation} size={28} /> },
            { title: "Status", dataIndex: "status", render: (v) => <StatusDot tone={ONBOARDING_STATUS_TONE[v] ?? "neutral"}>{ONBOARDING_STATUS_LABELS[v] ?? v}</StatusDot> },
            {
              title: "Checklist",
              render: (_, r) => (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 110 }} title={`${r.stepsDone} of ${r.stepsTotal} steps complete`}>
                  <Progress percent={Math.round((r.stepsDone / r.stepsTotal) * 100)} showInfo={false} size="small" style={{ width: 60, margin: 0 }} />
                  <span className="tnum muted" style={{ fontSize: 12.5 }}>
                    {r.stepsDone}/{r.stepsTotal}
                  </span>
                </span>
              ),
            },
            { title: "Submitted", dataIndex: "submittedAt", render: (v) => fmtDate(v), sorter: (a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)) },
            {
              title: "Waiting",
              align: "right",
              render: (_, r) => {
                if (r.status !== "SUBMITTED") return <span className="faint">—</span>;
                const d = days(r.submittedAt) ?? 0;
                return <span className="tnum" style={{ color: d > 14 ? "#b4141f" : d > 7 ? "#a15c00" : "var(--ink)", fontWeight: 600, whiteSpace: "nowrap" }}>{d} day{d === 1 ? "" : "s"}</span>;
              },
            },
          ]}
        />
      </Card>
      <div className="faint" style={{ fontSize: 12.5, marginTop: 10 }}>
        Programmes: {Object.values(PROGRAMME_LABELS).join(" and ")}. A second campus is a child record of the same registration, not a second account.
      </div>
    </>
  );
}
