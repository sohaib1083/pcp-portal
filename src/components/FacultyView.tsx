"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Col, DatePicker, Drawer, Empty, Form, Input, Modal, Row, Segmented, Select, Table, Typography } from "antd";
import {
  AuditOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  ExperimentOutlined,
  IdcardOutlined,
  LinkOutlined,
  PlusOutlined,
  SafetyOutlined,
  SearchOutlined,
  SolutionOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import {
  addFaculty,
  confirmFacultyList,
  endFacultyLink,
  requestFacultyChange,
  requestFacultyLink,
  searchFaculty,
  withdrawLinkRequest,
  type AddFacultyResult,
  type FacultySearchResult,
  type FacultySuggestion,
} from "@/app/actions/faculty";
import { NADRA_RULE_TEXT, type IdentityBadge } from "@/lib/identity-shared";
import { CHANGE_KIND_LABELS, DESIGNATIONS, QUALIFICATIONS, SPECIALIZATIONS } from "@/lib/registry-shared";
import { Avatar, KV, PageTitle, Person, Pill, StatCard, fmtDate, programLabel } from "./common";
import { DEMO } from "./demo-helpers";
import NadraBadge, { NadraStatus } from "./NadraBadge";
import ScreenGuide from "./ScreenGuide";
import { ChangeLines, RegStatus, SectionLabel, useBusy } from "./registry-ui";

type Row = {
  linkId: number;
  facultyId: number;
  programType: string;
  linkStatus: string;
  startDate: string;
  endDate: string | null;
  pcpId: string;
  cnic: string;
  fullName: string;
  fatherName: string;
  qualification: string;
  specialization: string;
  designation: string;
  pcpRegNo: string | null;
  verificationStatus: string;
  verified: boolean;
  pendingChange: { ref: string; kind: string } | null;
  nadra: IdentityBadge | null;
};
type History = {
  id: number;
  facultyId: number;
  ref: string;
  kind: string;
  status: string;
  changes: Record<string, { from: string | null; to: string | null }>;
  category: string | null;
  reason: string;
  requestedBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
};
type Annual = { year: number; due: string; confirmed: { by: string; at: string; activeCount: number; note: string | null } | null; previous: { year: number; by: string; at: string; activeCount: number }[] };

const TRIES = [
  { label: "Try: active elsewhere", hint: "CNIC already active at another institution", values: { cnic: "35202-7654321-2", fullName: "Dr. Sara Malik", fatherName: "Javed Malik", programType: "TECH" } },
  { label: "Try: near-duplicate", hint: "New CNIC, but the name matches an existing person", values: { cnic: "17301-7777777-1", fullName: "Dr. Mohammad Ali Khan", fatherName: "Abdul Ghafoor Khan", programType: "TECH" } },
  { label: "Try: spelling variant", hint: "A free person in the registry, typed with a different spelling", values: { cnic: "17301-8888888-3", fullName: "Dr. Mohammad Yousaf Qureshi", fatherName: "Abdul Rauf Qureshi", programType: "PHARMD" } },
  { label: "Try: NADRA spells it differently", hint: "A new person whose CNIC ends in 1111: the simulated NADRA check returns another spelling", values: { cnic: "17301-4561111-1", fullName: "Dr. Kashif Mehmood", fatherName: "Tariq Mehmood", programType: "TECH" } },
];

const END_CATEGORIES = ["Transfer", "Resignation", "Retirement", "Contract ended", "Other"];

function AppointmentStatus({ r }: { r: Row }) {
  if (r.linkStatus === "ACTIVE")
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
        <RegStatus value="ACTIVE" label={r.verified ? "Active · verified" : "Active"} />
        {r.pendingChange ? <span style={{ fontSize: 11.5, color: "#a15c00" }}>{r.pendingChange.ref} with PCP</span> : null}
      </span>
    );
  if (r.linkStatus === "REQUESTED") return <RegStatus value="REQUESTED" label="Requested · awaiting PCP" />;
  if (r.linkStatus === "ENDED") return <span className="faint">Ended {fmtDate(r.endDate)}</span>;
  return <RegStatus value={r.linkStatus} label={r.linkStatus === "DECLINED" ? "Declined by PCP" : "Request withdrawn"} />;
}

