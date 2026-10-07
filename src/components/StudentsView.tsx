"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { Alert, App, Button, Card, Col, Drawer, Form, Input, InputNumber, Popconfirm, Radio, Row, Select, Space, Steps, Switch, Table, Tag, Upload } from "antd";
import {
  CheckCircleFilled,
  CloudUploadOutlined,
  DownloadOutlined,
  FileExcelOutlined,
  LockOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  SolutionOutlined,
  TeamOutlined,
  TrophyOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { addStudent, checkDegree, checkStudentUpload, importStudentUpload, updateStudentLifecycle, type ImportNadraRow, type UploadCheck } from "@/app/actions/students";
import { NADRA_RULE_TEXT, type IdentityBadge } from "@/lib/identity-shared";
import { PROGRAMME_YEARS, UPLOAD_COLUMNS, UPLOAD_TEMPLATE_ROWS, toCsv, type UploadRow } from "@/lib/registry-shared";
import { KV, PageTitle, Person, StatCard, fmtDate, programLabel } from "./common";
import { DEMO } from "./demo-helpers";
import NadraBadge, { NadraStatus } from "./NadraBadge";
import ScreenGuide from "./ScreenGuide";
import { RegStatus, SectionLabel, downloadText, useBusy } from "./registry-ui";

type Row = {
  id: number;
  pcpId: string;
  fullName: string;
  fatherName: string;
  cnic: string;
  mobile: string | null;
  email: string | null;
  programType: string;
  shift: string;
  enrollmentYear: number;
  currentYear: number;
  status: string;
  result: string | null;
  resultYear: number | null;
  degreeVerified: boolean;
  eligible: boolean;
  hasLogin: boolean;
  nadra: IdentityBadge | null;
};
type Locked = { programType: string; year: number; ref: string; lockedAt: string | null };

const THIS_YEAR = new Date().getFullYear();

/** A demo file with three good rows and one of each kind of mistake. */
const SAMPLE_ROWS: UploadRow[] = [
  { full_name: "Ayesha Siddiqa", father_name: "Muhammad Siddiq", cnic: "17301-5550001-2", mobile: "0301-5550001", email: "ayesha.siddiqa@student.demo", programme: "PHARMD", session: "Morning", enrolment_year: "2026", year_of_study: "1" },
  { full_name: "Bilal Ahmed Khan", father_name: "Ahmed Khan", cnic: "17301-5550002-3", mobile: "0302-5550002", email: "bilal.khan@student.demo", programme: "PHARMD", session: "Evening", enrolment_year: "2026", year_of_study: "1" },
  { full_name: "Hira Batool", father_name: "Syed Ali Shah", cnic: "17301-555-0003", mobile: "0303-5550003", email: "hira.batool@student.demo", programme: "PHARMD", session: "Morning", enrolment_year: "2026", year_of_study: "1" },
  { full_name: "Usman Tariq", father_name: "Tariq Mehmood", cnic: "17301-5550001-2", mobile: "0304-5550004", email: "usman.tariq@student.demo", programme: "PHARMD", session: "Morning", enrolment_year: "2026", year_of_study: "1" },
  { full_name: "Zainab Rauf", father_name: "Abdul Rauf", cnic: "17301-2021001-2", mobile: "0305-5550005", email: "zainab.rauf@student.demo", programme: "PHARMD", session: "Morning", enrolment_year: "2026", year_of_study: "1" },
  { full_name: "Saad Akhtar", father_name: "Javed Akhtar", cnic: "17301-5550006-7", mobile: "0306-5550006", email: "saad.akhtar@student.demo", programme: "PHARMD", session: "Weekend", enrolment_year: "2026", year_of_study: "1" },
  { full_name: "Mehwish Anwar", father_name: "", cnic: "17301-5550007-8", mobile: "0307-5550007", email: "mehwish.anwar@student.demo", programme: "PHARMD", session: "Morning", enrolment_year: "2026", year_of_study: "1" },
  { full_name: "Kashif Nawaz", father_name: "Nawaz Sharif Khan", cnic: "17301-5550008-9", mobile: "0308-5550008", email: "kashif.nawaz@student.demo", programme: "TECH", session: "Morning", enrolment_year: "2026", year_of_study: "1" },
  { full_name: "Rabia Iqbal", father_name: "Muhammad Iqbal", cnic: "17301-5550009-1", mobile: "0309-5550009", email: "rabia.iqbal@student.demo", programme: "PHARMD", session: "Self-finance", enrolment_year: "2025", year_of_study: "1" },
  { full_name: "Owais Qureshi", father_name: "Adnan Qureshi", cnic: "17301-5550010-2", mobile: "0310-5550010", email: "owais.qureshi@student.demo", programme: "PHARMD", session: "Morning", enrolment_year: "2026", year_of_study: "4" },
  { full_name: "Maryam Javed", father_name: "Javed Iqbal", cnic: "17301-5550011-3", mobile: "0311-5550011", email: "maryam.javed@student.demo", programme: "PHARMD", session: "Self-finance", enrolment_year: "2026", year_of_study: "1" },
  // The simulated NADRA check (src/lib/nadra.ts): a CNIC ending in 1111 comes back with another spelling, one ending in 0000 is not found.
  { full_name: "Muhammad Hamza Aslam", father_name: "Muhammad Aslam", cnic: "17301-5551111-1", mobile: "0312-5550012", email: "hamza.aslam@student.demo", programme: "PHARMD", session: "Morning", enrolment_year: "2026", year_of_study: "1" },
  { full_name: "Iqra Shaheen", father_name: "Shaheen Akhtar", cnic: "17301-5550000-0", mobile: "0313-5550013", email: "iqra.shaheen@student.demo", programme: "PHARMD", session: "Evening", enrolment_year: "2026", year_of_study: "1" },
];

const COLUMN_GUIDE: [string, string, string][] = [
  ["full_name", "Yes", "Letters, at least 3"],
  ["father_name", "Yes", "Letters, at least 3"],
  ["cnic", "Yes", "13 digits: 17301-1234567-1 (B-Form number for under-18s)"],
  ["mobile", "No", "0301-2345678"],
  ["email", "No", "A valid address"],
  ["programme", "Yes", "PHARMD or TECH, approved for your institution"],
  ["session", "Yes", "Morning, Evening or Self-finance"],
  ["enrolment_year", "Yes", `2015 to ${THIS_YEAR}; not a year PCP has locked`],
  ["year_of_study", "Yes", "1 to 5 (PharmD) or 1 to 2 (Technician)"],
];

function yearOfStudy(r: Row) {
  return `Year ${r.currentYear} of ${PROGRAMME_YEARS[r.programType] ?? 5}`;
}

export default function StudentsView(props: {
  rows: Row[];
  canEdit: boolean;
  byYear: { year: number; type: string; n: number }[];
  intake: Record<string, number>;
  approved: string[];
  locked: Locked[];
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [studentId, setStudentId] = useState<number | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string; level?: string } | null>(null);
  const [pending, start] = useBusy();
  const [form] = Form.useForm();
  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim();
    return s ? props.rows.filter((r) => r.fullName.toLowerCase().includes(s) || r.pcpId.toLowerCase().includes(s)) : props.rows;
  }, [q, props.rows]);
  const student = props.rows.find((r) => r.id === studentId) ?? null;
  const onRoll = props.rows.filter((r) => !["GRADUATED", "WITHDRAWN"].includes(r.status));
  const awaitingDegree = props.rows.filter((r) => r.status === "GRADUATED" && !r.degreeVerified);
  const eligible = props.rows.filter((r) => r.eligible);

  return (
    <>
      <PageTitle
        eyebrow="Registry"
        title="Students"
        sub="Central student registry: each student gets one PCP student ID. Record results, promotion or repeat, graduation and the degree check here; PCP counts entrants, graduates and failures from these records."
        extra={
          props.canEdit ? (
            <>
              <ScreenGuide
                title="Students"
                intro="Each student gets one PCP student ID. The CNIC or B-Form is checked with NADRA when the student is enrolled, one by one or by bulk upload."
                steps={[
                  "**Enrol student** for one student, or **Bulk upload** a CSV: every row is checked before anything is saved.",
                  "After saving, each CNIC is checked with NADRA. The bulk upload shows the result for every row.",
                  NADRA_RULE_TEXT,
                  "A difference goes to PCP's verification officer. Open a student to see the badge or run **Check CNIC with NADRA** again.",
                ]}
                note="The NADRA check is simulated in this demo: no NADRA system is called."
              />
              <Button icon={<CloudUploadOutlined />} onClick={() => setBulkOpen(true)}>
                Bulk upload
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => { setResult(null); setOpen(true); }}>
                Enrol student
              </Button>
            </>
          ) : null
        }
      />
      {props.locked.length ? (
        <Alert
          type="info"
          showIcon
          icon={<LockOutlined />}
          style={{ marginBottom: 16 }}
          title={
            <span>
              <b>Locked by PCP: {[...props.locked].sort((a, b) => b.year - a.year).map((l) => `${programLabel(l.programType)} ${l.year}`).join(", ")}.</b> PCP accepted the annual return, so results and moves for a locked year cannot be changed here. Use a correction request on Annual returns.
            </span>
          }
        />
      ) : null}
      <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
        <Col xs={12} md={6}><StatCard label="On roll" value={onRoll.length} icon={<TeamOutlined />} /></Col>
        <Col xs={12} md={6}><StatCard label="Repeating" value={props.rows.filter((r) => r.status === "REPEAT").length} icon={<UndoOutlined />} tone="warn" /></Col>
        <Col xs={12} md={6}><StatCard label="Graduated, degree check due" value={awaitingDegree.length} icon={<SolutionOutlined />} tone="info" /></Col>
        <Col xs={12} md={6}><StatCard label="Eligible for registration" value={eligible.length} icon={<TrophyOutlined />} tone="gold" /></Col>
      </Row>
      <Card title="Enrolment by year against approved intake" style={{ marginBottom: 18 }}>
        <Row gutter={[12, 12]}>
          {props.byYear.map((b) => {
            const limit = props.intake[b.type] ?? 0;
            const isLocked = props.locked.some((l) => l.programType === b.type && l.year === b.year);
            return (
              <Col key={`${b.year}-${b.type}`} xs={12} md={6} xl={4}>
                <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px" }}>
                  <div className="faint" style={{ fontSize: 12 }}>
                    {b.year} · {programLabel(b.type)} {isLocked ? <LockOutlined title="Year locked by PCP" /> : null}
                  </div>
                  <div className="tnum" style={{ fontSize: 20, fontWeight: 700 }}>
                    {b.n} <span className="faint" style={{ fontSize: 12, fontWeight: 500 }}>/ {limit || "—"} approved</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 5, background: "var(--line-2)", overflow: "hidden", marginTop: 6 }}>
                    <div style={{ height: "100%", width: `${Math.min(100, limit ? (b.n / limit) * 100 : 0)}%`, background: limit && b.n > limit ? "#d03b3b" : "#0f8a63" }} />
                  </div>
                  {limit && b.n > limit ? <Tag color="red" style={{ marginTop: 6 }}>Over intake</Tag> : null}
                </div>
              </Col>
            );
          })}
        </Row>
      </Card>
      <Card extra={<Input.Search placeholder="Search name or PCP ID" allowClear onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />} title={`${filtered.length} student${filtered.length === 1 ? "" : "s"}`} styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          dataSource={filtered}
          pagination={{ pageSize: 12, hideOnSinglePage: true, showSizeChanger: false }}
          onRow={(r) => ({ onClick: () => setStudentId(r.id), style: { cursor: "pointer" } })}
          columns={[
            { title: "Student", dataIndex: "fullName", render: (v, r) => <Person name={v} sub={<span className="mono">{r.pcpId}</span>} /> },
            {
              title: "Program",
              dataIndex: "programType",
              filters: [{ text: "PharmD", value: "PHARMD" }, { text: "Pharmacy Technician", value: "TECH" }],
              onFilter: (v, r) => r.programType === v,
              render: (v, r) => <span>{programLabel(v)}<div className="faint" style={{ fontSize: 12 }}>{r.shift}</div></span>,
            },
            { title: "Enrolled", dataIndex: "enrollmentYear", sorter: (a, b) => a.enrollmentYear - b.enrollmentYear },
            { title: "Year of study", render: (_, r) => (r.status === "GRADUATED" ? <span className="faint">Completed</span> : yearOfStudy(r)) },
            {
              title: "Status",
              dataIndex: "status",
              filters: ["ENROLLED", "PROMOTED", "REPEAT", "GRADUATED", "WITHDRAWN"].map((s) => ({ text: s.charAt(0) + s.slice(1).toLowerCase(), value: s })),
              onFilter: (v, r) => r.status === v,
              render: (v, r) => (
                <span style={{ display: "inline-flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                  <RegStatus value={v} />
                  {r.nadra && r.nadra.status !== "MATCH" && r.nadra.reviewStatus === "OPEN" ? <NadraStatus badge={r.nadra} short /> : null}
                </span>
              ),
            },
            { title: "Latest result", render: (_, r) => (r.result ? <span><RegStatus value={r.result} /> <span className="faint" style={{ fontSize: 12 }}>{r.resultYear}</span></span> : <span className="faint">—</span>) },
            {
              title: "Degree and registration",
              render: (_, r) =>
                r.status !== "GRADUATED" ? (
                  <span className="faint">—</span>
                ) : r.eligible ? (
                  <RegStatus value="ELIGIBLE" label="Eligible for registration" />
                ) : r.degreeVerified ? (
                  <RegStatus value="VERIFIED" label="Degree verified" />
                ) : (
                  <RegStatus value="PENDING" label="Degree check due" />
                ),
            },
          ]}
        />
      </Card>

      <StudentDrawer student={student} locked={props.locked} canEdit={props.canEdit} onClose={() => setStudentId(null)} onDone={() => router.refresh()} />
      <BulkUpload open={bulkOpen} onClose={() => setBulkOpen(false)} onDone={() => router.refresh()} approved={props.approved} />

      <Drawer title="Enrol student" open={open} onClose={() => setOpen(false)} size="large">
        {result ? <Alert style={{ marginBottom: 16 }} showIcon type={result.level === "warning" ? "warning" : result.ok ? "success" : "error"} title={result.message} /> : null}
        <Form
          form={form}
          layout="vertical"
          initialValues={{ programType: props.approved[0], shift: "Morning", enrollmentYear: THIS_YEAR }}
          onFinish={(v) =>
            start(async () => {
              const r = await addStudent(v);
              setResult(r);
              if (r.ok) {
                form.resetFields();
                message.success("Student enrolled");
                router.refresh();
              }
            })
          }
        >
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="cnic" label="CNIC / B-Form" rules={[{ required: true }]}>
                <Input placeholder="17301-0000000-0" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="programType" label="Program" rules={[{ required: true }]}>
                <Select options={props.approved.map((p) => ({ value: p, label: programLabel(p) }))} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="fullName" label="Full name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="fatherName" label="Father's name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="mobile" label="Mobile">
                <Input placeholder="03xx xxxxxxx" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="email" label="Email">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="shift" label="Session" rules={[{ required: true }]}>
                <Select options={["Morning", "Evening", "Self-finance"].map((v) => ({ value: v }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="enrollmentYear" label="Enrolment year" rules={[{ required: true }]}>
                <InputNumber min={2015} max={2030} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Button type="primary" htmlType="submit" loading={pending}>
            Enrol and generate PCP student ID
          </Button>
        </Form>
      </Drawer>
    </>
  );
}

function StudentDrawer({ student: s, locked, canEdit, onClose, onDone }: { student: Row | null; locked: Locked[]; canEdit: boolean; onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp();
  const [busy, start] = useBusy();
  const [checking, setChecking] = useState(false);
  const [resultYear, setResultYear] = useState(THIS_YEAR);
  const [res, setRes] = useState<"PASS" | "FAIL">("PASS");
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const isLocked = (y: number | null) => !!s && y !== null && locked.some((l) => l.programType === s.programType && l.year === y);
  const len = s ? PROGRAMME_YEARS[s.programType] ?? 5 : 5;
  const closed = !!s && ["GRADUATED", "WITHDRAWN"].includes(s.status);

  const act = (payload: Record<string, unknown>) =>
    start(async () => {
      if (!s) return;
      const r = await updateStudentLifecycle(s.id, payload);
      setOutcome(r);
      message[r.ok ? "success" : "error"](r.message);
      if (r.ok) onDone();
    });

  const degree = async () => {
    if (!s) return;
    setChecking(true);
    try {
      const r = await checkDegree(s.id);
      setOutcome(r);
      message[r.ok ? "success" : r.level === "warning" ? "warning" : "error"](r.message);
      if (r.ok) onDone();
    } finally {
      setChecking(false);
    }
  };

  const stage = !s ? 0 : s.eligible ? 4 : s.status === "GRADUATED" ? 3 : 1;

  return (
    <Drawer
      open={!!s}
      onClose={() => {
        setOutcome(null);
        onClose();
      }}
      size="large"
      title={s ? <Person name={s.fullName} sub={<span className="mono">{s.pcpId}</span>} /> : null}
      destroyOnHidden
    >
      {s ? (
        <>
          <Steps
            size="small"
            current={stage}
            status={s.status === "WITHDRAWN" ? "error" : s.eligible ? "finish" : "process"}
            style={{ marginBottom: 18 }}
            items={[{ title: "Enrolled, ID issued" }, { title: "Results" }, { title: "Graduated" }, { title: "Degree check" }, { title: "Eligible" }].map((i, k) => ({ ...i, key: k }))}
          />
          {outcome ? <Alert style={{ marginBottom: 14 }} showIcon type={outcome.ok ? "success" : "error"} title={outcome.message} /> : null}
          <KV
            rows={[
              ["PCP student ID", <span key="id" className="mono">{s.pcpId}</span>],
              ["Father's name", s.fatherName],
              ["CNIC / B-Form", <span key="c" className="mono">{s.cnic}</span>],
              ["NADRA check", <NadraBadge key={`n${s.id}`} entityType="student" entityId={s.id} badge={s.nadra} canCheck={canEdit} />],
              ["Mobile", s.mobile],
              ["Email", s.email],
              ["Programme", `${programLabel(s.programType)} · ${s.shift} session`],
              ["Enrolled", s.enrollmentYear],
              ["Year of study", s.status === "GRADUATED" ? "Completed" : yearOfStudy(s)],
              ["Status", <RegStatus key="s" value={s.status} />],
              ["Latest result", s.result ? <span key="r"><RegStatus value={s.result} /> in {s.resultYear} {isLocked(s.resultYear) ? <LockOutlined title="Year locked by PCP" /> : null}</span> : "No result yet"],
              ["Degree check", s.status !== "GRADUATED" ? "After graduation" : s.degreeVerified ? <RegStatus key="d" value="VERIFIED" label="Verified with the university and HEC" /> : <RegStatus key="d" value="PENDING" label="Not checked yet" />],
              ["Eligible for registration", s.eligible ? <RegStatus key="e" value="ELIGIBLE" label="Yes" /> : "Not yet: needs graduation and a verified degree"],
              ["Student portal", s.hasLogin ? "Has a login" : "No login yet"],
            ]}
          />

          {canEdit && s.status === "GRADUATED" && !s.degreeVerified ? (
            <>
              <SectionLabel>Degree check</SectionLabel>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: 12, border: "1px solid var(--line)", borderRadius: 12 }}>
                <SafetyCertificateOutlined style={{ fontSize: 20, color: "var(--brand)" }} />
                <div style={{ flex: 1, minWidth: 220, fontSize: 13 }}>Confirm the degree with the university and HEC record before the student is marked eligible for registration. (Simulated in the demo.)</div>
                <Button type="primary" loading={checking} onClick={degree}>
                  {checking ? "Checking with the university and HEC…" : "Check degree"}
                </Button>
              </div>
            </>
          ) : null}

          {canEdit && !closed ? (
            <>
              <SectionLabel>Record a result</SectionLabel>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <Select
                  value={resultYear}
                  onChange={setResultYear}
                  style={{ width: 110 }}
                  aria-label="Result year"
                  options={Array.from({ length: THIS_YEAR - s.enrollmentYear + 1 }, (_, i) => THIS_YEAR - i).map((y) => ({ value: y, label: isLocked(y) ? `${y} (locked)` : String(y), disabled: isLocked(y) }))}
                />
                <Radio.Group value={res} onChange={(e) => setRes(e.target.value)} optionType="button" buttonStyle="solid" options={[{ value: "PASS", label: "Pass" }, { value: "FAIL", label: "Fail" }]} />
                <Button loading={busy} onClick={() => act({ op: "RESULT", result: res, year: resultYear })}>
                  Record result
                </Button>
              </div>

              <SectionLabel>Progress</SectionLabel>
              {isLocked(s.resultYear) ? (
                <Alert type="info" showIcon icon={<LockOutlined />} title={`${s.resultYear} is locked by PCP. Record the next year's result first; earlier figures change only through a correction request.`} style={{ marginBottom: 10 }} />
              ) : null}
              <Space wrap>
                <Button type="primary" disabled={!s.result || s.result !== "PASS" || s.status === "PROMOTED" || s.currentYear >= len || isLocked(s.resultYear)} loading={busy} onClick={() => act({ op: "PROMOTE" })}>
                  Promote to year {Math.min(len, s.currentYear + 1)}
                </Button>
                <Button disabled={s.result !== "FAIL" || s.status === "REPEAT" || isLocked(s.resultYear)} loading={busy} onClick={() => act({ op: "REPEAT" })}>
                  Repeat year {s.currentYear}
                </Button>
                <Button icon={<CheckCircleFilled />} disabled={s.result !== "PASS" || s.currentYear < len || isLocked(s.resultYear)} loading={busy} onClick={() => act({ op: "GRADUATE" })}>
                  Graduate
                </Button>
                <Popconfirm title={`Record that ${s.fullName} withdrew in ${THIS_YEAR}?`} okText="Record withdrawal" onConfirm={() => act({ op: "WITHDRAW", year: THIS_YEAR })} disabled={isLocked(THIS_YEAR)}>
                  <Button danger type="text" disabled={isLocked(THIS_YEAR)}>
                    Withdraw
                  </Button>
                </Popconfirm>
              </Space>
              <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
                Promote after a pass, repeat after a fail. A student graduates after passing year {len}.
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </Drawer>
  );
}

type Parsed = { rows: UploadRow[]; fileName: string };

function BulkUpload({ open, onClose, onDone, approved }: { open: boolean; onClose: () => void; onDone: () => void; approved: string[] }) {
  const { message, modal } = App.useApp();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [checks, setChecks] = useState<UploadCheck[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ message: string; ids: string[]; nadra: ImportNadraRow[] } | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const valid = checks?.filter((c) => !c.errors.length).length ?? 0;
  const invalid = (checks?.length ?? 0) - valid;

  const reset = () => {
    setParsed(null);
    setChecks(null);
    setProblem(null);
    setDone(null);
  };

  const check = async (rows: UploadRow[], fileName: string) => {
    reset();
    setBusy(true);
    try {
      const r = await checkStudentUpload(rows);
      if (!r.ok) return setProblem(r.message ?? "The file could not be checked.");
      setParsed({ rows, fileName });
      setChecks(r.checks);
    } finally {
      setBusy(false);
    }
  };

  const readFile = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
      complete: (out) => {
        const fields = out.meta.fields ?? [];
        const missing = UPLOAD_COLUMNS.filter((c) => !fields.includes(c));
        if (missing.length) {
          reset();
          setProblem(`The file is missing the column${missing.length > 1 ? "s" : ""} ${missing.join(", ")}. Download the template and copy your data into it.`);
          return;
        }
        const rows = out.data.map((d) => Object.fromEntries(UPLOAD_COLUMNS.map((c) => [c, String(d[c] ?? "").trim()])) as UploadRow);
        check(rows, file.name);
      },
      error: (e) => setProblem(`The file could not be read as CSV: ${e.message}`),
    });
    return false;
  };

  const errorReport = () => {
    if (!checks) return;
    const rows = checks.map((c) => ({ row: c.line, ...c.data, result: c.errors.length ? "Error" : "OK", errors: c.errors.join("; ") }));
    downloadText(`error-report-${(parsed?.fileName ?? "upload").replace(/\.csv$/i, "")}.csv`, toCsv(rows, ["row", ...UPLOAD_COLUMNS, "result", "errors"]));
  };

  const doImport = () =>
    modal.confirm({
      title: `Import ${valid} valid row${valid === 1 ? "" : "s"}?`,
      content: `Each student gets a PCP student ID. ${invalid ? `${invalid} row${invalid === 1 ? "" : "s"} with errors will not be imported; fix them and upload them again.` : ""}`,
      okText: `Import ${valid} row${valid === 1 ? "" : "s"}`,
      onOk: async () => {
        if (!parsed) return;
        const r = await importStudentUpload(parsed.rows);
        message[r.ok ? "success" : "error"](r.message);
        if (r.ok) {
          setDone({ message: r.message, ids: r.ids ?? [], nadra: r.nadra ?? [] });
          setChecks(null);
          onDone();
        }
      },
    });

  const shown = (checks ?? []).filter((c) => !onlyErrors || c.errors.length);

  return (
    <Drawer title="Bulk upload of students" open={open} onClose={onClose} size={980}>
      <Steps
        size="small"
        current={done ? 2 : checks ? 1 : 0}
        style={{ marginBottom: 18 }}
        items={[{ title: "Fill the template" }, { title: "Check every row" }, { title: "Import valid rows" }]}
      />
      <Row gutter={[14, 14]}>
        <Col xs={24} md={12}>
          <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14, height: "100%" }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>1. Download the template</div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
              One row per student. Programmes approved for you: {approved.map(programLabel).join(", ") || "none"}.
            </div>
            <Button icon={<DownloadOutlined />} onClick={() => downloadText("pcp-student-upload-template.csv", toCsv(UPLOAD_TEMPLATE_ROWS, [...UPLOAD_COLUMNS]))}>
              Download CSV template
            </Button>
          </div>
        </Col>
        <Col xs={24} md={12}>
          <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14, height: "100%" }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>2. Upload the filled file</div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>Every row is checked before anything is saved.</div>
            <Space wrap>
              <Upload accept=".csv,text/csv" showUploadList={false} beforeUpload={readFile} maxCount={1}>
                <Button type="primary" icon={<FileExcelOutlined />} loading={busy}>
                  Choose CSV file
                </Button>
              </Upload>
              {DEMO ? (
                <Button
                  size="small"
                  type="dashed"
                  style={{ borderColor: "#e3c97f", color: "#8a6a1c", background: "#fffbf0" }}
                  onClick={() => check(SAMPLE_ROWS, "sample-with-errors.csv")}
                >
                  Use a sample file with errors
                </Button>
              ) : null}
            </Space>
          </div>
        </Col>
      </Row>

      {problem ? <Alert style={{ marginTop: 16 }} type="error" showIcon title={problem} /> : null}
      {done ? (
        <Alert
          style={{ marginTop: 16 }}
          type="success"
          showIcon
          title={done.message}
          description={done.ids.length ? <span>New PCP student IDs: <span className="mono">{done.ids[0]}</span>{done.ids.length > 1 ? <> to <span className="mono">{done.ids[done.ids.length - 1]}</span></> : null}</span> : null}
        />
      ) : null}

      {checks ? (
        <div data-testid="upload-report">
          <SectionLabel
            extra={
              <Space>
                <span style={{ fontSize: 12.5 }}>
                  <Switch size="small" checked={onlyErrors} onChange={setOnlyErrors} /> Only rows with errors
                </span>
              </Space>
            }
          >
            Row-by-row check: {parsed?.fileName}
          </SectionLabel>
          <Alert
            type={invalid ? "warning" : "success"}
            showIcon
            style={{ marginBottom: 12 }}
            title={`${checks.length} rows checked: ${valid} valid, ${invalid} with errors. Nothing has been saved yet.`}
            action={
              <Space>
                <Button size="small" icon={<DownloadOutlined />} onClick={errorReport}>
                  Download error report
                </Button>
                <Button size="small" type="primary" disabled={!valid} onClick={doImport}>
                  Import {valid} valid row{valid === 1 ? "" : "s"}
                </Button>
              </Space>
            }
          />
          <Table
            size="small"
            rowKey="line"
            dataSource={shown}
            pagination={{ pageSize: 15, hideOnSinglePage: true }}
            columns={[
              { title: "Row", dataIndex: "line", width: 60 },
              { title: "Student", render: (_, c) => <span>{c.data.full_name || <span className="faint">(no name)</span>}<div className="faint mono" style={{ fontSize: 11.5 }}>{c.data.cnic}</div></span> },
              { title: "Programme", render: (_, c) => <span style={{ fontSize: 12.5 }}>{c.data.programme} · {c.data.session}<div className="faint">{c.data.enrolment_year}, year {c.data.year_of_study}</div></span> },
              {
                title: "Check",
                render: (_, c) =>
                  c.errors.length ? (
                    <ul style={{ margin: 0, paddingLeft: 16, color: "#b4141f", fontSize: 12.5 }}>
                      {c.errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  ) : (
                    <RegStatus value="ACTIVE" label="Ready to import" />
                  ),
              },
            ]}
          />
        </div>
      ) : null}
      {done?.nadra.length ? (
        <div data-testid="import-nadra">
          <SectionLabel extra={<span className="faint" style={{ fontSize: 12 }}>Simulated NADRA check</span>}>NADRA check of the imported rows</SectionLabel>
          <Table
            size="small"
            rowKey="line"
            dataSource={done.nadra}
            pagination={{ pageSize: 15, hideOnSinglePage: true }}
            columns={[
              { title: "Row", dataIndex: "line", width: 60 },
              { title: "Student", render: (_, n) => <span>{n.name}<div className="faint mono" style={{ fontSize: 11.5 }}>{n.pcpId}</div></span> },
              {
                title: "NADRA result",
                render: (_, n) =>
                  n.status === "MATCH" ? (
                    <RegStatus value="ACTIVE" label="NADRA verified" />
                  ) : n.status === "NAME_MISMATCH" ? (
                    <RegStatus value="PENDING" label={`Name differs at NADRA: ${n.nadraName}`} />
                  ) : (
                    <RegStatus value="REJECTED" label="Not found at NADRA" />
                  ),
              },
              { title: "What happens next", render: (_, n) => <span className="muted" style={{ fontSize: 12.5 }}>{n.status === "MATCH" ? "Nothing: the CNIC and name match." : "Imported. PCP's verification officer reviews the difference."}</span> },
              { title: "Transaction", dataIndex: "txnId", render: (v) => <span className="mono faint" style={{ fontSize: 11.5 }}>{v}</span>, responsive: ["lg"] },
            ]}
          />
        </div>
      ) : null}
      {done ? (
        <div style={{ marginTop: 12 }}>
          <Button onClick={reset}>Upload another file</Button> <span className="faint" style={{ fontSize: 12.5, marginLeft: 8 }}>Imported on {fmtDate(new Date().toISOString())}</span>
        </div>
      ) : null}

      <SectionLabel>Columns in the template</SectionLabel>
      <Table
        size="small"
        rowKey={(r) => r[0]}
        pagination={false}
        dataSource={COLUMN_GUIDE}
        columns={[
          { title: "Column", render: (_, r) => <span className="mono">{r[0]}</span> },
          { title: "Required", render: (_, r) => r[1] },
          { title: "Format", render: (_, r) => <span style={{ fontSize: 12.5 }}>{r[2]}</span> },
        ]}
      />
    </Drawer>
  );
}
