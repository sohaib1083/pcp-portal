"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Col, DatePicker, Form, Input, InputNumber, Radio, Row, Select, Space, Table, Tag, Typography } from "antd";
import {
  AuditOutlined,
  BulbOutlined,
  CheckOutlined,
  CloseOutlined,
  ExperimentOutlined,
  PauseOutlined,
  RollbackOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  StopOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import {
  forwardToCouncil,
  issueCertificate,
  passScrutiny,
  raiseDeficiency,
  recordDecision,
  recordTechnicalReview,
  returnToCouncil,
  reviewDeficiency,
  scheduleInspection,
  startScrutiny,
} from "@/app/actions/pcp";
import type { ActionResult } from "@/app/actions/faculty";
import { suggestInspectionTeam } from "@/app/actions/inspection-team";
import type { AppDetail } from "@/lib/appdetail";
import type { TeamSuggestion as TeamSuggestionData } from "@/lib/inspection-team";
import { formatPKR } from "@/lib/format";
import { DEFICIENCY_FROM, PG_TECHNICAL_REVIEW_CRITERIA, TECHNICAL_REVIEW_CRITERIA } from "@/lib/workflow";
import { AppHeader, CaseFacultyTable, CertificateCard, ChecksCard, DataDescriptions, DecisionCard, DocumentsCard, MessagesCard, ScoreBadge, SelfAssessmentTable, SubjectChips, SupervisorChips, SupervisorTable, TimelineCard, checklistColumns } from "./AppParts";
import { Avatar, Pill, StatusDot, fmtDate } from "./common";
import CaseGovernanceNote from "./CaseGovernanceNote";
import CouncilAgendaNote from "./CouncilAgendaNote";
import { FillDemo } from "./demo-helpers";
import { useOtp } from "./OtpConfirm";
import TeamSuggestion from "./TeamSuggestion";
import CaseOverridePanel, { type OverrideData } from "./CaseOverridePanel";

/** `technical`: the technical review (academic check, PG proforma, supervisors) is the technical officer's (RFP 4.1.2). */
export type PcpPerms = { scrutiny: boolean; technical: boolean; schedule: boolean; decide: boolean; issue: boolean; submitInspection: boolean };
type Inspector = { username: string; name: string; province: string };
type Declared = { username: string; reason: string };

function ActionBlock({ title, sub, children, extra }: { title: string; sub?: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 600 }}>{title}</div>
          {sub ? <div className="muted" style={{ fontSize: 12.5 }}>{sub}</div> : null}
        </div>
        {extra}
      </div>
      {children}
    </div>
  );
}

type ReviewResult = "MEETS" | "PARTLY" | "DOES_NOT_MEET";

type SupResult = "ELIGIBLE" | "NOT_ELIGIBLE";

