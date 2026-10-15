"use client";
import Link from "next/link";
import { Card, Col, Input, Row, Segmented, Select, Table, Tabs, Tag, Typography } from "antd";
import { CloseCircleFilled, DownloadOutlined, EyeOutlined, LinkOutlined, PauseCircleOutlined, SafetyCertificateFilled, StopOutlined, ToolOutlined, UserOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import { PageTitle, StatCard, StatusDot, fmtDate } from "./common";

type Row = { id: number; ts: string; actor: string; action: string; entity: string; entityId: string; details: string; hash: string; prevHash: string };
type OverrideRow = {
  ref: string;
  caseRef: string;
  caseStatus: string;
  inst: string;
  kind: string;
  label: string;
  reason: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  actor: string;
  at: string;
  auditId: number | null;
  auditHash: string | null;
};
type AccessRow = { id: number; ts: string; actor: string; name: string; role: string; action: string; kind: "VIEW" | "DOWNLOAD" | "EXPORT" | "REFUSED"; entity: string; entityId: string; label: string | null; details: string };

const isOverride = (a: string) => a.startsWith("override.");

/** Where a record opens on the PCP side, when it has a screen of its own. */
function recordHref(entity: string, id: string) {
  if (entity === "application") return `/pcp/applications/${id}`;
  if (entity === "faculty" && id.startsWith("PCP-FAC-")) return `/pcp/faculty/${id}`;
  if (entity === "onboarding") return `/pcp/onboarding/${id}`;
  if (entity === "council_meeting") return `/pcp/council/${id}`;
  return null;
}

const KIND_TAG: Record<AccessRow["kind"], [string, string, React.ReactNode]> = {
  VIEW: ["Viewed", "blue", <EyeOutlined key="v" />],
  DOWNLOAD: ["Downloaded", "green", <DownloadOutlined key="d" />],
  EXPORT: ["Exported", "purple", <DownloadOutlined key="e" />],
  REFUSED: ["Refused", "red", <StopOutlined key="r" />],
};

/** What an override changed, in words: before → after. */
function change(o: OverrideRow) {
  const b = o.before;
  const a = o.after;
  const day = (v: unknown) => (typeof v === "string" ? fmtDate(v) : "—");
  switch (o.kind) {
    case "REASSIGN_OFFICER":
      return `${b.officer ?? "unassigned"} → ${a.officer}`;
    case "EXTEND_DEADLINE":
      return `due ${day(b.due)} → ${day(a.due)}`;
    case "REOPEN":
      return `${String(b.status).toLowerCase().replace(/_/g, " ")} → ${String(a.status).toLowerCase().replace(/_/g, " ")}`;
    case "HOLD":
      return "clock paused";
    case "RELEASE_HOLD":
      return a.due ? `clock restarted, due ${day(a.due)}` : "released";
    default:
      return "";
  }
}

function AllEntries({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState("");
  const data = useMemo(() => {
    const s = q.toLowerCase();
    return s ? rows.filter((r) => `${r.actor} ${r.action} ${r.entity} ${r.entityId} ${r.details}`.toLowerCase().includes(s)) : rows;
  }, [q, rows]);
  return (
    <Card
      title={`Latest ${rows.length} entries`}
      extra={<Input.Search allowClear placeholder="Filter by actor, action, record…" onChange={(e) => setQ(e.target.value)} style={{ width: 300 }} />}
      styles={{ body: { padding: 0 } }}
    >
      <Table
        rowKey="id"
        dataSource={data}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        tableLayout="fixed"
        rowClassName={(r) => (isOverride(r.action) ? "audit-override-row" : "")}
        onRow={(r) => (isOverride(r.action) ? { style: { background: "#fff6f5" } } : {})}
        columns={[
          { title: "#", dataIndex: "id", width: 64, render: (v) => <span className="tnum faint">{v}</span> },
          { title: "Time", dataIndex: "ts", width: 170, render: (v) => <span style={{ whiteSpace: "nowrap" }}>{fmtDate(v, true)}</span> },
          { title: "Actor", dataIndex: "actor", width: 130, render: (v) => <span className="mono">{v}</span> },
          {
            title: "Action",
            dataIndex: "action",
            width: 210,
            render: (v: string) =>
              isOverride(v) ? (
                <StatusDot tone="bad">
                  <ToolOutlined /> {v}
                </StatusDot>
              ) : (
                <StatusDot tone={/blocked|denied|disable|reject/i.test(v) ? "bad" : /flag|deficiency/i.test(v) ? "warn" : "info"}>{v}</StatusDot>
              ),
          },
          { title: "Record", width: 230, ellipsis: true, render: (_, r) => <span className="mono">{r.entity}:{r.entityId}</span> },
          { title: "Details", dataIndex: "details", ellipsis: { showTitle: true }, render: (v: string) => <span className="mono faint" style={{ fontSize: 11.5 }}>{v === "{}" ? "" : v}</span> },
          {
            title: "Hash",
            dataIndex: "hash",
            width: 175,
            render: (v: string, r) => (
              <span title={`previous: ${r.prevHash}`} style={{ whiteSpace: "nowrap" }}>
                <LinkOutlined style={{ color: "var(--faint)", marginRight: 4 }} />
                <Typography.Text className="mono" copyable={{ text: v }}>
                  {v.slice(0, 10)}…
                </Typography.Text>
              </span>
            ),
          },
        ]}
      />
    </Card>
  );
}

function Overrides({ rows, activeHolds }: { rows: OverrideRow[]; activeHolds: number }) {
  const [kind, setKind] = useState("all");
  const data = rows.filter((r) => kind === "all" || r.kind === kind);
  return (
    <>
      <Row gutter={[14, 14]} style={{ marginBottom: 16 }}>
        <Col xs={12} lg={6}>
          <StatCard compact label="Overrides" icon={<ToolOutlined />} tone="bad" value={rows.length} hint="By the super administrator" />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard compact label="Deadlines extended" icon={<ToolOutlined />} tone="warn" value={rows.filter((r) => r.kind === "EXTEND_DEADLINE").length} />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard compact label="Cases reopened" icon={<ToolOutlined />} tone="info" value={rows.filter((r) => r.kind === "REOPEN").length} />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard compact label="On hold now" icon={<PauseCircleOutlined />} tone={activeHolds ? "bad" : "neutral"} value={activeHolds} />
        </Col>
      </Row>
      <Card
        styles={{ body: { padding: 0 } }}
        data-testid="overrides-table"
        title={
          <div style={{ padding: "8px 0" }}>
            <Segmented
              value={kind}
              onChange={(v) => setKind(String(v))}
              options={[
                { value: "all", label: "All" },
                { value: "REASSIGN_OFFICER", label: "Officer" },
                { value: "EXTEND_DEADLINE", label: "Deadline" },
                { value: "REOPEN", label: "Reopen" },
                { value: "HOLD", label: "Hold" },
                { value: "RELEASE_HOLD", label: "Release" },
              ]}
            />
          </div>
        }
        extra={<span className="faint" style={{ fontSize: 12 }}>Each needs a reason and a one-time code. None records a council decision.</span>}
      >
        <Table
          rowKey="ref"
          dataSource={data}
          pagination={{ pageSize: 15, hideOnSinglePage: true }}
          locale={{ emptyText: "No overrides yet. The super administrator applies them from a case screen." }}
          columns={[
            {
              title: "Override",
              width: 170,
              render: (_, r) => (
                <span style={{ display: "grid", lineHeight: 1.35 }}>
                  <span className="mono" style={{ fontWeight: 600 }}>
                    {r.ref}
                  </span>
                  <span className="faint" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                    {fmtDate(r.at, true)}
                  </span>
                </span>
              ),
            },
            {
              title: "Case",
              width: 150,
              render: (_, r) => (
                <span style={{ display: "grid", lineHeight: 1.35 }}>
                  <Link href={`/pcp/applications/${r.caseRef}`} className="mono">
                    {r.caseRef}
                  </Link>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {r.inst}
                  </span>
                </span>
              ),
            },
            {
              title: "What changed",
              width: 230,
              render: (_, r) => (
                <span style={{ display: "grid", gap: 3, justifyItems: "start" }}>
                  <Tag color={r.kind === "HOLD" ? "red" : r.kind === "REOPEN" ? "blue" : r.kind === "EXTEND_DEADLINE" ? "gold" : "default"} style={{ margin: 0 }}>
                    {r.label}
                  </Tag>
                  <span style={{ fontSize: 12.5 }}>{change(r)}</span>
                </span>
              ),
            },
            { title: "Reason", dataIndex: "reason", render: (v) => <span style={{ fontSize: 13 }}>{v}</span> },
            {
              title: "By",
              width: 170,
              render: (_, r) => (
                <span style={{ display: "grid", lineHeight: 1.35 }}>
                  <span>{r.actor}</span>
                  {r.auditId ? (
                    <span className="mono faint" style={{ fontSize: 11.5 }} title={r.auditHash ?? undefined}>
                      audit #{r.auditId} · OTP verified
                    </span>
                  ) : null}
                </span>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}

function AccessLog({ rows }: { rows: AccessRow[] }) {
  const [kind, setKind] = useState<string>("all");
  const [person, setPerson] = useState<string>();
  const [entity, setEntity] = useState<string>();
  const [q, setQ] = useState("");
  const people = useMemo(() => [...new Map(rows.map((r) => [r.actor, r])).values()].sort((a, b) => a.name.localeCompare(b.name)), [rows]);
  const entities = useMemo(() => [...new Set(rows.map((r) => r.entity))].sort(), [rows]);
  const data = useMemo(() => {
    const s = q.toLowerCase();
    return rows.filter(
      (r) =>
        (kind === "all" || r.kind === kind) &&
        (!person || r.actor === person) &&
        (!entity || r.entity === entity) &&
        (!s || `${r.name} ${r.actor} ${r.entity} ${r.entityId} ${r.label ?? ""} ${r.details}`.toLowerCase().includes(s)),
    );
  }, [rows, kind, person, entity, q]);
  const day = Date.now() - 86400000;
  const recent = rows.filter((r) => new Date(r.ts).getTime() > day);
  return (
    <>
      <Row gutter={[14, 14]} style={{ marginBottom: 16 }}>
        <Col xs={12} lg={6}>
          <StatCard compact label="Records viewed (24 h)" icon={<EyeOutlined />} tone="info" value={recent.filter((r) => r.kind === "VIEW").length} />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard compact label="Downloads and exports (24 h)" icon={<DownloadOutlined />} tone="brand" value={recent.filter((r) => r.kind === "DOWNLOAD" || r.kind === "EXPORT").length} />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard compact label="People with access (24 h)" icon={<UserOutlined />} tone="violet" value={new Set(recent.map((r) => r.actor)).size} />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard compact label="Refused attempts" icon={<StopOutlined />} tone={rows.some((r) => r.kind === "REFUSED") ? "bad" : "neutral"} value={rows.filter((r) => r.kind === "REFUSED").length} hint="Downloads or exports outside a user's scope" />
        </Col>
      </Row>
      <Card
        styles={{ body: { padding: 0 } }}
        data-testid="access-log"
        title={
          <div style={{ padding: "8px 0", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Segmented
              value={kind}
              onChange={(v) => setKind(String(v))}
              options={[
                { value: "all", label: "All" },
                { value: "VIEW", label: "Views" },
                { value: "DOWNLOAD", label: "Downloads" },
                { value: "EXPORT", label: "Exports" },
                { value: "REFUSED", label: "Refused" },
              ]}
            />
            <Select allowClear className="access-person" placeholder="Who" style={{ width: 220 }} popupMatchSelectWidth={300} value={person} onChange={setPerson} showSearch optionFilterProp="label" options={people.map((p) => ({ value: p.actor, label: `${p.name} (${p.actor})` }))} />
            <Select allowClear placeholder="Record type" style={{ width: 160 }} value={entity} onChange={setEntity} options={entities.map((e) => ({ value: e, label: e.replace(/_/g, " ") }))} />
          </div>
        }
        extra={<Input.Search allowClear placeholder="Find a record…" onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />}
      >
        <Table
          rowKey="id"
          dataSource={data}
          size="middle"
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          locale={{ emptyText: "No access matches these filters." }}
          columns={[
            { title: "Time", dataIndex: "ts", width: 165, render: (v) => <span style={{ whiteSpace: "nowrap" }}>{fmtDate(v, true)}</span> },
            {
              title: "Who",
              width: 220,
              render: (_, r) => (
                <span style={{ display: "grid", lineHeight: 1.3 }}>
                  <b style={{ fontWeight: 500 }}>{r.name}</b>
                  <span className="faint" style={{ fontSize: 12 }}>
                    <span className="mono">{r.actor}</span> · {r.role}
                  </span>
                </span>
              ),
            },
            {
              title: "Access",
              width: 130,
              render: (_, r) => (
                <Tag color={KIND_TAG[r.kind][1]} icon={KIND_TAG[r.kind][2]} style={{ margin: 0 }}>
                  {KIND_TAG[r.kind][0]}
                </Tag>
              ),
            },
            {
              title: "Record",
              render: (_, r) => {
                const href = recordHref(r.entity, r.entityId);
                const text = (
                  <span className="mono">
                    {r.entity.replace(/_/g, " ")} {r.entityId}
                  </span>
                );
                return (
                  <span style={{ display: "grid", lineHeight: 1.3 }}>
                    {href ? <Link href={href}>{text}</Link> : text}
                    {r.label ? <span className="faint" style={{ fontSize: 12 }}>{r.label}</span> : null}
                  </span>
                );
              },
            },
            { title: "Action", dataIndex: "action", width: 220, render: (v) => <span className="mono faint" style={{ fontSize: 12 }}>{v}</span> },
            { title: "Details", dataIndex: "details", ellipsis: { showTitle: true }, render: (v: string) => <span className="mono faint" style={{ fontSize: 11.5 }}>{v === "{}" ? "" : v}</span> },
          ]}
        />
      </Card>
    </>
  );
}

export default function AuditView({
  rows,
  chain,
  overrides = [],
  access = [],
  activeHolds = 0,
  tab,
}: {
  rows: Row[];
  chain: { ok: boolean; total: number; brokenAt: number | null };
  overrides?: OverrideRow[];
  access?: AccessRow[];
  activeHolds?: number;
  tab?: string;
}) {
  const [active, setActive] = useState(tab && ["all", "overrides", "access"].includes(tab) ? tab : "all");
  const tone = chain.ok ? { c: "#0d7a3d", bg: "linear-gradient(135deg,#e9f7ef,#f6fcf8)", bd: "#c9ecd8" } : { c: "#b4141f", bg: "#fff1f0", bd: "#ffccc7" };
  return (
    <>
      <PageTitle eyebrow="Administration" title="Audit log" sub="Append-only and hash-chained: each entry stores the hash of the one before it, so history cannot be quietly rewritten." />
      <div style={{ display: "flex", gap: 16, alignItems: "center", padding: "18px 20px", borderRadius: 16, border: `1px solid ${tone.bd}`, background: tone.bg, marginBottom: 18 }}>
        <span style={{ fontSize: 34, color: tone.c, lineHeight: 1 }}>{chain.ok ? <SafetyCertificateFilled /> : <CloseCircleFilled />}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: tone.c, letterSpacing: "-0.01em" }}>
            {chain.ok ? `Chain intact: all ${chain.total} entries verified` : `Tampering detected at entry #${chain.brokenAt}`}
          </div>
          <div style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 2 }}>
            {chain.ok
              ? "Editing or deleting any past entry, even directly in the database, breaks the chain from that point and this check fails."
              : `${chain.total} entries checked. Entries from #${chain.brokenAt} onward cannot be trusted.`}
          </div>
        </div>
        <div className="mono faint" style={{ fontSize: 11.5, textAlign: "right" }}>
          npm run audit:verify
          <br />
          verifies the same chain offline
        </div>
      </div>
      <Tabs
        activeKey={active}
        onChange={(k) => {
          setActive(k);
          window.history.replaceState(null, "", k === "all" ? "/pcp/audit" : `/pcp/audit?tab=${k}`);
        }}
        items={[
          { key: "all", label: "All entries", children: <AllEntries rows={rows} /> },
          { key: "overrides", label: <span data-testid="tab-overrides">Overrides ({overrides.length})</span>, children: <Overrides rows={overrides} activeHolds={activeHolds} /> },
          { key: "access", label: <span data-testid="tab-access">Database access log</span>, children: <AccessLog rows={access} /> },
        ]}
      />
    </>
  );
}
