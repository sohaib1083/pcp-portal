"use client";
// Committee pieces of the meeting screen: items that get a recommendation (or, for the council, a recorded
// outcome) rather than a decision, the Add agenda item dialog, and the action points that become tasks.
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Col, DatePicker, Empty, Form, Input, Modal, Popconfirm, Radio, Row, Select, Table, Tag } from "antd";
import { CheckOutlined, CheckSquareOutlined, DeleteOutlined, ExceptionOutlined, FolderOpenOutlined, InboxOutlined, PlayCircleOutlined, PlusOutlined, SendOutlined, StopOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { addActionPoint, addAgendaItem, recordItemResolution, updateActionPoint } from "@/app/actions/committees";
import { removeAgendaItem } from "@/app/actions/council";
import type { ActionResult } from "@/app/actions/faculty";
import type { AgendaItem } from "@/lib/council-data";
import type { AgendaOptions, meetingActions } from "@/lib/governance-data";
import { StatusTag, fmtDate } from "./common";
import { DocLink, ModuleStatus, Quote } from "./CouncilParts";
import { FillDemo } from "./demo-helpers";
import { CourtStatus, LetterStatus, RefLink, TaskStatus, relDays } from "./GovParts";

type Actions = Awaited<ReturnType<typeof meetingActions>>;
type Staff = AgendaOptions["staff"];

/** Run an action from a dialog: show the result, refresh, and say whether it worked. */
function useRun() {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>) =>
    new Promise<boolean>((resolve) =>
      start(async () => {
        const r = await fn();
        message[r.ok ? (r.level === "warning" ? "warning" : "success") : "error"](r.message, r.ok ? 5 : 8);
        router.refresh();
        resolve(r.ok);
      }),
    );
  return { run, pending };
}

const KIND_TAG: Record<string, [string, string]> = { case: ["Case", "cyan"], appeal: ["Appeal", "purple"], court: ["Court case", "red"], letter: ["Letter", "blue"], other: ["Other matter", "default"] };

function ResolutionModal({ it, council, onClose }: { it: AgendaItem; council: boolean; onClose: () => void }) {
  const { run, pending } = useRun();
  const [text, setText] = useState("");
  const demo: Record<string, string> = {
    case: "Recommends approval for an intake of 50, on condition that the second Pharmaceutics laboratory is commissioned before the next session. To the Council.",
    appeal: "Recommends that the Council uphold the appeal: the appointment letters predate the decision and answer its grounds.",
    court: "Counsel to file para-wise comments before the next date; the committee sees no ground to concede the interim relief sought.",
    letter: "Reply that the deadline stands; the institution may apply for review once the equipment is installed.",
    other: "Agreed. The Secretary will circulate the revised schedule to members within a week.",
  };
  return (
    <Modal
      open
      width={600}
      title={council ? `Record the council's outcome · ${it.kind === "other" ? `item ${it.position}` : it.ref}` : `Record the committee's recommendation · ${it.kind === "other" ? `item ${it.position}` : it.ref}`}
      okText={council ? "Record outcome" : "Record recommendation"}
      okButtonProps={{ disabled: text.trim().length < 5 }}
      confirmLoading={pending}
      onOk={async () => (await run(() => recordItemResolution(it.id, text))) && onClose()}
      onCancel={onClose}
      destroyOnHidden
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span className="muted" style={{ fontSize: 13 }}>{council ? "A discussion item is noted, not decided." : "A committee recommends; the Council decides."}</span>
        <FillDemo onClick={() => setText(demo[it.kind] ?? demo.other)} />
      </div>
      <Input.TextArea id="resolution-text" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={council ? "What the council resolved" : "The committee's recommendation"} />
    </Modal>
  );
}

