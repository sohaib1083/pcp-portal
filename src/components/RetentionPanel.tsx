"use client";
// Retention rules (guide section 14): the policy, a dry-run preview of what would be cleared now,
// the last runs, and "Run clean-up now" with a one-time code.
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Col, Empty, Row, Table, Tag } from "antd";
import { ClearOutlined, EditOutlined, ExperimentOutlined, LockOutlined } from "@ant-design/icons";
import { retentionDryRun, retentionRunNow } from "@/app/actions/retention";
import { useOtp } from "./OtpConfirm";
import { StatusDot, fmtDate } from "./common";

type Category = "draftApplications" | "onboardingDrafts" | "expiredCodes" | "unpaidChallans";
export type RetentionData = {
  policy: { draftApplicationDays: number; onboardingDraftDays: number; expiredCodeDays: number; unpaidChallanDays: number };
  version: number | null;
  preview: { items: { category: Category; ref: string; what: string }[]; kept: { category: Category; ref: string; why: string }[]; counts: Record<Category, number> };
  runs: { id: number; dryRun: boolean; trigger: string; counts: Record<string, number>; runBy: string; startedAt: string; policyVersion: number | null }[];
  protectedCounts: { documents: number; auditLog: number; messages: number; payments: number };
};

const LABELS: Record<Category, string> = {
  draftApplications: "Draft applications",
  onboardingDrafts: "Onboarding drafts",
  expiredCodes: "Expired one-time codes",
  unpaidChallans: "Unpaid challans",
};
const ACTION: Record<Category, string> = { draftApplications: "Cleared", onboardingDrafts: "Cleared", expiredCodes: "Deleted", unpaidChallans: "Cancelled, kept" };
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

