"use client";
import Link from "next/link";
import ReactECharts from "echarts-for-react";
import { Card, Col, Empty, Row, Table, Tooltip } from "antd";
import {
  AlertOutlined,
  BankOutlined,
  CheckCircleFilled,
  ClockCircleFilled,
  CloseCircleFilled,
  ExperimentOutlined,
  FileSearchOutlined,
  IdcardOutlined,
  MinusCircleFilled,
  ScheduleOutlined,
  SolutionOutlined,
  TeamOutlined,
  UserSwitchOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { PageTitle, StatCard, fmtDate, programLabel } from "./common";
import { daysUntil } from "@/lib/format";

type KV = { k: string; n: number }[];

// Chart colours: validated with the dataviz palette checker (emerald + blue pass CVD and normal-vision floors).
const SERIES = ["#0f8a63", "#2a78d6"];
const INK = { axis: "#8a9892", grid: "#eef2f0", text: "#33433c" };
const STATUS_FILL: Record<string, { c: string; label: string; icon: React.ReactNode }> = {
  APPROVED: { c: "#12a150", label: "Approved", icon: <CheckCircleFilled style={{ color: "#12a150" }} /> },
  VALID: { c: "#12a150", label: "Valid", icon: <CheckCircleFilled style={{ color: "#12a150" }} /> },
  PENDING: { c: "#e8a20c", label: "Pending", icon: <ClockCircleFilled style={{ color: "#e8a20c" }} /> },
  EXPIRED: { c: "#d03b3b", label: "Expired", icon: <CloseCircleFilled style={{ color: "#d03b3b" }} /> },
  REJECTED: { c: "#d03b3b", label: "Rejected", icon: <CloseCircleFilled style={{ color: "#d03b3b" }} /> },
  NONE: { c: "#c9d1cd", label: "None", icon: <MinusCircleFilled style={{ color: "#aab5b0" }} /> },
};
const STATUS_ORDER = ["APPROVED", "VALID", "PENDING", "EXPIRED", "REJECTED", "NONE"];

const tooltip = { trigger: "axis" as const, axisPointer: { type: "shadow" as const, shadowStyle: { color: "rgba(11,110,79,0.06)" } }, backgroundColor: "#fff", borderColor: "#e3e8e5", textStyle: { color: "#0f1f1a", fontSize: 12 }, extraCssText: "box-shadow:0 6px 24px rgba(16,40,30,.12);border-radius:10px;" };

function HBar({ data, height = 230 }: { data: { name: string; value: number }[]; height?: number }) {
  const sorted = [...data].sort((a, b) => a.value - b.value);
  return (
    <ReactECharts
      style={{ height }}
      option={{
        grid: { left: 8, right: 36, top: 6, bottom: 6, containLabel: true },
        tooltip,
        xAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: INK.grid } }, axisLabel: { color: INK.axis, fontSize: 11 } },
        yAxis: { type: "category", data: sorted.map((d) => d.name), axisLine: { lineStyle: { color: "#d6ddd9" } }, axisTick: { show: false }, axisLabel: { color: INK.text, fontSize: 12 } },
        series: [{ type: "bar", data: sorted.map((d) => d.value), barMaxWidth: 18, itemStyle: { color: SERIES[0], borderRadius: [0, 4, 4, 0] }, label: { show: true, position: "right", color: INK.text, fontSize: 12, fontWeight: 600 } }],
      }}
    />
  );
}