/** An agenda item that gets a recommendation or a recorded outcome, not a decision. */
export function GeneralItemCard({ it, status, council, canManage, run, pending, recusal }: { it: AgendaItem; status: string; council: boolean; canManage: boolean; run: (fn: () => Promise<ActionResult>) => void; pending: boolean; recusal?: React.ReactNode }) {
  const [resolving, setResolving] = useState(false);
  const [label, color] = KIND_TAG[it.kind] ?? ["Item", "default"];
  const href = it.kind === "case" ? `/pcp/applications/${it.ref}` : it.kind === "appeal" ? `/pcp/appeals/${it.ref}` : it.kind === "court" ? `/pcp/litigation/${it.ref}` : it.kind === "letter" ? `/pcp/correspondence/${it.ref}` : null;
  const title =
    it.kind === "case"
      ? it.case!.label
      : it.kind === "appeal"
        ? `against the decision on ${it.appeal!.caseRef}`
        : it.kind === "court"
          ? `${it.court!.courtShort} ${it.court!.caseNumber}`
          : it.kind === "letter"
            ? it.letter!.subject
            : it.subject;
  const inst = it.kind === "case" ? it.case!.inst : it.kind === "appeal" ? it.appeal!.inst : it.kind === "court" ? it.court!.inst : null;

  return (
    <Card
      data-item={it.ref}
      className="council-item"
      style={{ marginBottom: 14, borderColor: it.resolution ? "#c9ecd8" : undefined }}
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "6px 0" }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: it.resolution ? "var(--good)" : "#f2eefe", color: it.resolution ? "#fff" : "#5b3cc4", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13 }}>{it.resolution ? <CheckOutlined /> : it.position}</span>
          {href ? (
            <Link href={href} className="mono" style={{ fontWeight: 650, fontSize: 14 }}>
              {it.ref}
            </Link>
          ) : null}
          <Tag color={color} style={{ margin: 0 }}>
            {label}
          </Tag>
          <span style={{ fontWeight: 500, whiteSpace: "normal" }}>{title}</span>
          {inst ? (
            <span className="faint" style={{ fontWeight: 400, fontSize: 13 }}>
              {inst.name}
            </span>
          ) : null}
        </div>
      }
    >
      {recusal}
      <Row gutter={[18, 14]}>
        <Col xs={24} lg={13}>
          <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
            {it.kind === "case" ? (
              <>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <StatusTag status={it.case!.status} />
                  {it.case!.intake ? <span>Intake {it.case!.intake}</span> : null}
                  {it.case!.officer ? <span className="muted">· Officer {it.case!.officer}</span> : null}
                  <Link href={`/pcp/applications/${it.ref}`}>
                    <FolderOpenOutlined /> Open case file
                  </Link>
                </div>
                {it.case!.inspection ? <div className="muted">Inspection: {it.case!.inspection.compliant} of {it.case!.inspection.total} criteria compliant. {it.case!.inspection.summary}</div> : <div className="faint">No submitted inspection report yet.</div>}
              </>
            ) : it.kind === "appeal" ? (
              <>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <ModuleStatus status={it.appeal!.status} />
                  <Link href={`/pcp/applications/${it.appeal!.caseRef}`}>
                    <FolderOpenOutlined /> Case {it.appeal!.caseRef}
                  </Link>
                </div>
                <Quote label="Grounds of appeal">{it.appeal!.grounds}</Quote>
              </>
            ) : it.kind === "court" ? (
              <>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <CourtStatus status={it.court!.status} />
                  <span>{it.court!.court}</span>
                  <span className="muted">· Counsel {it.court!.counsel}</span>
                </div>
                <div>{it.court!.title}</div>
                <div className="muted">
                  {it.court!.nextHearing ? `Next hearing ${fmtDate(it.court!.nextHearing)}.` : "No hearing listed."}
                  {it.court!.linkedRef ? (
                    <>
                      {" "}About <RefLink refNo={it.court!.linkedRef} strong={false} />.
                    </>
                  ) : null}
                </div>
                {it.court!.stayUntil ? (
                  <div style={{ color: "#b4141f" }}>
                    <StopOutlined /> Stay order in force until {it.court!.stayUntil === "further orders" ? "further orders" : fmtDate(it.court!.stayUntil)}.
                  </div>
                ) : null}
              </>
            ) : it.kind === "letter" ? (
              <>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  {it.letter!.direction === "IN" ? <InboxOutlined style={{ color: "#1d5fb0" }} /> : <SendOutlined style={{ color: "var(--brand)" }} />}
                  <span>
                    {it.letter!.direction === "IN" ? "From" : "To"} {it.letter!.party}, dated {fmtDate(it.letter!.date)}
                  </span>
                  <LetterStatus status={it.letter!.status} direction={it.letter!.direction} dispatchedAt={it.letter!.status === "OPEN" ? null : "sent"} />
                </div>
                {it.letter!.linkedRef ? (
                  <div className="muted">
                    About <RefLink refNo={it.letter!.linkedRef} strong={false} />
                  </div>
                ) : null}
                {it.letter!.documentId ? <DocLink id={it.letter!.documentId} label="The letter (PDF)" /> : null}
              </>
            ) : (
              <div className="faint">Other business placed on the agenda by the Secretary.</div>
            )}
          </div>
        </Col>
        <Col xs={24} lg={11}>
          <div style={{ display: "grid", gap: 10 }}>
            {it.recommendation ? <Quote label="Background note" tone="brand">{it.recommendation}</Quote> : null}
            {it.resolution ? (
              <div style={{ border: "1px solid #c9ecd8", background: "#f4fbf7", borderRadius: 10, padding: "10px 12px", fontSize: 13.5 }} className="item-resolution">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                  <b>{council ? "Council outcome" : "Committee recommendation"}</b>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {it.resolvedBy} · {fmtDate(it.resolvedAt, true)}
                  </span>
                </div>
                <div style={{ lineHeight: 1.5 }}>{it.resolution}</div>
              </div>
            ) : status === "IN_SESSION" && canManage ? (
              <Button type="primary" block size="large" icon={<CheckOutlined />} onClick={() => setResolving(true)} className="record-resolution">
                {council ? "Record outcome" : "Record recommendation"}
              </Button>
            ) : status === "PLANNED" ? (
              <div className="faint" style={{ fontSize: 12.5 }}>{council ? "The outcome is recorded once the session starts." : "The recommendation is recorded once the session starts."}</div>
            ) : status === "CLOSED" ? (
              <div className="faint" style={{ fontSize: 12.5 }}>Not taken up at this meeting.</div>
            ) : null}
            {canManage && status === "PLANNED" ? (
              <Popconfirm title="Remove from this agenda?" okText="Remove" onConfirm={() => run(() => removeAgendaItem(it.id))}>
                <Button size="small" type="text" danger icon={<DeleteOutlined />} loading={pending} style={{ justifySelf: "end" }}>
                  Remove from agenda
                </Button>
              </Popconfirm>
            ) : null}
          </div>
        </Col>
      </Row>
      {resolving ? <ResolutionModal it={it} council={council} onClose={() => setResolving(false)} /> : null}
    </Card>
  );
}

