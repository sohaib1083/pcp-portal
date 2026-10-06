"use client";
// Accounts officer: payments ledger, bank statement reconciliation and dues (guide sections 2, 4 and 14).
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import dayjs, { type Dayjs } from "dayjs";
import { Alert, App, AutoComplete, Button, Card, Col, DatePicker, Empty, Form, Input, InputNumber, Modal, Row, Segmented, Select, Space, Table, Tabs, Tag, Tooltip, Upload } from "antd";
import {
  BankOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloudUploadOutlined,
  DownloadOutlined,
  FilePdfOutlined,
  ExclamationCircleOutlined,
  FileSearchOutlined,
  PlusOutlined,
  StopOutlined,
  ThunderboltOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { addDue, generateTodaysStatement, ignoreStatementLine, importStatementCsv, matchLine, waiveDue } from "@/app/actions/accounts";
import type { ActionResult } from "@/app/actions/faculty";
import { formatPKR } from "@/lib/format";
import { filtersToQuery } from "@/lib/report-types";
import { FillDemo } from "./demo-helpers";
import { useOtp } from "./OtpConfirm";
import { ExportButtons } from "./ReportParts";
import { PageTitle, StatCard, StatusDot, fmtDate } from "./common";

type Payment = {
  id: number;
  psid: string;
  receiptNo: string | null;
  institutionCode: string | null;
  institutionName: string;
  institutionShort: string;
  purpose: string;
  category: string;
  caseRef: string | null;
  amount: number;
  status: string;
  method: string | null;
  paidAt: string | null;
  createdAt: string;
  reconciledBy: string | null;
  reconciledAt: string | null;
  receiptDocumentId: number | null;
};
type Statement = { id: number; ref: string; statementDate: string; source: string; fileName: string | null; lineCount: number; matched: number; unmatched: number; ignored: number; importedBy: string; createdAt: string };
type Line = {
  id: number;
  statementId: number | null;
  statementRef: string | null;
  statementDate: string;
  psid: string | null;
  amount: number;
  bankRef: string;
  channel: string;
  narration: string | null;
  status: string;
  reason: string | null;
  matchType: string | null;
  matchedReceipt: string | null;
  matchedPsid: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  note: string | null;
};
type Due = {
  id: number;
  ref: string;
  institutionCode: string;
  institutionName: string;
  institutionShort: string;
  description: string;
  amount: number;
  dueDate: string;
  status: string;
  waivedBy: string | null;
  note: string | null;
  createdAt: string;
  receiptNo: string | null;
  receiptDocumentId: number | null;
  challanStatus: string | null;
};

type Tone = Parameters<typeof StatusDot>[0]["tone"];
export const PAY_STATUS: Record<string, { tone: Tone; label: string }> = {
  PENDING: { tone: "warn", label: "Challan issued, unpaid" },
  PAID: { tone: "info", label: "Paid, not reconciled" },
  RECONCILED: { tone: "good", label: "Reconciled" },
  CANCELLED: { tone: "neutral", label: "Cancelled" },
};
const DUE_STATUS: Record<string, { tone: Tone; label: string }> = {
  OUTSTANDING: { tone: "bad", label: "Outstanding" },
  PAID: { tone: "good", label: "Paid" },
  WAIVED: { tone: "neutral", label: "Waived" },
};
const LINE_STATUS: Record<string, { tone: Tone; label: string }> = {
  MATCHED: { tone: "good", label: "Matched" },
  UNMATCHED: { tone: "warn", label: "Unmatched" },
  IGNORED: { tone: "neutral", label: "Ignored" },
};
const METHOD: Record<string, string> = { RAAST_QR: "Raast QR", BANK_BRANCH: "Bank branch", INTERNET_BANKING: "Internet banking" };
const CHANNEL: Record<string, string> = { RAAST: "Raast", "1LINK": "1Link", BRANCH: "Branch" };
const STATUS_FILTERS = [
  { value: "ALL", label: "All statuses" },
  { value: "COLLECTED", label: "Collected (paid or reconciled)" },
  { value: "PAID", label: "Paid, not reconciled" },
  { value: "RECONCILED", label: "Reconciled" },
  { value: "PENDING", label: "Challan issued, unpaid" },
  { value: "CANCELLED", label: "Cancelled" },
];
const DUE_PRESETS = [
  "Late student-enrolment fee: 2026 intake",
  "Annual return late-filing fee, 2026",
  "Inspection re-visit fee",
  "Arrears: balance of a previous fee",
  "Certificate re-issue fee",
];

const sum = (xs: { amount: number }[]) => xs.reduce((a, x) => a + x.amount, 0);
const day = (p: Payment) => (p.paidAt ?? p.createdAt).slice(0, 10);
function psidDiff(a: string | null, b: string) {
  if (!a || a.length !== b.length) return 99;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

function Tile({ onClick, testId, ...p }: Parameters<typeof StatCard>[0] & { onClick: () => void; testId: string }) {
  return (
    <div role="button" tabIndex={0} data-testid={testId} onClick={onClick} onKeyDown={(e) => (e.key === "Enter" ? onClick() : null)} style={{ height: "100%", cursor: "pointer" }}>
      <StatCard compact clickable {...p} />
    </div>
  );
}

export default function AccountsView(p: { canManage: boolean; initialTab?: string; initialStatus?: string; institutions: { code: string; name: string; shortCode: string }[]; payments: Payment[]; statements: Statement[]; lines: Line[]; dues: Due[] }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const { withOtp, otpModal } = useOtp();
  const [tab, setTab] = useState(["ledger", "statement", "dues"].includes(p.initialTab ?? "") ? p.initialTab! : "ledger");
  const [status, setStatus] = useState(STATUS_FILTERS.some((s) => s.value === p.initialStatus) ? p.initialStatus! : "ALL");
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [inst, setInst] = useState<string | undefined>();
  const [purpose, setPurpose] = useState<string | undefined>();
  const [dueFilter, setDueFilter] = useState("Outstanding");
  const [matching, setMatching] = useState<Line | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [matchNote, setMatchNote] = useState("");
  const [ignoring, setIgnoring] = useState<Line | null>(null);
  const [ignoreNote, setIgnoreNote] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [waiving, setWaiving] = useState<Due | null>(null);
  const [waiveNote, setWaiveNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [dueForm] = Form.useForm();

  const toast = (r: ActionResult) => message[r.ok ? (r.level === "warning" ? "warning" : "success") : "error"](r.message, r.ok ? 4 : 6);
  const run = (fn: () => Promise<ActionResult>, after?: (r: ActionResult) => void) =>
    start(async () => {
      try {
        const r = await fn();
        toast(r);
        after?.(r);
        router.refresh();
      } catch (e) {
        message.error(e instanceof Error ? e.message : "Something went wrong. Try again.");
      }
    });

  // ---------- Ledger ----------
  const from = range?.[0]?.format("YYYY-MM-DD");
  const to = range?.[1]?.format("YYYY-MM-DD");
  const ledger = useMemo(
    () =>
      p.payments.filter(
        (x) =>
          (status === "ALL" || x.status === status || (status === "COLLECTED" && (x.status === "PAID" || x.status === "RECONCILED"))) &&
          (!from || day(x) >= from) &&
          (!to || day(x) <= to) &&
          (!inst || x.institutionCode === inst) &&
          (!purpose || x.category === purpose),
      ),
    [p.payments, status, from, to, inst, purpose],
  );
  const categories = [...new Set(p.payments.map((x) => x.category))].sort();
  const collected = p.payments.filter((x) => x.status === "PAID" || x.status === "RECONCILED");
  const awaiting = p.payments.filter((x) => x.status === "PAID");
  const reconciled = p.payments.filter((x) => x.status === "RECONCILED");
  const pendingChallans = p.payments.filter((x) => x.status === "PENDING");
  const unmatched = p.lines.filter((l) => l.status === "UNMATCHED");
  const outstanding = p.dues.filter((d) => d.status === "OUTSTANDING");
  const blocked = [...new Set(outstanding.map((d) => d.institutionCode))];

  const openLedger = (s: string) => {
    setTab("ledger");
    setStatus(s);
    setRange(null);
    setInst(undefined);
    setPurpose(undefined);
  };

  // ---------- Manual match ----------
  const candidates = useMemo(() => {
    if (!matching) return [];
    return p.payments
      .filter((x) => x.status === "PAID" || x.status === "PENDING")
      .map((x) => ({ ...x, same: x.amount === matching.amount, diff: psidDiff(matching.psid, x.psid) }))
      .sort((a, b) => Number(b.same) - Number(a.same) || a.diff - b.diff || (b.paidAt ?? "").localeCompare(a.paidAt ?? ""));
  }, [matching, p.payments]);
  const startMatch = (l: Line) => {
    setMatching(l);
    setMatchNote("");
    const best = p.payments
      .filter((x) => (x.status === "PAID" || x.status === "PENDING") && x.amount === l.amount)
      .map((x) => ({ x, d: psidDiff(l.psid, x.psid) }))
      .sort((a, b) => a.d - b.d)[0];
    setPick(best && best.d <= 3 ? best.x.id : null);
  };

  const groupedDues = useMemo(() => {
    const by = new Map<string, Due[]>();
    for (const d of outstanding) by.set(d.institutionCode, [...(by.get(d.institutionCode) ?? []), d]);
    return [...by.entries()].map(([code, ds]) => ({
      code,
      name: ds[0].institutionName,
      short: ds[0].institutionShort,
      dues: ds,
      amount: sum(ds),
      oldest: ds.map((d) => d.dueDate).sort()[0],
    }));
  }, [outstanding]);

  const dueRows = p.dues.filter((d) => dueFilter === "All" || DUE_STATUS[d.status]?.label === dueFilter);
  const startWaive = (d: Due) => {
    setWaiving(d);
    setWaiveNote("");
  };

  const ledgerQuery = filtersToQuery({ status: status === "ALL" ? undefined : status, from, to, institution: inst, purpose });

  return (
    <>
      {otpModal}
      <style>{`.acc-candidates .ant-table-row-selected > td { background: #e8f3ee !important; }`}</style>
      <PageTitle
        eyebrow="Finance"
        title="Payments & reconciliation"
        sub="Every fee paid by Raast or PSID challan, with its automatic receipt. Match the bank statement to close each payment, and keep the dues that block submissions in view."
        extra={
          p.canManage ? (
            <Button type="primary" icon={<BankOutlined />} onClick={() => setTab("statement")}>
              Import bank statement
            </Button>
          ) : (
            <span className="muted" style={{ fontSize: 13 }}>View only. The Accounts officer reconciles and manages dues.</span>
          )
        }
      />

      <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
        <Col xs={12} md={8} xl={4}>
          <Tile testId="kpi-collected" onClick={() => openLedger("COLLECTED")} label="Collected" value={formatPKR(sum(collected))} icon={<WalletOutlined />} hint={`${collected.length} receipts issued`} />
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Tile testId="kpi-awaiting" onClick={() => openLedger("PAID")} label="Awaiting reconciliation" value={awaiting.length} tone="info" icon={<ClockCircleOutlined />} hint={formatPKR(sum(awaiting))} />
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Tile testId="kpi-reconciled" onClick={() => openLedger("RECONCILED")} label="Reconciled" value={reconciled.length} icon={<CheckCircleFilled />} hint={formatPKR(sum(reconciled))} />
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Tile testId="kpi-pending" onClick={() => openLedger("PENDING")} label="Unpaid challans" value={pendingChallans.length} tone="gold" icon={<FileSearchOutlined />} hint={formatPKR(sum(pendingChallans))} />
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Tile testId="kpi-unmatched" onClick={() => setTab("statement")} label="Unmatched bank lines" value={unmatched.length} tone={unmatched.length ? "warn" : "neutral"} icon={<ExclamationCircleOutlined />} hint={unmatched.length ? formatPKR(sum(unmatched)) : "All lines placed"} />
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Tile testId="kpi-dues" onClick={() => { setTab("dues"); setDueFilter("Outstanding"); }} label="Outstanding dues" value={formatPKR(sum(outstanding))} tone={outstanding.length ? "bad" : "neutral"} icon={<StopOutlined />} hint={`${blocked.length} institution${blocked.length === 1 ? "" : "s"} blocked`} />
        </Col>
      </Row>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "ledger",
            label: <span data-testid="tab-ledger">Payments ledger ({p.payments.length})</span>,
            children: (
              <Card styles={{ body: { padding: 0 } }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--line-2)" }}>
                  <Space wrap size={8}>
                    <Select aria-label="Status" value={status} onChange={setStatus} options={STATUS_FILTERS} style={{ width: 220 }} data-testid="ledger-status" />
                    <DatePicker.RangePicker value={range} onChange={(v) => setRange(v as [Dayjs | null, Dayjs | null] | null)} allowEmpty={[true, true]} format="D MMM YYYY" />
                    <Select
                      aria-label="Institution"
                      allowClear
                      placeholder="All institutions"
                      value={inst}
                      onChange={setInst}
                      showSearch={{ optionFilterProp: "label" }}
                      options={p.institutions.map((i) => ({ value: i.code, label: `${i.shortCode} · ${i.name}` }))}
                      style={{ width: 210 }}
                    />
                    <Select aria-label="Purpose" allowClear placeholder="All purposes" value={purpose} onChange={setPurpose} options={categories.map((c) => ({ value: c, label: c }))} style={{ width: 170 }} />
                  </Space>
                  <span style={{ marginLeft: "auto" }}>
                    <ExportButtons base="/api/reports/payments" query={ledgerQuery} testId="export-payments" />
                  </span>
                </div>
                <div data-testid="ledger-totals" style={{ display: "flex", gap: 28, flexWrap: "wrap", padding: "12px 18px", borderBottom: "1px solid var(--line-2)", background: "#fafbfa", fontSize: 13 }}>
                  <span>
                    <span className="muted">Collected </span>
                    <b className="tnum">{formatPKR(sum(ledger.filter((x) => x.status === "PAID" || x.status === "RECONCILED")))}</b>
                  </span>
                  <span>
                    <span className="muted">Reconciled </span>
                    <b className="tnum" style={{ color: "#0d7a3d" }}>{formatPKR(sum(ledger.filter((x) => x.status === "RECONCILED")))}</b>
                  </span>
                  <span>
                    <span className="muted">Paid, not reconciled </span>
                    <b className="tnum" style={{ color: "#1d5fb0" }}>{formatPKR(sum(ledger.filter((x) => x.status === "PAID")))}</b>
                  </span>
                  <span>
                    <span className="muted">Pending (unpaid challans) </span>
                    <b className="tnum" style={{ color: "#a15c00" }}>{formatPKR(sum(ledger.filter((x) => x.status === "PENDING")))}</b>
                  </span>
                  <span className="faint">{ledger.length} of {p.payments.length} payments</span>
                </div>
                <Table
                  rowKey="id"
                  dataSource={ledger}
                  pagination={{ pageSize: 15, hideOnSinglePage: true, showSizeChanger: false }}
                  data-testid="ledger-table"
                  scroll={{ x: true }}
                  locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No payments match these filters" /> }}
                  columns={[
                    {
                      title: "Receipt",
                      dataIndex: "receiptNo",
                      render: (v, r) => (
                        <span>
                          {v ? <span className="mono" style={{ fontWeight: 600, fontSize: 12.5 }}>{v}</span> : <span className="faint">No receipt yet</span>}
                          <div className="faint mono" style={{ fontSize: 11 }}>PSID {r.psid}</div>
                        </span>
                      ),
                    },
                    { title: "Institution", dataIndex: "institutionName", render: (v, r) => <span><span style={{ fontWeight: 500 }}>{r.institutionShort}</span><div className="faint" style={{ fontSize: 12, maxWidth: 220 }}>{v}</div></span> },
                    {
                      title: "Purpose",
                      dataIndex: "purpose",
                      render: (v: string, r) => (
                        <span style={{ display: "block", maxWidth: 300 }}>
                          <b style={{ fontWeight: 500 }}>{r.category}</b>
                          <div className="faint" style={{ fontSize: 12 }}>
                            {v.split(" · ").slice(1).join(" · ")}
                          </div>
                        </span>
                      ),
                    },
                    { title: "Amount", dataIndex: "amount", align: "right", sorter: (a, b) => a.amount - b.amount, render: (v) => <b className="tnum" style={{ whiteSpace: "nowrap" }}>{formatPKR(v)}</b> },
                    { title: "Status", dataIndex: "status", render: (v) => <StatusDot tone={PAY_STATUS[v]?.tone ?? "neutral"}>{PAY_STATUS[v]?.label ?? v}</StatusDot> },
                    { title: "Paid", dataIndex: "paidAt", sorter: (a, b) => (a.paidAt ?? "").localeCompare(b.paidAt ?? ""), render: (v, r) => (v ? <span style={{ whiteSpace: "nowrap" }}>{fmtDate(v)}<div className="faint" style={{ fontSize: 12 }}>{METHOD[r.method ?? ""] ?? r.method}</div></span> : <span className="faint" style={{ whiteSpace: "nowrap" }}>Issued {fmtDate(r.createdAt)}</span>) },
                    { title: "Reconciled", dataIndex: "reconciledAt", render: (v, r) => (v ? <span style={{ whiteSpace: "nowrap" }}>{fmtDate(v)}<div className="faint" style={{ fontSize: 12 }}>by {r.reconciledBy}</div></span> : <span className="faint">-</span>) },
                    {
                      title: "",
                      key: "receipt",
                      align: "right",
                      render: (_, r) =>
                        r.receiptDocumentId ? (
                          <a href={`/api/documents/${r.receiptDocumentId}`} target="_blank" rel="noreferrer" data-testid={`receipt-${r.receiptNo}`} style={{ whiteSpace: "nowrap" }}>
                            <FilePdfOutlined /> Receipt
                          </a>
                        ) : null,
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: "statement",
            label: (
              <span data-testid="tab-statement">
                Bank statement{unmatched.length ? <Tag color="orange" style={{ marginLeft: 6 }}>{unmatched.length} unmatched</Tag> : null}
              </span>
            ),
            children: (
              <div style={{ display: "grid", gap: 16 }}>
                {p.canManage ? (
                  <Card
                    title={
                      <span>
                        <BankOutlined style={{ color: "var(--brand)", marginRight: 8 }} />
                        Import bank statement
                      </span>
                    }
                  >
                    <Row gutter={[16, 12]} align="middle">
                      <Col xs={24} lg={13}>
                        <div style={{ fontSize: 13.5, color: "var(--ink-2)" }}>
                          The sponsor bank sends a settlement statement each day. On import the portal matches each credit to a challan by <b>PSID and amount</b>; every match marks the payment reconciled. Credits it cannot place wait for you below.
                        </div>
                        <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>Demo: no bank is contacted. Today&apos;s statement is generated from the challans paid so far.</div>
                      </Col>
                      <Col xs={24} lg={11}>
                        <Space wrap>
                          <Button type="primary" icon={<ThunderboltOutlined />} loading={pending} onClick={() => run(() => generateTodaysStatement())}>
                            Generate today&apos;s statement
                          </Button>
                          <Upload
                            accept=".csv,text/csv"
                            showUploadList={false}
                            beforeUpload={(file) => {
                              Papa.parse<Record<string, string>>(file, {
                                header: true,
                                skipEmptyLines: true,
                                complete: (res) => run(() => importStatementCsv(file.name, res.data)),
                                error: () => message.error("That file could not be read as CSV. Save it as CSV (comma separated) and try again."),
                              });
                              return false;
                            }}
                          >
                            <Button icon={<CloudUploadOutlined />} data-testid="upload-csv">Upload CSV statement</Button>
                          </Upload>
                          <Button type="link" href="/api/accounts/sample-statement" icon={<DownloadOutlined />} style={{ paddingInline: 4 }}>
                            Sample CSV
                          </Button>
                        </Space>
                      </Col>
                    </Row>
                  </Card>
                ) : null}

                <Card
                  data-testid="unmatched-card"
                  title={
                    <span>
                      <ExclamationCircleOutlined style={{ color: unmatched.length ? "#d48806" : "var(--brand)", marginRight: 8 }} />
                      Unmatched lines ({unmatched.length})
                    </span>
                  }
                  extra={<span className="faint" style={{ fontSize: 12.5 }}>Match each by hand or ignore it with a note</span>}
                  styles={{ body: { padding: unmatched.length ? 0 : 16 } }}
                >
                  {unmatched.length ? (
                    <Table
                      rowKey="id"
                      dataSource={unmatched}
                      pagination={false}
                      scroll={{ x: true }}
                      columns={[
                        { title: "Statement", dataIndex: "statementRef", render: (v, r) => <span><span className="mono">{v ?? "-"}</span><div className="faint" style={{ fontSize: 12 }}>{fmtDate(r.statementDate)}</div></span> },
                        { title: "Bank reference", dataIndex: "bankRef", render: (v, r) => <span><span className="mono">{v}</span><div className="faint" style={{ fontSize: 12 }}>{CHANNEL[r.channel] ?? r.channel}</div></span> },
                        { title: "PSID quoted", dataIndex: "psid", render: (v) => (v ? <span className="mono">{v}</span> : <span className="faint">None</span>) },
                        { title: "Amount", dataIndex: "amount", align: "right", render: (v) => <b className="tnum">{formatPKR(v)}</b> },
                        { title: "Why it did not match", dataIndex: "reason", render: (v, r) => <span style={{ display: "block", maxWidth: 340, fontSize: 13 }}>{v}<div className="faint mono" style={{ fontSize: 11 }}>{r.narration}</div></span> },
                        {
                          title: "",
                          key: "act",
                          align: "right",
                          render: (_, r) =>
                            p.canManage ? (
                              <Space>
                                <Button size="small" type="primary" onClick={() => startMatch(r)}>
                                  Match by hand
                                </Button>
                                <Button size="small" onClick={() => { setIgnoring(r); setIgnoreNote(""); }}>
                                  Ignore
                                </Button>
                              </Space>
                            ) : null,
                        },
                      ]}
                    />
                  ) : (
                    <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 14px", borderRadius: 12, background: "var(--good-50)", color: "#0d7a3d" }}>
                      <CheckCircleFilled style={{ fontSize: 20 }} />
                      <span>Every line on the imported statements is matched or ignored.</span>
                    </div>
                  )}
                </Card>

                <Card title="Imported statements" styles={{ body: { padding: 0 } }}>
                  <Table
                    rowKey="id"
                    dataSource={p.statements}
                    pagination={false}
                    data-testid="statements-table"
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No statement imported yet" /> }}
                    expandable={{
                      expandedRowRender: (s) => (
                        <Table
                          size="small"
                          rowKey="id"
                          pagination={false}
                          dataSource={p.lines.filter((l) => l.statementId === s.id)}
                          columns={[
                            { title: "Bank reference", dataIndex: "bankRef", render: (v) => <span className="mono">{v}</span> },
                            { title: "PSID quoted", dataIndex: "psid", render: (v) => (v ? <span className="mono">{v}</span> : <span className="faint">None</span>) },
                            { title: "Amount", dataIndex: "amount", align: "right", render: (v) => <span className="tnum">{formatPKR(v)}</span> },
                            { title: "Result", dataIndex: "status", render: (v, l) => <StatusDot tone={LINE_STATUS[v]?.tone ?? "neutral"}>{`${LINE_STATUS[v]?.label ?? v}${l.matchType === "MANUAL" ? " by hand" : l.matchType === "AUTO" ? " automatically" : ""}`}</StatusDot> },
                            {
                              title: "Detail",
                              key: "d",
                              render: (_, l) =>
                                l.status === "MATCHED" ? (
                                  <span>
                                    Receipt <span className="mono">{l.matchedReceipt}</span>
                                    {l.resolvedBy ? <span className="faint"> · {l.resolvedBy}{l.note ? `: ${l.note}` : ""}</span> : null}
                                  </span>
                                ) : l.status === "IGNORED" ? (
                                  <span className="muted">{l.resolvedBy}: {l.note}</span>
                                ) : (
                                  <span className="muted">{l.reason}</span>
                                ),
                            },
                          ]}
                        />
                      ),
                    }}
                    columns={[
                      { title: "Statement", dataIndex: "ref", render: (v, s) => <span><span className="mono" style={{ fontWeight: 600 }}>{v}</span><div className="faint" style={{ fontSize: 12 }}>Value date {fmtDate(s.statementDate)}</div></span> },
                      { title: "Source", dataIndex: "source", render: (v, s) => (v === "DEMO" ? "Generated (demo bank)" : <span>CSV <span className="mono faint">{s.fileName}</span></span>) },
                      { title: "Lines", dataIndex: "lineCount", align: "right" },
                      { title: "Matched", dataIndex: "matched", align: "right", render: (v) => <b style={{ color: "#0d7a3d" }}>{v}</b> },
                      { title: "Unmatched", dataIndex: "unmatched", align: "right", render: (v) => <b style={{ color: v ? "#a15c00" : "var(--faint)" }}>{v}</b> },
                      { title: "Ignored", dataIndex: "ignored", align: "right", render: (v) => <span className="faint">{v}</span> },
                      { title: "Imported", dataIndex: "createdAt", render: (v, s) => <span>{fmtDate(v, true)}<div className="faint" style={{ fontSize: 12 }}>by {s.importedBy}</div></span> },
                    ]}
                  />
                </Card>
              </div>
            ),
          },
          {
            key: "dues",
            label: (
              <span data-testid="tab-dues">
                Dues{outstanding.length ? <Tag color="red" style={{ marginLeft: 6 }}>{outstanding.length} outstanding</Tag> : null}
              </span>
            ),
            children: (
              <div style={{ display: "grid", gap: 16 }}>
                <Card
                  title={
                    <span>
                      <StopOutlined style={{ color: "#b4141f", marginRight: 8 }} />
                      Outstanding dues by institution
                    </span>
                  }
                  extra={
                    p.canManage ? (
                      <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => {
                          dueForm.resetFields();
                          setAddOpen(true);
                        }}
                      >
                        Add a due
                      </Button>
                    ) : null
                  }
                  styles={{ body: { padding: groupedDues.length ? 0 : 16 } }}
                >
                  {groupedDues.length ? (
                    <>
                      <div className="muted" style={{ fontSize: 13, padding: "12px 18px", borderBottom: "1px solid var(--line-2)" }}>
                        An institution with an outstanding due cannot submit a new application until the due is paid or waived (guide section 4).
                      </div>
                      <Table
                        rowKey="code"
                        pagination={false}
                        dataSource={groupedDues}
                        data-testid="outstanding-table"
                        expandable={{
                          expandedRowKeys: groupedDues.map((g) => g.code),
                          showExpandColumn: false,
                          expandedRowRender: (g) => (
                            <div style={{ display: "grid", gap: 8 }}>
                              {g.dues.map((d) => (
                                <div key={d.id} data-testid={`due-${d.ref}`} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 10, background: "#fff" }}>
                                  <span className="mono" style={{ fontWeight: 600 }}>{d.ref}</span>
                                  <span style={{ flex: 1, minWidth: 220 }}>{d.description}</span>
                                  <b className="tnum">{formatPKR(d.amount)}</b>
                                  <span className={dayjs(d.dueDate).isBefore(dayjs(), "day") ? "" : "faint"} style={{ color: dayjs(d.dueDate).isBefore(dayjs(), "day") ? "#b4141f" : undefined, fontSize: 12.5 }}>
                                    due {fmtDate(d.dueDate)}
                                    {dayjs(d.dueDate).isBefore(dayjs(), "day") ? " · overdue" : ""}
                                  </span>
                                  {d.challanStatus === "PENDING" ? <Tag color="blue">Challan issued</Tag> : null}
                                  {p.canManage ? (
                                    <Button size="small" onClick={() => startWaive(d)}>
                                      Waive
                                    </Button>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ),
                        }}
                        columns={[
                          { title: "Institution", dataIndex: "name", render: (v, g) => <span><span style={{ fontWeight: 500 }}>{v}</span><div className="faint mono" style={{ fontSize: 11.5 }}>{g.code}</div></span> },
                          { title: "Dues", key: "n", align: "right", render: (_, g) => g.dues.length },
                          { title: "Amount", dataIndex: "amount", align: "right", render: (v) => <b className="tnum">{formatPKR(v)}</b> },
                          { title: "Oldest due date", dataIndex: "oldest", render: (v) => fmtDate(v) },
                          { title: "Submissions", key: "s", render: () => <StatusDot tone="bad">Blocked until paid or waived</StatusDot> },
                        ]}
                      />
                    </>
                  ) : (
                    <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 14px", borderRadius: 12, background: "var(--good-50)", color: "#0d7a3d" }}>
                      <CheckCircleFilled style={{ fontSize: 20 }} />
                      <span>No outstanding dues. No institution is blocked from submitting.</span>
                    </div>
                  )}
                </Card>

                <Card title="All dues" extra={<Segmented value={dueFilter} onChange={(v) => setDueFilter(String(v))} options={["Outstanding", "Paid", "Waived", "All"]} />} styles={{ body: { padding: 0 } }}>
                  <Table
                    rowKey="id"
                    dataSource={dueRows}
                    pagination={{ pageSize: 15, hideOnSinglePage: true, showSizeChanger: false }}
                    data-testid="dues-table"
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`No ${dueFilter === "All" ? "" : dueFilter.toLowerCase() + " "}dues`} /> }}
                    columns={[
                      { title: "Due", dataIndex: "ref", render: (v, d) => <span><span className="mono" style={{ fontWeight: 600 }}>{v}</span><div className="faint" style={{ fontSize: 12 }}>raised {fmtDate(d.createdAt)}</div></span> },
                      { title: "Institution", dataIndex: "institutionShort", render: (v, d) => <Tooltip title={d.institutionName}><span style={{ fontWeight: 500 }}>{v}</span></Tooltip> },
                      { title: "Description", dataIndex: "description", render: (v) => <span style={{ display: "block", maxWidth: 340 }}>{v}</span> },
                      { title: "Amount", dataIndex: "amount", align: "right", render: (v) => <b className="tnum">{formatPKR(v)}</b> },
                      { title: "Due date", dataIndex: "dueDate", render: (v) => fmtDate(v) },
                      { title: "Status", dataIndex: "status", render: (v) => <StatusDot tone={DUE_STATUS[v]?.tone ?? "neutral"}>{DUE_STATUS[v]?.label ?? v}</StatusDot> },
                      {
                        title: "Outcome",
                        key: "o",
                        render: (_, d) =>
                          d.status === "WAIVED" ? (
                            <span style={{ display: "block", maxWidth: 300, fontSize: 12.5 }}>
                              <span className="muted">By {d.waivedBy}:</span> {d.note}
                            </span>
                          ) : d.status === "PAID" ? (
                            d.receiptDocumentId ? (
                              <a href={`/api/documents/${d.receiptDocumentId}`} target="_blank" rel="noreferrer">
                                <FilePdfOutlined /> {d.receiptNo}
                              </a>
                            ) : (
                              d.receiptNo
                            )
                          ) : p.canManage ? (
                            <Button size="small" onClick={() => startWaive(d)}>
                              Waive
                            </Button>
                          ) : (
                            <span className="faint">Awaiting payment</span>
                          ),
                      },
                    ]}
                  />
                </Card>
              </div>
            ),
          },
        ]}
      />

      {/* Manual match */}
      <Modal
        open={!!matching}
        width={860}
        title="Match a bank line by hand"
        okText="Match and reconcile"
        okButtonProps={{ disabled: !pick }}
        onCancel={() => setMatching(null)}
        onOk={() =>
          matching &&
          pick &&
          withOtp(`reconcile:line-${matching.id}`, "Confirm the manual match", async (code) => {
            const r = await matchLine(matching.id, pick, matchNote, code);
            toast(r);
            if (r.ok) setMatching(null);
            router.refresh();
          })
        }
        destroyOnHidden
      >
        {matching ? (
          <>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", padding: "10px 14px", borderRadius: 10, background: "#fafbfa", border: "1px solid var(--line)", marginBottom: 12, fontSize: 13 }}>
              <span>
                <span className="muted">Bank reference </span>
                <span className="mono">{matching.bankRef}</span>
              </span>
              <span>
                <span className="muted">PSID quoted </span>
                <span className="mono">{matching.psid ?? "none"}</span>
              </span>
              <span>
                <span className="muted">Amount </span>
                <b>{formatPKR(matching.amount)}</b>
              </span>
              <span className="faint mono" style={{ fontSize: 11.5 }}>{matching.narration}</span>
            </div>
            <div className="pcp-section-title" style={{ marginBottom: 8 }}>Pick the challan this credit pays</div>
            <Table
              size="small"
              rowKey="id"
              pagination={{ pageSize: 6, hideOnSinglePage: true, showSizeChanger: false }}
              dataSource={candidates}
              className="acc-candidates"
              data-testid="match-candidates"
              rowSelection={{ type: "radio", selectedRowKeys: pick ? [pick] : [], onChange: (keys) => setPick(Number(keys[0])) }}
              onRow={(r) => ({ onClick: () => setPick(r.id), style: { cursor: "pointer" } })}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No paid or pending challan is waiting for reconciliation" /> }}
              columns={[
                { title: "PSID", dataIndex: "psid", render: (v, r) => <span><span className="mono">{v}</span><div className="faint" style={{ fontSize: 11.5 }}>{r.receiptNo ?? "No receipt yet"}</div></span> },
                { title: "Institution", dataIndex: "institutionShort" },
                { title: "Purpose", dataIndex: "category" },
                { title: "Amount", dataIndex: "amount", align: "right", render: (v) => <span className="tnum">{formatPKR(v)}</span> },
                {
                  title: "Fit",
                  key: "fit",
                  render: (_, r) => (
                    <Space size={4} wrap>
                      {r.same ? <Tag color="green">Same amount</Tag> : <Tag>Different amount</Tag>}
                      {r.diff > 0 && r.diff <= 3 ? <Tag color="gold">PSID differs in {r.diff} digit{r.diff === 1 ? "" : "s"}</Tag> : null}
                      {r.status === "PENDING" ? <Tag color="blue">Unpaid: matching confirms it</Tag> : null}
                    </Space>
                  ),
                },
              ]}
            />
            <Input.TextArea style={{ marginTop: 12 }} rows={2} placeholder="Note for the record (optional), e.g. branch keyed two PSID digits the wrong way round" value={matchNote} onChange={(e) => setMatchNote(e.target.value)} maxLength={300} />
            <Alert style={{ marginTop: 10 }} type="info" showIcon title="Amounts must agree. A part or excess credit is not matched: ignore it and raise a due or a refund instead." />
          </>
        ) : null}
      </Modal>

      {/* Ignore a line */}
      <Modal
        open={!!ignoring}
        title="Ignore this bank line"
        okText="Ignore line"
        okButtonProps={{ disabled: ignoreNote.trim().length < 5, loading: pending }}
        onCancel={() => setIgnoring(null)}
        onOk={() => ignoring && run(() => ignoreStatementLine(ignoring.id, ignoreNote), (r) => r.ok && setIgnoring(null))}
        destroyOnHidden
      >
        <p style={{ marginTop: 0 }}>
          <span className="mono">{ignoring?.bankRef}</span> · {formatPKR(ignoring?.amount ?? 0)} · {ignoring?.narration}
        </p>
        <Input.TextArea rows={3} placeholder="Why it is ignored, e.g. not a PCP fee; refunded to the depositor on 7 Oct" value={ignoreNote} onChange={(e) => setIgnoreNote(e.target.value)} maxLength={300} />
      </Modal>

      {/* Add a due */}
      <Modal
        open={addOpen}
        title="Add a due"
        okText="Add due"
        confirmLoading={busy}
        onCancel={() => setAddOpen(false)}
        onOk={async () => {
          const v = await dueForm.validateFields();
          setBusy(true);
          try {
            const r = await addDue({ ...v, dueDate: (v.dueDate as Dayjs).format("YYYY-MM-DD") });
            toast(r);
            if (r.ok) setAddOpen(false);
            router.refresh();
          } finally {
            setBusy(false);
          }
        }}
        destroyOnHidden
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8 }}>
          <span className="muted" style={{ fontSize: 13 }}>The institution is told at once. Until the due is paid or waived it cannot submit new applications.</span>
          <FillDemo
            onClick={() =>
              dueForm.setFieldsValue({
                institutionCode: "PCP-UNI-000101",
                description: "Late student-enrolment fee: 2026 intake, 6 students enrolled after the deadline",
                amount: 30000,
                dueDate: dayjs().add(30, "day"),
              })
            }
          />
        </div>
        <Form form={dueForm} layout="vertical" requiredMark={false}>
          <Form.Item name="institutionCode" label="Institution" rules={[{ required: true, message: "Pick the institution" }]}>
            <Select showSearch={{ optionFilterProp: "label" }} placeholder="Pick an institution" options={p.institutions.map((i) => ({ value: i.code, label: `${i.shortCode} · ${i.name}` }))} />
          </Form.Item>
          <Form.Item name="description" label="What it is for" rules={[{ required: true, min: 5, message: "Describe the due" }]}>
            <AutoComplete options={DUE_PRESETS.map((v) => ({ value: v }))} placeholder="e.g. Late student-enrolment fee: 2026 intake" filterOption={(i, o) => String(o?.value ?? "").toLowerCase().includes(i.toLowerCase())} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="amount" label="Amount (Rs)" rules={[{ required: true, type: "number", min: 100, message: "At least Rs 100" }]}>
                <InputNumber style={{ width: "100%" }} min={100} step={1000} formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")} parser={(v) => Number((v ?? "").replace(/,/g, "")) as 100} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="dueDate" label="Due date" rules={[{ required: true, message: "Pick a due date" }]}>
                <DatePicker style={{ width: "100%" }} format="D MMM YYYY" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* Waive a due */}
      <Modal
        open={!!waiving}
        title={`Waive ${waiving?.ref ?? ""}`}
        okText="Waive due"
        okButtonProps={{ danger: true, disabled: waiveNote.trim().length < 10 }}
        onCancel={() => setWaiving(null)}
        onOk={() =>
          waiving &&
          withOtp(`waive:${waiving.ref}`, `Waive ${formatPKR(waiving.amount)} for ${waiving.institutionShort}`, async (code) => {
            const r = await waiveDue(waiving.id, waiveNote, code);
            toast(r);
            if (r.ok) setWaiving(null);
            router.refresh();
          })
        }
        destroyOnHidden
      >
        {waiving ? (
          <>
            <p style={{ marginTop: 0 }}>
              <b>{waiving.institutionName}</b>: {waiving.description}, <b>{formatPKR(waiving.amount)}</b>, due {fmtDate(waiving.dueDate)}.
            </p>
            <Input.TextArea rows={3} placeholder="Reason for the waiver, e.g. Council decision CM-2026-07 item 4" value={waiveNote} onChange={(e) => setWaiveNote(e.target.value)} maxLength={500} data-testid="waive-note" />
            <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>The note is kept with the due and sent to the institution. A waiver needs a one-time code.</div>
          </>
        ) : null}
      </Modal>
    </>
  );
}