/** Part-to-whole for a status field: one segmented bar + a labelled legend (colour never stands alone). */
function StatusBreakdown({ data }: { data: KV }) {
  const total = data.reduce((a, d) => a + d.n, 0) || 1;
  const rows = [...data].sort((a, b) => STATUS_ORDER.indexOf(a.k) - STATUS_ORDER.indexOf(b.k));
  return (
    <div>
      <div style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", gap: 2, background: "#fff" }}>
        {rows.map((d) => (
          <Tooltip key={d.k} title={`${STATUS_FILL[d.k]?.label ?? d.k}: ${d.n} of ${total}`}>
            <div style={{ width: `${(d.n / total) * 100}%`, background: STATUS_FILL[d.k]?.c ?? "#c9d1cd", minWidth: 4 }} />
          </Tooltip>
        ))}
      </div>
      <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
        {rows.map((d) => (
          <div key={d.k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            {STATUS_FILL[d.k]?.icon}
            <span style={{ flex: 1 }}>{STATUS_FILL[d.k]?.label ?? d.k}</span>
            <b className="tnum">{d.n}</b>
            <span className="faint tnum" style={{ width: 40, textAlign: "right" }}>
              {Math.round((d.n / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const STAGES: { key: string; label: string; owner: string; statuses: string[]; c: string }[] = [
  { key: "sub", label: "Submitted", owner: "Officer", statuses: ["SUBMITTED"], c: "#1d5fb0" },
  { key: "scr", label: "Scrutiny", owner: "Officer", statuses: ["UNDER_SCRUTINY"], c: "#1d5fb0" },
  { key: "def", label: "Deficiency", owner: "Institution", statuses: ["DEFICIENCY_RAISED", "RESPONDED"], c: "#a15c00" },
  { key: "ins", label: "Inspection", owner: "Inspector", statuses: ["INSPECTION_SCHEDULED", "INSPECTION_SUBMITTED"], c: "#5b3cc4" },
  { key: "cou", label: "Council", owner: "Secretary", statuses: ["COUNCIL_REVIEW", "APPROVED", "DEFERRED"], c: "#0b6e6e" },
  { key: "iss", label: "Certificate issued", owner: "Closed", statuses: ["NOC_ISSUED"], c: "#0d7a3d" },
];

function Pipeline({ data }: { data: KV }) {
  const count = (s: string[]) => data.filter((d) => s.includes(d.k)).reduce((a, d) => a + d.n, 0);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
      {STAGES.map((s, i) => {
        const n = count(s.statuses);
        return (
          <Link key={s.key} href="/pcp/applications">
            <div style={{ position: "relative", padding: "14px 14px 12px", borderRadius: 12, background: n ? "#fff" : "#fafbfa", border: `1px solid ${n ? "var(--line)" : "var(--line-2)"}`, borderTop: `3px solid ${n ? s.c : "#dfe5e2"}`, height: "100%" }}>
              <div style={{ fontSize: 11, color: "var(--faint)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Stage {i + 1}</div>
              <div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--ink)", marginTop: 2 }}>{s.label}</div>
              <div className="tnum" style={{ fontSize: 28, fontWeight: 700, color: n ? s.c : "#b9c3be", lineHeight: 1.2, marginTop: 4 }}>
                {n}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{s.owner === "Closed" ? "Done" : `With: ${s.owner}`}</div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export default function ExecutiveDashboard(p: {
  kpis: Record<string, number>;
  byProvince: KV;
  bySector: KV;
  nocStatus: KV;
  accStatus: KV;
  enrol: { year: number; type: string; n: number }[];
  graduates: { year: number; n: number }[];
  facultyQual: KV;
  overIntake: { short_code: string; name: string; program_type: string; enrollment_year: number; enrolled: number; approved_intake: number }[];
  pipeline: KV;
  renewals: { name: string; code: string; type: string; until: string }[];
  notifications: { id: number; title: string; body: string; link: string | null; createdAt: string }[];
}) {
  const k = p.kpis;
  const years = [...new Set(p.enrol.map((e) => e.year))];
  const pub = p.bySector.find((s) => s.k === "Public")?.n ?? 0;
  const priv = p.bySector.find((s) => s.k === "Private")?.n ?? 0;
  const link = (href: string, el: React.ReactNode) => <Link href={href}>{el}</Link>;

  return (
    <>
      <PageTitle
        eyebrow="Pharmacy Council of Pakistan"
        title="Executive dashboard"
        sub={`All ${k.institutions} institutions and ${k.students.toLocaleString()} current students, live from the central registry. No spreadsheets, no letters.`}
      />

      <Row gutter={[14, 14]}>
        <Col xs={12} md={8} xl={4}>{link("/pcp/institutions", <StatCard compact clickable label="Institutions" value={k.institutions} icon={<BankOutlined />} hint={`${pub} public · ${priv} private`} />)}</Col>
        <Col xs={12} md={8} xl={4}><StatCard compact label="Active PharmD programs" value={k.pharmd} icon={<SolutionOutlined />} tone="gold" hint={`${k.tech} technician programs`} /></Col>
        <Col xs={12} md={8} xl={4}><StatCard compact label="Active faculty" value={k.faculty} icon={<TeamOutlined />} tone="info" hint="One PCP ID per CNIC" /></Col>
        <Col xs={12} md={8} xl={4}><StatCard compact label="Current students" value={k.students.toLocaleString()} icon={<IdcardOutlined />} tone="violet" hint="Enrolled, not graduated" /></Col>
        <Col xs={12} md={8} xl={4}>{link("/pcp/applications", <StatCard compact clickable label="Awaiting council" value={k.awaitingDecision} icon={<ScheduleOutlined />} tone="neutral" hint={`${k.pendingInspections} inspections pending`} />)}</Col>
        <Col xs={12} md={8} xl={4}>
          {link("/pcp/pharmacists", <StatCard compact clickable label="Registered pharmacists" value={k.pharmacists ?? 0} icon={<UserSwitchOutlined />} tone="neutral" help="PCP's index of the provincial councils' registers; the councils license pharmacists." hint={`${k.pharmacistsActive ?? 0} active`} />)}
        </Col>
      </Row>

      <Card
        style={{ marginTop: 18 }}
        title={
          <span>
            <FileSearchOutlined style={{ marginRight: 8, color: "var(--brand)" }} />
            Case pipeline
          </span>
        }
        extra={<span className="muted" style={{ fontSize: 12.5 }}>{k.pendingNoc} NOC and {k.pendingAcc} accreditation cases open · every stage has an owner</span>}
      >
        <Pipeline data={p.pipeline} />
      </Card>

      <Row gutter={[18, 18]} style={{ marginTop: 18 }}>
        <Col xs={24} lg={8}>
          <Card title="Risk signals" style={{ height: "100%" }} styles={{ body: { display: "grid", gap: 10 } }}>
            {link("/pcp/verification", <StatCard clickable label="Possible duplicate faculty" value={k.duplicates} icon={<AlertOutlined />} tone="bad" hint="Same person, different CNIC or spelling" />)}
            <StatCard label="Outstanding deficiencies" value={k.deficiencies} icon={<WarningOutlined />} tone="warn" hint="Waiting on institutions" />
            <StatCard label="Renewals due within 90 days" value={k.renewals90} icon={<ClockCircleFilled />} tone="warn" hint="Reminders at 180/120/90/60/30 days" />
          </Card>
        </Col>
        <Col xs={24} lg={16}>
          <Card title="Enrolment by intake year" extra={<span className="muted" style={{ fontSize: 12.5 }}>Students per program</span>} style={{ height: "100%" }}>
            <ReactECharts
              style={{ height: 270 }}
              option={{
                color: SERIES,
                tooltip,
                legend: { top: 0, right: 0, icon: "roundRect", itemWidth: 12, itemHeight: 12, textStyle: { color: INK.text, fontSize: 12 } },
                grid: { left: 8, right: 8, top: 36, bottom: 4, containLabel: true },
                xAxis: { type: "category", data: years, axisLine: { lineStyle: { color: "#d6ddd9" } }, axisTick: { show: false }, axisLabel: { color: INK.text } },
                yAxis: { type: "value", splitLine: { lineStyle: { color: INK.grid } }, axisLabel: { color: INK.axis, fontSize: 11 } },
                series: ["PHARMD", "TECH"].map((t, i) => ({
                  name: programLabel(t),
                  type: "bar",
                  stack: "s",
                  barMaxWidth: 44,
                  itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: i === 1 ? [4, 4, 0, 0] : 0 },
                  data: years.map((y) => p.enrol.find((e) => e.year === y && e.type === t)?.n ?? 0),
                })),
              }}
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={8}>
          <Card title="Institutions by province" style={{ height: "100%" }}>
            <HBar data={p.byProvince.map((x) => ({ name: x.k, value: x.n }))} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={8}>
          <Card title="Active faculty by qualification" style={{ height: "100%" }}>
            <HBar data={p.facultyQual.map((x) => ({ name: x.k, value: x.n }))} />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="Program status" style={{ height: "100%" }}>
            <div className="pcp-section-title" style={{ marginBottom: 10 }}>NOC</div>
            <StatusBreakdown data={p.nocStatus} />
            <div className="pcp-section-title" style={{ margin: "20px 0 10px" }}>Accreditation</div>
            <StatusBreakdown data={p.accStatus} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title={
              <span>
                <ExperimentOutlined style={{ marginRight: 8, color: "var(--brand)" }} />
                Unusual patterns: enrolment above approved intake
              </span>
            }
            style={{ height: "100%" }}
          >
            {p.overIntake.length ? (
              <Table
                size="small"
                pagination={false}
                rowKey={(r) => `${r.short_code}-${r.program_type}-${r.enrollment_year}`}
                dataSource={p.overIntake}
                columns={[
                  { title: "Institution", dataIndex: "name" },
                  { title: "Program", dataIndex: "program_type", render: programLabel },
                  { title: "Year", dataIndex: "enrollment_year" },
                  { title: "Enrolled / approved", dataIndex: "enrolled", render: (v, r) => <b style={{ color: "#b4141f" }}>{v} / {r.approved_intake}</b> },
                ]}
              />
            ) : (
              <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 14px", borderRadius: 12, background: "var(--good-50)", color: "#0d7a3d" }}>
                <CheckCircleFilled style={{ fontSize: 20 }} />
                <span>No institution has enrolled above its approved intake. The check runs on every annual student update.</span>
              </div>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Accreditation renewal watchlist" extra={<span className="muted" style={{ fontSize: 12.5 }}>Next 180 days</span>} style={{ height: "100%" }}>
            {p.renewals.length ? (
              <Table
                size="small"
                pagination={false}
                rowKey={(r) => `${r.code}-${r.type}`}
                dataSource={p.renewals}
                columns={[
                  { title: "Institution", dataIndex: "name", render: (v, r) => <span>{v}<div className="faint mono">{r.code}</div></span> },
                  { title: "Program", dataIndex: "type", render: programLabel },
                  { title: "Expires", dataIndex: "until", render: (v) => fmtDate(v) },
                  {
                    title: "Days left",
                    dataIndex: "until",
                    render: (v) => {
                      const d = daysUntil(v) ?? 0;
                      return <b style={{ color: d <= 90 ? "#b4141f" : "#a15c00" }} className="tnum">{d}</b>;
                    },
                  },
                ]}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No accreditation expires in the next 180 days" />
            )}
          </Card>
        </Col>
      </Row>
    </>
  );
}
