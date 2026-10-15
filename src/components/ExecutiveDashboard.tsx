"use client";
import Link from "next/link";
import ReactECharts from "echarts-for-react";
import { Card, Col, Empty, Row, Table, Tooltip } from "antd";
import {
  AlertOutlined,
  BankOutlined,
  CalendarOutlined,
  CheckCircleFilled,
  ClockCircleFilled,
  CloseCircleFilled,
  ExperimentOutlined,
  FieldTimeOutlined,
  ReadOutlined,
  FileSearchOutlined,
  MinusCircleFilled,
  SafetyCertificateOutlined,
  ScheduleOutlined,
  SolutionOutlined,
  UserSwitchOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { PageTitle, StatCard, StatusTag, fmtDate, kindLabel, programLabel, programmeLabel } from "./common";
import { daysUntil } from "@/lib/format";
import { slaClock } from "@/lib/sla-view";
import { STAGE_LABELS } from "@/lib/workflow";

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

const STAGES: { key: string; label: string; owner: string; statuses: string[]; c: string; href: string }[] = [
  { key: "sub", label: "Submitted", owner: "Officer", statuses: ["SUBMITTED"], c: "#1d5fb0", href: "/pcp/applications?status=SUBMITTED" },
  { key: "scr", label: "Scrutiny", owner: "Officer", statuses: ["UNDER_SCRUTINY"], c: "#1d5fb0", href: "/pcp/applications?status=UNDER_SCRUTINY" },
  { key: "def", label: "Deficiency", owner: "Institution", statuses: ["DEFICIENCY_RAISED", "RESPONDED"], c: "#a15c00", href: "/pcp/applications?status=DEFICIENCY_RAISED,RESPONDED" },
  { key: "tec", label: "Technical review", owner: "Technical officer", statuses: ["TECHNICAL_REVIEW"], c: "#1d5fb0", href: "/pcp/applications?status=TECHNICAL_REVIEW" },
  { key: "ins", label: "Inspection", owner: "Inspection team", statuses: ["INSPECTION_SCHEDULED", "INSPECTION_SUBMITTED"], c: "#5b3cc4", href: "/pcp/applications?status=INSPECTION_SCHEDULED,INSPECTION_SUBMITTED" },
  { key: "cou", label: "Council", owner: "Secretary", statuses: ["COUNCIL_REVIEW", "APPROVED", "DEFERRED"], c: "#0b6e6e", href: "/pcp/applications?status=COUNCIL_REVIEW,APPROVED,DEFERRED" },
  { key: "iss", label: "Certificate issued", owner: "Closed", statuses: ["NOC_ISSUED"], c: "#0d7a3d", href: "/pcp/applications?status=NOC_ISSUED" },
];

function Pipeline({ data }: { data: KV }) {
  const count = (s: string[]) => data.filter((d) => s.includes(d.k)).reduce((a, d) => a + d.n, 0);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
      {STAGES.map((s, i) => {
        const n = count(s.statuses);
        return (
          <Link key={s.key} href={s.href}>
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

export type WorkItem = { ref: string; kind: string; programType: string; field?: string; status: string; inst: string; dueAt: string | null; holder: string; escalated: boolean };
type Decided = { ref: string; kind: string; programType: string; field?: string; status: string; inst: string; decision: string; at: string; deferUntil: string | null };

function WorkRow({ w, showHolder }: { w: WorkItem; showHolder?: boolean }) {
  const c = slaClock(w.status, w.dueAt);
  return (
    <Link href={`/pcp/applications/${w.ref}`}>
      <div className="pcp-action-row" style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", borderRadius: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="mono" style={{ fontWeight: 600, fontSize: 13, color: "var(--ink)" }}>{w.ref}</span>
            <span className="faint" style={{ fontSize: 12 }}>{w.inst} · {kindLabel(w.kind)} · {programmeLabel(w.programType, w.field)}</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
            {STAGE_LABELS[w.status] ?? w.status}
            {showHolder ? ` · with ${w.holder}` : ""}
            {w.escalated ? <span style={{ color: "#b4141f" }}> · escalated</span> : null}
          </div>
        </div>
        {c ? (
          <b className="tnum" style={{ fontSize: 12.5, whiteSpace: "nowrap", color: c.overdue ? "#b4141f" : c.tone === "warn" ? "#a15c00" : "var(--ink-2)" }}>
            {c.text}
          </b>
        ) : null}
      </div>
    </Link>
  );
}

/** Task list first (guide section 11): what is due, what is blocked or overdue, what was decided. */
function MyWork({ work }: { work: { due: WorkItem[]; dueTotal: number; blocked: WorkItem[]; blockedTotal: number; decided: Decided[] } }) {
  const col = (title: React.ReactNode, extra: React.ReactNode, body: React.ReactNode, testid: string) => (
    <Col xs={24} lg={8}>
      <Card size="small" title={title} extra={extra} style={{ height: "100%" }} styles={{ body: { padding: 6 } }} data-testid={testid}>
        {body}
      </Card>
    </Col>
  );
  const empty = (t: string) => <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t} style={{ margin: "12px 0" }} />;
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="pcp-section-title" style={{ marginBottom: 10 }}>My work</div>
      <Row gutter={[14, 14]}>
        {col(
          <span><ScheduleOutlined style={{ color: "var(--brand)", marginRight: 8 }} />Due for you</span>,
          <Link href="/pcp/applications" style={{ fontSize: 12.5 }}>{work.dueTotal} in your queue</Link>,
          work.due.length ? work.due.map((w) => <WorkRow key={w.ref} w={w} />) : empty("Nothing waiting for your role"),
          "work-due",
        )}
        {col(
          <span><WarningOutlined style={{ color: "#b4141f", marginRight: 8 }} />Blocked or overdue</span>,
          <Link href="/pcp/applications?overdue=1" style={{ fontSize: 12.5 }}>{work.blockedTotal} past the time limit</Link>,
          work.blocked.length ? work.blocked.map((w) => <WorkRow key={w.ref} w={w} showHolder />) : empty("No case is past its time limit"),
          "work-blocked",
        )}
        {col(
          <span><CheckCircleFilled style={{ color: "#12a150", marginRight: 8 }} />Decided recently</span>,
          <span className="faint" style={{ fontSize: 12.5 }}>Last 30 days</span>,
          work.decided.length
            ? work.decided.map((x) => (
                <Link key={x.ref} href={`/pcp/applications/${x.ref}`}>
                  <div className="pcp-action-row" style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", borderRadius: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span className="mono" style={{ fontWeight: 600, fontSize: 13, color: "var(--ink)" }}>{x.ref}</span>{" "}
                      <span className="faint" style={{ fontSize: 12 }}>{x.inst} · {kindLabel(x.kind)} · {programmeLabel(x.programType, x.field)}</span>
                      <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{fmtDate(x.at)}{x.decision === "DEFERRED" && x.deferUntil ? ` · returns ${fmtDate(x.deferUntil)}` : ""}</div>
                    </div>
                    <StatusTag status={x.status === "NOC_ISSUED" ? "NOC_ISSUED" : x.decision} />
                  </div>
                </Link>
              ))
            : empty("No decisions in the last 30 days"),
          "work-decided",
        )}
      </Row>
    </div>
  );
}

export default function ExecutiveDashboard(p: {
  kpis: Record<string, number>;
  month: string;
  work: { due: WorkItem[]; dueTotal: number; blocked: WorkItem[]; blockedTotal: number; decided: Decided[] };
  byProvince: KV;
  bySector: KV;
  nocStatus: KV;
  accStatus: KV;
  enrol: { year: number; type: string; n: number }[];
  graduates: { year: number; n: number }[];
  facultyQual: KV;
  overIntake: { short_code: string; name: string; program_type: string; enrollment_year: number; enrolled: number; approved_intake: number }[];
  pipeline: KV;
  renewals: { name: string; code: string; type: string; field?: string; until: string }[];
  notifications: { id: number; title: string; body: string; link: string | null; createdAt: string }[];
  adminTasks?: { text: string; link: string; due: string }[];
  /** More of the work list from other modules (letters marked to you, action points, hearings). */
  moreWork?: React.ReactNode;
}) {
  const k = p.kpis;
  const years = [...new Set(p.enrol.map((e) => e.year))];
  const pub = p.bySector.find((s) => s.k === "Public")?.n ?? 0;
  const priv = p.bySector.find((s) => s.k === "Private")?.n ?? 0;
  const link = (href: string, el: React.ReactNode) => <Link href={href}>{el}</Link>;
  const monthName = new Date(`${p.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  // Every figure opens the list behind it (guide sections 11 and 14).
  const tiles: { href: string; label: string; value: React.ReactNode; icon: React.ReactNode; tone?: "brand" | "info" | "warn" | "bad" | "violet" | "gold" | "neutral"; hint?: string }[] = [
    { href: "/pcp/institutions", label: "Institutions", value: k.institutions, icon: <BankOutlined />, hint: `${pub} public · ${priv} private` },
    { href: "/pcp/institutions?programme=PHARMD", label: "Active PharmD programmes", value: k.pharmd, icon: <SolutionOutlined />, tone: "gold", hint: "NOC approved" },
    { href: "/pcp/institutions?programme=TECH", label: "Technician programmes", value: k.tech, icon: <ExperimentOutlined />, tone: "gold", hint: "NOC approved" },
    { href: "/pcp/institutions?programme=PG", label: "Postgraduate programmes", value: k.pg ?? 0, icon: <ReadOutlined />, tone: "gold", hint: `${k.mphil ?? 0} MS/MPhil · ${k.phd ?? 0} PhD accredited` },
    { href: "/pcp/pharmacists", label: "Registered pharmacists", value: k.pharmacists ?? 0, icon: <UserSwitchOutlined />, tone: "neutral", hint: `${k.pharmacistsActive ?? 0} active · index of provincial registers` },
    { href: "/pcp/applications?kind=NOC&state=open", label: "Pending NOCs", value: k.pendingNoc, icon: <FileSearchOutlined />, tone: "info", hint: "Submitted, not closed" },
    { href: "/pcp/applications?kind=ACCREDITATION,RENEWAL&state=open", label: "Pending accreditations", value: k.pendingAcc, icon: <SafetyCertificateOutlined />, tone: "info", hint: "Accreditation and renewal" },
    { href: "/pcp/applications?renewals=90", label: "Renewals inside 90 days", value: k.renewals90, icon: <ClockCircleFilled />, tone: "warn", hint: "Alerts at 180/120/90/60/30 days" },
    { href: `/pcp/inspections?month=${p.month}`, label: "Inspections this month", value: k.inspectionsMonth, icon: <CalendarOutlined />, tone: "violet", hint: `${monthName} · ${k.pendingInspections} still scheduled` },
    { href: "/pcp/applications?deficiencies=open", label: "Outstanding deficiencies", value: k.deficiencies, icon: <WarningOutlined />, tone: "warn", hint: "Waiting on institutions" },
    { href: "/pcp/applications?status=COUNCIL_REVIEW", label: "Awaiting a decision", value: k.awaitingDecision, icon: <ScheduleOutlined />, tone: "neutral", hint: "On the council agenda" },
  ];

  return (
    <>
      <PageTitle
        eyebrow="Pharmacy Council of Pakistan"
        title="Dashboard"
        sub={`Your work first, then the registry: ${k.institutions} institutions, ${k.faculty} active faculty and ${k.students.toLocaleString()} current students, live from the central registry.`}
      />
      {p.adminTasks?.length ? (
        <Card size="small" title="Your tasks" style={{ marginBottom: 18 }} data-testid="admin-tasks">
          {p.adminTasks.map((t) => (
            <Link key={t.link} href={t.link} style={{ display: "flex", gap: 10, alignItems: "center", color: "inherit" }}>
              <ClockCircleFilled style={{ color: "#e8a20c" }} />
              <span style={{ flex: 1 }}>{t.text}</span>
              <span className="muted" style={{ fontSize: 12.5 }}>by {t.due}</span>
            </Link>
          ))}
        </Card>
      ) : null}

      <MyWork work={p.work} />
      {p.moreWork}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 14 }} data-testid="kpi-tiles">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href}>
            <StatCard compact clickable label={t.label} value={t.value} icon={t.icon} tone={t.tone} hint={t.hint} />
          </Link>
        ))}
      </div>

      <Card
        style={{ marginTop: 18 }}
        title={
          <span>
            <FileSearchOutlined style={{ marginRight: 8, color: "var(--brand)" }} />
            Case pipeline
          </span>
        }
        extra={<span className="muted" style={{ fontSize: 12.5 }}>{k.pendingNoc} NOC and {k.pendingAcc} accreditation cases open · every stage has an owner and a time limit</span>}
      >
        <Pipeline data={p.pipeline} />
      </Card>

      <Row gutter={[18, 18]} style={{ marginTop: 18 }}>
        <Col xs={24} lg={8}>
          <Card title="Risk signals" style={{ height: "100%" }} styles={{ body: { display: "grid", gap: 10 } }}>
            {link("/pcp/applications?overdue=1", <StatCard clickable label="Cases past the time limit" value={k.overdue} icon={<FieldTimeOutlined />} tone="bad" hint={`${k.escalated} escalated to a supervisor`} />)}
            {link("/pcp/verification", <StatCard clickable label="Possible duplicate faculty" value={k.duplicates} icon={<AlertOutlined />} tone="bad" hint="Same person, different CNIC or spelling" />)}
            {link("/pcp/applications?deficiencies=open", <StatCard clickable label="Cases with open deficiencies" value={k.deficiencies} icon={<WarningOutlined />} tone="warn" hint="Waiting on institutions" />)}
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
                rowKey={(r) => `${r.code}-${r.type}-${r.field ?? ""}`}
                dataSource={p.renewals}
                columns={[
                  { title: "Institution", dataIndex: "name", render: (v, r) => <span>{v}<div className="faint mono">{r.code}</div></span> },
                  { title: "Program", dataIndex: "type", render: (v: string, r) => programmeLabel(v, r.field) },
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
