"use client";
// Quarterly access review (guide section 14): every account, its roles, institution and last activity;
// keep or remove access, then record the review with a one-time code.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Col, Empty, Input, Row, Segmented, Space, Table, Tag } from "antd";
import { AuditOutlined, CheckCircleFilled, ClockCircleOutlined, SafetyOutlined, StopOutlined, TeamOutlined, UserOutlined } from "@ant-design/icons";
import { recordAccessReview } from "@/app/actions/access-review";
import { ROLE_LABELS } from "@/lib/roles";
import { useOtp } from "./OtpConfirm";
import { Person, StatCard, StatusDot, fmtDate, timeAgo } from "./common";

export type AccessUserRow = {
  username: string;
  displayName: string;
  email: string | null;
  enabled: boolean;
  roles: string[];
  institution: string | null;
  institutionName: string | null;
  lastActivity: string | null;
  createdAt: string | null;
};
export type PastReview = { ref: string; quarter: string; reviewedBy: string; reviewerName: string; reviewedAt: string; total: number; kept: number; removed: number; note: string | null; removedUsers: string[] };
export type AccessReviewData = {
  error: string | null;
  users: AccessUserRow[];
  quarter: { key: string; label: string; nextLabel: string };
  current: PastReview | null;
  past: PastReview[];
  me: string;
};

const STALE_DAYS = 90;
const quarterLabel = (k: string) => k.replace(/^(\d{4})-(Q\d)$/, "$2 $1");

