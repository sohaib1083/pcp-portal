"use client";
import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Alert, App, Badge, Button, Card, Col, Empty, Form, Input, Modal, Row, Segmented, Select, Space, Table, Tabs, Typography } from "antd";
import {
  ApiOutlined,
  BankOutlined,
  ClockCircleOutlined,
  FilterOutlined,
  KeyOutlined,
  LineChartOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  TrophyOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { issueFeedKey, revokeFeedKey } from "@/app/actions/reports";
import { PROGRAMME_LABELS, describeFilters, filtersToQuery, type FilterKey, type Report, type ReportFilters, type ReportKpi } from "@/lib/report-types";
import { useOtp } from "./OtpConfirm";
import { ExportButtons, ReportChart, ReportTable, ReportTableStyles, useDrill } from "./ReportParts";
import ScreenGuide from "./ScreenGuide";
import { PageTitle, StatusDot, fmtDate, timeAgo } from "./common";

type FeedKeyRow = { id: string; name: string; audience: string; prefix: string; active: boolean; issuedAt: string; issuedBy: string; revokedAt: string | null; calls: number; lastCall: string | null };
type FeedCall = { id: number; ts: string; actor: string; keyName: string | null; endpoint: string; ok: boolean; count: number | null; reason: string | null };
type Feed = {
  baseUrl: string;
  header: string;
  demoKey: string | null;
  demoHolder: string | null;
  canManageKeys: boolean;
  pharmacists: number;
  endpoints: { path: string; title: string; what: string; fields: string; filters: string }[];
  keys: FeedKeyRow[];
  calls: FeedCall[];
};

const TAB_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  institutions: { label: "Institutions", icon: <BankOutlined /> },
  intake: { label: "Intake vs enrolment", icon: <TeamOutlined /> },
  graduates: { label: "Graduates", icon: <LineChartOutlined /> },
  ratio: { label: "Faculty ratio", icon: <TeamOutlined /> },
  validity: { label: "Validity", icon: <SafetyCertificateOutlined /> },
  "early-warning": { label: "Early warning", icon: <WarningOutlined /> },
  measures: { label: "Measures of success", icon: <TrophyOutlined /> },
};

/** A headline figure against its target; clicking it opens the list behind it. */
function KpiTile({ k, onDrill }: { k: ReportKpi; onDrill: Parameters<typeof ReportTable>[0]["onDrill"] }) {
  const tone = k.met === null ? { fg: "#55625c", bg: "#f7f9f8", bd: "var(--line)", word: "No data yet" } : k.met ? { fg: "#0d7a3d", bg: "#f3fbf6", bd: "#c9ecd8", word: "Target met" } : { fg: "#a15c00", bg: "#fffaf0", bd: "#ffe1a8", word: "Target not met" };
  return (
    <button
      type="button"
      data-testid={`kpi-${k.key}`}
      onClick={() => k.drill && onDrill(k.drill)}
      disabled={!k.drill}
      style={{ all: "unset", cursor: k.drill ? "pointer" : "default", display: "block", height: "100%", boxSizing: "border-box", width: "100%", padding: 14, borderRadius: 12, border: `1px solid ${tone.bd}`, background: tone.bg }}
    >
      <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>{k.label}</div>
      <div className="tnum" style={{ fontSize: 26, fontWeight: 750, letterSpacing: "-0.02em", color: "var(--ink)", marginTop: 4 }}>{k.value}</div>
      <div style={{ fontSize: 12.5, color: tone.fg, fontWeight: 600, marginTop: 2 }}>
        {tone.word} · {k.target}
      </div>
      <div className="faint" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.4 }}>{k.detail}</div>
    </button>
  );
}
const FILTER_NAMES: Record<FilterKey, string> = { province: "Province", sector: "Sector", programme: "Programme", year: "Year" };

