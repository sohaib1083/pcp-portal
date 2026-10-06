"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Alert, App, Button, Card, Checkbox, Col, Form, Input, InputNumber, Radio, Row, Select, Spin, Tag, Typography, Upload } from "antd";
import { BankOutlined, CheckCircleFilled, CreditCardOutlined, DeleteOutlined, LockOutlined, ScheduleOutlined, SendOutlined, TeamOutlined, UploadOutlined, UserAddOutlined, WarningFilled } from "@ant-design/icons";
import {
  answerDeferral,
  autoLinkCaseFaculty,
  generateChallan,
  linkCaseFaculty,
  payFeeDemo,
  recheck,
  respondDeficiency,
  saveApplication,
  saveSelfAssessment,
  searchCaseFaculty,
  submitApplication,
  unlinkCaseFaculty,
  type FacultyOption,
} from "@/app/actions/applications";
import type { AppDetail } from "@/lib/appdetail";
import { formatPKR } from "@/lib/format";
import { KIND_LABELS, SELF_ASSESSMENT_CRITERIA } from "@/lib/workflow";
import { AppHeader, CaseFacultyTable, CertificateCard, ChecksCard, DataDescriptions, DecisionCard, DocumentsCard, MessagesCard, SelfAssessmentTable, SubjectChips, TimelineCard, uploadDocument } from "./AppParts";
import { Pill, fmtDate, programLabel } from "./common";
import { FillDemo, SamplePdfButton } from "./demo-helpers";
import { useOtp } from "./OtpConfirm";
import type { ActionResult } from "@/app/actions/faculty";

type Perms = { canEdit: boolean; canUpload: boolean; canPay: boolean; canSubmit: boolean; canRespond: boolean };

const DEMO_FORM = {
  proposedIntake: 60,
  classrooms: 4,
  labs: 3,
  libraryBooks: 800,
  libraryJournals: 6,
  labList: "Pharmaceutics, Pharmacology, Pharmaceutical Chemistry",
  buildingAreaSqft: 14000,
};

/** What the institution still has to do before it can submit, as one checklist. */
function Readiness({ d }: { d: AppDetail }) {
  const have = new Set(d.documents.filter((x) => !x.deficiencyId).map((x) => x.docType));
  const docs = d.requiredDocs.filter((r) => have.has(r)).length;
  const failing = d.app.checks.filter((c) => !c.ok).length;
  const shortSubjects = d.subjects.filter((s) => s.linked < s.required);
  const acc = d.app.kind !== "NOC";
  const items = [
    { label: "Campus and form", ok: !!d.app.campusId && !!d.app.data.proposedIntake, detail: d.app.campusName ? d.app.campusName : "Pick the campus first", href: "#case-form" },
    { label: "Faculty by ID", ok: d.faculty.length > 0 && shortSubjects.length === 0, detail: d.faculty.length ? (shortSubjects.length ? `${shortSubjects.length} subject(s) short` : `${d.faculty.length} linked`) : "None linked yet", href: "#case-faculty" },
    ...(acc ? [{ label: "Self-assessment", ok: !d.app.checks.some((c) => c.key === "self_assessment" && !c.ok) && d.app.selfAssessment.length > 0, detail: `${d.app.selfAssessment.length} of ${SELF_ASSESSMENT_CRITERIA.length} rated`, href: "#case-self" }] : []),
    { label: "Documents", ok: d.requiredDocs.length > 0 && docs === d.requiredDocs.length, detail: `${docs} of ${d.requiredDocs.length} attached`, href: "#case-documents" },
    { label: "Automatic checks", ok: d.app.checks.length > 0 && failing === 0, detail: d.app.checks.length ? (failing ? `${failing} failing` : "All passing") : "Not run yet", href: "#case-checks" },
    { label: "Fee", ok: !!d.app.feePaidAt, detail: d.app.feePaidAt ? "Paid" : d.app.feePsid ? "Challan generated" : failing ? "After the checks pass" : "Ready to pay", href: "#case-fee" },
  ];
  const done = items.filter((i) => i.ok).length;
  return (
    <Card size="small" style={{ marginBottom: 16 }} title={`Ready to submit? ${done} of ${items.length} done`}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
        {items.map((i, n) => (
          <a key={i.label} href={i.href} style={{ padding: "12px 14px", borderRadius: 12, border: `1px solid ${i.ok ? "#c9ecd8" : "var(--line)"}`, background: i.ok ? "#f3fbf6" : "#fff", color: "inherit" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 13, color: "var(--ink)" }}>
              {i.ok ? <CheckCircleFilled style={{ color: "#12a150" }} /> : <span className="dg-n" style={{ width: 18, height: 18, fontSize: 10 }}>{n + 1}</span>}
              {i.label}
            </div>
            <div style={{ fontSize: 12.5, color: i.ok ? "#0d7a3d" : "var(--muted)", marginTop: 4 }}>{i.detail}</div>
          </a>
        ))}
      </div>
    </Card>
  );
}