export default function RetentionPanel({ data }: { data: RetentionData }) {
  const { message } = App.useApp();
  const router = useRouter();
  const { withOtp, otpModal } = useOtp();
  const [busy, setBusy] = useState(false);
  const total = Object.values(data.preview.counts).reduce((a, b) => a + b, 0);
  const p = data.policy;

  const dryRun = async () => {
    setBusy(true);
    try {
      const r = await retentionDryRun();
      message[r.ok ? "success" : "error"](r.message, 6);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  const runNow = () =>
    withOtp("retention:run", `Run the retention clean-up now (${total} item${total === 1 ? "" : "s"})`, async (code) => {
      const r = await retentionRunNow(code);
      message[r.ok ? "success" : "error"](r.message, 8);
      router.refresh();
    });

  return (
    <div data-testid="retention" style={{ display: "grid", gap: 16 }}>
      {otpModal}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card
            title={
              <span>
                Retention policy <span className="faint" style={{ fontWeight: 400, fontSize: 13 }}>{data.version ? `rule retention.policy, version ${data.version}` : "defaults (rule not set)"}</span>
              </span>
            }
            extra={
              <Link href="/pcp/rules">
                <Button size="small" icon={<EditOutlined />}>Change in reference rules</Button>
              </Link>
            }
            style={{ height: "100%" }}
          >
            <div style={{ display: "grid", gap: 8, fontSize: 13.5 }} data-testid="retention-policy">
              <div><b>Draft applications</b> nobody changed for <b>{days(p.draftApplicationDays)}</b> are cleared. The institution is told.</div>
              <div><b>Onboarding drafts</b> never submitted and untouched for <b>{days(p.onboardingDraftDays)}</b> are cleared.</div>
              <div><b>One-time codes</b> are deleted <b>{days(p.expiredCodeDays)}</b> after they expire.</div>
              <div><b>Unpaid challans</b> older than <b>{days(p.unpaidChallanDays)}</b> are cancelled, not deleted: the PSID can no longer be paid and the record stays in the ledger.</div>
              <div className="muted" style={{ fontSize: 12.5 }}>A draft with a document or a challan attached is kept and listed below. The clean-up runs every night on the scheduler, and here on demand.</div>
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title={<span><LockOutlined style={{ color: "var(--brand)", marginRight: 8 }} />Always kept</span>} style={{ height: "100%" }}>
            <div style={{ display: "grid", gap: 6, fontSize: 13.5 }}>
              <div>Academic and regulatory records: submitted and decided cases, registers, returns</div>
              <div>Documents <span className="faint tnum">({data.protectedCounts.documents.toLocaleString()})</span></div>
              <div>Audit log <span className="faint tnum">({data.protectedCounts.auditLog.toLocaleString()} entries)</span></div>
              <div>Payments <span className="faint tnum">({data.protectedCounts.payments.toLocaleString()}, never deleted)</span></div>
              <div>Messages <span className="faint tnum">({data.protectedCounts.messages.toLocaleString()})</span></div>
            </div>
          </Card>
        </Col>
      </Row>

      <Card
        title="Dry-run preview: what a clean-up would clear now"
        extra={
          <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
            <Button icon={<ExperimentOutlined />} loading={busy} onClick={dryRun} data-testid="retention-dry-run">
              Record a dry run
            </Button>
            <Button type="primary" danger icon={<ClearOutlined />} disabled={!total} onClick={runNow} data-testid="retention-run">
              Run clean-up now
            </Button>
          </span>
        }
        styles={{ body: { padding: 0 } }}
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "14px 16px", borderBottom: "1px solid var(--line-2)" }} data-testid="retention-counts">
          {(Object.keys(LABELS) as Category[]).map((k) => (
            <StatusDot key={k} tone={data.preview.counts[k] ? "warn" : "neutral"}>
              {LABELS[k]}: {data.preview.counts[k]}
            </StatusDot>
          ))}
        </div>
        <Table
          rowKey={(r) => `${r.category}:${r.ref}`}
          size="small"
          dataSource={data.preview.items}
          pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing is past its limit. A clean-up now would clear nothing." /> }}
          columns={[
            { title: "What", dataIndex: "category", render: (v: Category) => <Tag style={{ marginInlineEnd: 0 }}>{LABELS[v]}</Tag> },
            { title: "Reference", dataIndex: "ref", render: (v) => <span className="mono" style={{ whiteSpace: "nowrap" }}>{v}</span> },
            { title: "Details", dataIndex: "what", render: (v) => <span style={{ fontSize: 13 }}>{v}</span> },
            { title: "Clean-up", dataIndex: "category", render: (v: Category) => <span className="muted" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{ACTION[v]}</span> },
          ]}
        />
        {data.preview.kept.length ? (
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line-2)" }}>
            <Alert
              type="info"
              showIcon
              title={`Past the limit but kept (${data.preview.kept.length})`}
              description={
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
                  {data.preview.kept.map((k) => (
                    <li key={`${k.category}:${k.ref}`}>
                      <span className="mono">{k.ref}</span>: {k.why}
                    </li>
                  ))}
                </ul>
              }
            />
          </div>
        ) : null}
      </Card>

      <Card title="Last runs" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          size="small"
          dataSource={data.runs}
          pagination={false}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No clean-up has run yet" /> }}
          columns={[
            { title: "When", dataIndex: "startedAt", render: (v) => <span style={{ whiteSpace: "nowrap" }}>{fmtDate(v, true)}</span> },
            { title: "Run", render: (_, r) => (r.dryRun ? <StatusDot tone="info">Dry run</StatusDot> : <StatusDot tone="good">Clean-up</StatusDot>) },
            { title: "Started by", render: (_, r) => <span>{r.trigger === "SCHEDULED" ? "Daily scheduler" : r.runBy}</span> },
            {
              title: "Result",
              render: (_, r) => {
                const parts = (Object.keys(LABELS) as Category[]).filter((k) => r.counts[k]).map((k) => `${r.counts[k]} ${LABELS[k].toLowerCase()}`);
                return <span style={{ fontSize: 13 }}>{parts.length ? `${r.dryRun ? "Would clear" : "Cleared"} ${parts.join(", ")}` : "Nothing to clear"}</span>;
              },
            },
            { title: "Policy", dataIndex: "policyVersion", render: (v) => <span className="faint">{v ? `v${v}` : "defaults"}</span> },
          ]}
        />
      </Card>
    </div>
  );
}