function ReportPanel({ report, filters, onDrill }: { report: Report; filters: ReportFilters; onDrill: Parameters<typeof ReportTable>[0]["onDrill"] }) {
  const ignored = (Object.keys(FILTER_NAMES) as FilterKey[]).filter((k) => filters[k] !== undefined && !report.filters.includes(k));
  const query = filtersToQuery({ province: filters.province, sector: filters.sector, programme: filters.programme, year: filters.year });
  return (
    <Card
      data-testid={`report-${report.id}`}
      title={report.title}
      extra={<ExportButtons base={`/api/reports/${report.id}`} query={query} testId={`export-${report.id}`} />}
      styles={{ body: { padding: 0 } }}
    >
      <div style={{ padding: "14px 20px 4px" }}>
        <div className="muted" style={{ fontSize: 13.5 }}>{report.sub}</div>
        <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
          <FilterOutlined /> {describeFilters(filters, report.filters)}
          {ignored.length ? ` · ${ignored.map((k) => FILTER_NAMES[k]).join(" and ")} filter does not apply to this report` : ""}
        </div>
      </div>
      {report.kpis?.length ? (
        <Row gutter={[12, 12]} style={{ padding: "10px 20px 16px" }} data-testid="report-kpis">
          {report.kpis.map((k) => (
            <Col key={k.key} xs={24} sm={12} xl={6}>
              <KpiTile k={k} onDrill={onDrill} />
            </Col>
          ))}
        </Row>
      ) : null}
      {report.chart ? (
        <div style={{ padding: "8px 20px 12px", borderBottom: "1px solid var(--line-2)" }}>
          <ReportChart chart={report.chart} onDrill={onDrill} />
        </div>
      ) : null}
      {report.sections?.length ? (
        report.sections.map((sec) => (
          <div key={sec.key} data-testid={`section-${sec.key}`} style={{ borderTop: "1px solid var(--line-2)" }}>
            <div style={{ padding: "16px 20px 4px" }}>
              <div className="pcp-section-title" style={{ fontSize: 15 }}>{sec.title}</div>
              {sec.sub ? <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{sec.sub}</div> : null}
            </div>
            {sec.chart ? (
              <div style={{ padding: "8px 20px 12px" }}>
                <ReportChart chart={sec.chart} onDrill={onDrill} height={220} />
              </div>
            ) : null}
            <ReportTable report={sec} onDrill={onDrill} pageSize={sec.rows.length > 12 ? 12 : 0} />
          </div>
        ))
      ) : (
        <ReportTable report={report} onDrill={onDrill} pageSize={report.rows.length > 25 ? 20 : 0} />
      )}
      {report.notes.length ? (
        <ul className="faint" style={{ fontSize: 12.5, margin: 0, padding: "12px 20px 14px 36px", borderTop: "1px solid var(--line-2)" }}>
          {report.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function DataFeedPanel({ feed }: { feed: Feed }) {
  const { message } = App.useApp();
  const router = useRouter();
  const { withOtp, otpModal } = useOtp();
  const [tryOut, setTryOut] = useState<{ status: number; body: string; withKey: boolean } | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issued, setIssued] = useState<{ name: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const curl = `curl -H "${feed.header}: ${feed.demoKey ?? "<your key>"}" ${feed.baseUrl}/api/feed/institutions`;

  const tryFeed = async (withKey: boolean) => {
    const res = await fetch("/api/feed/institutions?province=Sindh", { headers: withKey && feed.demoKey ? { [feed.header]: feed.demoKey } : {} });
    const body = await res.json();
    const shown = res.ok ? { ...body, data: body.data.slice(0, 1), "…": `${body.count - 1} more records` } : body;
    setTryOut({ status: res.status, body: JSON.stringify(shown, null, 2), withKey });
    router.refresh();
  };

  return (
    <div style={{ display: "grid", gap: 16 }} data-testid="feed-panel">
      {otpModal}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card
            title={
              <span>
                <ApiOutlined style={{ color: "var(--brand)", marginRight: 8 }} />
                Read-only data feed
              </span>
            }
            style={{ height: "100%" }}
          >
            <p style={{ marginTop: 0 }}>
              For the Ministry of National Health Services and the provincial pharmacy councils. JSON, read only, with <b>no CNICs and no personal contact data</b>. Each call needs a named key in the{" "}
              <span className="mono">{feed.header}</span> header. PCP can revoke a key at any time, and every call is written to the audit log.
            </p>
            {feed.demoKey ? (
              <>
                <div className="pcp-section-title" style={{ marginBottom: 6 }}>
                  Demo key <span className="faint" style={{ fontWeight: 400 }}>({feed.demoHolder})</span>
                </div>
                <Typography.Text code copyable={{ text: feed.demoKey }} data-testid="feed-demo-key" style={{ fontSize: 13 }}>
                  {feed.demoKey}
                </Typography.Text>
                <div className="pcp-section-title" style={{ margin: "14px 0 6px" }}>Try it from a terminal</div>
                <div style={{ position: "relative", background: "#0f1f1a", color: "#d9efe5", borderRadius: 10, padding: "12px 44px 12px 14px", fontFamily: "ui-monospace, monospace", fontSize: 12.5, wordBreak: "break-all" }}>
                  <span data-testid="feed-curl">{curl}</span>
                  <Typography.Text copyable={{ text: curl, tooltips: ["Copy the command", "Copied"] }} style={{ position: "absolute", right: 12, top: 10, color: "#fff" }} />
                </div>
                <p className="faint" style={{ fontSize: 12, margin: "8px 0 0" }}>Demo only: a real key is shown once when it is issued, and PCP keeps only its hash.</p>
              </>
            ) : (
              <Alert type="warning" showIcon title="No active demo key. The Super administrator can issue a key below." />
            )}
            <Space style={{ marginTop: 14 }} wrap>
              <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => tryFeed(true)} disabled={!feed.demoKey}>
                Call the feed with the demo key
              </Button>
              <Button onClick={() => tryFeed(false)}>Call it without a key</Button>
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Response" style={{ height: "100%" }} extra={tryOut ? <StatusDot tone={tryOut.status === 200 ? "good" : "bad"}>HTTP {tryOut.status}</StatusDot> : null}>
            {tryOut ? (
              <pre data-testid="feed-response" style={{ margin: 0, maxHeight: 330, overflow: "auto", fontSize: 11.5, background: "#f7f9f8", border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
                {tryOut.body}
              </pre>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Call the feed to see what the Ministry receives (Sindh institutions, first record shown)" />
            )}
          </Card>
        </Col>
      </Row>

      <Card title="Endpoints" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="path"
          pagination={false}
          dataSource={feed.endpoints}
          columns={[
            {
              title: "Endpoint",
              dataIndex: "path",
              render: (v, r) => (
                <span>
                  <span className="mono" style={{ fontWeight: 600 }}>GET {v}</span>
                  <div className="faint" style={{ fontSize: 12 }}>
                    {r.title}
                    {r.path.endsWith("pharmacists") ? ` · ${feed.pharmacists ? `${feed.pharmacists} registrations` : "register empty for now"}` : ""}
                  </div>
                </span>
              ),
            },
            { title: "Returns", dataIndex: "what" },
            { title: "Fields", dataIndex: "fields", render: (v) => <span className="mono" style={{ fontSize: 11.5 }}>{v}</span> },
            { title: "Query filters", dataIndex: "filters", render: (v) => <span className="mono" style={{ fontSize: 11.5 }}>{v}</span> },
          ]}
        />
        <div className="faint" style={{ fontSize: 12.5, padding: "10px 16px", borderTop: "1px solid var(--line-2)" }}>
          Responses: 200 with <span className="mono">{"{ source, feed, generatedAt, keyHolder, filters, count, data }"}</span>; 401 when the header is missing; 403 when the key is unknown or revoked. <span className="mono">GET /api/feed</span> lists the endpoints without a key.
        </div>
      </Card>

      <Card
        title={
          <span>
            <KeyOutlined style={{ color: "var(--brand)", marginRight: 8 }} />
            Feed keys
          </span>
        }
        extra={feed.canManageKeys ? <Button size="small" onClick={() => { form.resetFields(); setIssueOpen(true); }}>Issue a key</Button> : <span className="faint" style={{ fontSize: 12.5 }}>The Super administrator issues and revokes keys</span>}
        styles={{ body: { padding: 0 } }}
      >
        <Table
          rowKey="id"
          pagination={false}
          dataSource={feed.keys}
          columns={[
            { title: "Key holder", dataIndex: "name", render: (v, r) => <span><span style={{ fontWeight: 500 }}>{v}</span><div className="faint" style={{ fontSize: 12 }}>{r.audience}</div></span> },
            { title: "Key", dataIndex: "prefix", render: (v) => <span className="mono">{v}…</span> },
            { title: "Issued", dataIndex: "issuedAt", render: (v, r) => <span>{fmtDate(v)}<div className="faint" style={{ fontSize: 12 }}>by {r.issuedBy}</div></span> },
            { title: "Status", dataIndex: "active", render: (v, r) => (v ? <StatusDot tone="good">Active</StatusDot> : <StatusDot tone="bad">{`Revoked ${fmtDate(r.revokedAt)}`}</StatusDot>) },
            { title: "Calls", dataIndex: "calls", align: "right", render: (v, r) => <span><b className="tnum">{v}</b><div className="faint" style={{ fontSize: 12 }}>{r.lastCall ? `last ${timeAgo(r.lastCall)}` : "never used"}</div></span> },
            ...(feed.canManageKeys
              ? [
                  {
                    title: "",
                    key: "act",
                    align: "right" as const,
                    render: (_: unknown, r: FeedKeyRow) =>
                      r.active ? (
                        <Button
                          size="small"
                          danger
                          onClick={() =>
                            withOtp(`feed-key:revoke:${r.id}`, `Revoke the key for ${r.name}`, async (code) => {
                              const res = await revokeFeedKey(r.id, code);
                              message[res.ok ? "success" : "error"](res.message);
                              router.refresh();
                            })
                          }
                        >
                          Revoke
                        </Button>
                      ) : null,
                  },
                ]
              : []),
          ]}
        />
      </Card>

      <Card
        title={
          <span>
            <ClockCircleOutlined style={{ color: "var(--brand)", marginRight: 8 }} />
            Latest feed calls
          </span>
        }
        extra={<span className="faint" style={{ fontSize: 12.5 }}>From the audit log</span>}
        styles={{ body: { padding: 0 } }}
      >
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={feed.calls}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No feed calls yet" /> }}
          columns={[
            { title: "When", dataIndex: "ts", render: (v) => <span title={v}>{fmtDate(v, true)}</span> },
            { title: "Caller", dataIndex: "keyName", render: (v, r) => v ?? <span className="faint">{r.actor === "feed:anonymous" ? "No key" : "Unknown or revoked key"}</span> },
            { title: "Endpoint", dataIndex: "endpoint", render: (v) => <span className="mono">/api/feed/{v}</span> },
            { title: "Result", dataIndex: "ok", render: (v, r) => (v ? <StatusDot tone="good">{`Served ${r.count ?? 0} record${r.count === 1 ? "" : "s"}`}</StatusDot> : <StatusDot tone="bad">{`Refused: ${r.reason ?? "no key"}`}</StatusDot>) },
          ]}
        />
      </Card>

      <Modal
        open={issueOpen}
        title="Issue a feed key"
        okText="Issue key"
        confirmLoading={busy}
        onCancel={() => setIssueOpen(false)}
        onOk={async () => {
          const v = await form.validateFields();
          setBusy(true);
          try {
            const r = await issueFeedKey(v.name, v.audience);
            if (!r.ok || !r.key) return void message.error(r.message);
            setIssueOpen(false);
            setIssued({ name: v.name, key: r.key });
            router.refresh();
          } finally {
            setBusy(false);
          }
        }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={{ audience: "Provincial council" }}>
          <Form.Item name="name" label="Organisation that will hold the key" rules={[{ required: true, min: 3, message: "Name the organisation" }]}>
            <Input placeholder="e.g. Khyber Pakhtunkhwa Pharmacy Council" />
          </Form.Item>
          <Form.Item name="audience" label="Type">
            <Segmented options={["Ministry", "Provincial council"]} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal open={!!issued} title={`Key for ${issued?.name ?? ""}`} onCancel={() => setIssued(null)} footer={<Button type="primary" onClick={() => setIssued(null)}>I have copied it</Button>}>
        <Alert type="warning" showIcon title="Copy the key now. PCP keeps only its hash, so it cannot be shown again." style={{ marginBottom: 12 }} />
        <Typography.Text code copyable style={{ fontSize: 14 }}>
          {issued?.key}
        </Typography.Text>
      </Modal>
    </div>
  );
}

export default function ReportsView({ reports, filters, tab, provinces, years, feed }: { reports: Report[]; filters: ReportFilters; tab?: string; provinces: string[]; years: number[]; feed: Feed }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [active, setActive] = useState(tab && (TAB_LABELS[tab] || tab === "feed") ? tab : "institutions");
  const { open, drawer } = useDrill();
  const go = (f: ReportFilters, t = active) =>
    start(() => {
      const q = filtersToQuery({ province: f.province, sector: f.sector, programme: f.programme, year: f.year });
      router.replace(`${pathname}?${q}${q ? "&" : ""}tab=${t}`, { scroll: false });
    });
  const set = (patch: Partial<ReportFilters>) => go({ ...filters, ...patch });
  const warnings = reports.find((r) => r.id === "early-warning")?.rows.length ?? 0;
  const any = filters.province || filters.sector || filters.programme || filters.year;

  return (
    <>
      <ReportTableStyles />
      {drawer}
      <PageTitle
        eyebrow="Finance & reports"
        title="Reports & exports"
        sub="Standard reports for PCP's decisions. Every figure opens the list behind it, and every report exports to Excel, PDF and CSV with the filters you set."
        extra={
          <ScreenGuide
            title="Reports & exports"
            steps={[
              "Set the **Filters** once: they apply to every report and to its exports.",
              "Click any figure or bar to open the list of records behind it.",
              "**Measures of success** tracks the guide's three measures against the targets in the kpi.targets reference rule: days to decide an NOC, cases returned for deficiency, and annual returns filed on time.",
              "**Excel**, **PDF** and **CSV** download the report with the filters you set. Every download is written to the audit log.",
            ]}
          />
        }
      />
      <Card size="small" style={{ marginBottom: 16 }} styles={{ body: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" } }} data-testid="report-filters">
        <span className="muted" style={{ fontSize: 13, display: "inline-flex", gap: 6, alignItems: "center" }}>
          <FilterOutlined /> Filters
        </span>
        <Select
          aria-label="Province"
          allowClear
          placeholder="All provinces"
          value={filters.province}
          onChange={(v) => set({ province: v })}
          options={provinces.map((p) => ({ value: p, label: p }))}
          style={{ width: 200 }}
        />
        <Segmented aria-label="Sector" value={filters.sector ?? "All sectors"} onChange={(v) => set({ sector: v === "All sectors" ? undefined : String(v) })} options={["All sectors", "Public", "Private"]} />
        <Select
          aria-label="Programme"
          allowClear
          placeholder="All programmes"
          value={filters.programme}
          onChange={(v) => set({ programme: v })}
          options={Object.entries(PROGRAMME_LABELS).map(([value, label]) => ({ value, label }))}
          style={{ width: 190 }}
        />
        <Select aria-label="Year" allowClear placeholder="All years" value={filters.year} onChange={(v) => set({ year: v })} options={years.map((y) => ({ value: y, label: String(y) }))} style={{ width: 120 }} />
        {any ? (
          <Button icon={<ReloadOutlined />} onClick={() => go({})}>
            Clear filters
          </Button>
        ) : null}
        {pending ? <span className="faint" style={{ fontSize: 12.5 }}>Updating…</span> : null}
      </Card>
      <Tabs
        activeKey={active}
        onChange={(k) => {
          setActive(k);
          window.history.replaceState(null, "", `${pathname}?${filtersToQuery({ province: filters.province, sector: filters.sector, programme: filters.programme, year: filters.year })}${any ? "&" : ""}tab=${k}`);
        }}
        items={[
          ...reports.map((r) => ({
            key: r.id,
            label: (
              <span data-testid={`tab-${r.id}`}>
                {TAB_LABELS[r.id]?.icon} {TAB_LABELS[r.id]?.label ?? r.title}
                {r.id === "early-warning" && warnings ? <Badge count={warnings} size="small" style={{ marginLeft: 6, background: "#d48806" }} /> : null}
              </span>
            ),
            children: <ReportPanel report={r} filters={filters} onDrill={open} />,
          })),
          { key: "feed", label: <span data-testid="tab-feed"><ApiOutlined /> Data feed</span>, children: <DataFeedPanel feed={feed} /> },
        ]}
      />
    </>
  );
}