/** Link teachers by Faculty ID: search the institution's own active faculty, assign each to a subject. */
function FacultyPicker({ d, run, pending }: { d: AppDetail; run: (fn: () => Promise<ActionResult>) => void; pending: boolean }) {
  const [options, setOptions] = useState<FacultyOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<number>();
  const [subject, setSubject] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const search = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        setOptions(await searchCaseFaculty(d.app.ref, q));
      } finally {
        setLoading(false);
      }
    }, 250);
  };
  useEffect(() => {
    search("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.faculty.length]);
  const linkedIds = new Set(d.faculty.map((f) => f.facultyId));
  const chosen = options.find((o) => o.id === picked);
  const short = d.subjects.find((s) => s.linked < s.required)?.name;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 210px auto", gap: 8, marginBottom: 12 }} className="case-faculty-picker">
      <Select
        className="case-faculty-search"
        showSearch={{ filterOption: false, onSearch: search }}
        placeholder="Find by Faculty ID (PCP-FAC-…), CNIC or name"
        value={picked}
        onChange={(v) => {
          setPicked(v);
          const o = options.find((x) => x.id === v);
          if (!subject) setSubject(d.subjectNames.includes(o?.specialization ?? "") ? o?.specialization : short);
        }}
        notFoundContent={loading ? <Spin size="small" /> : "No active faculty match. Add the person under Faculty first."}
        options={options.map((o) => ({
          value: o.id,
          disabled: linkedIds.has(o.id),
          label: (
            <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                <span className="mono">{o.pcpId}</span> · {o.fullName} · {o.qualification} {o.specialization}
              </span>
              <span className="faint" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                {linkedIds.has(o.id) ? "linked" : o.verificationStatus === "FLAGGED" ? "flagged" : programLabel(o.programType)}
              </span>
            </span>
          ),
        }))}
      />
      <Select className="case-subject-select" placeholder="Subject" value={subject} onChange={setSubject} options={d.subjectNames.map((s) => ({ value: s, label: s }))} />
      <Button
        type="primary"
        icon={<UserAddOutlined />}
        disabled={!picked || !subject}
        loading={pending}
        onClick={() =>
          run(async () => {
            const r = await linkCaseFaculty(d.app.ref, picked!, subject!);
            if (r.ok) {
              setPicked(undefined);
              setSubject(undefined);
            }
            return r;
          })
        }
      >
        Link teacher
      </Button>
      {chosen ? (
        <div className="faint" style={{ gridColumn: "1 / -1", fontSize: 12 }}>
          {chosen.fullName} · {chosen.designation} · CNIC {chosen.cnic} · {chosen.verificationStatus === "VERIFIED" ? "verified by PCP" : chosen.verificationStatus.toLowerCase()}
        </div>
      ) : null}
    </div>
  );
}

function SelfAssessmentForm({ d, run, pending }: { d: AppDetail; run: (fn: () => Promise<ActionResult>) => void; pending: boolean }) {
  const init = SELF_ASSESSMENT_CRITERIA.map((criterion) => {
    const x = d.app.selfAssessment.find((s) => s.criterion === criterion);
    return { criterion, rating: (x?.rating ?? "") as "MET" | "PARTLY" | "NOT_MET" | "", comment: x?.comment ?? "" };
  });
  const [items, setItems] = useState(init);
  const set = (i: number, v: Partial<(typeof items)[number]>) => setItems((prev) => prev.map((x, j) => (j === i ? { ...x, ...v } : x)));
  return (
    <>
      {items.map((it, i) => (
        <div key={it.criterion} style={{ padding: "10px 0", borderBottom: "1px solid var(--line-2)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <b style={{ fontSize: 13.5 }}>
              {i + 1}. {it.criterion}
            </b>
            <Radio.Group
              size="small"
              optionType="button"
              className="self-rating"
              value={it.rating || undefined}
              onChange={(e) => set(i, { rating: e.target.value as "MET" })}
              options={[
                { value: "MET", label: "Met" },
                { value: "PARTLY", label: "Partly met" },
                { value: "NOT_MET", label: "Not met" },
              ]}
            />
          </div>
          {it.rating && it.rating !== "MET" ? <Input size="small" style={{ marginTop: 6 }} placeholder="What is missing and when it will be fixed" value={it.comment} onChange={(e) => set(i, { comment: e.target.value })} /> : null}
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, gap: 8, flexWrap: "wrap" }}>
        <FillDemo
          onClick={() =>
            setItems(items.map((x, i) => (i === 4 ? { ...x, rating: "PARTLY", comment: "Six journal subscriptions renewed; four more by December." } : { ...x, rating: "MET", comment: "" })))
          }
        />
        <Button type="primary" loading={pending} onClick={() => run(() => saveSelfAssessment(d.app.ref, items.filter((x) => x.rating)))}>
          Save self-assessment
        </Button>
      </div>
    </>
  );
}

export default function InstitutionApplicationView({ d, perms }: { d: AppDetail; perms: Perms }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [qr, setQr] = useState<string | null>(null);
  const [form] = Form.useForm();
  const { withOtp, otpModal } = useOtp();
  const draft = d.app.status === "DRAFT";
  const failing = d.app.checks.filter((c) => !c.ok).length;
  const checksPass = d.app.checks.length > 0 && failing === 0;
  const acc = d.app.kind !== "NOC";

  useEffect(() => {
    if (d.app.feePsid && !d.app.feePaidAt)
      QRCode.toDataURL(`RAAST-P2M|DEMO|PAYEE:PHARMACY COUNCIL OF PAKISTAN|PSID:${d.app.feePsid}|AMOUNT:${d.app.feeAmount}|REF:${d.app.ref}`, { width: 180, margin: 1, color: { dark: "#0a3d2e" } }).then(setQr);
  }, [d.app.feePsid, d.app.feePaidAt, d.app.feeAmount, d.app.ref]);

  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      try {
        const r = await fn();
        message[r.ok ? (r.level === "warning" ? "warning" : "success") : "error"](r.message, r.ok ? 3 : 6);
        router.refresh();
      } catch (e) {
        message.error(e instanceof Error ? e.message : "Something went wrong");
      }
    });

  const submitBlockers = [
    failing > 0 && `${failing} automatic check(s) failing`,
    d.app.checks.length === 0 && "Checks have not run yet",
    !d.app.feePaidAt && "Fee not paid",
  ].filter(Boolean) as string[];

  const inspection = d.inspections[0];
  const demoCampus = d.campuses.find((c) => /hayatabad/i.test(c.name)) ?? d.campuses[0];

  return (
    <>
      {otpModal}
      <AppHeader d={d} />
      <Row gutter={18}>
        <Col xs={24} lg={15}>
          {draft ? <Readiness d={d} /> : null}
          <DecisionCard d={d} />
          {d.app.status === "DEFERRED" && perms.canRespond ? <DeferralAnswer d={d} onDone={() => router.refresh()} /> : null}

          {d.deficiencies.length ? (
            <Card
              size="small"
              title={
                <span>
                  <WarningFilled style={{ color: "#d48806", marginRight: 8 }} />
                  Deficiencies raised by PCP
                </span>
              }
              style={{ marginBottom: 16, borderColor: "#ffd591" }}
            >
              {d.deficiencies.map((def) => (
                <div key={def.id} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14, marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                      <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{def.ref}</span>
                      <Pill value={def.status} />
                      <Tag>{def.criterion}</Tag>
                    </span>
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      Raised by {def.raisedBy} · due <b style={{ color: "var(--ink)" }}>{fmtDate(def.dueDate)}</b>
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "6px 12px", fontSize: 13.5, marginBottom: 10 }}>
                    <span className="muted">Required action</span>
                    <span>{def.requiredAction}</span>
                    <span className="muted">Evidence required</span>
                    <span>{def.evidenceRequired}</span>
                  </div>
                  {def.reviewNote ? <Alert type={def.status === "REJECTED" ? "error" : "success"} showIcon style={{ marginBottom: 8 }} title={`PCP review: ${def.reviewNote}`} /> : null}
                  {def.responseNote ? <Alert type="info" showIcon style={{ marginBottom: 8 }} title={`Your response (${def.respondedBy}, ${fmtDate(def.respondedAt)}): ${def.responseNote}`} /> : null}
                  {d.documents.filter((x) => x.deficiencyId === def.id).map((x) => (
                    <div key={x.id} style={{ fontSize: 13 }}>
                      Evidence: <a href={`/api/documents/${x.id}`} target="_blank" rel="noreferrer">{x.fileName}</a> <Tag>v{x.version}</Tag>
                    </div>
                  ))}
                  {perms.canRespond && (def.status === "OUTSTANDING" || def.status === "REJECTED") ? <DeficiencyResponse d={d} defId={def.id} onDone={() => router.refresh()} /> : null}
                </div>
              ))}
            </Card>
          ) : null}

          {inspection ? (
            <Card size="small" style={{ marginBottom: 16 }} data-testid="inst-inspection">
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{ width: 38, height: 38, borderRadius: 10, background: "#f2eefe", color: "#5b3cc4", display: "grid", placeItems: "center", fontSize: 17, flex: "none" }}>
                  <ScheduleOutlined />
                </span>
                {inspection.status === "SCHEDULED" ? (
                  <div style={{ fontSize: 13.5 }}>
                    <div>
                      PCP inspection on <b>{fmtDate(inspection.scheduledFor)}</b> with a team of <b>{inspection.team.length}</b>.
                    </div>
                    {inspection.scope ? (
                      <div style={{ marginTop: 6 }}>
                        <b>Please prepare:</b> {inspection.scope}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <span>Inspection completed on {fmtDate(inspection.scheduledFor)} by a team of {inspection.team.length}. PCP reviews the findings; any deficiency will appear above.</span>
                )}
              </div>
            </Card>
          ) : null}

          <Card
            size="small"
            id="case-form"
            title={acc ? "What changed: campus, intake, laboratories, library" : "Campus, intake, laboratories, library"}
            style={{ marginBottom: 16 }}
            extra={draft && perms.canEdit ? <FillDemo onClick={() => form.setFieldsValue({ ...(acc ? {} : DEMO_FORM), campusId: d.app.campusId ?? demoCampus?.id, ...(d.app.kind === "RENEWAL" ? { complianceConfirmed: true } : {}) })} /> : null}
          >
            {draft && perms.canEdit ? (
              <Form
                form={form}
                layout="vertical"
                initialValues={{ ...d.app.data, campusId: d.app.campusId ?? undefined }}
                onFinish={(v) => run(() => saveApplication(d.app.ref, v))}
              >
                {acc ? <Alert type="info" showIcon style={{ marginBottom: 12 }} title="Prepared from your existing records" description="Intake, faculty, laboratories and library come from the programme card and the last case. Change only what is different now." /> : null}
                <Row gutter={12}>
                  <Col xs={24} md={14}>
                    <Form.Item name="campusId" label="Campus" rules={[{ required: true, message: "Pick the campus this case is for" }]} extra={d.campuses.length > 1 ? `${d.campuses.length} campuses on your profile` : undefined}>
                      <Select placeholder="Pick the campus" options={d.campuses.map((c) => ({ value: c.id, label: `${c.name}${c.isMain ? " (main)" : ""}` }))} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={10}>
                    <Form.Item name="proposedIntake" label="Proposed intake (students per year)" rules={[{ required: true }]}>
                      <InputNumber min={1} style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={12}>
                  <Col xs={12} md={6}><Form.Item name="classrooms" label="Classrooms"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
                  <Col xs={12} md={6}><Form.Item name="labs" label="Laboratories"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
                  <Col xs={12} md={6}><Form.Item name="libraryBooks" label="Library books"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
                  <Col xs={12} md={6}><Form.Item name="libraryJournals" label="Journals"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
                </Row>
                <Row gutter={12}>
                  <Col xs={24} md={16}><Form.Item name="labList" label="Laboratories (list)"><Input placeholder="Pharmaceutics, Pharmacology, ..." /></Form.Item></Col>
                  <Col xs={24} md={8}><Form.Item name="buildingAreaSqft" label="Building area (sq ft)"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
                </Row>
                {d.app.kind === "RENEWAL" ? (
                  <Form.Item name="complianceConfirmed" valuePropName="checked">
                    <Checkbox>We confirm the programme complied with PCP&apos;s conditions in every year of the current accreditation term.</Checkbox>
                  </Form.Item>
                ) : null}
                <Form.Item name="notes" label="Notes"><Input.TextArea rows={2} /></Form.Item>
                <Button type="primary" htmlType="submit" loading={pending}>Save and run checks</Button>
              </Form>
            ) : (
              <>
                {draft ? <Alert type="info" showIcon style={{ marginBottom: 12 }} title="Your role can view this draft but not edit it." /> : null}
                <DataDescriptions d={d} />
              </>
            )}
          </Card>

          <Card
            size="small"
            id="case-faculty"
            title={
              <span>
                <TeamOutlined style={{ marginRight: 8, color: "var(--brand)" }} />
                Faculty linked by Faculty ID
              </span>
            }
            extra={draft && perms.canEdit ? <FillDemo label="Link by specialisation" onClick={() => run(() => autoLinkCaseFaculty(d.app.ref))} /> : null}
            style={{ marginBottom: 16 }}
          >
            <div style={{ marginBottom: 10 }}>
              <SubjectChips d={d} />
            </div>
            {draft && perms.canEdit ? <FacultyPicker d={d} run={run} pending={pending} /> : null}
            <CaseFacultyTable
              d={d}
              subjectCell={
                draft && perms.canEdit
                  ? (r) => <Select size="small" value={r.subject} style={{ minWidth: 170 }} onChange={(v) => run(() => linkCaseFaculty(d.app.ref, r.facultyId, v))} options={d.subjectNames.map((s) => ({ value: s, label: s }))} />
                  : undefined
              }
              actions={draft && perms.canEdit ? (r) => <Button size="small" type="text" danger icon={<DeleteOutlined />} title="Remove from this case" onClick={() => run(() => unlinkCaseFaculty(d.app.ref, r.facultyId))} /> : undefined}
            />
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: "10px 0 0" }}>
              Teachers are linked by their PCP Faculty ID, never typed in. Someone new? Add them under Faculty first; the duplicate check runs there.
            </Typography.Paragraph>
          </Card>

          {acc ? (
            <Card size="small" id="case-self" title="Self-assessment" extra={<span className="faint" style={{ fontSize: 12 }}>Rate each criterion; explain anything not fully met</span>} style={{ marginBottom: 16 }}>
              {draft && perms.canEdit ? <SelfAssessmentForm d={d} run={run} pending={pending} /> : <SelfAssessmentTable items={d.app.selfAssessment} />}
            </Card>
          ) : null}

          <DocumentsCard d={d} uploadable={draft && perms.canUpload} title="Application documents" />
          <MessagesCard d={d} />
        </Col>

        <Col xs={24} lg={9}>
          <CertificateCard d={d} />

          {draft ? (
            <div style={{ marginBottom: 16 }}>
              <ChecksCard checks={d.app.checks} onRecheck={() => run(() => recheck(d.app.ref))} recheckLoading={pending} fixLinks />
            </div>
          ) : null}

          <Card
            size="small"
            id="case-fee"
            style={{ marginBottom: 16 }}
            title={
              <span>
                <CreditCardOutlined style={{ marginRight: 8, color: "var(--brand)" }} />
                Fee
              </span>
            }
            extra={d.app.feePaidAt ? <Pill value="APPROVED" label="Paid" /> : <Pill value="PENDING" label="Unpaid" />}
          >
            <div className="tnum" style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" }}>{formatPKR(d.app.feeAmount)}</div>
            <div className="muted" style={{ marginBottom: 12, fontSize: 12.5 }}>{KIND_LABELS[d.app.kind]} fee per the PCP fee schedule</div>
            {d.app.feePaidAt ? (
              <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--good-50)", fontSize: 13 }}>
                <b style={{ color: "#0d7a3d" }}>Paid {fmtDate(d.app.feePaidAt, true)}</b> · {d.app.feeMethod}
                <div className="mono" style={{ marginTop: 2 }}>PSID {d.app.feePsid}</div>
              </div>
            ) : d.app.feePsid ? (
              <>
                <div style={{ display: "flex", gap: 14, alignItems: "center", padding: 12, border: "1px dashed var(--line)", borderRadius: 12 }}>
                  {qr ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qr} alt="Raast QR (demo)" width={120} height={120} />
                  ) : null}
                  <div style={{ fontSize: 12.5 }}>
                    <div className="muted">PSID (1Link)</div>
                    <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{d.app.feePsid}</div>
                    <div className="muted" style={{ marginTop: 8 }}>Pay in any banking app with Raast, or at any branch with the PSID.</div>
                  </div>
                </div>
                {perms.canPay ? (
                  <Button block type="primary" style={{ marginTop: 10 }} icon={<BankOutlined />} loading={pending} onClick={() => withOtp(`payment:${d.app.feePsid}`, "Confirm the fee payment", async (code) => run(() => payFeeDemo(d.app.ref, code)))}>
                    Simulate bank confirmation (demo)
                  </Button>
                ) : (
                  <Typography.Text type="secondary">Awaiting payment by the Head or the Finance officer.</Typography.Text>
                )}
              </>
            ) : draft && perms.canPay ? (
              <>
                {!checksPass ? (
                  <Alert type="warning" showIcon icon={<LockOutlined />} style={{ marginBottom: 10 }} title="Pay opens when every check passes" description={failing ? `${failing} check(s) still failing. Use the Fix links in Automatic checks.` : "Save the form to run the checks."} />
                ) : null}
                <Button block type="primary" disabled={!checksPass} loading={pending} onClick={() => run(() => generateChallan(d.app.ref))}>
                  Pay fee: generate challan (PSID + Raast QR)
                </Button>
              </>
            ) : (
              <Typography.Text type="secondary">{draft ? "The Head of institution or the Finance officer pays the fee once every check passes." : "No fee record."}</Typography.Text>
            )}
          </Card>

          {draft ? (
            <Card size="small" style={{ marginBottom: 16, borderColor: submitBlockers.length || !perms.canSubmit ? undefined : "#95d5b2" }} title="Submit to PCP">
              {!perms.canSubmit ? (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 10 }}
                  title="Ask your Head or Principal to submit"
                  description="Data entry cannot submit without a second check. Once everything is ready, the Head of institution or the Principal reviews the file and submits it."
                />
              ) : submitBlockers.length ? (
                <Alert type="warning" showIcon style={{ marginBottom: 10 }} title="Not ready to submit" description={<ul style={{ margin: 0, paddingLeft: 18 }}>{submitBlockers.map((b) => <li key={b}>{b}</li>)}</ul>} />
              ) : (
                <Alert type="success" showIcon style={{ marginBottom: 10 }} title="All checks pass and the fee is paid" />
              )}
              {perms.canSubmit ? (
                <Button type="primary" size="large" block icon={<SendOutlined />} disabled={submitBlockers.length > 0} loading={pending} onClick={() => run(() => submitApplication(d.app.ref))}>
                  Submit application
                </Button>
              ) : null}
            </Card>
          ) : (
            <div style={{ marginBottom: 16 }}>
              <ChecksCard checks={d.app.checks} title="Checks at submission" />
            </div>
          )}

          <TimelineCard d={d} />
        </Col>
      </Row>
    </>
  );
}

