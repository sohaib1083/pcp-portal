"use client";
// One court case: hearings, orders (a stay blocks council decisions on the linked case), documents and history.
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Col, DatePicker, Empty, Form, Input, Modal, Radio, Row, Select, Table, Tag } from "antd";
import { AuditOutlined, CalendarOutlined, ClockCircleOutlined, EditOutlined, FileAddOutlined, FolderOpenOutlined, SafetyCertificateFilled, StopOutlined, UnlockOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { addHearing, liftStay, recordHearing, recordOrder, setCourtStatus } from "@/app/actions/litigation";
import type { ActionResult } from "@/app/actions/faculty";
import type { CourtCaseDetail } from "@/lib/governance-data";
import { COURT_STATUS, NATURE_LABELS, ORDER_LABELS } from "@/lib/governance-shared";
import { KV, StatusTag, fmtDate } from "./common";
import { DocLink, Quote } from "./CouncilParts";
import { FillDemo } from "./demo-helpers";
import { CourtStatus, DocList, FilePick, History, LetterStatus, RefLink, relDays, uploadGov } from "./GovParts";
import ScreenGuide from "./ScreenGuide";

type Run = (fn: () => Promise<ActionResult>) => Promise<boolean>;
const ymd = (d: unknown) => (d ? dayjs(d as string).format("YYYY-MM-DD") : null);

function HearingModal({ d, run, onClose }: { d: CourtCaseDetail; run: Run; onClose: () => void }) {
  const [form] = Form.useForm();
  const last = [...d.hearings].reverse().find((h) => h.bench);
  return (
    <Modal open title={<span><CalendarOutlined style={{ color: "#5b3cc4", marginRight: 8 }} />Add a hearing</span>} okText="Add hearing" onOk={() => form.submit()} onCancel={onClose} destroyOnHidden>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <FillDemo onClick={() => form.setFieldsValue({ date: dayjs().add(6, "day"), bench: last?.bench ?? "Justice S. Kazmi", purpose: "Arguments on interim relief" })} />
      </div>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={async (v) => (await run(() => addHearing(d.c.ref, { date: ymd(v.date), bench: v.bench, purpose: v.purpose }))) && onClose()}>
        <Form.Item name="date" label="Hearing date" rules={[{ required: true, message: "Pick the hearing date." }]} extra="Reminders go to you and to counsel 7 days and 1 day before.">
          <DatePicker id="hearing-date" style={{ width: "100%" }} format="D MMM YYYY" />
        </Form.Item>
        <Form.Item name="bench" label="Bench">
          <Input placeholder="Justice ..." />
        </Form.Item>
        <Form.Item name="purpose" label="Fixed for">
          <Input placeholder="Notice, reply, arguments, order ..." />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function OutcomeModal({ h, run, onClose }: { h: CourtCaseDetail["hearings"][number]; run: Run; onClose: () => void }) {
  const [form] = Form.useForm();
  return (
    <Modal open width={600} title={`What happened on ${fmtDate(h.date)}`} okText="Record the hearing" onOk={() => form.submit()} onCancel={onClose} destroyOnHidden>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <FillDemo onClick={() => form.setFieldsValue({ outcome: "Counsel for PCP filed para-wise comments. The petitioner sought time to file a rejoinder; adjourned.", nextDate: dayjs().add(21, "day"), nextPurpose: "Rejoinder and arguments" })} />
      </div>
      <Form form={form} layout="vertical" requiredMark={false} initialValues={{ bench: h.bench }} onFinish={async (v) => (await run(() => recordHearing(h.id, { outcome: v.outcome, bench: v.bench, nextDate: ymd(v.nextDate), nextPurpose: v.nextPurpose }))) && onClose()}>
        <Form.Item name="outcome" label="What happened" rules={[{ required: true, min: 5, message: "Say what happened at the hearing." }]}>
          <Input.TextArea id="hearing-outcome" rows={3} placeholder="Adjourned, arguments heard, order reserved ..." />
        </Form.Item>
        <Form.Item name="bench" label="Bench">
          <Input />
        </Form.Item>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="nextDate" label="Next date" extra="Lists the next hearing, with its reminders.">
              <DatePicker style={{ width: "100%" }} format="D MMM YYYY" disabledDate={(x) => !x.isAfter(dayjs(h.date), "day")} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="nextPurpose" label="Next date fixed for">
              <Input />
            </Form.Item>
          </Col>
        </Row>
      </Form>
      <div className="faint" style={{ fontSize: 12.5 }}>If the court passed an order, record it separately with Record an order.</div>
    </Modal>
  );
}

function OrderModal({ d, onClose }: { d: CourtCaseDetail; onClose: () => void }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm();
  const [file, setFile] = useState<File | null>(null);
  const [pending, start] = useTransition();
  const kind = (Form.useWatch("kind", form) as string) ?? "STAY";
  const linked = d.c.linkedRef;

  const submit = (v: Record<string, unknown>) =>
    start(async () => {
      const r = await recordOrder(d.c.ref, { kind: v.kind, date: ymd(v.date), summary: v.summary, stayUntil: ymd(v.stayUntil), outcome: v.outcome ?? null });
      if (!r.ok) {
        message.error(r.message, 8);
        return;
      }
      let note = r.message;
      if (file && "orderId" in r && r.orderId) {
        const u = await uploadGov({ target: "court", ref: d.c.ref, file, orderId: r.orderId });
        note = u.ok ? `${r.message} The order is filed.` : `${r.message} The file was not filed: ${u.message}`;
      }
      message.success(note, 6);
      onClose();
      router.refresh();
    });

  const demo = () => {
    if (kind === "STAY")
      form.setFieldsValue({ date: dayjs(), stayUntil: dayjs().add(28, "day"), summary: `Notice issued to the respondents. Till the next date of hearing, the respondents shall not take any further action${linked ? ` on ${linked}` : ""}.` });
    else if (kind === "FINAL") form.setFieldsValue({ date: dayjs(), outcome: "DISPOSED_FAVOUR", summary: "Petition dismissed. The council may decide the case on its merits under its regulations." });
    else form.setFieldsValue({ date: dayjs(), summary: "Respondents directed to file para-wise comments within two weeks." });
  };

  return (
    <Modal open width={640} title={<span><AuditOutlined style={{ color: "var(--brand)", marginRight: 8 }} />Record an order</span>} okText="Record the order" confirmLoading={pending} onOk={() => form.submit()} onCancel={onClose} destroyOnHidden>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <FillDemo onClick={demo} />
      </div>
      <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: "STAY", date: dayjs() }} onFinish={submit}>
        <Form.Item name="kind" label="Kind of order">
          <Radio.Group optionType="button" buttonStyle="solid" options={Object.entries(ORDER_LABELS).map(([value, label]) => ({ value, label: label.replace(" or judgment", "") }))} />
        </Form.Item>
        <Row gutter={12}>
          <Col span={kind === "STAY" ? 12 : 24}>
            <Form.Item name="date" label="Date of the order" rules={[{ required: true, message: "Pick the date of the order." }]}>
              <DatePicker id="order-date" style={{ width: "100%" }} format="D MMM YYYY" disabledDate={(x) => x.isAfter(dayjs(), "day")} />
            </Form.Item>
          </Col>
          {kind === "STAY" ? (
            <Col span={12}>
              <Form.Item name="stayUntil" label="No further action until" extra="Leave empty for until further orders.">
                <DatePicker id="stay-until" style={{ width: "100%" }} format="D MMM YYYY" disabledDate={(x) => !x.isAfter(dayjs(), "day")} />
              </Form.Item>
            </Col>
          ) : null}
        </Row>
        {kind === "FINAL" ? (
          <Form.Item name="outcome" label="Outcome for PCP" rules={[{ required: true, message: "Say how the case was disposed of." }]}>
            <Radio.Group options={[{ value: "DISPOSED_FAVOUR", label: "In PCP's favour" }, { value: "DISPOSED_AGAINST", label: "Against PCP" }]} />
          </Form.Item>
        ) : null}
        <Form.Item name="summary" label="What the court ordered" rules={[{ required: true, min: 10, message: "Summarise the order (at least a sentence)." }]}>
          <Input.TextArea id="order-summary" rows={3} />
        </Form.Item>
        <Form.Item label="The order (PDF or scan)" extra="Filed in the case's documents as a new version.">
          <FilePick file={file} onFile={setFile} sample={kind === "STAY" ? "Stay order" : "Court order"} id="order-file" />
        </Form.Item>
      </Form>
      {kind === "STAY" ? (
        <Alert
          type="error"
          showIcon
          icon={<StopOutlined />}
          title={linked ? `A stay blocks council decisions and certificates on ${linked} and puts a red banner on its screen until you lift it.` : "This case is not linked to a PCP case, so the stay blocks nothing in the portal. Link the case to make it count."}
        />
      ) : kind === "FINAL" ? (
        <Alert type="info" showIcon title="A final order disposes of the case and ends any stay in force." />
      ) : null}
    </Modal>
  );
}

function LiftModal({ order, run, onClose }: { order: CourtCaseDetail["orders"][number]; run: Run; onClose: () => void }) {
  const [note, setNote] = useState("");
  return (
    <Modal
      open
      title={<span><UnlockOutlined style={{ color: "var(--brand)", marginRight: 8 }} />Lift the stay of {fmtDate(order.date)}</span>}
      okText="Lift the stay"
      okButtonProps={{ disabled: note.trim().length < 5 }}
      onOk={async () => (await run(() => liftStay(order.id, note))) && onClose()}
      onCancel={onClose}
      destroyOnHidden
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span className="muted" style={{ fontSize: 13 }}>Why the stay no longer applies</span>
        <FillDemo onClick={() => setNote(`Stay vacated by the court on ${dayjs().format("D MMMM YYYY")}; the council may proceed.`)} />
      </div>
      <Input.TextArea id="lift-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Vacated by the order of ..., or not extended at the hearing of ..." />
      <Alert style={{ marginTop: 12 }} type="info" showIcon title="The council can decide the linked case again. The Secretary and the case officer are told." />
    </Modal>
  );
}

function StatusModal({ d, run, onClose }: { d: CourtCaseDetail; run: Run; onClose: () => void }) {
  const [status, setStatus] = useState<string>();
  const [note, setNote] = useState("");
  return (
    <Modal open title="Change the status" okText="Change status" okButtonProps={{ disabled: !status || note.trim().length < 5 }} onOk={async () => (await run(() => setCourtStatus(d.c.ref, status!, note))) && onClose()} onCancel={onClose} destroyOnHidden>
      <div style={{ display: "grid", gap: 10 }}>
        <Select
          placeholder="New status"
          value={status}
          onChange={setStatus}
          options={Object.entries(COURT_STATUS)
            .filter(([k]) => k !== d.c.status && k !== "STAY_GRANTED")
            .map(([value, s]) => ({ value, label: s.label }))}
        />
        <Input.TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why, for example: petition withdrawn by the petitioner on 2 October" />
        <div className="faint" style={{ fontSize: 12.5 }}>A stay is granted by recording the stay order itself. Disposing of or withdrawing the case ends any stay in force.</div>
      </div>
    </Modal>
  );
}

const DOC_TYPES = ["Petition", "Para-wise comments", "Reply", "Order", "Judgment", "Power of attorney", "Other court paper"];

function DocModal({ d, onClose }: { d: CourtCaseDetail; onClose: () => void }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [docType, setDocType] = useState("Petition");
  const [file, setFile] = useState<File | null>(null);
  const [pending, start] = useTransition();
  return (
    <Modal
      open
      title={<span><FileAddOutlined style={{ color: "var(--brand)", marginRight: 8 }} />File a court paper</span>}
      okText="File it"
      okButtonProps={{ disabled: !file }}
      confirmLoading={pending}
      onOk={() =>
        start(async () => {
          const r = await uploadGov({ target: "court", ref: d.c.ref, file: file!, docType });
          message[r.ok ? "success" : "error"](r.message, r.ok ? 4 : 8);
          if (r.ok) {
            onClose();
            router.refresh();
          }
        })
      }
      onCancel={onClose}
      destroyOnHidden
    >
      <div style={{ display: "grid", gap: 12 }}>
        <Select value={docType} onChange={setDocType} options={DOC_TYPES.map((x) => ({ value: x }))} />
        <FilePick file={file} onFile={setFile} sample={docType} />
        <div className="faint" style={{ fontSize: 12.5 }}>Filing the same kind of paper again adds a new version; earlier versions are kept. Court papers are PCP&apos;s own file and are not shown to the institution.</div>
      </div>
    </Modal>
  );
}

export default function LitigationView({ d, canManage }: { d: CourtCaseDetail; canManage: boolean }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [, start] = useTransition();
  const [modal, setModal] = useState<null | "hearing" | "order" | "status" | "doc">(null);
  const [outcomeOf, setOutcomeOf] = useState<CourtCaseDetail["hearings"][number] | null>(null);
  const [lifting, setLifting] = useState<CourtCaseDetail["orders"][number] | null>(null);
  const c = d.c;
  const stay = d.orders.find((o) => o.active);
  const next = d.hearings.find((h) => h.status === "SCHEDULED" && !h.past);
  const toRecord = d.hearings.filter((h) => h.status === "SCHEDULED" && h.days <= 0);

  const run: Run = (fn) =>
    new Promise((resolve) =>
      start(async () => {
        const r = await fn();
        message[r.ok ? "success" : "error"](r.message, r.ok ? 5 : 8);
        router.refresh();
        resolve(r.ok);
      }),
    );

  const court = stay
    ? { who: `Stay order in force${c.linkedRef ? ` on ${c.linkedRef}` : ""}`, what: `No further action until ${stay.stayUntil ? fmtDate(stay.stayUntil) : "further orders"}. ${stay.summary}`, c: "#b4141f", bg: "#fff1f0", bd: "#ffccc7", icon: <StopOutlined /> }
    : !c.open
      ? { who: COURT_STATUS[c.status]?.label ?? c.status, what: "The case is closed in the ledger. Its record stays here.", c: "#55625c", bg: "#f2f4f3", bd: "#e1e6e3", icon: <SafetyCertificateFilled /> }
      : next
        ? { who: `Next hearing ${fmtDate(next.date)} (${relDays(next.days)})`, what: `${next.bench ? `Before ${next.bench}. ` : ""}${next.purpose ? `Fixed for ${next.purpose.toLowerCase()}.` : ""}`, c: "#5b3cc4", bg: "#f2eefe", bd: "#ddd3fb", icon: <CalendarOutlined /> }
        : { who: "No hearing listed", what: canManage ? "Add the next date with Add hearing, so reminders go out." : "The legal officer lists the next date.", c: "#a15c00", bg: "#fff7e6", bd: "#ffe1a8", icon: <ClockCircleOutlined /> };

  return (
    <>
      <Card style={{ marginBottom: 18 }} styles={{ body: { padding: "20px 22px" } }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div className="pcp-eyebrow">
              <Link href="/pcp/litigation" style={{ color: "inherit" }}>
                Court cases
              </Link>{" "}
              · {NATURE_LABELS[c.nature] ?? c.nature}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h1 className="pcp-page-title mono" style={{ fontSize: 24, letterSpacing: "-0.01em" }}>
                {c.ref}
              </h1>
              <CourtStatus status={c.status} />
            </div>
            <div style={{ marginTop: 6, fontSize: 15, fontWeight: 500 }}>{c.title}</div>
            <div className="muted" style={{ marginTop: 2, fontSize: 13.5 }}>
              {c.court} · <span className="mono">{c.caseNumber}</span> · filed {fmtDate(c.filedDate)}
            </div>
          </div>
          <ScreenGuide
            title="A court case"
            steps={[
              "The box under the title says what matters now: a stay in force, the next hearing, or that no date is listed.",
              "**Add hearing** lists a date. You and counsel get reminders 7 days and 1 day before.",
              "After the hearing, **Record what happened** and the next date; the next hearing is listed for you.",
              "**Record an order** files the court's order with its PDF. A stay order blocks council decisions on the linked case until you **Lift the stay**.",
              "**File a court paper** keeps the petition, comments and judgment as versioned documents.",
            ]}
            note={canManage ? undefined : "Only the legal officer and the Secretary change the ledger."}
          />
        </div>
        <div className="pcp-court" style={{ marginTop: 18, background: court.bg, borderColor: court.bd }} data-testid="court-state">
          <span style={{ width: 36, height: 36, borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center", color: court.c }}>{court.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="pcp-court-title" style={{ color: court.c }}>
              {court.who}
            </div>
            <div className="pcp-court-sub">{court.what}</div>
          </div>
          {stay && canManage ? (
            <Button danger icon={<UnlockOutlined />} onClick={() => setLifting(stay)}>
              Lift the stay
            </Button>
          ) : null}
        </div>
      </Card>

      {toRecord.length && canManage ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title={`The hearing of ${fmtDate(toRecord[0].date)} has passed. Record what happened and the next date.`}
          action={
            <Button size="small" onClick={() => setOutcomeOf(toRecord[0])}>
              Record what happened
            </Button>
          }
        />
      ) : null}

      <Row gutter={18}>
        <Col xs={24} lg={15}>
          <Card
            size="small"
            title={<span><CalendarOutlined style={{ color: "#5b3cc4", marginRight: 8 }} />Hearings</span>}
            extra={canManage && c.open ? <Button size="small" onClick={() => setModal("hearing")}>Add hearing</Button> : null}
            style={{ marginBottom: 16 }}
            styles={{ body: { padding: 0 } }}
          >
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={[...d.hearings].reverse()}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No hearings listed yet." /> }}
              columns={[
                {
                  title: "Date",
                  dataIndex: "date",
                  width: 130,
                  render: (v, h) => (
                    <span style={{ display: "inline-flex", flexDirection: "column" }}>
                      <b style={{ fontWeight: 600 }}>{fmtDate(v)}</b>
                      {h.status === "SCHEDULED" ? <span style={{ fontSize: 12, color: h.days < 0 ? "#a15c00" : "#5b3cc4" }}>{h.days < 0 ? "to record" : relDays(h.days)}</span> : null}
                    </span>
                  ),
                },
                { title: "Bench", dataIndex: "bench", render: (v) => v ?? <span className="faint">—</span> },
                {
                  title: "Fixed for / what happened",
                  render: (_, h) =>
                    h.status === "HELD" ? (
                      <span style={{ fontSize: 13 }}>
                        {h.outcome}
                        {h.nextDate ? <span className="faint"> Next: {fmtDate(h.nextDate)}.</span> : null}
                      </span>
                    ) : (
                      <span className="muted" style={{ fontSize: 13 }}>{h.purpose ?? "Listed"}</span>
                    ),
                },
                {
                  title: "",
                  width: 150,
                  align: "right",
                  render: (_, h) =>
                    h.status === "SCHEDULED" && canManage && h.days <= 0 ? (
                      <Button size="small" icon={<EditOutlined />} onClick={() => setOutcomeOf(h)}>
                        Record
                      </Button>
                    ) : h.status === "HELD" ? (
                      <Tag style={{ margin: 0 }}>Held</Tag>
                    ) : (
                      <Tag color="purple" style={{ margin: 0 }}>Listed</Tag>
                    ),
                },
              ]}
            />
          </Card>

          <Card
            size="small"
            title={<span><AuditOutlined style={{ color: "var(--brand)", marginRight: 8 }} />Orders</span>}
            extra={canManage && c.open ? <Button size="small" onClick={() => setModal("order")}>Record an order</Button> : null}
            style={{ marginBottom: 16 }}
          >
            {d.orders.length ? (
              <div style={{ display: "grid", gap: 10 }}>
                {d.orders.map((o) => (
                  <div key={o.id} data-order={o.kind} style={{ border: `1px solid ${o.active ? "#ffccc7" : "var(--line)"}`, background: o.active ? "#fff8f7" : "#fff", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                      <b>{ORDER_LABELS[o.kind] ?? o.kind}</b>
                      <span className="faint" style={{ fontSize: 12.5 }}>{fmtDate(o.date)} · recorded by {o.by}</span>
                      {o.kind === "STAY" ? (
                        o.active ? (
                          <Tag color="red" style={{ margin: 0 }}>In force until {o.stayUntil ? fmtDate(o.stayUntil) : "further orders"}</Tag>
                        ) : (
                          <Tag style={{ margin: 0 }}>Lifted {fmtDate(o.liftedAt)}</Tag>
                        )
                      ) : null}
                      <span style={{ flex: 1 }} />
                      {o.active && canManage ? (
                        <Button size="small" danger icon={<UnlockOutlined />} onClick={() => setLifting(o)}>
                          Lift the stay
                        </Button>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>{o.summary}</div>
                    {o.liftNote ? <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>Lifted by {o.liftedBy}: {o.liftNote}</div> : null}
                    {o.documentId ? (
                      <div style={{ marginTop: 6 }}>
                        <DocLink id={o.documentId} label="The order (PDF)" />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="faint" style={{ fontSize: 13 }}>No orders recorded.</div>
            )}
          </Card>

          <Card size="small" title={<span><FolderOpenOutlined style={{ color: "var(--brand)", marginRight: 8 }} />Court papers</span>} extra={canManage ? <Button size="small" onClick={() => setModal("doc")}>File a court paper</Button> : null} style={{ marginBottom: 16 }}>
            <DocList docs={d.documents} empty="No papers filed yet. File the petition, PCP's comments and each order." />
          </Card>

          {d.letters.length || d.meetings.length ? (
            <Card size="small" title="Letters and committee meetings" style={{ marginBottom: 16 }}>
              <div style={{ display: "grid", gap: 8 }}>
                {d.letters.map((l) => (
                  <div key={l.ref} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 }}>
                    <RefLink refNo={l.ref} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div>
                        {l.direction === "IN" ? "From" : "To"} {l.party}: {l.subject}
                      </div>
                      <div className="faint" style={{ fontSize: 12 }}>Dated {fmtDate(l.date)}</div>
                    </div>
                    <LetterStatus status={l.status} direction={l.direction} dispatchedAt={l.dispatchedAt} />
                  </div>
                ))}
                {d.meetings.map((m) => (
                  <div key={m.ref} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 }}>
                    <Link href={`/pcp/council/${m.ref}`} className="mono" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                      {m.ref}
                    </Link>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div>{m.resolution ? `Recommended: ${m.resolution}` : "On the agenda"}</div>
                      <div className="faint" style={{ fontSize: 12 }}>
                        {m.committee}, {fmtDate(m.date)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </Col>
        <Col xs={24} lg={9}>
          {canManage ? (
            <Card size="small" title="Your next step" style={{ marginBottom: 16, borderColor: "#95d5b2", boxShadow: "0 0 0 3px #e8f3ee" }} styles={{ body: { background: "#fbfdfc" } }}>
              <div style={{ display: "grid", gap: 8 }}>
                {c.open ? (
                  <>
                    <Button type="primary" icon={<CalendarOutlined />} onClick={() => setModal("hearing")}>
                      Add hearing
                    </Button>
                    <Button icon={<AuditOutlined />} onClick={() => setModal("order")}>
                      Record an order
                    </Button>
                  </>
                ) : null}
                <Button icon={<FileAddOutlined />} onClick={() => setModal("doc")}>
                  File a court paper
                </Button>
                <Button type="text" onClick={() => setModal("status")}>
                  Change the status
                </Button>
              </div>
            </Card>
          ) : null}
          <Card size="small" title="Linked PCP case" style={{ marginBottom: 16 }}>
            {d.linked ? (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Link href={d.linked.href} className="mono" style={{ fontWeight: 600, fontSize: 14 }}>
                    <FolderOpenOutlined /> {d.linked.ref}
                  </Link>
                  <span>{d.linked.label}</span>
                </div>
                <div>{d.linked.kind === "case" ? <StatusTag status={d.linked.status} /> : <span className="muted">{d.linked.status.toLowerCase().replace(/_/g, " ")}</span>}</div>
                {stay ? (
                  <div style={{ fontSize: 12.5, color: "#b4141f" }}>
                    <StopOutlined /> Council decisions on {d.linked.ref} are blocked while the stay is in force.
                  </div>
                ) : (
                  <div className="faint" style={{ fontSize: 12.5 }}>No stay in force: the case proceeds normally.</div>
                )}
              </div>
            ) : (
              <span className="faint" style={{ fontSize: 13 }}>Not linked to a PCP case or appeal.</span>
            )}
          </Card>
          <Card size="small" title="Parties and counsel" style={{ marginBottom: 16 }}>
            <KV
              rows={[
                ["Petitioner", c.petitioner],
                ["Respondent", c.respondent],
                ["Institution", d.inst ? `${d.inst.name} (${d.inst.shortCode})` : "—"],
                ["PCP counsel", c.counsel],
                ["Counsel's email", c.counselEmail ?? "—"],
                ["Entered by", `${c.createdBy} · ${fmtDate(c.createdAt)}`],
              ]}
            />
            {c.summary ? (
              <div style={{ marginTop: 10 }}>
                <Quote label="What the case is about">{c.summary}</Quote>
              </div>
            ) : null}
          </Card>
          {d.reminders.length ? (
            <Card size="small" title="Reminders sent" style={{ marginBottom: 16 }}>
              <div style={{ display: "grid", gap: 6 }}>
                {d.reminders.map((m) => (
                  <div key={m.id} style={{ fontSize: 12.5 }}>
                    <b style={{ fontWeight: 500 }}>{m.subject}</b>
                    <div className="faint">
                      Email to {m.to} · {fmtDate(m.at, true)}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
          <Card size="small" title="History" style={{ marginBottom: 16 }}>
            <History rows={d.history} />
          </Card>
        </Col>
      </Row>

      {modal === "hearing" ? <HearingModal d={d} run={run} onClose={() => setModal(null)} /> : null}
      {modal === "order" ? <OrderModal d={d} onClose={() => setModal(null)} /> : null}
      {modal === "status" ? <StatusModal d={d} run={run} onClose={() => setModal(null)} /> : null}
      {modal === "doc" ? <DocModal d={d} onClose={() => setModal(null)} /> : null}
      {outcomeOf ? <OutcomeModal h={outcomeOf} run={run} onClose={() => setOutcomeOf(null)} /> : null}
      {lifting ? <LiftModal order={lifting} run={run} onClose={() => setLifting(null)} /> : null}
    </>
  );
}
