"use client";
// Provincial council area (RFP 4.1.2: local territory oversight, validation routing, regional reporting).
// Every screen shows one province: the server scopes the data; these components only display it.
import Link from "next/link";
import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Alert, App, Button, Card, Col, Empty, Input, Modal, Row, Segmented, Select, Table, Tabs, Tag, Timeline, Upload } from "antd";
import {
  AuditOutlined,
  BankOutlined,
  CheckOutlined,
  CloseOutlined,
  CloudUploadOutlined,
  EnvironmentOutlined,
  FileSearchOutlined,
  FilterOutlined,
  MedicineBoxOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  ScheduleOutlined,
  SendOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { checkCouncilFile, provinceDrill, sampleCouncilFile, submitCouncilFile, validatePracticeUpdate } from "@/app/actions/people";
import { COUNCIL_FILE_STATUS } from "@/lib/people-shared";
import type { ImportReport } from "@/lib/pharmacist-import";
import { CATEGORY_LABELS, STATUSES, STATUS_LABELS } from "@/lib/register";
import { PROGRAMME_LABELS, filtersToQuery, type Report, type ReportFilters } from "@/lib/report-types";
import { KV, PageTitle, Pill, StatCard, StatusDot, StatusTag, fmtDate, kindLabel, programLabel, timeAgo } from "./common";
import { DEMO } from "./demo-helpers";
import { useOtp } from "./OtpConfirm";
import { CategoryText, RegStatus } from "./pharmacist-parts";
import { ReportTableStyles, useDrill } from "./ReportParts";
import { ReportPanel } from "./ReportsView";
import { useBusy } from "./registry-ui";

const docHref = (id: number) => `/api/people/documents/${id}`;

function NocLine({ p }: { p: { type: string; nocStatus: string; accreditationStatus: string; validUntil: string | null; intake: number } }) {
  const lapsed = p.validUntil && p.validUntil < new Date().toISOString().slice(0, 10);
  return (
    <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
      <b style={{ fontWeight: 600 }}>{programLabel(p.type)}</b> <Pill value={p.nocStatus === "APPROVED" ? "APPROVED" : p.nocStatus} label={`NOC ${p.nocStatus.toLowerCase()}`} />
      {p.accreditationStatus !== "NONE" ? (
        <span className="faint">
          {" "}
          · accreditation {p.accreditationStatus.toLowerCase()}
          {p.validUntil ? <span style={{ color: lapsed ? "#b4141f" : undefined }}> to {fmtDate(p.validUntil)}</span> : null}
        </span>
      ) : null}
      {p.intake ? <span className="faint"> · intake {p.intake}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------- dashboard

type Waiting = { id: number; practicePlace: string; designation: string; submittedAt: string; evidence: { id: number; fileName: string } | null; pharmacist: { id: number; regNo: string; fullName: string; status: string; current: string | null } };
type Decided = { id: number; decision: string; note: string | null; decidedBy: string; decidedAt: string; practicePlace: string; designation: string; pcpStatus: string; pcpNote: string | null; pharmacist: { id: number; regNo: string; fullName: string } };
type FileRow = { id: number; ref: string; fileName: string; totalRows: number; readyRows: number; errorRows: number; note: string | null; status: string; submittedBy: string; submittedAt: string; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; importRef: string | null };
type InspectionRow = { id: number; scheduledFor: string; status: string; scope: string | null; lead: string; submittedAt: string | null; inst: { code: string; shortCode: string; name: string; city: string }; app: { ref: string; kind: string; programType: string }; compliant: number; partial: number; nonCompliant: number; items: number };
type DeficiencyRow = { id: number; ref: string; caseRef: string; criterion: string; requiredAction: string; dueDate: string; status: string; inst: { code: string; shortCode: string; name: string } };

const PCP_OUTCOME: Record<string, { value: string; label: string }> = {
  PENDING: { value: "PENDING", label: "With PCP" },
  VERIFIED: { value: "VERIFIED", label: "Verified by PCP" },
  REJECTED: { value: "REJECTED", label: "Rejected by PCP" },
  WITHDRAWN: { value: "WITHDRAWN", label: "Replaced" },
};

export function ProvinceDashboard({
  province,
  councilName,
  hasCouncil,
  stats,
  waiting,
  returnedFiles,
  expiring,
  upcoming,
  decided,
}: {
  province: string;
  councilName: string;
  hasCouncil: boolean;
  stats: { institutions: number; programmes: number; students: number; pharmacists: number; activePharmacists: number; inspections: number; deficiencies: number; toValidate: number };
  waiting: Waiting[];
  returnedFiles: FileRow[];
  expiring: { code: string; name: string; type: string; validUntil: string; lapsed: boolean }[];
  upcoming: InspectionRow[];
  decided: Decided[];
}) {
  const due = waiting.length + returnedFiles.length + expiring.length;
  return (
    <>
      <PageTitle eyebrow={councilName} title={`${province}: regional oversight`} sub={`Institutions, programmes, inspections and the pharmacists the ${councilName} registered. You see ${province} only.`} />
      <Row gutter={[14, 14]} style={{ marginBottom: 18 }} data-testid="province-stats">
        <Col xs={12} md={6}>
          <Link href="/province/institutions">
            <StatCard clickable label="Institutions" value={stats.institutions} icon={<BankOutlined />} hint={`${stats.programmes} programmes with an approved NOC`} />
          </Link>
        </Col>
        <Col xs={12} md={6}>
          <Link href="/province/pharmacists">
            <StatCard clickable label="Pharmacists registered" value={stats.pharmacists} icon={<MedicineBoxOutlined />} tone="info" hint={`${stats.activePharmacists} active`} />
          </Link>
        </Col>
        <Col xs={12} md={6}>
          <Link href="/province/inspections">
            <StatCard clickable label="Outstanding deficiencies" value={stats.deficiencies} icon={<WarningOutlined />} tone={stats.deficiencies ? "warn" : "neutral"} hint={`${stats.inspections} inspections this year`} />
          </Link>
        </Col>
        <Col xs={12} md={6}>
          <Link href="/province/pharmacists?tab=validation">
            <StatCard clickable label="Waiting for your validation" value={stats.toValidate} icon={<SafetyCertificateOutlined />} tone={stats.toValidate ? "violet" : "neutral"} hint="Practice updates" />
          </Link>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card title={`What is due (${due})`} style={{ marginBottom: 16 }} styles={{ body: { padding: due ? 0 : undefined } }} data-testid="province-due">
            {!due ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing waiting for you" />
            ) : (
              <div>
                {waiting.map((w) => (
                  <Link key={`w${w.id}`} href="/province/pharmacists?tab=validation" className="pcp-task-row" style={{ display: "flex", gap: 12, padding: "12px 18px", borderBottom: "1px solid var(--line-2)", color: "var(--ink)" }}>
                    <SafetyCertificateOutlined style={{ color: "#5b3cc4", marginTop: 3 }} />
                    <span style={{ minWidth: 0 }}>
                      <b style={{ fontWeight: 600 }}>Validate a practice update: {w.pharmacist.fullName}</b>
                      <div className="muted" style={{ fontSize: 12.5 }}>
                        <span className="mono">{w.pharmacist.regNo}</span> · {w.designation}, {w.practicePlace} · sent {timeAgo(w.submittedAt)}
                      </div>
                    </span>
                  </Link>
                ))}
                {returnedFiles.map((f) => (
                  <Link key={`f${f.id}`} href="/province/pharmacists?tab=files" style={{ display: "flex", gap: 12, padding: "12px 18px", borderBottom: "1px solid var(--line-2)", color: "var(--ink)" }}>
                    <CloudUploadOutlined style={{ color: "#b4141f", marginTop: 3 }} />
                    <span>
                      <b style={{ fontWeight: 600 }}>PCP returned register file {f.ref}</b>
                      <div className="muted" style={{ fontSize: 12.5 }}>{f.decisionNote}</div>
                    </span>
                  </Link>
                ))}
                {expiring.map((e) => (
                  <Link key={`e${e.code}${e.type}`} href={`/province/institutions/${e.code}`} style={{ display: "flex", gap: 12, padding: "12px 18px", borderBottom: "1px solid var(--line-2)", color: "var(--ink)" }}>
                    <ScheduleOutlined style={{ color: "#a15c00", marginTop: 3 }} />
                    <span>
                      <b style={{ fontWeight: 600 }}>
                        {e.name}: {programLabel(e.type)} accreditation {e.lapsed ? "ended" : "ends"} {fmtDate(e.validUntil)}
                      </b>
                      <div className="muted" style={{ fontSize: 12.5 }}>Renewal is with PCP; the institution was reminded automatically.</div>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </Card>
          <Card title="Inspections coming up" styles={{ body: { padding: 0 } }}>
            <Table
              rowKey="id"
              size="small"
              dataSource={upcoming}
              pagination={false}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No inspection scheduled in the province" /> }}
              columns={[
                { title: "Date", dataIndex: "scheduledFor", render: (v) => <span className="tnum">{fmtDate(v)}</span> },
                { title: "Institution", render: (_, r) => <Link href={`/province/institutions/${r.inst.code}`}>{r.inst.name}</Link> },
                { title: "Case", render: (_, r) => <span className="mono">{r.app.ref}</span>, responsive: ["md"] },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card title="What PCP decided" styles={{ body: { padding: decided.length ? 0 : undefined } }}>
            {!hasCouncil ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`${province} has no pharmacy council register in PCP's index.`} />
            ) : decided.length ? (
              <Table
                rowKey="id"
                size="small"
                dataSource={decided}
                pagination={false}
                columns={[
                  { title: "Pharmacist", render: (_, r) => <Link href={`/province/pharmacists/${r.pharmacist.id}`}>{r.pharmacist.fullName}</Link> },
                  { title: "Council", render: (_, r) => <Pill value={r.decision === "VALIDATED" ? "VERIFIED" : "REJECTED"} label={r.decision === "VALIDATED" ? "Validated" : "Returned"} /> },
                  { title: "PCP", render: (_, r) => (r.decision === "VALIDATED" ? <Pill value={PCP_OUTCOME[r.pcpStatus]?.value ?? r.pcpStatus} label={PCP_OUTCOME[r.pcpStatus]?.label} /> : <span className="faint">Not sent</span>) },
                ]}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No decisions yet" />
            )}
          </Card>
          <Alert
            style={{ marginTop: 16 }}
            type="info"
            showIcon
            title="Validation routing"
            description={`Practice updates of pharmacists registered by the ${councilName}, and register files from your council, come to you first. After you validate them they go to PCP registration, marked "Validated by the ${councilName}".`}
          />
        </Col>
      </Row>
    </>
  );
}

// ---------------------------------------------------------------- institutions

type InstRow = { id: number; code: string; shortCode: string; name: string; city: string; sector: string; status: string; programmes: { type: string; nocStatus: string; accreditationStatus: string; validUntil: string | null; intake: number }[]; students: number; faculty: number; deficiencies: number; openCases: number };

export function ProvinceInstitutions({ province, rows }: { province: string; rows: InstRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const list = rows.filter((r) => !q || `${r.name} ${r.code} ${r.city}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageTitle eyebrow="Registry" title={`Institutions in ${province}`} sub="Each institution with the status of its programmes. Open one for its cases, inspections and deficiencies." />
      <Card styles={{ body: { padding: 0 } }}>
        <div style={{ padding: 14, borderBottom: "1px solid var(--line-2)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Input.Search allowClear placeholder="Name, PCP ID or city" onChange={(e) => setQ(e.target.value)} style={{ width: 320, maxWidth: "100%" }} aria-label="Search institutions" />
          <span className="muted" style={{ marginInlineStart: "auto", fontSize: 12.5 }}>
            {list.length} of {rows.length}
          </span>
        </div>
        <Table
          rowKey="code"
          dataSource={list}
          pagination={false}
          data-testid="province-institutions"
          onRow={(r) => ({ onClick: () => router.push(`/province/institutions/${r.code}`), style: { cursor: "pointer" } })}
          scroll={{ x: true }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`No institution in ${province} matches`} /> }}
          columns={[
            {
              title: "Institution",
              render: (_, r) => (
                <span>
                  <Link href={`/province/institutions/${r.code}`} style={{ fontWeight: 500, color: "var(--ink)" }} onClick={(e) => e.stopPropagation()}>
                    {r.name}
                  </Link>
                  <div className="faint" style={{ fontSize: 12 }}>
                    <span className="mono">{r.code}</span> · {r.city} · {r.sector}
                  </div>
                </span>
              ),
            },
            { title: "Programmes", render: (_, r) => (r.programmes.length ? r.programmes.map((p) => <NocLine key={p.type} p={p} />) : <span className="faint">None</span>) },
            { title: "Students", dataIndex: "students", align: "right", render: (v) => <span className="tnum">{v}</span>, responsive: ["md"] },
            { title: "Faculty", dataIndex: "faculty", align: "right", render: (v) => <span className="tnum">{v}</span>, responsive: ["md"] },
            { title: "Open cases", dataIndex: "openCases", align: "right", render: (v) => <span className="tnum">{v}</span>, responsive: ["lg"] },
            { title: "Deficiencies", dataIndex: "deficiencies", align: "right", render: (v) => (v ? <Pill value="OUTSTANDING" label={`${v} outstanding`} /> : <span className="faint">None</span>) },
          ]}
        />
      </Card>
    </>
  );
}

export function ProvinceInstitution({
  inst,
  row,
  cases,
  inspections,
  deficiencies,
  intake,
}: {
  inst: { code: string; name: string; shortCode: string; city: string; province: string; sector: string; status: string; affiliatedUniversity: string | null; establishedYear: number | null; website: string | null };
  row: InstRow;
  cases: { ref: string; kind: string; programType: string; status: string; submittedAt: string | null; certificateNo: string | null; validUntil: string | null }[];
  inspections: InspectionRow[];
  deficiencies: DeficiencyRow[];
  intake: { year: number; pharmd: number; tech: number; graduated: number }[];
}) {
  return (
    <>
      <PageTitle
        eyebrow={<Link href="/province/institutions">Institutions in {inst.province}</Link>}
        title={inst.name}
        sub={
          <span>
            <span className="mono">{inst.code}</span> · {inst.city} · {inst.sector} · <Pill value={inst.status} />
          </span>
        }
      />
      <Row gutter={[14, 14]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <StatCard compact label="Students on roll" value={row.students} icon={<TeamOutlined />} />
        </Col>
        <Col xs={12} md={6}>
          <StatCard compact label="Active faculty" value={row.faculty} icon={<TeamOutlined />} tone="info" />
        </Col>
        <Col xs={12} md={6}>
          <StatCard compact label="Open cases" value={row.openCases} icon={<AuditOutlined />} tone="violet" />
        </Col>
        <Col xs={12} md={6}>
          <StatCard compact label="Outstanding deficiencies" value={row.deficiencies} icon={<WarningOutlined />} tone={row.deficiencies ? "warn" : "neutral"} />
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card title="Programmes" style={{ marginBottom: 16 }}>
            {row.programmes.length ? (
              <div style={{ display: "grid", gap: 10 }}>
                {row.programmes.map((p) => (
                  <NocLine key={p.type} p={p} />
                ))}
              </div>
            ) : (
              <span className="muted">No programme on record.</span>
            )}
            <div style={{ marginTop: 14 }}>
              <KV
                rows={[
                  ["Affiliated university", inst.affiliatedUniversity ?? "Not recorded"],
                  ["Established", inst.establishedYear ? String(inst.establishedYear) : "Not recorded"],
                  ["Website", inst.website ?? "Not recorded"],
                ]}
              />
            </div>
          </Card>
          <Card title="Enrolment by intake year" styles={{ body: { padding: 0 } }} style={{ marginBottom: 16 }}>
            <Table
              rowKey="year"
              size="small"
              dataSource={intake}
              pagination={false}
              locale={{ emptyText: "No student records" }}
              columns={[
                { title: "Intake", dataIndex: "year", render: (v) => <span className="mono">{v}</span> },
                { title: "PharmD", dataIndex: "pharmd", align: "right" },
                { title: "Technician", dataIndex: "tech", align: "right" },
                { title: "Graduated", dataIndex: "graduated", align: "right" },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title={`Cases with PCP (${cases.length})`} styles={{ body: { padding: 0 } }} style={{ marginBottom: 16 }}>
            <Table
              rowKey="ref"
              size="small"
              dataSource={cases}
              pagination={false}
              scroll={{ x: true }}
              locale={{ emptyText: "No cases" }}
              columns={[
                { title: "Case", dataIndex: "ref", render: (v) => <span className="mono">{v}</span> },
                { title: "Kind", render: (_, c) => `${kindLabel(c.kind)} · ${programLabel(c.programType)}` },
                { title: "Status", dataIndex: "status", render: (v) => <StatusTag status={v} /> },
                { title: "Submitted", dataIndex: "submittedAt", render: (v) => fmtDate(v), responsive: ["md"] },
              ]}
            />
          </Card>
          <InspectionTable inspections={inspections} compact />
          <div style={{ height: 16 }} />
          <DeficiencyTable deficiencies={deficiencies} compact />
        </Col>
      </Row>
    </>
  );
}

// ---------------------------------------------------------------- inspections and deficiencies

function InspectionTable({ inspections, compact }: { inspections: InspectionRow[]; compact?: boolean }) {
  return (
    <Card title={`Inspections (${inspections.length})`} styles={{ body: { padding: 0 } }} data-testid="province-inspections">
      <Table
        rowKey="id"
        size="small"
        dataSource={inspections}
        pagination={inspections.length > 12 ? { pageSize: 12, showSizeChanger: false } : false}
        scroll={{ x: true }}
        locale={{ emptyText: "No inspections" }}
        columns={[
          { title: "Date", dataIndex: "scheduledFor", render: (v) => <span className="tnum">{fmtDate(v)}</span> },
          ...(compact ? [] : [{ title: "Institution", render: (_: unknown, r: InspectionRow) => <Link href={`/province/institutions/${r.inst.code}`}>{r.inst.name}</Link> }]),
          { title: "Case", render: (_, r) => <span><span className="mono">{r.app.ref}</span><div className="faint" style={{ fontSize: 12 }}>{kindLabel(r.app.kind)} · {programLabel(r.app.programType)}</div></span> },
          { title: "Status", dataIndex: "status", render: (v) => <Pill value={v} label={v === "SCHEDULED" ? "Scheduled" : "Report submitted"} /> },
          {
            title: "Findings",
            responsive: ["md"],
            render: (_, r) =>
              r.items ? (
                <span style={{ fontSize: 12.5 }}>
                  {r.compliant} compliant · {r.partial} partly · <span style={{ color: r.nonCompliant ? "#b4141f" : undefined }}>{r.nonCompliant} not</span>
                </span>
              ) : (
                <span className="faint">Not yet</span>
              ),
          },
        ]}
      />
    </Card>
  );
}

function DeficiencyTable({ deficiencies, compact }: { deficiencies: DeficiencyRow[]; compact?: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Card title={`Deficiencies (${deficiencies.filter((d) => ["OUTSTANDING", "REJECTED"].includes(d.status)).length} outstanding)`} styles={{ body: { padding: 0 } }} data-testid="province-deficiencies">
      <Table
        rowKey="id"
        size="small"
        dataSource={deficiencies}
        pagination={deficiencies.length > 12 ? { pageSize: 12, showSizeChanger: false } : false}
        scroll={{ x: true }}
        locale={{ emptyText: "No deficiencies" }}
        columns={[
          { title: "Deficiency", render: (_, d) => <span><span className="mono">{d.ref}</span><div className="faint" style={{ fontSize: 12 }}>{d.caseRef}</div></span> },
          ...(compact ? [] : [{ title: "Institution", render: (_: unknown, d: DeficiencyRow) => <Link href={`/province/institutions/${d.inst.code}`}>{d.inst.shortCode}</Link> }]),
          { title: "Required action", render: (_, d) => <span style={{ fontSize: 13 }}><b style={{ fontWeight: 600 }}>{d.criterion}</b>: {d.requiredAction}</span> },
          {
            title: "Due",
            dataIndex: "dueDate",
            render: (v, d) => <span className="tnum" style={{ color: ["OUTSTANDING", "REJECTED"].includes(d.status) && v < today ? "#b4141f" : undefined }}>{fmtDate(v)}{["OUTSTANDING", "REJECTED"].includes(d.status) && v < today ? " · overdue" : ""}</span>,
          },
          { title: "Status", dataIndex: "status", render: (v) => <Pill value={v} /> },
        ]}
      />
    </Card>
  );
}

export function ProvinceInspections({ province, inspections, deficiencies }: { province: string; inspections: InspectionRow[]; deficiencies: DeficiencyRow[] }) {
  return (
    <>
      <PageTitle eyebrow="Oversight" title={`Inspections and deficiencies in ${province}`} sub="Read-only: PCP's inspection coordinator schedules the visits, and no inspector inspects an institution in their own province." />
      <InspectionTable inspections={inspections} />
      <div style={{ height: 16 }} />
      <DeficiencyTable deficiencies={deficiencies} />
    </>
  );
}

// ---------------------------------------------------------------- pharmacists: register, validation, files

type RegisterRow = { id: number; regNo: string; fullName: string; category: string; status: string; validUntil: string | null; university: string; practiceConfirmed: boolean; practicePlace: string | null; designation: string | null };

export function ProvincePharmacists({
  province,
  councilName,
  council,
  filters,
  register,
  queue,
  files,
}: {
  province: string;
  councilName: string;
  council: string | null;
  filters: { q: string; status: string; page: number; tab: string };
  register: { total: number; pageSize: number; rows: RegisterRow[]; byStatus: Record<string, number> } | null;
  queue: { waiting: Waiting[]; decided: Decided[] };
  files: FileRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const go = (next: Partial<typeof filters>) => {
    const f = { ...filters, ...next };
    const sp = new URLSearchParams();
    if (f.q) sp.set("q", f.q);
    if (f.status) sp.set("status", f.status);
    if (f.page > 1) sp.set("page", String(f.page));
    sp.set("tab", f.tab);
    router.push(`${pathname}?${sp.toString()}`);
  };
  if (!council || !register)
    return (
      <>
        <PageTitle eyebrow="Registry" title="Pharmacists" />
        <Card>
          <Empty description={`${province} has no pharmacy council register in PCP's index.`} />
        </Card>
      </>
    );
  const total = Object.values(register.byStatus).reduce((a, x) => a + x, 0);
  return (
    <>
      <PageTitle eyebrow={councilName} title="Pharmacists registered by your council" sub="PCP's index of your register. Validate practice updates and send register files to PCP from here." />
      <Tabs
        activeKey={filters.tab}
        onChange={(k) => go({ tab: k, page: 1 })}
        items={[
          {
            key: "register",
            label: `Register (${total})`,
            children: (
              <Card styles={{ body: { padding: 0 } }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: 14, borderBottom: "1px solid var(--line-2)" }}>
                  <Input.Search allowClear defaultValue={filters.q} placeholder="Name, number or university" onSearch={(v) => go({ q: v.trim(), page: 1, tab: "register" })} style={{ width: 320, maxWidth: "100%" }} aria-label="Search the register" />
                  <Select value={filters.status || undefined} placeholder="All statuses" allowClear onChange={(v) => go({ status: v ?? "", page: 1, tab: "register" })} options={STATUSES.map((s) => ({ value: s, label: `${STATUS_LABELS[s]} (${register.byStatus[s] ?? 0})` }))} style={{ width: 180 }} aria-label="Status" />
                  <span className="muted" style={{ marginInlineStart: "auto", alignSelf: "center", fontSize: 12.5 }}>
                    {register.total} {register.total === 1 ? "pharmacist" : "pharmacists"}
                  </span>
                </div>
                <Table
                  rowKey="id"
                  data-testid="province-register"
                  dataSource={register.rows}
                  pagination={{ current: filters.page, pageSize: register.pageSize, total: register.total, showSizeChanger: false, hideOnSinglePage: true, onChange: (page) => go({ page, tab: "register" }) }}
                  onRow={(r) => ({ onClick: () => router.push(`/province/pharmacists/${r.id}`), style: { cursor: "pointer" } })}
                  locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No pharmacist matches" /> }}
                  columns={[
                    {
                      title: "Pharmacist",
                      render: (_, r) => (
                        <span>
                          <Link href={`/province/pharmacists/${r.id}`} style={{ fontWeight: 500, color: "var(--ink)" }} onClick={(e) => e.stopPropagation()}>
                            {r.fullName}
                          </Link>
                          <div className="faint" style={{ fontSize: 12 }}>
                            <span className="mono">{r.regNo}</span>
                          </div>
                        </span>
                      ),
                    },
                    { title: "Category", dataIndex: "category", render: (v) => <CategoryText category={v} />, responsive: ["md"] },
                    { title: "Status", render: (_, r) => <RegStatus status={r.status} validUntil={r.validUntil} /> },
                    { title: "Valid until", dataIndex: "validUntil", render: (v) => <span className="tnum">{fmtDate(v)}</span>, responsive: ["lg"] },
                    { title: "Practice", responsive: ["lg"], render: (_, r) => (r.practiceConfirmed ? <span style={{ fontSize: 12.5 }}>{r.designation}<div className="faint">{r.practicePlace}</div></span> : <span className="faint" style={{ fontSize: 12.5 }}>Not confirmed</span>) },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: "validation",
            label: (
              <span data-testid="tab-validation">
                To validate {queue.waiting.length ? <Tag color="purple" style={{ marginInlineStart: 4 }}>{queue.waiting.length}</Tag> : null}
              </span>
            ),
            children: <ValidationQueue councilName={councilName} waiting={queue.waiting} decided={queue.decided} />,
          },
          { key: "files", label: `Register files (${files.length})`, children: <CouncilFiles councilName={councilName} files={files} /> },
        ]}
      />
    </>
  );
}

function ValidationQueue({ councilName, waiting, decided }: { councilName: string; waiting: Waiting[]; decided: Decided[] }) {
  const { message } = App.useApp();
  const router = useRouter();
  const { withOtp, otpModal } = useOtp();
  const [busy, run] = useBusy();
  const [returning, setReturning] = useState<Waiting | null>(null);
  const [note, setNote] = useState("");

  const decide = (w: Waiting, decision: "VALIDATED" | "RETURNED", why: string) =>
    withOtp(`validation:practice-${w.id}`, `${decision === "VALIDATED" ? "Validate" : "Return"} ${w.pharmacist.fullName}'s practice update`, (code) =>
      run(async () => {
        const r = await validatePracticeUpdate(w.id, decision, why, code);
        message[r.ok ? "success" : r.level === "warning" ? "warning" : "error"](r.message, 6);
        if (r.ok) {
          setReturning(null);
          router.refresh();
        }
      }),
    );

  return (
    <>
      {otpModal}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14 }}
        title={`Check each update against the ${councilName}'s own records and the evidence. Validated updates go to PCP registration, marked "Validated by the ${councilName}"; returned ones go back to the pharmacist with your reason.`}
      />
      {waiting.length ? (
        waiting.map((w) => (
          <Card key={w.id} data-testid={`validate-${w.pharmacist.regNo}`} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <div className="pcp-eyebrow" style={{ color: "#5b3cc4" }}>Practice update · sent {timeAgo(w.submittedAt)}</div>
                <Link href={`/province/pharmacists/${w.pharmacist.id}`} style={{ fontWeight: 650, fontSize: 15, color: "var(--ink)" }}>
                  {w.pharmacist.fullName}
                </Link>{" "}
                <span className="mono faint" style={{ fontSize: 12.5 }}>{w.pharmacist.regNo}</span> <RegStatus status={w.pharmacist.status} />
                <div style={{ marginTop: 6, fontSize: 13.5 }}>
                  New: <b style={{ fontWeight: 600 }}>{w.designation}</b>, {w.practicePlace}
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}>Now on record: {w.pharmacist.current ?? "no confirmed practice place"}</div>
                <div style={{ marginTop: 6 }}>
                  {w.evidence ? (
                    <a href={docHref(w.evidence.id)} target="_blank" rel="noreferrer">
                      <FileSearchOutlined /> {w.evidence.fileName}
                    </a>
                  ) : (
                    <span className="faint">No evidence attached</span>
                  )}
                </div>
              </div>
              <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                <Button type="primary" icon={<CheckOutlined />} loading={busy} onClick={() => decide(w, "VALIDATED", "")}>
                  Validate and send to PCP
                </Button>
                <Button
                  danger
                  icon={<CloseOutlined />}
                  disabled={busy}
                  onClick={() => {
                    setNote("");
                    setReturning(w);
                  }}
                >
                  Return
                </Button>
              </span>
            </div>
          </Card>
        ))
      ) : (
        <Card style={{ marginBottom: 12 }}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing waiting for your validation" />
        </Card>
      )}
      <Card title="Decided by your council" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          size="small"
          dataSource={decided}
          pagination={false}
          scroll={{ x: true }}
          locale={{ emptyText: "No decisions yet" }}
          columns={[
            { title: "Pharmacist", render: (_, r) => <Link href={`/province/pharmacists/${r.pharmacist.id}`}>{r.pharmacist.fullName}</Link> },
            { title: "Update", render: (_, r) => <span style={{ fontSize: 12.5 }}>{r.designation}, {r.practicePlace}</span>, responsive: ["md"] },
            { title: "Your council", render: (_, r) => <span><Pill value={r.decision === "VALIDATED" ? "VERIFIED" : "REJECTED"} label={r.decision === "VALIDATED" ? "Validated" : "Returned"} /><div className="faint" style={{ fontSize: 12 }}>{r.decidedBy} · {fmtDate(r.decidedAt)}</div></span> },
            { title: "PCP", render: (_, r) => (r.decision === "VALIDATED" ? <Pill value={PCP_OUTCOME[r.pcpStatus]?.value ?? r.pcpStatus} label={PCP_OUTCOME[r.pcpStatus]?.label} /> : <span className="faint">Not sent</span>) },
          ]}
        />
      </Card>
      <Modal
        open={!!returning}
        title={`Return ${returning?.pharmacist.fullName ?? ""}'s update`}
        okText="Continue"
        okButtonProps={{ danger: true, disabled: note.trim().length < 10, loading: busy }}
        onCancel={() => setReturning(null)}
        onOk={() => returning && decide(returning, "RETURNED", note)}
        destroyOnHidden
      >
        <p style={{ marginTop: 0 }}>The update does not go to PCP. The pharmacist sees your reason and can send a new update.</p>
        <Input.TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (required), e.g. Our register shows a different pharmacy at this licence number" aria-label="Reason for returning" />
      </Modal>
    </>
  );
}

function CouncilFiles({ councilName, files }: { councilName: string; files: FileRow[] }) {
  const { message } = App.useApp();
  const router = useRouter();
  const { withOtp, otpModal } = useOtp();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, start] = useTransition();

  const check = (f: { name: string; text: string }) =>
    start(async () => {
      setProblem(null);
      setReport(null);
      setFile(f);
      const r = await checkCouncilFile(f.name, f.text);
      if (!r.ok) return void setProblem(r.message ?? "The file could not be read.");
      setReport(r as ImportReport);
    });
  const sample = () =>
    start(async () => {
      const r = await sampleCouncilFile();
      if (!r.ok || !r.csv || !r.fileName) return void message.error(r.message ?? "Could not make a sample file.");
      check({ name: r.fileName, text: r.csv });
    });
  const send = () =>
    file &&
    withOtp("validation:council-file", `Validate ${file.name} and send it to PCP`, (code) =>
      start(async () => {
        const r = await submitCouncilFile(file.name, file.text, note, code);
        message[r.ok ? (r.level === "warning" ? "warning" : "success") : "error"](r.message, 8);
        if (r.ok) {
          setFile(null);
          setReport(null);
          setNote("");
          router.refresh();
        }
      }),
    );

  const errors = report?.rows.filter((r) => r.errors.length) ?? [];
  return (
    <>
      {otpModal}
      <Card title="Send a register file to PCP" style={{ marginBottom: 14 }} data-testid="council-file-card">
        <p className="muted" style={{ marginTop: 0 }}>
          Upload the {councilName}&apos;s register file (CSV). It is checked row by row; nothing is saved until you validate it. PCP registration then loads the rows without errors into its index, each marked &quot;Validated by the {councilName}&quot;.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Upload
            accept=".csv,text/csv"
            maxCount={1}
            showUploadList={false}
            beforeUpload={async (f) => {
              check({ name: f.name, text: await f.text() });
              return false;
            }}
          >
            <Button icon={<CloudUploadOutlined />} loading={busy}>
              Choose CSV file
            </Button>
          </Upload>
          {DEMO ? (
            <Button icon={<ThunderboltOutlined />} onClick={sample} disabled={busy} style={{ borderColor: "#e3c97f", color: "#8a6a1c", background: "#fffbf0" }}>
              Use a sample file
            </Button>
          ) : null}
          {file ? <span style={{ fontSize: 13 }}>{file.name}</span> : null}
        </div>
        {problem ? <Alert style={{ marginTop: 12 }} type="error" showIcon title={problem} /> : null}
        {report ? (
          <div style={{ marginTop: 14 }} data-testid="council-file-report">
            <Row gutter={[10, 10]}>
              <Col xs={8}>
                <StatCard compact label="Rows" value={report.total} />
              </Col>
              <Col xs={8}>
                <StatCard compact label="Ready" value={report.ready} tone="brand" />
              </Col>
              <Col xs={8}>
                <StatCard compact label="With errors" value={report.withErrors} tone={report.withErrors ? "bad" : "neutral"} />
              </Col>
            </Row>
            {errors.length ? (
              <Table
                style={{ marginTop: 12 }}
                rowKey="row"
                size="small"
                dataSource={errors}
                pagination={errors.length > 8 ? { pageSize: 8, showSizeChanger: false } : false}
                scroll={{ x: true }}
                columns={[
                  { title: "Row", dataIndex: "row", width: 60 },
                  { title: "Number", dataIndex: "regNo", render: (v) => <span className="mono">{v || "None"}</span> },
                  { title: "What to fix", dataIndex: "errors", render: (v: string[]) => <span style={{ fontSize: 12.5, color: "#b4141f" }}>{v.join("; ")}</span> },
                ]}
              />
            ) : null}
            <Input.TextArea style={{ marginTop: 12 }} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for PCP (optional), e.g. Monthly update, September 2026" aria-label="Note for PCP" />
            <Button style={{ marginTop: 10 }} type="primary" icon={<SendOutlined />} disabled={!report.ready || busy} onClick={send}>
              Validate {report.ready} rows and send to PCP
            </Button>
            {errors.length ? <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>Rows with errors stay out. Fix them in your file and send them again.</div> : null}
          </div>
        ) : null}
      </Card>
      <Card title="Files sent" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          size="small"
          dataSource={files}
          pagination={false}
          scroll={{ x: true }}
          locale={{ emptyText: "No files sent yet" }}
          columns={[
            { title: "File", render: (_, f) => <span><span className="mono">{f.ref}</span><div className="faint" style={{ fontSize: 12 }}>{f.fileName}</div></span> },
            { title: "Rows", render: (_, f) => <span className="tnum" style={{ fontSize: 12.5 }}>{f.readyRows} validated{f.errorRows ? ` · ${f.errorRows} with errors` : ""}</span> },
            { title: "Sent", render: (_, f) => <span style={{ fontSize: 12.5 }}>{fmtDate(f.submittedAt)}<div className="faint">{f.submittedBy}</div></span>, responsive: ["md"] },
            {
              title: "PCP",
              render: (_, f) => (
                <span>
                  <Pill value={f.status === "LOADED" ? "ACCEPTED" : f.status === "RETURNED" ? "REJECTED" : "PENDING"} label={COUNCIL_FILE_STATUS[f.status]} />
                  {f.importRef ? <div className="faint mono" style={{ fontSize: 12 }}>{f.importRef}</div> : null}
                  {f.decisionNote ? <div className="faint" style={{ fontSize: 12 }}>{f.decisionNote}</div> : null}
                </span>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- one register entry

const EVENT_LABEL: Record<string, string> = { IMPORTED: "Imported", STATUS: "Status changed", PRACTICE: "Practice details", LOGIN: "Portal login", CARD: "Registration card", IDENTITY: "NADRA check", PROVINCE: "Council validation" };
const EVENT_COLOR: Record<string, string> = { IMPORTED: "gray", STATUS: "orange", PRACTICE: "green", LOGIN: "blue", CARD: "gray", IDENTITY: "blue", PROVINCE: "purple" };

export function ProvincePharmacist({
  councilName,
  p,
  imported,
  events,
  updates,
}: {
  councilName: string;
  p: { id: number; regNo: string; fullName: string; fatherName: string; cnic: string; university: string; graduationYear: number; category: string; council: string; issueDate: string; validUntil: string | null; status: string; practicePlace: string | null; designation: string | null; practiceConfirmedAt: string | null; hasLogin: boolean };
  imported: { ref: string; fileName: string; createdAt: string } | null;
  events: { id: number; kind: string; fromStatus: string | null; toStatus: string | null; note: string | null; actor: string; createdAt: string }[];
  updates: { id: number; practicePlace: string; designation: string; status: string; submittedAt: string; council: { decision: string; by: string; at: string; note: string | null } | null; reviewedBy: string | null; reviewedAt: string | null; reviewNote: string | null }[];
}) {
  return (
    <>
      <PageTitle eyebrow={<Link href="/province/pharmacists">Pharmacists registered by the {councilName}</Link>} title={p.fullName} sub={<span className="mono">{p.regNo}</span>} />
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={13}>
          <Card title="Registration" style={{ marginBottom: 16 }}>
            <KV
              rows={[
                ["Status", <RegStatus key="s" status={p.status} validUntil={p.validUntil} />],
                ["Category", CATEGORY_LABELS[p.category] ?? p.category],
                ["Issued", fmtDate(p.issueDate)],
                ["Valid until", p.validUntil ? fmtDate(p.validUntil) : "No end date in your file"],
                ["University", `${p.university}, ${p.graduationYear}`],
                ["Father's name", p.fatherName],
                ["CNIC", <span key="c" className="mono">{p.cnic}</span>],
                ["Practice", p.practicePlace ? `${p.designation}, ${p.practicePlace} (verified ${fmtDate(p.practiceConfirmedAt)})` : "Not confirmed"],
                ["Source", imported ? `${imported.ref} · ${imported.fileName} · ${fmtDate(imported.createdAt)}` : "Entered before the import log"],
                ["Portal login", p.hasLogin ? "Yes" : "No"],
              ]}
            />
          </Card>
          <Card title={`Practice updates (${updates.length})`} styles={{ body: { padding: 0 } }}>
            <Table
              rowKey="id"
              size="small"
              dataSource={updates}
              pagination={false}
              scroll={{ x: true }}
              locale={{ emptyText: "No practice updates" }}
              columns={[
                { title: "Sent", dataIndex: "submittedAt", render: (v) => fmtDate(v) },
                { title: "Update", render: (_, u) => <span style={{ fontSize: 12.5 }}>{u.designation}, {u.practicePlace}</span> },
                {
                  title: "Your council",
                  render: (_, u) =>
                    u.council ? <Pill value={u.council.decision === "VALIDATED" ? "VERIFIED" : "REJECTED"} label={u.council.decision === "VALIDATED" ? "Validated" : "Returned"} /> : u.status === "WITH_COUNCIL" ? <Pill value="PENDING" label="Waiting for you" /> : <span className="faint">Before routing</span>,
                },
                { title: "PCP", render: (_, u) => (u.status === "WITH_COUNCIL" || u.council?.decision === "RETURNED" ? <span className="faint">Not sent</span> : <Pill value={PCP_OUTCOME[u.status]?.value ?? u.status} label={PCP_OUTCOME[u.status]?.label} />) },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={11}>
          <Card title="History">
            {events.length ? (
              <Timeline
                items={events.map((e) => ({
                  color: EVENT_COLOR[e.kind] ?? "gray",
                  content: (
                    <div>
                      <b style={{ fontWeight: 600 }}>{EVENT_LABEL[e.kind] ?? e.kind}</b>
                      {e.kind === "STATUS" && e.fromStatus && e.toStatus ? <span> · {STATUS_LABELS[e.fromStatus] ?? e.fromStatus} to {STATUS_LABELS[e.toStatus] ?? e.toStatus}</span> : null}
                      {e.note ? <div style={{ color: "var(--ink-2)", fontSize: 13 }}>{e.note}</div> : null}
                      <div className="faint" style={{ fontSize: 12 }}>
                        {e.actor} · {fmtDate(e.createdAt, true)}
                      </div>
                    </div>
                  ),
                }))}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No history yet" />
            )}
          </Card>
        </Col>
      </Row>
    </>
  );
}

// ---------------------------------------------------------------- reports

const REPORT_TABS: Record<string, string> = { institutions: "Institutions", intake: "Intake vs enrolment", graduates: "Graduates", ratio: "Faculty ratio", validity: "Validity", "early-warning": "Early warning", measures: "Measures of success" };

export function ProvinceReports({ province, reports, filters, years, tab }: { province: string; reports: Report[]; filters: ReportFilters; years: number[]; tab?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [active, setActive] = useState(tab && REPORT_TABS[tab] ? tab : "institutions");
  const { open, drawer } = useDrill(provinceDrill);
  const query = (f: ReportFilters, t = active) => {
    const q = filtersToQuery({ sector: f.sector, programme: f.programme, year: f.year });
    return `${pathname}?${q}${q ? "&" : ""}tab=${t}`;
  };
  const set = (patch: Partial<ReportFilters>) => start(() => router.replace(query({ ...filters, ...patch }), { scroll: false }));
  const any = filters.sector || filters.programme || filters.year;
  return (
    <>
      <ReportTableStyles />
      {drawer}
      <PageTitle eyebrow="Oversight" title={`Reports for ${province}`} sub={`PCP's standard reports, limited to ${province}. Every figure opens the list behind it; Excel, PDF and CSV exports carry the same filters and are logged.`} />
      <Card size="small" style={{ marginBottom: 16 }} styles={{ body: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" } }} data-testid="report-filters">
        <span className="muted" style={{ fontSize: 13, display: "inline-flex", gap: 6, alignItems: "center" }}>
          <FilterOutlined /> Filters
        </span>
        <StatusDot tone="teal">
          <EnvironmentOutlined /> {province} (fixed)
        </StatusDot>
        <Segmented aria-label="Sector" value={filters.sector ?? "All sectors"} onChange={(v) => set({ sector: v === "All sectors" ? undefined : String(v) })} options={["All sectors", "Public", "Private"]} />
        <Select aria-label="Programme" allowClear placeholder="All programmes" value={filters.programme} onChange={(v) => set({ programme: v })} options={Object.entries(PROGRAMME_LABELS).map(([value, label]) => ({ value, label }))} style={{ width: 190 }} />
        <Select aria-label="Year" allowClear placeholder="All years" value={filters.year} onChange={(v) => set({ year: v })} options={years.map((y) => ({ value: y, label: String(y) }))} style={{ width: 120 }} />
        {any ? (
          <Button icon={<ReloadOutlined />} onClick={() => set({ sector: undefined, programme: undefined, year: undefined })}>
            Clear filters
          </Button>
        ) : null}
        {pending ? <span className="faint" style={{ fontSize: 12.5 }}>Updating…</span> : null}
      </Card>
      <Tabs
        activeKey={active}
        onChange={(k) => {
          setActive(k);
          window.history.replaceState(null, "", query(filters, k));
        }}
        items={reports.map((r) => ({
          key: r.id,
          label: <span data-testid={`tab-${r.id}`}>{REPORT_TABS[r.id] ?? r.title}</span>,
          children: <ReportPanel report={r} filters={filters} onDrill={open} exportBase="/api/province/reports" />,
        }))}
      />
    </>
  );
}