function DeficiencyResponse({ d, defId, onDone }: { d: AppDetail; defId: number; onDone: () => void }) {
  const { message } = App.useApp();
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const sendEvidence = async (file: File) => {
    try {
      await uploadDocument(file, { docType: "Deficiency evidence", applicationRef: d.app.ref, deficiencyId: String(defId) });
      message.success("Evidence uploaded");
      onDone();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Upload failed");
    }
  };
  return (
    <div style={{ background: "var(--bg)", padding: 12, borderRadius: 10, marginTop: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <b style={{ fontSize: 13 }}>Your response</b>
        <FillDemo onClick={() => setNote("Safety certificate obtained from the district fire officer; attached.")} />
      </div>
      <Input.TextArea rows={2} placeholder="What did you do to fix it?" value={note} onChange={(e) => setNote(e.target.value)} style={{ marginBottom: 8, background: "#fff" }} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Upload
          showUploadList={false}
          customRequest={async ({ file, onSuccess }) => {
            await sendEvidence(file as File);
            onSuccess?.({});
          }}
        >
          <Button icon={<UploadOutlined />}>Upload evidence</Button>
        </Upload>
        <SamplePdfButton docLabel="Lab safety certificate" onFile={sendEvidence} />
        <Button
          type="primary"
          loading={pending}
          style={{ marginLeft: "auto" }}
          onClick={() =>
            start(async () => {
              const r = await respondDeficiency(defId, note);
              message[r.ok ? "success" : "error"](r.message);
              if (r.ok) onDone();
            })
          }
        >
          Submit response
        </Button>
      </div>
    </div>
  );
}

/** Answer a deferral before its return date: a note and the evidence, filed on the case. */
function DeferralAnswer({ d, onDone }: { d: AppDetail; onDone: () => void }) {
  const { message } = App.useApp();
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const evidence = d.documents.filter((x) => x.docType === "Deferral evidence");
  const send = async (file: File) => {
    try {
      await uploadDocument(file, { docType: "Deferral evidence", applicationRef: d.app.ref });
      message.success("Evidence uploaded");
      onDone();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Upload failed");
    }
  };
  return (
    <Card size="small" title="Answer the deferral" style={{ marginBottom: 16, borderColor: "#ffe1a8" }} extra={<FillDemo onClick={() => setNote("Renewed appointment letter and the laboratory safety audit are attached.")} />} data-testid="deferral-answer">
      <Input.TextArea rows={2} placeholder="What you did about the reason for deferral" value={note} onChange={(e) => setNote(e.target.value)} style={{ marginBottom: 8 }} />
      {evidence.map((x) => (
        <div key={x.id} style={{ fontSize: 13 }}>
          Evidence: <a href={`/api/documents/${x.id}`} target="_blank" rel="noreferrer">{x.fileName}</a> <Tag>v{x.version}</Tag>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <Upload
          showUploadList={false}
          customRequest={async ({ file, onSuccess }) => {
            await send(file as File);
            onSuccess?.({});
          }}
        >
          <Button icon={<UploadOutlined />}>Upload evidence</Button>
        </Upload>
        <SamplePdfButton docLabel="Deferral evidence" onFile={send} />
        <Button
          type="primary"
          loading={pending}
          style={{ marginLeft: "auto" }}
          onClick={() =>
            start(async () => {
              const r = await answerDeferral(d.app.ref, note);
              message[r.ok ? "success" : "error"](r.message);
              if (r.ok) onDone();
            })
          }
        >
          Send to PCP
        </Button>
      </div>
    </Card>
  );
}