export default function AccessReview({ data }: { data: AccessReviewData }) {
  const { message } = App.useApp();
  const router = useRouter();
  const { withOtp, otpModal } = useOtp();
  const [decisions, setDecisions] = useState<Record<string, "KEEP" | "REMOVE">>({});
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const [view, setView] = useState<"all" | "pcp" | "inst" | "other" | "stale">("all");
  const now = Date.now();
  const stale = (u: AccessUserRow) => !u.lastActivity || now - new Date(u.lastActivity).getTime() > STALE_DAYS * 86400000;
  const kindOf = (u: AccessUserRow) => (u.roles.some((r) => r.startsWith("pcp_")) ? "pcp" : u.roles.some((r) => r.startsWith("inst_")) ? "inst" : "other");
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.users.filter(
      (u) =>
        (view === "all" || (view === "stale" ? stale(u) && u.enabled : kindOf(u) === view)) &&
        (!s || u.username.includes(s) || u.displayName.toLowerCase().includes(s) || (u.institution ?? "").toLowerCase().includes(s) || u.roles.some((r) => (ROLE_LABELS[r] ?? r).toLowerCase().includes(s))),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.users, q, view]);
  const removing = Object.entries(decisions).filter(([, d]) => d === "REMOVE").map(([u]) => u);
  const enabled = data.users.filter((u) => u.enabled).length;

  const record = () =>
    withOtp(`access-review:${data.quarter.key}`, `Record the ${data.quarter.label} access review${removing.length ? ` and remove access for ${removing.length} account${removing.length === 1 ? "" : "s"}` : ""}`, async (code) => {
      const r = await recordAccessReview(decisions, note, code);
      message[r.ok ? (r.level === "warning" ? "warning" : "success") : "error"](r.message, 8);
      if (r.ok) {
        setDecisions({});
        setNote("");
      }
      router.refresh();
    });

  return (
    <div data-testid="access-review" style={{ display: "grid", gap: 16 }}>
      {otpModal}
      <style>{".ar-row-remove > td { background: #fff6f5 !important; }"}</style>
      {data.error ? <Alert type="error" showIcon title="Keycloak could not be reached, so the accounts cannot be listed" description={data.error} /> : null}
      <Card styles={{ body: { display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" } }}>
        {data.current ? (
          <CheckCircleFilled style={{ fontSize: 28, color: "var(--good)" }} />
        ) : (
          <ClockCircleOutlined style={{ fontSize: 28, color: "#a15c00" }} />
        )}
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontWeight: 650, fontSize: 16 }} data-testid="access-review-status">
            {data.current ? `${data.quarter.label} review recorded` : `${data.quarter.label} review due`}
          </div>
          <div className="muted" style={{ fontSize: 13.5 }}>
            {data.current
              ? `${data.current.ref} by ${data.current.reviewerName} on ${fmtDate(data.current.reviewedAt, true)}: ${data.current.kept} kept, ${data.current.removed} removed.`
              : "Go through every account below: keep it, or remove access from someone who has left or changed job. Then record the review."}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="faint" style={{ fontSize: 12 }}>Every quarter</div>
          <b data-testid="next-review">Next review due {data.quarter.nextLabel}</b>
        </div>
      </Card>

      <Row gutter={[14, 14]}>
        <Col xs={12} md={6}><StatCard compact label="Accounts in Keycloak" value={data.users.length} icon={<TeamOutlined />} /></Col>
        <Col xs={12} md={6}><StatCard compact label="Enabled" value={enabled} icon={<UserOutlined />} tone="info" hint={`${data.users.length - enabled} disabled`} /></Col>
        <Col xs={12} md={6}><StatCard compact label="PCP staff accounts" value={data.users.filter((u) => kindOf(u) === "pcp").length} icon={<SafetyOutlined />} tone="gold" /></Col>
        <Col xs={12} md={6}>
          <StatCard compact label={`No activity in ${STALE_DAYS} days`} value={data.users.filter((u) => u.enabled && stale(u)).length} icon={<ClockCircleOutlined />} tone="warn" help="Enabled accounts with no entry in the audit log for 90 days. Check whether they still need access." />
        </Col>
      </Row>

      <Card
        title={`Who holds which role (${rows.length})`}
        extra={
          <Space wrap>
            <Segmented
              size="small"
              value={view}
              onChange={(v) => setView(v as typeof view)}
              options={[
                { value: "all", label: "All" },
                { value: "pcp", label: "PCP staff" },
                { value: "inst", label: "Institutions" },
                { value: "other", label: "Students, pharmacists, applicants" },
                { value: "stale", label: "Inactive" },
              ]}
            />
            <Input.Search allowClear placeholder="Name, username, role or institution" onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} aria-label="Search accounts" />
          </Space>
        }
        styles={{ body: { padding: 0 } }}
      >
        <Table
          rowKey="username"
          size="middle"
          dataSource={rows}
          pagination={{ pageSize: 15, hideOnSinglePage: true, showSizeChanger: false }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No account matches" /> }}
          scroll={{ x: true }}
          rowClassName={(u) => (decisions[u.username] === "REMOVE" ? "ar-row-remove" : "")}
          columns={[
            { title: "Account", render: (_, u) => <Person name={u.displayName} sub={<span><span className="mono">{u.username}</span>{u.email ? ` · ${u.email}` : ""}</span>} /> },
            {
              title: "Roles",
              render: (_, u) =>
                u.roles.length ? (
                  <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", maxWidth: 260 }}>
                    {u.roles.map((r) => (
                      <Tag key={r} color={r.startsWith("pcp_") ? "blue" : r.startsWith("inst_") ? "green" : undefined} style={{ marginInlineEnd: 0 }}>
                        {ROLE_LABELS[r] ?? r}
                      </Tag>
                    ))}
                  </span>
                ) : (
                  <span className="faint">No portal role</span>
                ),
            },
            { title: "Institution", render: (_, u) => (u.institution ? <span><span className="mono">{u.institution}</span><div className="faint" style={{ fontSize: 12 }}>{u.institutionName ?? "Not in this database"}</div></span> : <span className="faint">—</span>) },
            { title: "Status", render: (_, u) => (u.enabled ? <StatusDot tone="good">Enabled</StatusDot> : <StatusDot tone="neutral">Disabled</StatusDot>) },
            {
              title: "Last activity",
              render: (_, u) =>
                u.lastActivity ? (
                  <span title={fmtDate(u.lastActivity, true)} style={{ whiteSpace: "nowrap", color: stale(u) ? "#a15c00" : undefined }}>
                    {timeAgo(u.lastActivity)}
                  </span>
                ) : (
                  <span className="faint" style={{ whiteSpace: "nowrap" }}>None in the audit log</span>
                ),
            },
            {
              title: "Decision",
              render: (_, u) =>
                u.username === data.me ? (
                  <span className="faint" style={{ fontSize: 12.5 }}>Your account: kept</span>
                ) : (
                  <Segmented
                    size="small"
                    data-testid={`decide-${u.username}`}
                    value={decisions[u.username] ?? "KEEP"}
                    onChange={(v) => setDecisions((d) => ({ ...d, [u.username]: v as "KEEP" | "REMOVE" }))}
                    options={[
                      { value: "KEEP", label: "Keep" },
                      { value: "REMOVE", label: <span style={{ color: (decisions[u.username] ?? "KEEP") === "REMOVE" ? "#b4141f" : undefined }}>{u.enabled ? "Remove access" : "Remove (already off)"}</span> },
                    ]}
                  />
                ),
            },
          ]}
        />
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "14px 16px", borderTop: "1px solid var(--line-2)" }}>
          <Input placeholder="Note for the record (optional), e.g. Checked against HR's leavers list for September" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: "1 1 320px" }} aria-label="Review note" />
          <span className="muted" style={{ fontSize: 13 }}>
            {removing.length ? (
              <span style={{ color: "#b4141f" }}>
                <StopOutlined /> {removing.length} to remove: {removing.join(", ")}
              </span>
            ) : (
              `All ${data.users.length} accounts kept`
            )}
          </span>
          <Button type="primary" icon={<AuditOutlined />} disabled={!!data.error || !data.users.length} onClick={record} data-testid="record-review">
            Record the {data.quarter.label} review
          </Button>
        </div>
      </Card>

      <Card title="Past reviews" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="ref"
          size="small"
          dataSource={data.past}
          pagination={false}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No access review recorded yet" /> }}
          columns={[
            { title: "Review", dataIndex: "ref", render: (v, r) => <span><span className="mono">{v}</span><div className="faint" style={{ fontSize: 12 }}>{quarterLabel(r.quarter)}</div></span> },
            { title: "Reviewed by", render: (_, r) => <span>{r.reviewerName}<div className="faint" style={{ fontSize: 12 }}>{fmtDate(r.reviewedAt, true)}</div></span> },
            { title: "Accounts", align: "right", render: (_, r) => <span className="tnum">{r.total}</span> },
            { title: "Kept", align: "right", render: (_, r) => <span className="tnum">{r.kept}</span> },
            { title: "Removed", render: (_, r) => (r.removed ? <span><b className="tnum">{r.removed}</b> <span className="muted" style={{ fontSize: 12.5 }}>{r.removedUsers.join(", ")}</span></span> : <span className="faint">None</span>) },
            { title: "Note", dataIndex: "note", render: (v) => <span style={{ fontSize: 12.5 }}>{v ?? "—"}</span> },
          ]}
        />
      </Card>
    </div>
  );
}
