"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Col, DatePicker, Empty, Form, Input, Modal, Popconfirm, Radio, Row, Select, Steps, Tag } from "antd";
import {
  AuditOutlined,
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  LockOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  SafetyOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { buildAgenda, closeMeeting, recordItemDecision, removeAgendaItem, setDraftDecision, startSession } from "@/app/actions/council";
import type { ActionResult } from "@/app/actions/faculty";
import type { AgendaItem, MeetingDetail } from "@/lib/council-data";
import { PageTitle, StatusTag, fmtDate } from "./common";
import { DECISION_TEXT, DecisionPill, DocLink, ModuleStatus, Quote } from "./CouncilParts";
import { FillDemo } from "./demo-helpers";
import { useOtp } from "./OtpConfirm";
import ScreenGuide from "./ScreenGuide";

const CASE_DECISIONS = ["APPROVED", "DEFERRED", "REJECTED"] as const;
const APPEAL_DECISIONS = ["UPHELD", "DISMISSED"] as const;
const ICON: Record<string, React.ReactNode> = { APPROVED: <CheckOutlined />, DEFERRED: <PauseOutlined />, REJECTED: <CloseOutlined />, UPHELD: <CheckOutlined />, DISMISSED: <CloseOutlined /> };

const itemRef = (it: AgendaItem) => (it.kind === "case" ? it.case!.ref : it.appeal!.ref);

function DecisionModal({ item, onClose }: { item: AgendaItem; onClose: () => void }) {
  const { message } = App.useApp();
  const router = useRouter();
  const { withOtp, otpModal } = useOtp();
  const [form] = Form.useForm();
  const isCase = item.kind === "case";
  const options = isCase ? CASE_DECISIONS : APPEAL_DECISIONS;
  const initial = item.draftDecision && (options as readonly string[]).includes(item.draftDecision) ? item.draftDecision : options[0];
  const decision = Form.useWatch("decision", form) ?? initial;
  const ref = itemRef(item);

  const noteLabel: Record<string, string> = {
    APPROVED: "Conditions or note (optional)",
    DEFERRED: "Reason for deferral",
    REJECTED: "Grounds for rejection",
    UPHELD: "Reasons (optional)",
    DISMISSED: "Reasons for dismissing the appeal",
  };
  const noteRequired = ["DEFERRED", "REJECTED", "DISMISSED"].includes(decision);
  const demo: Record<string, string> = {
    APPROVED: "Approved for the recommended intake; library journals to reach 20 subscriptions within 6 months.",
    DEFERRED: "Deferred until the institution submits the laboratory safety audit and two further appointment letters.",
    REJECTED: "Faculty below the minimum for the requested intake and two laboratories missing at inspection.",
    UPHELD: "The appointment letters filed with the appeal show the faculty were in post before the decision; the case is to be decided afresh.",
    DISMISSED: "The evidence post-dates the decision and does not address the grounds; the decision stands.",
  };

  const submit = async () => {
    const v = await form.validateFields();
    const payload = { decision: v.decision, note: v.note ?? "", deferUntil: v.deferUntil ? dayjs(v.deferUntil).format("YYYY-MM-DD") : null, grounds: v.decision === "REJECTED" ? v.note : null };
    await withOtp(`decision:${ref}`, `${DECISION_TEXT[v.decision]}: ${ref}`, async (code) => {
      const r: ActionResult = await recordItemDecision(item.id, { ...payload, otp: code });
      message[r.ok ? "success" : "error"](r.message, r.ok ? 4 : 8);
      if (r.ok) onClose();
      router.refresh();
    });
  };

  return (
    <>
      <Modal
        open
        width={620}
        title={
          <span>
            <SafetyOutlined style={{ color: "var(--brand)", marginRight: 8 }} />
            Record the council decision · <span className="mono">{ref}</span>
          </span>
        }
        okText="Continue to one-time code"
        onOk={submit}
        onCancel={onClose}
        destroyOnHidden
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            {isCase ? `${item.case!.inst?.name} · ${item.case!.label}` : `Appeal by ${item.appeal!.inst?.name} against the decision on ${item.appeal!.caseRef}`}
          </span>
          <FillDemo onClick={() => form.setFieldsValue({ note: demo[decision], deferUntil: decision === "DEFERRED" ? dayjs().add(45, "day") : undefined })} />
        </div>
        <Form form={form} layout="vertical" requiredMark={false} initialValues={{ decision: initial }}>
          <Form.Item name="decision" label="Decision">
            <Radio.Group optionType="button" buttonStyle="solid" style={{ display: "flex" }}>
              {options.map((o) => (
                <Radio.Button key={o} value={o} style={{ flex: 1, textAlign: "center" }}>
                  {ICON[o]} {DECISION_TEXT[o]}
                </Radio.Button>
              ))}
            </Radio.Group>
          </Form.Item>
          {item.draftDecision ? (
            <div className="faint" style={{ fontSize: 12.5, marginTop: -12, marginBottom: 12 }}>
              Draft before the meeting: {DECISION_TEXT[item.draftDecision]}
            </div>
          ) : null}
          <Form.Item
            name="note"
            label={noteLabel[decision]}
            rules={noteRequired ? [{ required: true, min: 5, message: decision === "REJECTED" ? "A rejection must state its grounds." : decision === "DEFERRED" ? "Say why the case is deferred and what must happen first." : "Give the council's reasons." }] : []}
          >
            <Input.TextArea id="decision-note" rows={3} placeholder={decision === "DEFERRED" ? "What must happen before the case returns" : decision === "REJECTED" ? "The grounds, as they will appear in the letter" : "Optional"} />
          </Form.Item>
          {decision === "DEFERRED" ? (
            <Form.Item name="deferUntil" label="Return date" rules={[{ required: true, message: "A deferral needs a date to return." }]} extra="A deferral is not a silent hold: the case comes back to the council on this date.">
              <DatePicker id="defer-until" style={{ width: "100%" }} format="D MMM YYYY" disabledDate={(d) => !d.isAfter(dayjs(), "day")} />
            </Form.Item>
          ) : null}
        </Form>
        <Alert
          type="info"
          showIcon
          icon={<LockOutlined />}
          title={isCase ? "The decision is recorded on the case, the institution is notified and the decision letter is generated." : decision === "UPHELD" ? `Upholding reopens ${item.appeal!.caseRef} for a fresh council decision. The decision letter is generated.` : `Dismissing leaves the decision on ${item.appeal!.caseRef} standing. The decision letter is generated.`}
        />
      </Modal>
      {otpModal}
    </>
  );
}

function InspectionBlock({ i }: { i: NonNullable<NonNullable<AgendaItem["case"]>["inspection"]> }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <span className="pcp-section-title">
          <AuditOutlined style={{ color: "#5b3cc4", marginRight: 6 }} />
          Inspection report
        </span>
        <span className="faint" style={{ fontSize: 12.5 }}>
          {i.inspector} · {fmtDate(i.date)}
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Tag color="green" style={{ margin: 0 }}>{i.compliant} compliant</Tag>
        {i.partial ? <Tag color="gold" style={{ margin: 0 }}>{i.partial} partial</Tag> : null}
        {i.nonCompliant ? <Tag color="red" style={{ margin: 0 }}>{i.nonCompliant} non-compliant</Tag> : null}
        <span className="faint" style={{ fontSize: 12 }}>of {i.total} criteria</span>
      </div>
      {i.summary ? <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>{i.summary}</div> : null}
      {i.issues.length ? (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--ink-2)" }}>
          {i.issues.map((x) => (
            <li key={x.criterion}>
              <b style={{ fontWeight: 600 }}>{x.criterion.split(":")[0]}</b>
              {x.remarks ? `: ${x.remarks}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {i.reportDocumentId ? <DocLink id={i.reportDocumentId} label="Inspection report (PDF)" /> : null}
    </div>
  );
}

function ItemCard({ it, status, canManage, canDecide, onDecide, run, pending }: { it: AgendaItem; status: string; canManage: boolean; canDecide: boolean; onDecide: () => void; run: (fn: () => Promise<ActionResult>) => void; pending: boolean }) {
  const ref = itemRef(it);
  const isCase = it.kind === "case";
  const c = it.case;
  const a = it.appeal;
  const decidedElsewhere = isCase && !it.decision && c!.status !== "COUNCIL_REVIEW";
  const appealClosed = !isCase && !it.decision && ["UPHELD", "DISMISSED", "WITHDRAWN"].includes(a!.status);
  const options = (isCase ? CASE_DECISIONS : APPEAL_DECISIONS).map((o) => ({ value: o, label: DECISION_TEXT[o] }));
  const inst = isCase ? c!.inst : a!.inst;

  return (
    <Card
      data-item={ref}
      className="council-item"
      style={{ marginBottom: 14, borderColor: it.decision ? "#c9ecd8" : undefined }}
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "6px 0" }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: it.decision ? "var(--good)" : "var(--brand-50)", color: it.decision ? "#fff" : "var(--brand)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13 }}>{it.decision ? <CheckOutlined /> : it.position}</span>
          <Link href={isCase ? `/pcp/applications/${ref}` : `/pcp/appeals/${ref}`} className="mono" style={{ fontWeight: 650, fontSize: 14 }}>
            {ref}
          </Link>
          <Tag color={isCase ? "cyan" : "purple"} style={{ margin: 0 }}>
            {isCase ? "Case" : "Appeal"}
          </Tag>
          <span style={{ fontWeight: 500 }}>{isCase ? c!.label : `against the decision on ${a!.caseRef}`}</span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 13 }}>
            {inst?.name}
          </span>
        </div>
      }
      extra={
        it.decision ? (
          <DecisionPill decision={it.decision} />
        ) : canManage && status !== "CLOSED" && !decidedElsewhere && !appealClosed ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span className="faint" style={{ fontSize: 12.5 }}>Draft</span>
            <Select
              size="small"
              className="draft-select"
              style={{ width: 170 }}
              allowClear
              placeholder="No draft yet"
              value={it.draftDecision ?? undefined}
              options={options}
              onChange={(v) => run(() => setDraftDecision(it.id, v ?? null))}
            />
          </span>
        ) : it.draftDecision ? (
          <span className="faint" style={{ fontSize: 12.5 }}>Draft: {DECISION_TEXT[it.draftDecision]}</span>
        ) : null
      }
    >
      <Row gutter={[18, 14]}>
        <Col xs={24} lg={13}>
          {isCase ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
                <StatusTag status={c!.status} />
                {c!.intake ? <span>Intake {c!.intake}</span> : null}
                {c!.campus ? <span className="muted">· {c!.campus}</span> : null}
                {c!.officer ? <span className="muted">· Officer {c!.officer}</span> : null}
                <Link href={`/pcp/applications/${ref}`}>
                  <FolderOpenOutlined /> Open case file
                </Link>
              </div>
              {c!.inspection ? <InspectionBlock i={c!.inspection} /> : <div className="faint">No submitted inspection report on this case.</div>}
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
                <ModuleStatus status={a!.status} />
                <span className="muted">
                  Filed by {a!.filedBy} · {fmtDate(a!.filedAt)}
                </span>
                <Link href={`/pcp/applications/${a!.caseRef}`}>
                  <FolderOpenOutlined /> Open case file {a!.caseRef}
                </Link>
              </div>
              {a!.underAppeal ? (
                <Quote label={`Decision under appeal · ${fmtDate(a!.underAppeal.at)}`} tone="warn">
                  <DecisionPill decision={a!.underAppeal.decision} /> {a!.underAppeal.note}
                </Quote>
              ) : null}
              <Quote label="Grounds of appeal">{a!.grounds}</Quote>
              {a!.evidenceDocumentId ? <DocLink id={a!.evidenceDocumentId} label="Evidence filed with the appeal" /> : null}
            </div>
          )}
        </Col>
        <Col xs={24} lg={11}>
          <div style={{ display: "grid", gap: 10 }}>
            <Quote label={isCase ? "Officer's recommendation" : "Officer's review"} tone="brand">
              {it.recommendation ?? <span className="faint">No recommendation was recorded when the case was forwarded.</span>}
            </Quote>
            {it.decision ? (
              <div style={{ border: "1px solid #c9ecd8", background: "#f4fbf7", borderRadius: 10, padding: "10px 12px", fontSize: 13.5 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                  <b>Council decision</b>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {it.decidedBy} · {fmtDate(it.decidedAt, true)}
                  </span>
                </div>
                <DecisionPill decision={it.decision} /> {it.deferUntil ? <span style={{ fontSize: 12.5 }}>Returns on <b>{fmtDate(it.deferUntil)}</b></span> : null}
                {it.decisionNote ? <div style={{ marginTop: 6, lineHeight: 1.5 }}>{it.decisionNote}</div> : null}
                {!isCase && a!.letterDocumentId ? (
                  <div style={{ marginTop: 6 }}>
                    <DocLink id={a!.letterDocumentId} label="Appeal decision letter" />
                  </div>
                ) : null}
              </div>
            ) : decidedElsewhere ? (
              <Alert type="warning" showIcon title={`Decided on the case file, outside this meeting: ${c!.status.toLowerCase().replace(/_/g, " ")}.`} />
            ) : appealClosed ? (
              <Alert type="warning" showIcon title={`This appeal is ${a!.status.toLowerCase()}.`} />
            ) : status === "IN_SESSION" && canDecide ? (
              <Button type="primary" block size="large" icon={<SafetyOutlined />} onClick={onDecide} className="record-decision">
                Record decision
              </Button>
            ) : status === "PLANNED" ? (
              <div className="faint" style={{ fontSize: 12.5 }}>Decisions are recorded once the session starts.</div>
            ) : status === "CLOSED" ? (
              <div className="faint" style={{ fontSize: 12.5 }}>Not taken up at this meeting; carried forward.</div>
            ) : null}
            {canManage && status === "PLANNED" ? (
              <Popconfirm title="Remove from this agenda?" description="It stays ready for the next meeting." okText="Remove" onConfirm={() => run(() => removeAgendaItem(it.id))}>
                <Button size="small" type="text" danger icon={<DeleteOutlined />} loading={pending} style={{ justifySelf: "end" }}>
                  Remove from agenda
                </Button>
              </Popconfirm>
            ) : null}
          </div>
        </Col>
      </Row>
    </Card>
  );
}

export default function CouncilMeetingView({ d, canManage, canDecide }: { d: MeetingDetail; canManage: boolean; canDecide: boolean }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [deciding, setDeciding] = useState<AgendaItem | null>(null);
  const m = d.meeting;
  const decided = d.items.filter((i) => i.decision).length;
  const undecided = d.items.length - decided;

  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      message[r.ok ? (r.level === "warning" ? "warning" : "success") : "error"](r.message, r.ok ? 4 : 8);
      router.refresh();
    });

  const step = m.status === "PLANNED" ? 0 : m.status === "IN_SESSION" ? 1 : 2;

  return (
    <>
      <PageTitle
        eyebrow={
          <Link href="/pcp/council" style={{ color: "inherit" }}>
            Council meetings · <span className="mono">{m.ref}</span>
          </Link>
        }
        title={m.title}
        sub={
          <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span>{dayjs(m.date).format("dddd D MMMM YYYY")}</span>
            <ModuleStatus status={m.status} />
            <span>
              {d.items.length} item{d.items.length === 1 ? "" : "s"} · {decided} decided
            </span>
          </span>
        }
        extra={
          <>
            <ScreenGuide
              title="Running a council meeting"
              steps={[
                "**Build agenda from ready cases** adds every case awaiting a council decision and every appeal an officer has placed for council. Each item shows the case file, the inspection report and the officer's recommendation.",
                "Before the meeting, set a **draft decision** on each item. It is a suggestion; nothing is decided yet.",
                "On the day, **Start session**. Then **Record decision** on each item and confirm with the one-time code. A deferral needs a reason and a return date; a rejection needs its grounds.",
                "An upheld appeal sends the original case back to council review for a fresh decision; a dismissed appeal leaves the decision standing.",
                "**Close meeting and file minutes** generates the minutes PDF. Undecided items are carried forward to the next agenda.",
              ]}
              note={canManage ? undefined : "Only the Secretary changes the agenda and records decisions. You can read everything here."}
            />
            {m.minutesDocumentId ? (
              <a href={`/api/documents/${m.minutesDocumentId}`} target="_blank" rel="noreferrer" id="minutes-link">
                <Button icon={<DownloadOutlined />}>Download minutes (PDF)</Button>
              </a>
            ) : null}
            {canManage && m.status !== "CLOSED" ? (
              <Button icon={<UnorderedListOutlined />} loading={pending} onClick={() => run(() => buildAgenda(m.ref))}>
                Build agenda from ready cases
              </Button>
            ) : null}
            {canManage && m.status === "PLANNED" ? (
              <Popconfirm title="Start the session?" description="The agenda is then fixed and decisions can be recorded." okText="Start session" onConfirm={() => run(() => startSession(m.ref))} disabled={!d.items.length}>
                <Button type="primary" icon={<PlayCircleOutlined />} loading={pending} disabled={!d.items.length}>
                  Start session
                </Button>
              </Popconfirm>
            ) : null}
            {canManage && m.status === "IN_SESSION" ? (
              <Popconfirm
                title="Close the meeting and file the minutes?"
                description={undecided ? `${undecided} item${undecided === 1 ? " is" : "s are"} not decided and will be carried forward.` : "All items are decided. The minutes PDF is generated and filed."}
                okText="Close and file minutes"
                onConfirm={() => run(() => closeMeeting(m.ref))}
              >
                <Button type="primary" icon={<LockOutlined />} loading={pending}>
                  Close meeting and file minutes
                </Button>
              </Popconfirm>
            ) : null}
          </>
        }
      />

      <Card size="small" style={{ marginBottom: 16 }}>
        <Steps
          size="small"
          current={step}
          status={step === 2 ? "finish" : "process"}
          items={[
            { title: "Planned", content: "Agenda and draft decisions" },
            { title: "In session", content: m.startedAt ? `Started ${fmtDate(m.startedAt, true)}` : "Decisions recorded with a one-time code" },
            { title: "Closed", content: m.closedAt ? `Closed ${fmtDate(m.closedAt, true)}, minutes filed` : "Minutes filed as a PDF" },
          ]}
        />
      </Card>

      {m.status === "IN_SESSION" && canDecide && undecided ? (
        <Alert type="info" showIcon style={{ marginBottom: 16 }} title={`In session: record a decision for each of the ${undecided} remaining item${undecided === 1 ? "" : "s"}. Each decision needs a one-time code.`} />
      ) : null}
      {m.status === "CLOSED" && m.minutesDocumentId ? (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
          title={
            <span>
              Meeting closed and minutes filed. <DocLink id={m.minutesDocumentId} label={`Minutes of ${m.ref}`} />
            </span>
          }
        />
      ) : null}

      {d.items.length ? (
        d.items.map((it) => <ItemCard key={it.id} it={it} status={m.status} canManage={canManage} canDecide={canDecide} onDecide={() => setDeciding(it)} run={run} pending={pending} />)
      ) : (
        <Card>
          <Empty
            image={<FileSearchOutlined style={{ fontSize: 42, color: "var(--faint)" }} />}
            description={
              canManage && m.status !== "CLOSED" ? "The agenda is empty. Click Build agenda from ready cases to add every case and appeal ready for council." : "No items on this agenda."
            }
          />
        </Card>
      )}

      {deciding ? <DecisionModal item={deciding} onClose={() => setDeciding(null)} /> : null}
    </>
  );
}
