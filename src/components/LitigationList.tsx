"use client";
// Court case ledger: every case PCP is party to, its next hearing and any stay order in force.
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Card, Col, DatePicker, Empty, Form, Input, Modal, Row, Segmented, Select, Table } from "antd";
import { BankOutlined, CalendarOutlined, CheckCircleOutlined, ExceptionOutlined, PlusOutlined, StopOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { createCourtCase } from "@/app/actions/litigation";
import type { loadCourtCases } from "@/lib/governance-data";
import { NATURE_LABELS } from "@/lib/governance-shared";
import { PageTitle, StatCard, fmtDate } from "./common";
import { FillDemo } from "./demo-helpers";
import { CourtStatus, ExportButtons, openCaseOf, RefLink, relDays } from "./GovParts";
import ScreenGuide from "./ScreenGuide";

type Data = Awaited<ReturnType<typeof loadCourtCases>>;
type Options = { institutions: { id: number; name: string; code: string; shortCode: string }[]; refs: { ref: string; kind: string; institutionId: number | null; label: string }[] } | null;

function NewCaseModal({ courts, options, onClose }: { courts: string[]; options: NonNullable<Options>; onClose: () => void }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm();
  const [pending, start] = useTransition();
  const instId = Form.useWatch("institutionId", form) as number | undefined;
  const refs = options.refs.filter((r) => !instId || r.institutionId === instId);

  const demo = () => {
    const bvu = options.institutions.find((i) => i.shortCode === "BVU") ?? options.institutions[0];
    const ref = openCaseOf(options.refs, bvu.id);
    form.setFieldsValue({
      court: "Islamabad High Court",
      caseNumber: `WP ${1200 + Math.floor(Math.random() * 700)}/2026`,
      petitioner: bvu.name,
      respondent: "Pharmacy Council of Pakistan",
      nature: "WRIT",
      institutionId: bvu.id,
      linkedRef: ref,
      counsel: "Barrister Saad Hashmi",
      counselEmail: "saad.hashmi@example.com",
      filedDate: dayjs().subtract(6, "day"),
      summary: "The petitioner challenges the inspection findings behind the pending NOC case and asks the court to restrain the council from deciding it until a fresh inspection.",
      hearingDate: dayjs().add(5, "day"),
      bench: "Justice S. Kazmi",
      purpose: "Notice to respondents and interim relief",
    });
  };

  const submit = (v: Record<string, unknown>) =>
    start(async () => {
      const d = (x: unknown) => (x ? dayjs(x as string).format("YYYY-MM-DD") : null);
      const r = await createCourtCase({ ...v, filedDate: d(v.filedDate), hearingDate: d(v.hearingDate), institutionId: v.institutionId ?? null, linkedRef: v.linkedRef ?? null });
      message[r.ok ? "success" : "error"](r.message, r.ok ? 4 : 8);
      if (r.ok && r.ref) router.push(`/pcp/litigation/${r.ref}`);
    });

  return (
    <Modal
      open
      width={760}
      title={
        <span>
          <ExceptionOutlined style={{ color: "var(--brand)", marginRight: 8 }} />
          New court case
        </span>
      }
      okText="Add to the ledger"
      confirmLoading={pending}
      onOk={() => form.submit()}
      onCancel={onClose}
      destroyOnHidden
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span className="muted" style={{ fontSize: 13 }}>The ledger reference (LIT-year-number) is assigned when you add it.</span>
        <FillDemo onClick={demo} />
      </div>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={submit} initialValues={{ respondent: "Pharmacy Council of Pakistan", nature: "WRIT", filedDate: dayjs() }}>
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="court" label="Court" rules={[{ required: true, message: "Choose the court." }]}>
              <Select id="lit-court" options={courts.map((c) => ({ value: c, label: c }))} placeholder="Choose the court" showSearch />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="caseNumber" label="Case number" rules={[{ required: true, message: "Enter the case number." }]}>
              <Input id="lit-number" placeholder="WP 1234/2026" />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="nature" label="Nature">
              <Select options={Object.entries(NATURE_LABELS).map(([value, label]) => ({ value, label }))} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="petitioner" label="Petitioner" rules={[{ required: true, message: "Name the petitioner." }]}>
              <Input placeholder="Who filed the case" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="respondent" label="Respondent" rules={[{ required: true, message: "Name the respondent." }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="institutionId" label="Linked institution" extra="Optional. Picks the cases below.">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="None"
                options={options.institutions.map((i) => ({ value: i.id, label: `${i.name} (${i.shortCode})` }))}
                onChange={() => form.setFieldValue("linkedRef", undefined)}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="linkedRef" label="Linked PCP decision or case" extra="A stay order recorded on this court case blocks council decisions on it.">
              <Select allowClear showSearch optionFilterProp="label" placeholder="None" options={refs.map((r) => ({ value: r.ref, label: `${r.ref} · ${r.label}` }))} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="counsel" label="PCP counsel" rules={[{ required: true, message: "Name PCP's counsel." }]}>
              <Input placeholder="Advocate's name" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="counselEmail" label="Counsel's email" extra="Hearing reminders go here.">
              <Input placeholder="name@example.com" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="filedDate" label="Filed on" rules={[{ required: true, message: "Pick the filing date." }]}>
              <DatePicker style={{ width: "100%" }} format="D MMM YYYY" disabledDate={(d) => d.isAfter(dayjs(), "day")} />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item name="summary" label="What the case is about">
              <Input.TextArea rows={2} placeholder="The relief sought and PCP's position" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="hearingDate" label="First hearing (optional)">
              <DatePicker style={{ width: "100%" }} format="D MMM YYYY" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="bench" label="Bench">
              <Input placeholder="Justice ..." />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="purpose" label="Fixed for">
              <Input placeholder="Notice, arguments, reply ..." />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}

export default function LitigationList({ data, canManage, options }: { data: Data; canManage: boolean; options: Options }) {
  const [scope, setScope] = useState<"open" | "closed" | "all">("open");
  const [court, setCourt] = useState<string | undefined>();
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const rows = useMemo(
    () =>
      data.cases.filter(
        (c) =>
          (scope === "all" || (scope === "open" ? c.open : !c.open)) &&
          (!court || c.court === court) &&
          (!q || `${c.ref} ${c.caseNumber} ${c.title} ${c.linkedRef ?? ""} ${c.counsel} ${c.inst?.name ?? ""}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [data.cases, scope, court, q],
  );

  return (
    <>
      <PageTitle
        eyebrow="Casework"
        title="Court cases"
        sub="The litigation ledger: every case PCP is party to, its hearings, counsel and orders. A stay order stops council decisions on the linked case until it is lifted."
        extra={
          <>
            <ScreenGuide
              title="Court cases"
              intro="The legal officer keeps this ledger. Each case is linked, where it applies, to the institution and the PCP decision or case it is about."
              steps={[
                "**New court case** enters a case with its court, case number, parties, counsel and the PCP case it is about. It gets a ledger reference (LIT-year-number).",
                "On the case, **Add hearing** lists a date. Reminders go to you and to counsel 7 days and 1 day before (in the portal and by email).",
                "After a hearing, **Record what happened** with the next date; the next hearing is listed for you.",
                "**Record an order** files the court's order. A **stay order** puts a red banner on the linked case and blocks council decisions on it until you **Lift the stay**.",
                "**Excel** and **PDF** export the ledger as shown.",
              ]}
              note={canManage ? undefined : "Only the legal officer and the Secretary change the ledger. You can read it."}
            />
            <ExportButtons href={`/api/governance/export?what=litigation&scope=${scope}`} />
            {canManage ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
                New court case
              </Button>
            ) : null}
          </>
        }
      />
      <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
        <Col xs={12} lg={6}>
          <StatCard label="Open cases" icon={<BankOutlined />} value={data.counts.open} hint="Pending, interim order or stay" />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard label="Stay orders in force" icon={<StopOutlined />} tone={data.counts.stays ? "bad" : "neutral"} value={data.counts.stays} hint="Council decisions blocked on the linked case" />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard label="Hearings this week" icon={<CalendarOutlined />} tone="violet" value={data.counts.hearingsWeek} hint="Next 7 days, reminders sent" />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard label="Disposed this year" icon={<CheckCircleOutlined />} tone="info" value={data.counts.disposedYear} hint="Decided or withdrawn" />
        </Col>
      </Row>

      {data.upcoming.length ? (
        <Card size="small" title="Hearings in the next 14 days" style={{ marginBottom: 16 }} data-testid="upcoming-hearings">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {data.upcoming.map((h) => (
              <Link key={`${h.ref}-${h.date}`} href={`/pcp/litigation/${h.ref}`} style={{ border: `1px solid ${h.stay ? "#f5b5b0" : "var(--line)"}`, borderRadius: 10, padding: "8px 12px", background: h.stay ? "#fff8f7" : "#fff", display: "inline-flex", flexDirection: "column", minWidth: 220 }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: "var(--ink)" }}>
                  {fmtDate(h.date)} <span className="faint" style={{ fontWeight: 400 }}>· {relDays(h.days)}</span>
                </span>
                <span className="mono" style={{ fontSize: 12.5 }}>
                  {h.court} {h.caseNumber}
                </span>
                <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{h.title.length > 48 ? `${h.title.slice(0, 46)}…` : h.title}</span>
                {h.bench ? <span className="faint" style={{ fontSize: 11.5 }}>{h.bench}</span> : null}
              </Link>
            ))}
          </div>
        </Card>
      ) : null}

      <Card
        styles={{ body: { padding: 0 } }}
        title={
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 0" }}>
            <Segmented
              value={scope}
              onChange={(v) => setScope(v as typeof scope)}
              options={[
                { value: "open", label: `Open (${data.cases.filter((c) => c.open).length})` },
                { value: "closed", label: "Disposed or withdrawn" },
                { value: "all", label: "All" },
              ]}
            />
            <Select allowClear placeholder="Any court" style={{ width: 220 }} value={court} onChange={setCourt} options={data.courts.map((c) => ({ value: c, label: c }))} />
            <Input.Search allowClear placeholder="Ref, case number, party, counsel" style={{ width: 280 }} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        }
      >
        <Table
          rowKey="ref"
          dataSource={rows}
          pagination={{ pageSize: 15, hideOnSinglePage: true }}
          locale={{ emptyText: <Empty description={canManage ? "No court cases here. Add one with New court case." : "No court cases here."} /> }}
          onRow={(r) => (r.stay ? { style: { background: "#fffafa" } } : {})}
          columns={[
            {
              title: "Case",
              dataIndex: "ref",
              render: (v, r) => (
                <Link href={`/pcp/litigation/${v}`} style={{ display: "inline-flex", flexDirection: "column" }} data-court={v}>
                  <span className="mono" style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap" }}>
                    {v}
                  </span>
                  <span style={{ color: "var(--ink)", fontSize: 13 }}>{r.title}</span>
                  <span className="faint" style={{ fontSize: 12 }}>{NATURE_LABELS[r.nature] ?? r.nature}</span>
                </Link>
              ),
            },
            {
              title: "Court",
              render: (_, r) => (
                <span style={{ display: "inline-flex", flexDirection: "column" }}>
                  <span>{r.court}</span>
                  <span className="mono faint" style={{ fontSize: 12 }}>
                    {r.caseNumber}
                  </span>
                </span>
              ),
            },
            {
              title: "Linked to",
              render: (_, r) =>
                r.linkedRef || r.inst ? (
                  <span style={{ display: "inline-flex", flexDirection: "column" }}>
                    {r.linkedRef ? <RefLink refNo={r.linkedRef} /> : null}
                    {r.inst ? <span className="faint" style={{ fontSize: 12 }}>{r.inst.shortCode}</span> : null}
                  </span>
                ) : (
                  <span className="faint">—</span>
                ),
            },
            { title: "Counsel", dataIndex: "counsel" },
            {
              title: "Next hearing",
              render: (_, r) =>
                r.nextHearing ? (
                  <span style={{ display: "inline-flex", flexDirection: "column" }}>
                    <span style={{ whiteSpace: "nowrap" }}>{fmtDate(r.nextHearing.date)}</span>
                    <span className="faint" style={{ fontSize: 12, color: r.nextHearing.days <= 7 ? "#5b3cc4" : undefined }}>
                      {relDays(r.nextHearing.days)}
                    </span>
                  </span>
                ) : (
                  <span className="faint">{r.open ? "Not listed" : "—"}</span>
                ),
              sorter: (a, b) => String(a.nextHearing?.date ?? "9").localeCompare(String(b.nextHearing?.date ?? "9")),
            },
            {
              title: "Status",
              render: (_, r) => (
                <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
                  <CourtStatus status={r.status} />
                  {r.stay ? <span style={{ fontSize: 11.5, color: "#b4141f", whiteSpace: "nowrap" }}>Stay until {r.stay.until ? fmtDate(r.stay.until) : "further orders"}</span> : null}
                </span>
              ),
            },
          ]}
        />
      </Card>
      {adding && options ? <NewCaseModal courts={data.courts} options={options} onClose={() => setAdding(false)} /> : null}
    </>
  );
}