function TechnicalReviewForm({ d, run, pending }: { d: AppDetail; run: (fn: () => Promise<ActionResult>) => void; pending: boolean }) {
  const pg = d.pg;
  const [items, setItems] = useState((pg ? PG_TECHNICAL_REVIEW_CRITERIA : TECHNICAL_REVIEW_CRITERIA).map((criterion) => ({ criterion, result: "" as ReviewResult | "", remarks: "" })));
  const [sups, setSups] = useState(d.faculty.map((f) => ({ facultyId: f.facultyId, result: "" as SupResult | "", remarks: "" })));
  const [summary, setSummary] = useState("");
  const set = (i: number, v: Partial<(typeof items)[number]>) => setItems((prev) => prev.map((x, j) => (j === i ? { ...x, ...v } : x)));
  const setSup = (id: number, v: Partial<(typeof sups)[number]>) => setSups((prev) => prev.map((x) => (x.facultyId === id ? { ...x, ...v } : x)));
  const failing = d.subjects.filter((s) => s.linked < s.required);
  const confirmed = sups.filter((s) => s.result === "ELIGIBLE").length;
  return (
    <ActionBlock
      title={pg ? "Technical review: PG proforma and supervisors" : "Technical review"}
      sub={pg ? "Check the proforma against PCP's postgraduate standards and each supervisor against the rule. A standard not met needs a deficiency." : "Academic check against PCP standards. A criterion that does not meet the standard needs a deficiency."}
      extra={
        <FillDemo
          onClick={() => {
            setItems(items.map((x) => ({ ...x, result: "MEETS", remarks: "" })));
            setSups(sups.map((s) => {
              const j = pg?.judged.find((x) => x.facultyId === s.facultyId);
              return { ...s, result: j?.eligible === false ? "NOT_ELIGIBLE" : "ELIGIBLE", remarks: j?.eligible === false ? j.reasons.join("; ") : "" };
            }));
            setSummary(
              pg
                ? `Proforma meets the ${d.app.programType === "PHD" ? "PhD" : "MS/MPhil"} standards; supervisors checked against HEC records; intake of ${d.app.data.proposedIntake ?? "-"} fits. Proceed to inspection.`
                : `Faculty, laboratories and library meet the standards for an intake of ${d.app.data.proposedIntake ?? "-"}; proceed to inspection.`,
            );
          }}
        />
      }
    >
      {failing.length ? <Alert type="warning" showIcon style={{ marginBottom: 8 }} title={`Faculty short in ${failing.map((s) => s.name).join(", ")}`} /> : null}
      {pg && d.app.checks.some((c) => !c.ok) ? <Alert type="warning" showIcon style={{ marginBottom: 8 }} title="Some automatic checks were failing at submission. See Checks at submission." /> : null}
      {items.map((it, i) => (
        <div key={it.criterion} style={{ padding: "8px 0", borderBottom: "1px solid var(--line-2)" }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{it.criterion}</div>
          <Radio.Group
            size="small"
            optionType="button"
            className="review-rating"
            value={it.result || undefined}
            onChange={(e) => set(i, { result: e.target.value as ReviewResult })}
            options={[
              { value: "MEETS", label: "Meets" },
              { value: "PARTLY", label: "Partly" },
              { value: "DOES_NOT_MEET", label: "Does not meet" },
            ]}
          />
          {it.result && it.result !== "MEETS" ? <Input size="small" style={{ marginTop: 6 }} placeholder="Remark" value={it.remarks} onChange={(e) => set(i, { remarks: e.target.value })} /> : null}
        </div>
      ))}
      {pg ? (
        <div style={{ marginTop: 12 }} data-testid="supervisor-checks">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
            <b style={{ fontSize: 13 }}>Supervisor eligibility</b>
            <span className="faint" style={{ fontSize: 12 }}>
              {confirmed} confirmed · {pg.required} needed for intake {d.app.data.proposedIntake ?? 0}
            </span>
          </div>
          {d.faculty.map((f) => {
            const s = sups.find((x) => x.facultyId === f.facultyId)!;
            const j = pg.judged.find((x) => x.facultyId === f.facultyId);
            return (
              <div key={f.facultyId} style={{ padding: "8px 0", borderBottom: "1px solid var(--line-2)" }} className="supervisor-check" data-faculty={f.pcpId}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {f.fullName} <span className="mono faint" style={{ fontSize: 11.5 }}>{f.pcpId}</span>
                </div>
                <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>
                  Declared: {j?.summary}
                  {j && !j.eligible ? <span style={{ color: "#b4141f" }}> · {j.reasons.join("; ")}</span> : null}
                </div>
                <Radio.Group
                  size="small"
                  optionType="button"
                  className="supervisor-rating"
                  value={s.result || undefined}
                  // The reason for "not eligible" does not carry over when the officer changes the check back.
                  onChange={(e) => setSup(f.facultyId, e.target.value === "ELIGIBLE" && s.result === "NOT_ELIGIBLE" ? { result: "ELIGIBLE", remarks: "" } : { result: e.target.value as SupResult })}
                  options={[
                    { value: "ELIGIBLE", label: "Eligible" },
                    { value: "NOT_ELIGIBLE", label: "Not eligible" },
                  ]}
                />
                {s.result === "NOT_ELIGIBLE" || s.remarks ? <Input size="small" style={{ marginTop: 6 }} placeholder={s.result === "NOT_ELIGIBLE" ? "Why not eligible (required)" : "Remark"} value={s.remarks} onChange={(e) => setSup(f.facultyId, { remarks: e.target.value })} /> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <Input.TextArea rows={2} style={{ marginTop: 10 }} placeholder="Summary of the technical review" value={summary} onChange={(e) => setSummary(e.target.value)} />
      <Button
        type="primary"
        block
        style={{ marginTop: 10 }}
        icon={<ExperimentOutlined />}
        loading={pending}
        disabled={items.some((x) => !x.result) || (!!pg && sups.some((s) => !s.result))}
        onClick={() => run(() => recordTechnicalReview(d.app.ref, { items, summary, supervisors: sups.filter((s) => s.result) }))}
      >
        Record review: ready for inspection
      </Button>
    </ActionBlock>
  );
}

function ScheduleTeam({ d, inspectors, declared, run, pending }: { d: AppDetail; inspectors: Inspector[]; declared: Declared[]; run: (fn: () => Promise<ActionResult>) => void; pending: boolean }) {
  const { message } = App.useApp();
  const [lead, setLead] = useState<string>();
  const [members, setMembers] = useState<string[]>([]);
  const [date, setDate] = useState<string>(dayjs().add(10, "day").format("YYYY-MM-DD"));
  const [scope, setScope] = useState("");
  const [suggestion, setSuggestion] = useState<TeamSuggestionData | null>(null);
  const [used, setUsed] = useState<{ lead: string; members: string[]; date: string | null } | null>(null);
  const [asking, setAsking] = useState(false);
  const suggest = async () => {
    setAsking(true);
    try {
      const r = await suggestInspectionTeam(d.app.ref);
      if (r.ok) setSuggestion(r.suggestion);
      else message.error(r.message, 6);
    } finally {
      setAsking(false);
    }
  };
  const conflict = (u: string) => {
    const m = inspectors.find((i) => i.username === u);
    if (!m) return null;
    if (m.province === d.inst?.province) return `same province (${m.province})`;
    const dec = declared.find((x) => x.username === u);
    return dec ? `declared conflict: ${dec.reason}` : null;
  };
  const opt = (i: Inspector) => ({
    value: i.username,
    label: (
      <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span>
          {i.name} · {i.province}
        </span>
        {conflict(i.username) ? <span style={{ color: "#b4141f", fontSize: 12 }}>conflict</span> : null}
      </span>
    ),
  });
  const picked = [lead, ...members].filter(Boolean) as string[];
  const problems = picked.map((u) => ({ u, c: conflict(u) })).filter((x) => x.c);
  return (
    <ActionBlock
      title="Assign the inspection team"
      sub="A lead plus members. No member may inspect an institution in their own province or one they have declared a conflict with."
      extra={<FillDemo onClick={() => setScope("Faculty files and appointment letters for every linked teacher; laboratories with equipment registers; library stock and journal subscriptions; student records for the current intake.")} />}
    >
      <Space orientation="vertical" style={{ width: "100%" }}>
        {suggestion ? (
          <TeamSuggestion
            s={suggestion}
            onDismiss={() => setSuggestion(null)}
            onUse={(l, m, dt) => {
              setLead(l);
              setMembers(m);
              if (dt) setDate(dt);
              // The audit compares the booking with what the system proposed (before any swap).
              setUsed({ lead: suggestion.team.find((t) => t.role === "LEAD")?.username ?? l, members: suggestion.team.filter((t) => t.role !== "LEAD").map((t) => t.username), date: suggestion.date });
              setSuggestion(null);
              message.success("Team and date filled in below. Check them, add the scope, then Schedule and notify.", 4);
            }}
          />
        ) : (
          <Button block icon={<BulbOutlined />} loading={asking} onClick={suggest} className="suggest-team" style={{ borderColor: "#ddd3fb", color: "#5b3cc4", background: "#faf8ff" }}>
            Suggest a team
          </Button>
        )}
        <div className="faint" style={{ fontSize: 12 }}>Team lead (submits the checklist)</div>
        <Select className="pcp-inspector-select" placeholder="Inspection panel member" style={{ width: "100%" }} value={lead} onChange={setLead} options={inspectors.map(opt)} />
        <div className="faint" style={{ fontSize: 12 }}>Members (optional)</div>
        <Select
          className="pcp-team-select"
          mode="multiple"
          placeholder="Add members"
          style={{ width: "100%" }}
          value={members}
          onChange={setMembers}
          options={inspectors.filter((i) => i.username !== lead).map(opt)}
        />
        {problems.length ? (
          <Alert
            type="error"
            showIcon
            icon={<StopOutlined />}
            title="Conflict of interest"
            description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {problems.map((p) => (
                  <li key={p.u}>
                    {inspectors.find((i) => i.username === p.u)?.name}: {p.c}. The system will refuse the booking.
                  </li>
                ))}
              </ul>
            }
          />
        ) : null}
        <div className="faint" style={{ fontSize: 12 }}>Visit date</div>
        <DatePicker style={{ width: "100%" }} value={dayjs(date)} onChange={(v) => v && setDate(v.format("YYYY-MM-DD"))} />
        <Input.TextArea rows={3} placeholder="What the institution should prepare (scope)" value={scope} onChange={(e) => setScope(e.target.value)} />
        <Button type="primary" block icon={<TeamOutlined />} loading={pending} disabled={!lead} onClick={() => run(() => scheduleInspection(d.app.ref, lead!, date, { members, scope, suggestion: used }))}>
          Schedule and notify
        </Button>
      </Space>
    </ActionBlock>
  );
}

function DecisionPanel({ d, run, pending, withOtp }: { d: AppDetail; run: (fn: () => Promise<ActionResult>) => void; pending: boolean; withOtp: ReturnType<typeof useOtp>["withOtp"] }) {
  const [decision, setDecision] = useState<"APPROVED" | "DEFERRED" | "REJECTED">("APPROVED");
  const [note, setNote] = useState("");
  const [grounds, setGrounds] = useState("");
  const [until, setUntil] = useState(dayjs().add(30, "day").format("YYYY-MM-DD"));
  const record = () =>
    withOtp(`decision:${d.app.ref}`, "Record the council decision", (code) =>
      run(() => recordDecision(d.app.ref, decision, note, { grounds: decision === "APPROVED" ? undefined : grounds, deferUntil: decision === "DEFERRED" ? until : undefined, otp: code })),
    );
  const label = { APPROVED: "Record approval", DEFERRED: "Record deferral", REJECTED: "Record rejection" }[decision];
  return (
    <ActionBlock
      title="Record council decision"
      sub="Each outcome generates a standard decision letter. A one-time code confirms it."
      extra={
        <FillDemo
          onClick={() => {
            if (decision === "APPROVED") setNote("Approved; lab signage within 3 months.");
            else if (decision === "DEFERRED") setGrounds("Upload renewed appointment letters for the two contract lecturers and the laboratory safety audit.");
            else setGrounds("Faculty strength is below the PCP standard for the requested intake and the deficiencies were not resolved.");
          }}
        />
      }
    >
      <Radio.Group
        className="decision-choice"
        optionType="button"
        buttonStyle="solid"
        value={decision}
        onChange={(e) => setDecision(e.target.value)}
        style={{ display: "flex", marginBottom: 10 }}
        options={[
          { value: "APPROVED", label: <span><CheckOutlined /> Approve</span>, style: { flex: 1, textAlign: "center" } },
          { value: "DEFERRED", label: <span><PauseOutlined /> Defer</span>, style: { flex: 1, textAlign: "center" } },
          { value: "REJECTED", label: <span><CloseOutlined /> Reject</span>, style: { flex: 1, textAlign: "center" } },
        ]}
      />
      {decision === "APPROVED" ? (
        <Input.TextArea rows={2} placeholder="Decision note / conditions (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ marginBottom: 10 }} />
      ) : decision === "DEFERRED" ? (
        <>
          <Input.TextArea rows={3} placeholder="Reason for deferral: what the institution must do" value={grounds} onChange={(e) => setGrounds(e.target.value)} style={{ marginBottom: 8 }} />
          <div className="faint" style={{ fontSize: 12, marginBottom: 4 }}>Return date (the case comes back to the council after it)</div>
          <DatePicker className="defer-until" style={{ width: "100%", marginBottom: 10 }} value={dayjs(until)} disabledDate={(v) => v.isBefore(dayjs().add(1, "day"), "day")} onChange={(v) => v && setUntil(v.format("YYYY-MM-DD"))} />
        </>
      ) : (
        <Input.TextArea rows={3} placeholder="Grounds for rejection" value={grounds} onChange={(e) => setGrounds(e.target.value)} style={{ marginBottom: 10 }} />
      )}
      <Button type="primary" danger={decision === "REJECTED"} block loading={pending} disabled={decision !== "APPROVED" && grounds.trim().length < 10} onClick={record}>
        {label}
      </Button>
    </ActionBlock>
  );
}

export default function PcpApplicationView({
  d,
  perms,
  username,
  inspectors,
  declared,
  override,
}: {
  d: AppDetail;
  perms: PcpPerms;
  username: string;
  inspectors: Inspector[];
  declared: Declared[];
  /** Super Administrator only: the override panel (RFP 4.1.2). */
  override?: OverrideData | null;
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [defForm] = Form.useForm();
  const { withOtp, otpModal } = useOtp();
  const s = d.app.status;

  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      message[r.ok ? "success" : "error"](r.message, r.ok ? 3 : 6);
      if (r.ok) setNote("");
      // A refused step changes nothing on the case: no refresh, so the buttons are ready again at once.
      if (r.ok) router.refresh();
    });

  const scheduled = d.inspections.find((i) => i.status === "SCHEDULED");
  const myRole = scheduled?.team.find((m) => m.username === username)?.role;
  const openDefs = d.deficiencies.filter((x) => x.status !== "ACCEPTED" && x.status !== "WITHDRAWN");
  const acc = d.app.kind !== "NOC";
  const pg = !!d.pg;
  // The technical officer raises (and reviews the answers to) deficiencies found in the technical review.
  const technicalStage = s === "TECHNICAL_REVIEW" && !d.reviewDone;
  const canRaise = perms.scrutiny || (perms.technical && technicalStage);
  const canReviewResponses = perms.scrutiny || (perms.technical && d.deficiencyOrigin === "TECHNICAL_REVIEW");

  const panels: React.ReactNode[] = [];

  if (perms.technical && technicalStage) panels.push(<TechnicalReviewForm key="tr" d={d} run={run} pending={pending} />);

  if (perms.scrutiny) {
    if (s === "SUBMITTED")
      panels.push(
        <ActionBlock key="scrutiny" title="Start scrutiny" sub="Assigns the case to you; the institution sees your name.">
          <Button type="primary" block size="large" icon={<UserOutlined />} loading={pending} onClick={() => run(() => startScrutiny(d.app.ref))}>
            Start scrutiny (assign to me)
          </Button>
        </ActionBlock>,
      );
    if (s === "UNDER_SCRUTINY")
      panels.push(
        <ActionBlock key="pass" title="Pass initial scrutiny" sub="Documents and data are complete. The case moves to the technical review.">
          <Button type="primary" block icon={<CheckOutlined />} loading={pending} disabled={openDefs.length > 0} onClick={() => run(() => passScrutiny(d.app.ref))}>
            Pass scrutiny: start technical review
          </Button>
          {openDefs.length ? <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>Resolve the open deficiencies first.</div> : null}
        </ActionBlock>,
      );
  }
  if (canRaise) {
    if (DEFICIENCY_FROM.includes(s) && !(s === "TECHNICAL_REVIEW" && d.reviewDone))
      panels.push(
        <ActionBlock
          key="def"
          title="Raise a formal deficiency"
          sub="Gets an ID, a deadline and the evidence required. The case returns to this stage once the responses are accepted."
          extra={
            <FillDemo
              onClick={() =>
                defForm.setFieldsValue(
                  pg
                    ? { criterion: "Supervisors", requiredAction: "Upload the HEC supervisor approval letter or the publication list for each supervisor short of the rule", evidenceRequired: "HEC approval letter or publication list", dueDays: 30 }
                    : { criterion: "Laboratories", requiredAction: "Upload the lab safety certificate for the Pharmaceutics lab", evidenceRequired: "Safety certificate", dueDays: 30 },
                )
              }
            />
          }
        >
          <Form form={defForm} layout="vertical" requiredMark={false} initialValues={{ dueDays: 30, criterion: pg ? "Supervisors" : "Faculty" }} onFinish={(v) => run(() => raiseDeficiency(d.app.ref, v))}>
            <Row gutter={10}>
              <Col span={14}>
                <Form.Item name="criterion" label="Criterion" rules={[{ required: true }]}>
                  <Select options={(pg ? ["Supervisors", "HEC NOC", "Coursework", "Research laboratories", "Library", "Documents", "Finance"] : ["Faculty", "Laboratories", "Library", "Infrastructure", "Documents", "Finance"]).map((x) => ({ value: x }))} />
                </Form.Item>
              </Col>
              <Col span={10}>
                <Form.Item name="dueDays" label="Deadline (days)">
                  <InputNumber min={1} max={120} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="requiredAction" label="Required action" rules={[{ required: true }]}>
              <Input.TextArea rows={2} placeholder="e.g. Appoint a qualified faculty member" />
            </Form.Item>
            <Form.Item name="evidenceRequired" label="Evidence required" rules={[{ required: true }]}>
              <Input placeholder="e.g. Appointment letter + CV" />
            </Form.Item>
            <Button htmlType="submit" danger loading={pending}>
              Raise deficiency
            </Button>
          </Form>
        </ActionBlock>,
      );
  }
  if (perms.scrutiny) {
    if (s === "INSPECTION_SUBMITTED")
      panels.push(
        <ActionBlock key="fwd" title="Forward to council" sub="Your recommendation goes on the council agenda." extra={<FillDemo onClick={() => setNote(`Recommend approval for an intake of ${d.app.data.proposedIntake ?? 60}. Inspection found all criteria compliant.`)} />}>
          <Input.TextArea rows={3} placeholder="Recommendation for the council" value={note} onChange={(e) => setNote(e.target.value)} style={{ marginBottom: 10 }} />
          <Button type="primary" block icon={<SendOutlined />} loading={pending} onClick={() => run(() => forwardToCouncil(d.app.ref, note))}>
            Forward to council agenda
          </Button>
        </ActionBlock>,
      );
    if (s === "DEFERRED")
      panels.push(
        <ActionBlock key="return" title="Return to the council" sub={`Deferred until ${fmtDate(d.app.deferUntil)}. When the institution has answered the reason, put the case back on the agenda.`} extra={<FillDemo onClick={() => setNote("Renewed appointment letters and the safety audit are now on file.")} />}>
          <Input.TextArea rows={2} placeholder="What changed since the deferral" value={note} onChange={(e) => setNote(e.target.value)} style={{ marginBottom: 10 }} />
          <Button type="primary" block icon={<RollbackOutlined />} loading={pending} onClick={() => run(() => returnToCouncil(d.app.ref, note))}>
            Return to council agenda
          </Button>
        </ActionBlock>,
      );
  }

  if (perms.schedule && s === "TECHNICAL_REVIEW" && d.reviewDone) panels.push(<ScheduleTeam key="team" d={d} inspectors={inspectors} declared={declared} run={run} pending={pending} />);

  if (scheduled && myRole === "LEAD" && perms.submitInspection)
    panels.push(
      <ActionBlock key="fill" title="Your inspection (team lead)" sub={`Scheduled for ${fmtDate(scheduled.scheduledFor)} · team of ${scheduled.team.length}`}>
        <Link href={`/pcp/inspections/${scheduled.id}`}>
          <Button type="primary" block size="large">
            Open my inspection checklist
          </Button>
        </Link>
      </ActionBlock>,
    );
  if (scheduled && myRole === "MEMBER")
    panels.push(
      <ActionBlock key="member" title="Your inspection (team member)" sub={`Scheduled for ${fmtDate(scheduled.scheduledFor)}. The lead, ${scheduled.inspectorName}, submits the checklist.`}>
        <Link href={`/pcp/inspections/${scheduled.id}`}>
          <Button block>Open the visit</Button>
        </Link>
      </ActionBlock>,
    );

  if (perms.decide && s === "COUNCIL_REVIEW") panels.push(<DecisionPanel key="council" d={d} run={run} pending={pending} withOtp={withOtp} />);
  if (perms.issue && s === "APPROVED")
    panels.push(
      <ActionBlock key="issue" title="Issue the certificate" sub="Generates a signed PDF with a QR code and files it in the institution's folder. A one-time code confirms it.">
        <Button
          type="primary"
          block
          size="large"
          icon={<SafetyCertificateOutlined />}
          loading={pending}
          onClick={() => withOtp(`certificate:${d.app.ref}`, "Issue the certificate", (code) => run(() => issueCertificate(d.app.ref, code)))}
        >
          {acc ? "Issue accreditation certificate (QR + signed PDF)" : "Issue NOC certificate (QR + signed PDF)"}
        </Button>
      </ActionBlock>,
    );

  // An administrative hold stops every step: nobody's panels apply until the super administrator releases it.
  if (d.hold) panels.length = 0;

  const report = d.inspections.find((i) => i.status === "SUBMITTED");

  return (
    <>
      {otpModal}
      <AppHeader
        d={d}
        extra={
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 12, alignSelf: "flex-start" }}>
            {d.app.assignedOfficerName ? <Avatar name={d.app.assignedOfficerName} size={30} /> : null}
            <div style={{ lineHeight: 1.3 }}>
              <div className="faint" style={{ fontSize: 11.5 }}>Assigned officer</div>
              <b style={{ fontSize: 13 }}>{d.app.assignedOfficerName ?? "Unassigned"}</b>
            </div>
          </div>
        }
      />
      <CouncilAgendaNote caseRef={d.app.ref} status={s} />
      <CaseGovernanceNote refNo={d.app.ref} status={s} />
      <Row gutter={18}>
        <Col xs={24} lg={15}>
          <DecisionCard d={d} />
          {report ? (
            <Card
              size="small"
              style={{ marginBottom: 16 }}
              title={
                <span>
                  <AuditOutlined style={{ marginRight: 8, color: "#5b3cc4" }} />
                  Inspection report · {fmtDate(report.scheduledFor)}
                </span>
              }
              extra={<span className="faint" style={{ fontSize: 12 }}>Team: {report.team.map((m) => `${m.name}${m.role === "LEAD" ? " (lead)" : ""}`).join(", ")}</span>}
            >
              {report.score ? (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 12px", marginBottom: 10, borderRadius: 10, background: report.score.passed ? "#f3fbf6" : "#fff6f5", border: `1px solid ${report.score.passed ? "#c9ecd8" : "#ffccc7"}` }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>Inspection score</span>
                  <ScoreBadge s={report.score} />
                </div>
              ) : null}
              <Table size="small" rowKey="criterion" pagination={false} dataSource={report.checklist} scroll={{ x: true }} columns={checklistColumns(report.maxScore)} />
              <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--bg)", borderRadius: 10, fontSize: 13.5 }}>
                <b>Lead&apos;s summary:</b> {report.summary}
              </div>
            </Card>
          ) : scheduled ? (
            <Card size="small" style={{ marginBottom: 16 }} title={<span><TeamOutlined style={{ marginRight: 8, color: "#5b3cc4" }} />Inspection on {fmtDate(scheduled.scheduledFor)}</span>} data-testid="pcp-inspection-team">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                {scheduled.team.map((m) => (
                  <StatusDot key={m.username} tone={m.role === "LEAD" ? "violet" : "neutral"}>
                    {m.name} · {m.province} {m.role === "LEAD" ? "(lead)" : ""}
                  </StatusDot>
                ))}
              </div>
              {scheduled.scope ? <div style={{ fontSize: 13 }}><b>Scope:</b> {scheduled.scope}</div> : null}
            </Card>
          ) : null}
          {d.technicalReview ? (
            <Card size="small" style={{ marginBottom: 16 }} title={<span><ExperimentOutlined style={{ marginRight: 8, color: "var(--brand)" }} />Technical review · {d.technicalReview.reviewer} · {fmtDate(d.technicalReview.createdAt)}</span>}>
              <Table
                size="small"
                rowKey="criterion"
                pagination={false}
                dataSource={d.technicalReview.items}
                columns={[
                  { title: "Criterion", dataIndex: "criterion" },
                  { title: "Result", dataIndex: "result", width: 110, render: (v) => <StatusDot tone={v === "MEETS" ? "good" : v === "PARTLY" ? "warn" : "bad"}>{v === "MEETS" ? "Meets" : v === "PARTLY" ? "Partly" : "Does not meet"}</StatusDot> },
                  { title: "Remarks", dataIndex: "remarks", render: (v) => v || <span className="faint">—</span> },
                ]}
              />
              {d.technicalReview.supervisors.length ? (
                <>
                  <div style={{ fontWeight: 600, fontSize: 13, margin: "12px 0 6px" }}>Supervisor eligibility</div>
                  <Table
                    size="small"
                    rowKey="facultyId"
                    pagination={false}
                    dataSource={d.technicalReview.supervisors}
                    data-testid="review-supervisors"
                    columns={[
                      { title: "Supervisor", render: (_, r) => <span>{r.name} <span className="mono faint" style={{ fontSize: 11.5 }}>{r.pcpId}</span></span> },
                      { title: "Check", dataIndex: "result", width: 120, render: (v) => <StatusDot tone={v === "ELIGIBLE" ? "good" : "bad"}>{v === "ELIGIBLE" ? "Eligible" : "Not eligible"}</StatusDot> },
                      { title: "Remarks", dataIndex: "remarks", render: (v) => v || <span className="faint">—</span> },
                    ]}
                  />
                </>
              ) : null}
              <div style={{ marginTop: 10, fontSize: 13.5 }}>
                <b>Summary:</b> {d.technicalReview.summary}
              </div>
            </Card>
          ) : null}
          {d.deficiencies.length ? (
            <Card size="small" title="Deficiencies" style={{ marginBottom: 16 }}>
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={d.deficiencies}
                expandable={{
                  expandedRowRender: (r) => (
                    <div style={{ fontSize: 13 }}>
                      <div>
                        <b>Required:</b> {r.requiredAction} · <b>Evidence:</b> {r.evidenceRequired}
                      </div>
                      {r.responseNote ? (
                        <div style={{ marginTop: 6 }}>
                          <b>Institution response ({r.respondedBy}):</b> {r.responseNote}
                        </div>
                      ) : null}
                      {d.documents.filter((x) => x.deficiencyId === r.id).map((x) => (
                        <div key={x.id}>
                          Evidence: <a href={`/api/documents/${x.id}`} target="_blank" rel="noreferrer">{x.fileName}</a>
                        </div>
                      ))}
                    </div>
                  ),
                  defaultExpandAllRows: true,
                }}
                columns={[
                  { title: "Ref", dataIndex: "ref", render: (v) => <span className="mono">{v}</span> },
                  { title: "Criterion", dataIndex: "criterion", render: (v) => <Tag>{v}</Tag> },
                  { title: "Due", dataIndex: "dueDate", render: (v) => fmtDate(v) },
                  { title: "Status", dataIndex: "status", render: (v) => <Pill value={v} /> },
                  {
                    title: "",
                    render: (_, r) =>
                      canReviewResponses && r.status === "RESPONDED" ? (
                        <Space size={4}>
                          <Button size="small" type="primary" loading={pending} onClick={() => run(() => reviewDeficiency(r.id, true, "Evidence accepted"))}>
                            Accept
                          </Button>
                          <Button size="small" danger loading={pending} onClick={() => run(() => reviewDeficiency(r.id, false, "Evidence not sufficient; resubmit"))}>
                            Reject
                          </Button>
                        </Space>
                      ) : null,
                  },
                ]}
              />
            </Card>
          ) : null}
          <Card size="small" title={pg ? "PG proforma" : "Application data"} style={{ marginBottom: 16 }}>
            <DataDescriptions d={d} />
          </Card>
          {pg ? (
            <Card size="small" title={<span><TeamOutlined style={{ marginRight: 8, color: "var(--brand)" }} />Supervisors linked by Faculty ID</span>} extra={<SupervisorChips d={d} />} style={{ marginBottom: 16 }}>
              <SupervisorTable d={d} />
            </Card>
          ) : (
            <Card size="small" title={<span><TeamOutlined style={{ marginRight: 8, color: "var(--brand)" }} />Faculty linked by Faculty ID</span>} extra={<SubjectChips d={d} />} style={{ marginBottom: 16 }}>
              <CaseFacultyTable d={d} />
            </Card>
          )}
          {acc && !pg ? (
            <Card size="small" title="Self-assessment" style={{ marginBottom: 16 }}>
              <SelfAssessmentTable items={d.app.selfAssessment} />
            </Card>
          ) : null}
          <DocumentsCard d={d} uploadable={false} />
          <MessagesCard d={d} />
        </Col>
        <Col xs={24} lg={9}>
          <Card
            size="small"
            title="Your next step"
            style={{ marginBottom: 16, borderColor: panels.length ? "#95d5b2" : undefined, boxShadow: panels.length ? "0 0 0 3px #e8f3ee" : undefined }}
            styles={{ body: { background: panels.length ? "#fbfdfc" : undefined } }}
          >
            {panels.length ? (
              <Space orientation="vertical" style={{ width: "100%" }} size={12}>
                {panels}
              </Space>
            ) : d.hold ? (
              <Typography.Text type="secondary">The case is on administrative hold. No step can be taken until the super administrator releases it.</Typography.Text>
            ) : (
              <Typography.Text type="secondary">Nothing for your role at this stage. The banner above shows who holds the file.</Typography.Text>
            )}
          </Card>
          {override ? <CaseOverridePanel key={`${d.overrides.length}-${s}-${d.hold ? 1 : 0}`} d={d} data={override} run={run} pending={pending} withOtp={withOtp} /> : null}
          <CertificateCard d={d} />
          <Card size="small" title="Fee" style={{ marginBottom: 16 }} extra={d.app.feePaidAt ? <Pill value="APPROVED" label={`Paid ${fmtDate(d.app.feePaidAt)}`} /> : <Pill value="REJECTED" label="Unpaid" />}>
            <div className="tnum" style={{ fontSize: 20, fontWeight: 700 }}>{formatPKR(d.app.feeAmount)}</div>
            <div className="mono muted" style={{ marginTop: 2 }}>
              PSID {d.app.feePsid ?? "—"} · {d.app.feeMethod ?? ""}
            </div>
          </Card>
          <div style={{ marginBottom: 16 }}>
            <ChecksCard checks={d.app.checks} title="Checks at submission" />
          </div>
          <TimelineCard d={d} />
        </Col>
      </Row>
    </>
  );
}