/** Add one item to a meeting's agenda. */
export function AddItemModal({ meetingRef, council, options, onClose }: { meetingRef: string; council: boolean; options: AgendaOptions; onClose: () => void }) {
  const { run, pending } = useRun();
  const [form] = Form.useForm();
  const sources = council ? (["court", "letter", "other"] as const) : (["case", "appeal", "court", "letter", "other"] as const);
  const source = (Form.useWatch("source", form) as string) ?? sources[0];
  const list = source === "other" ? [] : options.sources[source as keyof AgendaOptions["sources"]];

  const demo = () => {
    const pick = list[0];
    form.setFieldsValue({
      ref: pick?.ref,
      subject: source === "other" ? "Schedule of inspection visits for the next quarter" : undefined,
      note:
        source === "case"
          ? "Self-assessment and inspection are complete. The officer recommends accreditation for 3 years with a library condition."
          : source === "court"
            ? "Hearing on the stay is listed shortly. Counsel seeks the committee's view on conceding a fresh inspection."
            : source === "letter"
              ? "The institution asks for more time on its deficiencies. The officer's view: no extension without evidence of orders placed."
              : "For the committee's information and comment.",
    });
  };

  return (
    <Modal open width={640} title={<span><PlusOutlined style={{ color: "var(--brand)", marginRight: 8 }} />Add agenda item</span>} okText="Add to the agenda" confirmLoading={pending} onOk={() => form.submit()} onCancel={onClose} destroyOnHidden>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span className="muted" style={{ fontSize: 13 }}>{council ? "Cases and appeals come from Build agenda from ready cases." : "The item goes at the end of the agenda."}</span>
        <FillDemo onClick={demo} />
      </div>
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ source: sources[0] }}
        onFinish={async (v) => (await run(() => addAgendaItem(meetingRef, { source: v.source, ref: v.ref ?? null, subject: v.subject ?? null, note: v.note ?? null }))) && onClose()}
      >
        <Form.Item name="source" label="Item">
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            onChange={() => form.setFieldsValue({ ref: undefined })}
            options={sources.map((x) => ({ value: x, label: { case: "Case", appeal: "Appeal", court: "Court case", letter: "Letter", other: "Other matter" }[x] }))}
          />
        </Form.Item>
        {source === "other" ? (
          <Form.Item name="subject" label="Matter" rules={[{ required: true, min: 5, message: "Describe the matter (at least 5 characters)." }]}>
            <Input id="item-subject" />
          </Form.Item>
        ) : (
          <Form.Item name="ref" label="Which one" rules={[{ required: true, message: "Pick the item." }]} extra={list.length ? undefined : "Nothing open of this kind."}>
            <Select id="item-ref" showSearch optionFilterProp="label" placeholder="Pick from the list" options={list.map((x) => ({ value: x.ref, label: `${x.ref} · ${x.label}` }))} />
          </Form.Item>
        )}
        <Form.Item name="note" label="Background note for members">
          <Input.TextArea id="item-note" rows={3} placeholder="What the members should know, and the officer's view" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function AddActionModal({ meetingRef, items, staff, onClose }: { meetingRef: string; items: { id: number; position: number; ref: string | null }[]; staff: Staff; onClose: () => void }) {
  const { run, pending } = useRun();
  const [form] = Form.useForm();
  return (
    <Modal open width={600} title={<span><CheckSquareOutlined style={{ color: "var(--brand)", marginRight: 8 }} />Add action point</span>} okText="Assign the action point" confirmLoading={pending} onOk={() => form.submit()} onCancel={onClose} destroyOnHidden>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span className="muted" style={{ fontSize: 13 }}>It goes on the owner&apos;s work list, with reminders before it is due and when it is overdue.</span>
        <FillDemo
          onClick={() =>
            form.setFieldsValue({
              title: "Write to the institution for the laboratory commissioning certificate and report back to the committee",
              owner: staff.find((s) => s.username === "pcp.officer")?.username ?? staff[0]?.username,
              dueDate: dayjs().add(10, "day"),
              itemId: items[0]?.id,
            })
          }
        />
      </div>
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={async (v) => (await run(() => addActionPoint(meetingRef, { title: v.title, owner: v.owner, dueDate: v.dueDate ? dayjs(v.dueDate).format("YYYY-MM-DD") : null, itemId: v.itemId ?? null }))) && onClose()}
      >
        <Form.Item name="title" label="Action" rules={[{ required: true, min: 5, message: "Describe the action point (at least 5 characters)." }]}>
          <Input.TextArea id="action-title" rows={2} />
        </Form.Item>
        <Row gutter={12}>
          <Col span={14}>
            <Form.Item name="owner" label="Owner" rules={[{ required: true, message: "Choose the owner." }]}>
              <Select id="action-owner" showSearch optionFilterProp="label" options={staff.map((s) => ({ value: s.username, label: `${s.name} · ${s.roleLabel}` }))} />
            </Form.Item>
          </Col>
          <Col span={10}>
            <Form.Item name="dueDate" label="Due by" rules={[{ required: true, message: "Pick the due date." }]}>
              <DatePicker id="action-due" style={{ width: "100%" }} format="D MMM YYYY" disabledDate={(d) => d.isBefore(dayjs(), "day")} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="itemId" label="From agenda item (optional)">
          <Select allowClear options={items.map((i) => ({ value: i.id, label: `Item ${i.position}${i.ref ? ` · ${i.ref}` : ""}` }))} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function DoneModal({ a, onClose }: { a: Actions[number]; onClose: () => void }) {
  const { run, pending } = useRun();
  const [note, setNote] = useState("");
  return (
    <Modal open title="Mark the action point done" okText="Mark done" okButtonProps={{ disabled: note.trim().length < 5 }} confirmLoading={pending} onOk={async () => (await run(() => updateActionPoint(a.id, { status: "DONE", note }))) && onClose()} onCancel={onClose} destroyOnHidden>
      <div style={{ marginBottom: 8, fontSize: 13.5 }}>{a.title}</div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
        <FillDemo onClick={() => setNote("Letter sent and the certificate received; filed on the case.")} />
      </div>
      <Input.TextArea id="done-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done" />
    </Modal>
  );
}

/** Action points of a meeting: tracked tasks with an owner, a due date and a status. */
export function ActionPointsCard({ meetingRef, status, actions, items, staff, canManage, username, run }: { meetingRef: string; status: string; actions: Actions; items: { id: number; position: number; ref: string | null }[]; staff: Staff; canManage: boolean; username: string; run: (fn: () => Promise<ActionResult>) => void }) {
  const [adding, setAdding] = useState(false);
  const [done, setDone] = useState<Actions[number] | null>(null);
  const itemOf = (id: number | null) => items.find((i) => i.id === id);
  if (!actions.length && status !== "IN_SESSION") return null;
  return (
    <Card
      id="actions"
      size="small"
      title={<span><CheckSquareOutlined style={{ color: "var(--brand)", marginRight: 8 }} />Action points</span>}
      extra={canManage && status === "IN_SESSION" ? <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>Add action point</Button> : <span className="faint" style={{ fontSize: 12 }}>Each one is a task on its owner&apos;s work list</span>}
      style={{ marginBottom: 16 }}
      styles={{ body: { padding: 0 } }}
      data-testid="action-points"
    >
      {actions.length ? (
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={actions}
          columns={[
            {
              title: "Action",
              render: (_, a) => (
                <div style={{ fontSize: 13 }} data-action={a.id}>
                  <div>{a.title}</div>
                  {itemOf(a.itemId) ? <div className="faint" style={{ fontSize: 12 }}>From item {itemOf(a.itemId)!.position}{itemOf(a.itemId)!.ref ? ` · ${itemOf(a.itemId)!.ref}` : ""}</div> : null}
                  {a.note ? <div style={{ fontSize: 12, color: "var(--good)" }}>Done: {a.note}</div> : null}
                </div>
              ),
            },
            { title: "Owner", dataIndex: "ownerName", width: 170 },
            {
              title: "Due",
              width: 150,
              render: (_, a) => (
                <span style={{ display: "inline-flex", flexDirection: "column" }}>
                  <span>{fmtDate(a.dueDate)}</span>
                  {a.status !== "DONE" ? <span className="faint" style={{ fontSize: 12, color: a.days < 0 ? "#b4141f" : undefined }}>{relDays(a.days)}</span> : null}
                </span>
              ),
            },
            { title: "Status", width: 120, render: (_, a) => <TaskStatus status={a.status} overdue={a.days < 0} /> },
            {
              title: "",
              width: 210,
              align: "right",
              render: (_, a) =>
                a.status !== "DONE" && (a.owner === username || canManage) ? (
                  <span style={{ display: "inline-flex", gap: 6 }}>
                    {a.status === "OPEN" ? (
                      <Button size="small" icon={<PlayCircleOutlined />} onClick={() => run(() => updateActionPoint(a.id, { status: "IN_PROGRESS" }))}>
                        Start
                      </Button>
                    ) : null}
                    <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => setDone(a)}>
                      Mark done
                    </Button>
                  </span>
                ) : null,
            },
          ]}
        />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No action points yet. Add them as the meeting agrees them." style={{ margin: "14px 0" }} />
      )}
      {status === "CLOSED" && actions.some((a) => a.status !== "DONE") ? (
        <Alert type="info" showIcon style={{ margin: 10 }} title="Open action points stay on their owners' work lists after the meeting, with reminders, until they are done." icon={<ExceptionOutlined />} />
      ) : null}
      {adding ? <AddActionModal meetingRef={meetingRef} items={items} staff={staff} onClose={() => setAdding(false)} /> : null}
      {done ? <DoneModal a={done} onClose={() => setDone(null)} /> : null}
    </Card>
  );
}