export default function FacultyView({
  rows,
  canEdit,
  canConfirm,
  programmes,
  history,
  elsewhere,
  annual,
}: {
  rows: Row[];
  canEdit: boolean;
  canConfirm: boolean;
  programmes: string[];
  history: History[];
  elsewhere: { facultyId: number; status: string; startDate: string; endDate: string | null }[];
  annual: Annual;
}) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<AddFacultyResult | null>(null);
  const [pending, start] = useBusy();
  const [form] = Form.useForm();
  const [view, setView] = useState<"current" | "ended" | "all">("current");
  const [recordId, setRecordId] = useState<number | null>(null);
  const [linkFor, setLinkFor] = useState<{ facultyId: number; pcpId: string; fullName: string; designation: string } | null>(null);
  const [linkForm] = Form.useForm();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState<{ by?: string; results: FacultySearchResult[]; message?: string } | null>(null);
  const [searching, setSearching] = useState(false);

  const active = rows.filter((r) => r.linkStatus === "ACTIVE");
  const waiting = rows.filter((r) => r.linkStatus === "REQUESTED").length + active.filter((r) => !r.verified || r.pendingChange).length;
  const shown = rows.filter((r) => (view === "all" ? true : view === "current" ? ["ACTIVE", "REQUESTED"].includes(r.linkStatus) : !["ACTIVE", "REQUESTED"].includes(r.linkStatus)));
  const record = rows.find((r) => r.linkId === recordId) ?? null;
  const progOptions = programmes.map((p) => ({ value: p, label: programLabel(p) }));

  const refresh = () => router.refresh();

  const runSearch = async (term: string) => {
    if (!term.trim()) return setSearch(null);
    setSearching(true);
    try {
      const r = await searchFaculty(term);
      setSearch({ by: r.by, results: r.results, message: r.ok ? undefined : r.message });
    } finally {
      setSearching(false);
    }
  };

  const submit = (values: Record<string, string>, decision?: "DIFFERENT") =>
    start(async () => {
      const r = await addFaculty(values, decision);
      setResult(r);
      if (r.ok) {
        form.resetFields();
        message[r.level === "warning" ? "warning" : "success"]("Faculty saved");
        refresh();
      }
    });

  const linkSuggested = (s: FacultySuggestion) =>
    start(async () => {
      const v = form.getFieldsValue();
      const r = await requestFacultyLink({ facultyId: s.facultyId, programType: v.programType, designation: v.designation });
      setResult({ ok: r.ok, level: r.ok ? "success" : "error", message: r.message });
      if (r.ok) {
        form.resetFields();
        message.success(`Link request ${r.ref} sent to PCP`);
        refresh();
      }
    });

  const sameButNotLinkable = (s: FacultySuggestion) => {
    setResult({
      ok: true,
      level: "success",
      message:
        s.availability.state === "MINE"
          ? `Nothing was saved: ${s.fullName} (${s.pcpId}) is already on your faculty list. To move them to another programme, open their record and request a change.`
          : `Nothing was saved. ${s.pcpId}: ${s.availability.label}. They can be linked only when that is settled.`,
    });
    form.resetFields();
  };

  const requestLink = (values: { programType: string; designation: string }) =>
    start(async () => {
      if (!linkFor) return;
      const r = await requestFacultyLink({ facultyId: linkFor.facultyId, ...values });
      message[r.ok ? "success" : "error"](r.message);
      if (r.ok) {
        setLinkFor(null);
        if (q) await runSearch(q);
        refresh();
      }
    });

  const endLink = (row: Row) => {
    let reason = "";
    let category = "Transfer";
    let endDate = dayjs().format("YYYY-MM-DD");
    modal.confirm({
      title: `End appointment of ${row.fullName}?`,
      width: 520,
      okText: row.verified ? "Send change request to PCP" : "End appointment",
      content: (
        <div style={{ display: "grid", gap: 10 }}>
          <p style={{ margin: 0 }}>
            {row.verified
              ? "PCP has verified this appointment, so ending it opens a change request. The appointment stays active until PCP approves it."
              : "PCP has not verified this appointment yet, so it ends at once. The record and its history are kept."}
          </p>
          <Select defaultValue={category} options={END_CATEGORIES.map((v) => ({ value: v }))} onChange={(v) => (category = v)} aria-label="Why the appointment ends" />
          <DatePicker defaultValue={dayjs()} onChange={(d) => (endDate = d ? d.format("YYYY-MM-DD") : endDate)} style={{ width: "100%" }} aria-label="End date" />
          <Input.TextArea rows={2} placeholder="Reason, e.g. Transferred to another university from 1 November" onChange={(e) => (reason = e.target.value)} aria-label="Reason" />
        </div>
      ),
      onOk: async () => {
        const r = await endFacultyLink(row.linkId, reason ? `${category}: ${reason}` : category === "Other" ? "" : category, endDate, category);
        message[r.ok ? "success" : "error"](r.message);
        if (!r.ok) throw new Error(r.message);
        refresh();
      },
    });
  };

  const withdraw = (row: Row) =>
    modal.confirm({
      title: `Withdraw the link request for ${row.fullName}?`,
      content: "PCP will not be asked to verify it any more. You can request the link again later.",
      okText: "Withdraw request",
      onOk: async () => {
        const r = await withdrawLinkRequest(row.linkId);
        message[r.ok ? "success" : "error"](r.message);
        refresh();
      },
    });

  const confirmList = () => {
    let note = "";
    modal.confirm({
      title: `Confirm the faculty list for ${annual.year}?`,
      width: 520,
      okText: `Confirm faculty list for ${annual.year}`,
      icon: <AuditOutlined style={{ color: "var(--brand)" }} />,
      content: (
        <div style={{ display: "grid", gap: 10 }}>
          <p style={{ margin: 0 }}>
            You confirm that the {active.length} active faculty members listed are employed and teaching at your institution in {annual.year}. PCP is notified, and the confirmation is recorded in the audit log.
          </p>
          <Input.TextArea rows={2} placeholder="Note to PCP (optional)" onChange={(e) => (note = e.target.value)} />
        </div>
      ),
      onOk: async () => {
        const r = await confirmFacultyList(note);
        message[r.ok ? "success" : r.level === "warning" ? "warning" : "error"](r.message);
        refresh();
      },
    });
  };

  return (
    <>
      <PageTitle
        eyebrow="Registry"
        title="Faculty"
        sub="Central PCP faculty registry: one record and one PCP-FAC ID per person, active at one institution at a time. Search the registry before adding anyone."
        extra={
          <>
            <ScreenGuide
              title="Faculty"
              intro="One PCP record per person, checked against the registry and against NADRA before it counts towards any application."
              steps={[
                "**Search** the registry by PCP-FAC ID, CNIC or name first. Someone already in the registry is linked by ID, not added again.",
                "**Add faculty member** creates a new person. On save the duplicate check runs, then the CNIC is checked with NADRA.",
                NADRA_RULE_TEXT,
                "A name difference or a CNIC NADRA does not know goes to PCP's verification officer, who resolves it with a note. The record shows the result as a badge.",
                "Open a record and use **Check CNIC with NADRA** to run the check again, for example after a correction.",
              ]}
              note="The NADRA check is simulated in this demo: no NADRA system is called."
            />
            {canEdit ? (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  setResult(null);
                  setOpen(true);
                }}
              >
                Add faculty member
              </Button>
            ) : null}
          </>
        }
      />
      <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
        <Col xs={12} md={6}><StatCard label="Active faculty" value={active.length} icon={<TeamOutlined />} /></Col>
        <Col xs={12} md={6}><StatCard label="PharmD" value={active.filter((r) => r.programType === "PHARMD").length} icon={<SolutionOutlined />} tone="gold" /></Col>
        <Col xs={12} md={6}><StatCard label="Pharmacy Technician" value={active.filter((r) => r.programType === "TECH").length} icon={<ExperimentOutlined />} tone="info" /></Col>
        <Col xs={12} md={6}>
          <StatCard label="Waiting for PCP" value={waiting} icon={<ClockCircleOutlined />} tone="warn" help="Link requests, records not yet verified and change requests PCP has not decided" />
        </Col>
      </Row>

      <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
        <Col xs={24} lg={15}>
          <Card title={<span><SearchOutlined style={{ marginRight: 8, color: "var(--brand)" }} />Find a faculty member</span>} style={{ height: "100%" }} extra={<span className="faint" style={{ fontSize: 12 }}>Whole PCP registry</span>}>
            <Input.Search
              placeholder="PCP-FAC ID, CNIC or name, e.g. PCP-FAC-000096"
              enterButton="Search"
              allowClear
              loading={searching}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                if (!e.target.value) setSearch(null);
              }}
              onSearch={runSearch}
              aria-label="Search the faculty registry"
            />
            <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
              Results show only what another institution may see: someone active elsewhere reads &quot;active at another institution&quot;, without naming it.
            </div>
            {DEMO ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                <span className="faint" style={{ fontSize: 12 }}>Try:</span>
                {["PCP-FAC-000095", "Sara Malik", "Yousaf Qureshi"].map((t) => (
                  <Button
                    key={t}
                    size="small"
                    type="dashed"
                    style={{ borderColor: "#e3c97f", color: "#8a6a1c", background: "#fffbf0" }}
                    onClick={() => {
                      setQ(t);
                      runSearch(t);
                    }}
                  >
                    {t}
                  </Button>
                ))}
              </div>
            ) : null}
            {search ? (
              <div style={{ marginTop: 12 }} data-testid="faculty-search-results">
                {search.message ? <Alert type="info" showIcon title={search.message} /> : null}
                {!search.message && search.results.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No faculty record matches. If the person is new to the registry, add them with Add faculty member." />
                ) : null}
                {search.results.map((s) => (
                  <div key={s.facultyId} className="fac-result" style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--line-2)", flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <Person
                        name={s.fullName}
                        sub={
                          <span>
                            <span className="mono">{s.pcpId}</span> · {s.qualification} {s.specialization} · {s.designation}
                            {s.cnic ? <span className="mono"> · {s.cnic}</span> : null}
                          </span>
                        }
                      />
                    </div>
                    <RegStatus value={s.availability.state === "FREE" ? "ACTIVE" : s.availability.state === "MINE" ? "VERIFIED" : s.availability.state === "DEACTIVATED" ? "REJECTED" : "PENDING"} label={s.availability.label} />
                    {s.availability.state === "FREE" && canEdit ? (
                      <Button size="small" type="primary" icon={<LinkOutlined />} onClick={() => setLinkFor(s)}>
                        Link by ID
                      </Button>
                    ) : null}
                    {s.availability.state === "MINE" ? (
                      <Button size="small" onClick={() => setRecordId(rows.find((r) => r.facultyId === s.facultyId && r.linkStatus === "ACTIVE")?.linkId ?? null)}>
                        Open record
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </Card>
        </Col>
        <Col xs={24} lg={9}>
          <Card title={`Annual faculty update ${annual.year}`} style={{ height: "100%" }} extra={annual.confirmed ? <RegStatus value="DONE" label="Done" /> : <RegStatus value="DUE" label={`Due ${fmtDate(annual.due)}`} />}>
            {annual.confirmed ? (
              <div style={{ display: "flex", gap: 10 }}>
                <CheckCircleFilled style={{ color: "var(--good)", fontSize: 20, marginTop: 2 }} />
                <div style={{ fontSize: 13.5 }}>
                  Faculty list confirmed by <b>{annual.confirmed.by}</b> on {fmtDate(annual.confirmed.at)}: {annual.confirmed.activeCount} active faculty members.
                  {annual.confirmed.note ? <div className="muted" style={{ marginTop: 4 }}>&ldquo;{annual.confirmed.note}&rdquo;</div> : null}
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 13.5, marginBottom: 12 }}>
                  Check the list below once a year: end appointments of people who left, request links for new staff, then confirm. PCP is notified.
                </div>
                {canConfirm ? (
                  <Button type="primary" icon={<AuditOutlined />} onClick={confirmList}>
                    Confirm faculty list for {annual.year}
                  </Button>
                ) : (
                  <Typography.Text type="secondary">The Head of institution or the Principal confirms the list.</Typography.Text>
                )}
              </>
            )}
            {annual.previous.length ? (
              <div style={{ marginTop: 14, borderTop: "1px solid var(--line-2)", paddingTop: 10, display: "grid", gap: 4 }}>
                {annual.previous.map((p) => (
                  <div key={p.year} className="muted" style={{ fontSize: 12.5 }}>
                    {p.year}: confirmed by {p.by} on {fmtDate(p.at)} ({p.activeCount} active)
                  </div>
                ))}
              </div>
            ) : null}
          </Card>
        </Col>
      </Row>

      <Card
        styles={{ body: { padding: 0 } }}
        title={`${shown.length} appointment${shown.length === 1 ? "" : "s"}`}
        extra={
          <Segmented
            size="small"
            value={view}
            onChange={(v) => setView(v as typeof view)}
            options={[
              { value: "current", label: "Current" },
              { value: "ended", label: "Ended and declined" },
              { value: "all", label: "All" },
            ]}
          />
        }
      >
        <Table
          rowKey="linkId"
          dataSource={shown}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          columns={[
            {
              title: "Name",
              dataIndex: "fullName",
              render: (v, r) => (
                <a onClick={() => setRecordId(r.linkId)} style={{ color: "inherit" }}>
                  <Person name={v} sub={<span className="mono">{r.pcpId}</span>} />
                </a>
              ),
            },
            { title: "CNIC", dataIndex: "cnic", render: (v) => <span className="mono" style={{ whiteSpace: "nowrap" }}>{v}</span> },
            { title: "Qualification", dataIndex: "qualification", render: (v, r) => <span>{v}<div className="faint" style={{ fontSize: 12 }}>{r.specialization}</div></span> },
            {
              title: "Role",
              dataIndex: "designation",
              filters: [{ text: "PharmD", value: "PHARMD" }, { text: "Pharmacy Technician", value: "TECH" }],
              onFilter: (v, r) => r.programType === v,
              render: (v, r) => <span>{v}<div className="faint" style={{ fontSize: 12 }}>{programLabel(r.programType)}</div></span>,
            },
            {
              title: "PCP verification",
              dataIndex: "verificationStatus",
              render: (v, r) => (
                <span style={{ display: "inline-flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                  <Pill value={v} />
                  <NadraStatus badge={r.nadra} short />
                </span>
              ),
            },
            { title: "Appointment", render: (_, r) => <AppointmentStatus r={r} /> },
            {
              title: "",
              align: "right" as const,
              render: (_: unknown, r: Row) => (
                <span style={{ whiteSpace: "nowrap" }}>
                  <Button size="small" type="link" onClick={() => setRecordId(r.linkId)}>
                    {canEdit && r.linkStatus === "ACTIVE" ? "Change" : "View"}
                  </Button>
                  {canEdit && r.linkStatus === "ACTIVE" && !r.pendingChange ? (
                    <Button size="small" type="link" onClick={() => endLink(r)}>
                      End
                    </Button>
                  ) : null}
                  {canEdit && r.linkStatus === "REQUESTED" ? (
                    <Button size="small" type="link" danger onClick={() => withdraw(r)}>
                      Withdraw
                    </Button>
                  ) : null}
                </span>
              ),
            },
          ]}
        />
      </Card>

      <Drawer title="Add faculty member" open={open} onClose={() => setOpen(false)} size="large">
        <div style={{ display: "flex", gap: 12, padding: 14, borderRadius: 12, background: "var(--brand-50)", border: "1px solid var(--brand-100)", marginBottom: 16 }}>
          <SafetyOutlined style={{ color: "var(--brand)", fontSize: 18, marginTop: 2 }} />
          <div style={{ fontSize: 13, lineHeight: 1.55 }}>
            <b>Checks run when you save</b>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              <li>CNIC is the key: one PCP record per person. After saving, the CNIC and name are checked with NADRA (simulated in this demo: a CNIC ending in 0000 is not found, one ending in 1111 comes back with another spelling).</li>
              <li>A person already active at another institution is blocked; the other institution is not revealed.</li>
              <li>Registration number, and name plus father&apos;s name after normalisation (Muhammad / Mohammad, Umer / Umar …), are matched against the registry. A close match asks &ldquo;Did you mean …?&rdquo; before anything is created.</li>
            </ul>
          </div>
        </div>
        {DEMO ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {TRIES.map((t) => (
              <Button
                key={t.label}
                size="small"
                type="dashed"
                icon={<IdcardOutlined />}
                title={t.hint}
                onClick={() => {
                  setResult(null);
                  form.setFieldsValue(t.values);
                }}
                style={{ borderColor: "#e3c97f", color: "#8a6a1c", background: "#fffbf0" }}
              >
                {t.label}
              </Button>
            ))}
          </div>
        ) : null}
        {result?.suggestions?.length ? (
          <DidYouMean
            result={result}
            busy={pending}
            canEdit={canEdit}
            onLink={linkSuggested}
            onSame={sameButNotLinkable}
            onDifferent={() => submit(form.getFieldsValue(), "DIFFERENT")}
          />
        ) : result ? (
          <Alert style={{ marginBottom: 16 }} showIcon type={result.level === "warning" ? "warning" : result.ok ? "success" : "error"} title={result.message} />
        ) : null}
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => submit(v)}
          onValuesChange={() => {
            if (result?.suggestions) setResult(null);
          }}
          initialValues={{ programType: "TECH", qualification: "MPhil", designation: "Lecturer", specialization: "Pharmaceutics" }}
        >
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="cnic" label="CNIC" rules={[{ required: true }]}>
                <Input placeholder="17301-1234567-1" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="programType" label="Program" rules={[{ required: true }]}>
                <Select options={[{ value: "PHARMD", label: "PharmD" }, { value: "TECH", label: "Pharmacy Technician" }]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="fullName" label="Full name" rules={[{ required: true }]}>
            <Input placeholder="Dr. ..." />
          </Form.Item>
          <Form.Item name="fatherName" label="Father's name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="qualification" label="Qualification" rules={[{ required: true }]}>
                <Select options={QUALIFICATIONS.map((v) => ({ value: v }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="specialization" label="Specialization" rules={[{ required: true }]}>
                <Select options={SPECIALIZATIONS.map((v) => ({ value: v }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="designation" label="Designation" rules={[{ required: true }]}>
                <Select options={DESIGNATIONS.map((v) => ({ value: v }))} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="pcpRegNo" label="PCP / provincial registration no.">
            <Input />
          </Form.Item>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Button type="primary" htmlType="submit" loading={pending}>
              Save and run checks
            </Button>
            <Typography.Text type="secondary">Saved records await PCP verification.</Typography.Text>
          </div>
        </Form>
      </Drawer>

      <Modal
        open={!!linkFor}
        title={linkFor ? `Link ${linkFor.fullName} (${linkFor.pcpId})` : ""}
        okText="Request link"
        confirmLoading={pending}
        onCancel={() => setLinkFor(null)}
        onOk={() => linkForm.submit()}
        destroyOnHidden
      >
        <p style={{ marginTop: 0 }}>
          The link starts as <b>Requested</b>. PCP&apos;s verification officer checks it, and it becomes Active only when PCP approves. It does not count towards an application until then.
        </p>
        <Form key={linkFor?.facultyId ?? 0} form={linkForm} layout="vertical" onFinish={requestLink} preserve={false} initialValues={{ programType: programmes[0], designation: linkFor?.designation }}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="programType" label="Programme" rules={[{ required: true, message: "Choose the programme" }]}>
                <Select options={progOptions} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="designation" label="Designation at your institution" rules={[{ required: true, message: "Choose the designation" }]}>
                <Select options={DESIGNATIONS.map((v) => ({ value: v }))} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <RecordDrawer
        row={record}
        rows={rows}
        history={history}
        elsewhere={elsewhere}
        programmes={programmes}
        canEdit={canEdit}
        onClose={() => setRecordId(null)}
        onDone={refresh}
      />
    </>
  );
}

function DidYouMean({ result, busy, canEdit, onLink, onSame, onDifferent }: { result: AddFacultyResult; busy: boolean; canEdit: boolean; onLink: (s: FacultySuggestion) => void; onSame: (s: FacultySuggestion) => void; onDifferent: () => void }) {
  const list = result.suggestions ?? [];
  const canBeDifferent = list.some((s) => s.match !== "CNIC");
  return (
    <Alert
      style={{ marginBottom: 16 }}
      showIcon
      type="warning"
      title={<span style={{ fontWeight: 600 }}>{result.message}</span>}
      description={
        <div style={{ display: "grid", gap: 10, marginTop: 6 }}>
          {list.map((s) => (
            <div key={s.facultyId} data-testid="did-you-mean" style={{ background: "#fff", border: "1px solid #ffe1a8", borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <Avatar name={s.fullName} size={36} />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 650 }}>
                    {s.fullName} <span className="mono" style={{ marginLeft: 6 }}>{s.pcpId}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    Father: {s.fatherName} · {s.qualification} {s.specialization} · {s.designation}
                  </div>
                </div>
                <RegStatus value={s.availability.state === "FREE" ? "ACTIVE" : s.availability.state === "MINE" ? "VERIFIED" : "PENDING"} label={s.availability.label} />
              </div>
              <div className="faint" style={{ fontSize: 12, margin: "8px 0" }}>
                Why: {s.reason}
              </div>
              {canEdit ? (
                s.availability.state === "FREE" ? (
                  <Button type="primary" size="small" icon={<LinkOutlined />} loading={busy} onClick={() => onLink(s)}>
                    Yes, link this person
                  </Button>
                ) : (
                  <Button size="small" onClick={() => onSame(s)}>
                    Yes, this is the same person
                  </Button>
                )
              ) : null}
            </div>
          ))}
          {canBeDifferent && canEdit ? (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Button loading={busy} onClick={onDifferent}>
                No, a different person
              </Button>
              <span className="muted" style={{ fontSize: 12.5 }}>Creates a new record and flags it for PCP&apos;s verification officer.</span>
            </div>
          ) : null}
        </div>
      }
    />
  );
}

type Kind = "CHANGE_DESIGNATION" | "CHANGE_PROGRAMME" | "CORRECT_DETAILS" | "END_LINK";

function RecordDrawer({
  row,
  rows,
  history,
  elsewhere,
  programmes,
  canEdit,
  onClose,
  onDone,
}: {
  row: Row | null;
  rows: Row[];
  history: History[];
  elsewhere: { facultyId: number; status: string; startDate: string; endDate: string | null }[];
  programmes: string[];
  canEdit: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<Kind>("CHANGE_DESIGNATION");
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const mine = useMemo(() => (row ? rows.filter((r) => r.facultyId === row.facultyId) : []), [row, rows]);
  const other = row ? elsewhere.filter((e) => e.facultyId === row.facultyId) : [];
  const hist = row ? history.filter((h) => h.facultyId === row.facultyId) : [];
  const editable = !!row && canEdit && row.linkStatus === "ACTIVE" && !row.pendingChange;

  const timeline = [
    ...mine.map((m) => ({ key: `m${m.linkId}`, where: "Your institution", prog: programLabel(m.programType), status: m.linkStatus, start: m.startDate, end: m.endDate })),
    ...other.map((o, i) => ({ key: `o${i}`, where: "Another institution", prog: "", status: o.status, start: o.startDate, end: o.endDate })),
  ].sort((a, b) => (a.start < b.start ? 1 : -1));

  return (
    <Drawer
      open={!!row}
      onClose={() => {
        setOutcome(null);
        onClose();
      }}
      size="large"
      title={row ? <Person name={row.fullName} sub={<span className="mono">{row.pcpId}</span>} /> : null}
      destroyOnHidden
    >
      {row ? (
        <>
          {row.pendingChange ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 14 }}
              title={`${row.pendingChange.ref} (${CHANGE_KIND_LABELS[row.pendingChange.kind]?.toLowerCase()}) is with PCP. The appointment stays as it is until PCP decides.`}
            />
          ) : row.linkStatus === "ACTIVE" ? (
            <Alert
              type={row.verified ? "info" : "warning"}
              showIcon
              style={{ marginBottom: 14 }}
              title={
                row.verified
                  ? "PCP has verified this appointment. Any change goes to PCP as a change request; nothing is edited in place."
                  : "PCP has not verified this appointment yet, so changes apply at once. They are still recorded in the history."
              }
            />
          ) : null}
          <KV
            rows={[
              ["PCP faculty ID", <span key="id" className="mono">{row.pcpId}</span>],
              ["CNIC", <span key="cnic" className="mono">{row.cnic}</span>],
              ["Father's name", row.fatherName],
              ["Qualification", `${row.qualification}, ${row.specialization}`],
              ["Designation", row.designation],
              ["Registration no.", row.pcpRegNo],
              ["PCP verification", <Pill key="v" value={row.verificationStatus} />],
              ["NADRA check", <NadraBadge key={`n${row.facultyId}`} entityType="faculty" entityId={row.facultyId} badge={row.nadra} canCheck={canEdit && ["ACTIVE", "REQUESTED"].includes(row.linkStatus)} />],
            ]}
          />

          <SectionLabel>Appointments</SectionLabel>
          <div style={{ display: "grid", gap: 6 }}>
            {timeline.map((t) => (
              <div key={t.key} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, padding: "8px 10px", border: "1px solid var(--line-2)", borderRadius: 10 }}>
                <span style={{ flex: 1 }}>
                  <b style={{ fontWeight: 600 }}>{t.where}</b>
                  {t.prog ? <span className="muted"> · {t.prog}</span> : null}
                  <div className="faint" style={{ fontSize: 12 }}>
                    {fmtDate(t.start)} to {t.end ? fmtDate(t.end) : "present"}
                  </div>
                </span>
                <RegStatus value={t.status} />
              </div>
            ))}
          </div>

          <SectionLabel>Change history</SectionLabel>
          {hist.length === 0 ? (
            <div className="faint" style={{ fontSize: 13 }}>No changes or link requests yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {hist.map((h) => (
                <div key={h.id} data-testid="change-history" style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 6 }}>
                    <span>
                      <span className="mono">{h.ref}</span> <b style={{ fontWeight: 600, marginLeft: 6 }}>{CHANGE_KIND_LABELS[h.kind] ?? h.kind}</b>
                      {h.category ? <span className="muted"> · {h.category}</span> : null}
                    </span>
                    <RegStatus value={h.status} />
                  </div>
                  <ChangeLines changes={h.changes} />
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>Reason: {h.reason}</div>
                  <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>
                    Requested by {h.requestedBy} on {fmtDate(h.createdAt)}
                    {h.decidedAt && h.status !== "APPLIED" ? ` · ${h.status.toLowerCase()} by ${h.decidedBy} on ${fmtDate(h.decidedAt)}` : ""}
                    {h.decisionNote && h.status !== "APPLIED" ? `: ${h.decisionNote}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}

          {editable ? (
            <>
              <SectionLabel>Request a change</SectionLabel>
              {outcome ? <Alert style={{ marginBottom: 12 }} type={outcome.ok ? "success" : "error"} showIcon title={outcome.message} /> : null}
              <Segmented
                block
                value={kind}
                onChange={(v) => {
                  setKind(v as Kind);
                  setOutcome(null);
                }}
                options={[
                  { value: "CHANGE_DESIGNATION", label: "Designation" },
                  { value: "CHANGE_PROGRAMME", label: "Programme" },
                  { value: "CORRECT_DETAILS", label: "Correct details" },
                  { value: "END_LINK", label: "End appointment" },
                ]}
                style={{ marginBottom: 14 }}
              />
              <ChangeForm
                key={`${row.linkId}:${kind}:${row.fullName}:${row.fatherName}:${row.designation}:${row.qualification}:${row.specialization}:${row.pcpRegNo}:${row.programType}`}
                row={row}
                kind={kind}
                programmes={programmes}
                onResult={(r) => {
                  setOutcome(r);
                  if (r.ok) onDone();
                }}
              />
            </>
          ) : null}
        </>
      ) : null}
    </Drawer>
  );
}

/** The change form for one appointment. It has its own form instance, so it never carries another person's values. */
function ChangeForm({ row, kind, programmes, onResult }: { row: Row; kind: Kind; programmes: string[]; onResult: (r: { ok: boolean; message: string }) => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [busy, start] = useBusy();
  const send = (values: Record<string, unknown>) =>
    start(async () => {
      const payload = { kind, ...values, endDate: values.endDate ? dayjs(values.endDate as string).format("YYYY-MM-DD") : undefined };
      const r = await requestFacultyChange(row.linkId, payload);
      message[r.ok ? "success" : "error"](r.message);
      onResult(r);
    });
  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={send}
      initialValues={{
        designation: row.designation,
        programType: programmes.find((p) => p !== row.programType) ?? row.programType,
        fullName: row.fullName,
        fatherName: row.fatherName,
        qualification: row.qualification,
        specialization: row.specialization,
        pcpRegNo: row.pcpRegNo ?? "",
        category: "Transfer",
        endDate: dayjs(),
      }}
    >
      {kind === "CHANGE_DESIGNATION" ? (
        <Form.Item name="designation" label="New designation" rules={[{ required: true }]}>
          <Select options={DESIGNATIONS.map((v) => ({ value: v }))} />
        </Form.Item>
      ) : null}
      {kind === "CHANGE_PROGRAMME" ? (
        <Form.Item name="programType" label="Move to programme" extra="The current appointment ends and a new one opens under the new programme, so the history is kept." rules={[{ required: true }]}>
          <Select options={programmes.map((p) => ({ value: p, label: programLabel(p), disabled: p === row.programType }))} />
        </Form.Item>
      ) : null}
      {kind === "CORRECT_DETAILS" ? (
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="fullName" label="Full name" rules={[{ required: true }]}><Input /></Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="fatherName" label="Father's name" rules={[{ required: true }]}><Input /></Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="qualification" label="Qualification"><Select options={QUALIFICATIONS.map((v) => ({ value: v }))} /></Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="specialization" label="Specialization"><Select options={SPECIALIZATIONS.map((v) => ({ value: v }))} /></Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="pcpRegNo" label="Registration no."><Input /></Form.Item>
          </Col>
        </Row>
      ) : null}
      {kind === "END_LINK" ? (
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="category" label="Why it ends"><Select options={END_CATEGORIES.map((v) => ({ value: v }))} /></Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="endDate" label="End date"><DatePicker style={{ width: "100%" }} /></Form.Item>
          </Col>
        </Row>
      ) : null}
      <Form.Item name="reason" label="Reason for the change" rules={[{ required: true, min: 5, message: "Give a reason of at least 5 characters" }]}>
        <Input.TextArea rows={2} placeholder={kind === "CHANGE_DESIGNATION" ? "e.g. Promoted by the selection board on 12 September 2026" : "Explain the change for PCP"} />
      </Form.Item>
      <Button type="primary" htmlType="submit" loading={busy}>
        {row.verified ? "Send change request to PCP" : "Apply change"}
      </Button>
    </Form>
  );
}
