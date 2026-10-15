"use client";
// Correspondence register: the inward diary, the outward dispatch register and the letters marked to you.
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Card, Col, DatePicker, Empty, Form, Input, Modal, Radio, Row, Segmented, Select, Table } from "antd";
import { ClockCircleOutlined, InboxOutlined, MailOutlined, SendOutlined, UserOutlined, WarningOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { createOutward, registerInward } from "@/app/actions/correspondence";
import type { CorrespondenceOptions, LetterRow, loadCorrespondence } from "@/lib/governance-data";
import { MODE_LABELS } from "@/lib/governance-shared";
import { PageTitle, StatCard, fmtDate } from "./common";
import { FillDemo } from "./demo-helpers";
import { ExportButtons, openCaseOf, FilePick, LetterStatus, RefLink, uploadGov } from "./GovParts";
import ScreenGuide from "./ScreenGuide";

type Data = Awaited<ReturnType<typeof loadCorrespondence>>;
type Tab = "in" | "out" | "mine";
const modes = Object.entries(MODE_LABELS).map(([value, label]) => ({ value, label }));

/** Sender or addressee: an institution from the registry, or anyone else. */
function PartyFields({ options, label, form }: { options: CorrespondenceOptions; label: string; form: ReturnType<typeof Form.useForm>[0] }) {
  const kind = (Form.useWatch("partyKind", form) as string) ?? "inst";
  return (
    <>
      <Form.Item name="partyKind" label={label} style={{ marginBottom: 8 }}>
        <Radio.Group optionType="button" options={[{ value: "inst", label: "An institution" }, { value: "other", label: "Someone else" }]} onChange={() => form.setFieldsValue({ linkedRef: undefined })} />
      </Form.Item>
      {kind === "inst" ? (
        <Form.Item name="partyInstitutionId" rules={[{ required: true, message: "Pick the institution." }]}>
          <Select id="letter-inst" showSearch optionFilterProp="label" placeholder="Pick the institution" options={options.institutions.map((i) => ({ value: i.id, label: `${i.name} (${i.shortCode})` }))} onChange={() => form.setFieldsValue({ linkedRef: undefined })} />
        </Form.Item>
      ) : (
        <Row gutter={12}>
          <Col span={14}>
            <Form.Item name="party" rules={[{ required: true, message: "Type the name." }]}>
              <Input placeholder="e.g. Higher Education Commission, Islamabad" />
            </Form.Item>
          </Col>
          <Col span={10}>
            <Form.Item name="partyEmail">
              <Input placeholder="Email (optional)" />
            </Form.Item>
          </Col>
        </Row>
      )}
    </>
  );
}

function linkOptions(options: CorrespondenceOptions, instId?: number) {
  return options.refs.filter((r) => !instId || r.institutionId === instId).map((r) => ({ value: r.ref, label: `${r.ref} · ${r.label}` }));
}

function InwardModal({ options, onClose }: { options: CorrespondenceOptions; onClose: () => void }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm();
  const [file, setFile] = useState<File | null>(null);
  const [pending, start] = useTransition();
  const instId = Form.useWatch("partyInstitutionId", form) as number | undefined;
  const kind = (Form.useWatch("partyKind", form) as string) ?? "inst";

  const demo = () => {
    const ccp = options.institutions.find((i) => i.shortCode === "CCP") ?? options.institutions[0];
    const ref = openCaseOf(options.refs, ccp.id);
    form.setFieldsValue({
      partyKind: "inst",
      partyInstitutionId: ccp.id,
      letterDate: dayjs().subtract(2, "day"),
      mode: "COURIER",
      subject: "Request for extension of the deficiency deadline for laboratory equipment",
      linkedRef: ref,
      markedTo: "pcp.officer",
      actionDue: dayjs().add(7, "day"),
    });
  };

  const submit = (v: Record<string, unknown>) =>
    start(async () => {
      const r = await registerInward({
        letterDate: v.letterDate ? dayjs(v.letterDate as string).format("YYYY-MM-DD") : null,
        mode: v.mode,
        partyInstitutionId: kind === "inst" ? v.partyInstitutionId : null,
        party: kind === "inst" ? null : v.party,
        partyEmail: kind === "inst" ? null : v.partyEmail,
        subject: v.subject,
        linkedRef: v.linkedRef ?? null,
        markedTo: v.markedTo ?? null,
        actionDue: v.actionDue ? dayjs(v.actionDue as string).format("YYYY-MM-DD") : null,
        note: v.note ?? null,
      });
      if (!r.ok || !r.ref) {
        message.error(r.message, 8);
        return;
      }
      let note = r.message;
      if (file) {
        const u = await uploadGov({ target: "letter", ref: r.ref, file });
        note = u.ok ? `${r.message} The scan is filed.` : `${r.message} The scan was not filed: ${u.message}`;
      }
      message.success(note, 6);
      router.push(`/pcp/correspondence/${r.ref}`);
    });

  return (
    <Modal open width={720} title={<span><InboxOutlined style={{ color: "var(--brand)", marginRight: 8 }} />Register an inward letter</span>} okText="Enter in the diary" confirmLoading={pending} onOk={() => form.submit()} onCancel={onClose} destroyOnHidden>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span className="muted" style={{ fontSize: 13 }}>The diary number (IN-year-number) is assigned when you enter it.</span>
        <FillDemo onClick={demo} />
      </div>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={submit} initialValues={{ partyKind: "inst", letterDate: dayjs(), mode: "POST" }}>
        <PartyFields options={options} label="From" form={form} />
        <Row gutter={12}>
          <Col xs={24} md={16}>
            <Form.Item name="subject" label="Subject" rules={[{ required: true, min: 5, message: "Give the subject (at least 5 characters)." }]}>
              <Input id="letter-subject" />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="letterDate" label="Date on the letter" rules={[{ required: true, message: "Pick the date." }]}>
              <DatePicker style={{ width: "100%" }} format="D MMM YYYY" disabledDate={(d) => d.isAfter(dayjs(), "day")} />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="mode" label="Received by">
              <Select options={modes} />
            </Form.Item>
          </Col>
          <Col xs={24} md={16}>
            <Form.Item name="linkedRef" label="About case, appeal or court case" extra="The letter then shows on that case.">
              <Select allowClear showSearch optionFilterProp="label" placeholder="None" options={linkOptions(options, kind === "inst" ? instId : undefined)} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="markedTo" label="Mark to officer" extra="It goes on their work list and they are notified.">
              <Select id="letter-marked" allowClear showSearch optionFilterProp="label" placeholder="Nobody yet" options={options.staff.map((s) => ({ value: s.username, label: `${s.name} · ${s.roleLabel}` }))} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="actionDue" label="Action due by">
              <DatePicker style={{ width: "100%" }} format="D MMM YYYY" disabledDate={(d) => d.isBefore(dayjs(), "day")} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item label="Scanned letter" extra="PDF or image, up to 10 MB. Filed as a versioned document in the institution's Correspondence folder.">
          <FilePick file={file} onFile={setFile} sample="Scanned inward letter" id="letter-file" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

const TEMPLATE = (to: string, ref?: string | null) =>
  `With reference to ${ref ? `case ${ref}` : "your letter"}, the Pharmacy Council of Pakistan writes to inform ${to} as follows.\n\n` +
  "The request has been examined against the record. The institution is asked to submit the documents listed in the deficiency notice through the PCP portal within 30 days of this letter.\n\n" +
  "This letter is issued with the approval of the competent authority.";

function OutwardModal({ options, replyTo, onClose }: { options: CorrespondenceOptions; replyTo: string | null; onClose: () => void }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm();
  const [pending, start] = useTransition();
  const reply = options.openInward.find((l) => l.ref === replyTo);
  const instId = Form.useWatch("partyInstitutionId", form) as number | undefined;
  const kind = (Form.useWatch("partyKind", form) as string) ?? "inst";

  const pickReply = (id: number | undefined) => {
    const l = options.openInward.find((x) => x.id === id);
    if (!l) return;
    form.setFieldsValue({
      partyKind: l.partyInstitutionId ? "inst" : "other",
      partyInstitutionId: l.partyInstitutionId ?? undefined,
      party: l.partyInstitutionId ? undefined : l.party,
      partyEmail: l.partyEmail ?? undefined,
      linkedRef: l.linkedRef ?? undefined,
      subject: `Reply: ${l.subject}`,
    });
  };

  const demo = () => {
    const v = form.getFieldsValue();
    const inst = options.institutions.find((i) => i.id === (v.partyInstitutionId ?? instId));
    if (!v.partyInstitutionId && !v.party) {
      const ccp = options.institutions.find((i) => i.shortCode === "CCP") ?? options.institutions[0];
      const ref = openCaseOf(options.refs, ccp.id);
      form.setFieldsValue({ partyKind: "inst", partyInstitutionId: ccp.id, linkedRef: ref, subject: v.subject || `Outstanding deficiency on ${ref ?? "your case"}`, body: TEMPLATE(ccp.name, ref), mode: "EMAIL" });
      return;
    }
    form.setFieldsValue({ subject: v.subject || "Outstanding deficiency", body: TEMPLATE(inst?.name ?? v.party ?? "you", v.linkedRef), mode: v.mode ?? "EMAIL" });
  };

  const submit = (v: Record<string, unknown>) =>
    start(async () => {
      const r = await createOutward({
        partyInstitutionId: kind === "inst" ? v.partyInstitutionId : null,
        party: kind === "inst" ? null : v.party,
        partyEmail: kind === "inst" ? null : v.partyEmail,
        subject: v.subject,
        body: v.body,
        mode: v.mode,
        linkedRef: v.linkedRef ?? null,
        inReplyTo: v.inReplyTo ?? null,
      });
      message[r.ok ? "success" : "error"](r.message, r.ok ? 5 : 8);
      if (r.ok && r.ref) router.push(`/pcp/correspondence/${r.ref}`);
    });

  return (
    <Modal open width={760} title={<span><SendOutlined style={{ color: "var(--brand)", marginRight: 8 }} />New outward letter</span>} okText="Generate the letter" confirmLoading={pending} onOk={() => form.submit()} onCancel={onClose} destroyOnHidden>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span className="muted" style={{ fontSize: 13 }}>The letter is generated on the PCP letterhead with a dispatch number. You dispatch it on the next screen.</span>
        <FillDemo onClick={demo} />
      </div>
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={submit}
        initialValues={
          reply
            ? { inReplyTo: reply.id, partyKind: reply.partyInstitutionId ? "inst" : "other", partyInstitutionId: reply.partyInstitutionId ?? undefined, party: reply.partyInstitutionId ? undefined : reply.party, partyEmail: reply.partyEmail ?? undefined, linkedRef: reply.linkedRef ?? undefined, subject: `Reply: ${reply.subject}`, mode: "EMAIL" }
            : { partyKind: "inst", mode: "EMAIL" }
        }
      >
        <Form.Item name="inReplyTo" label="In reply to (optional)">
          <Select allowClear showSearch optionFilterProp="label" placeholder="Not a reply" options={options.openInward.map((l) => ({ value: l.id, label: `${l.ref} · ${l.party}: ${l.subject}` }))} onChange={pickReply} />
        </Form.Item>
        <PartyFields options={options} label="To" form={form} />
        <Row gutter={12}>
          <Col xs={24} md={16}>
            <Form.Item name="subject" label="Subject" rules={[{ required: true, min: 5, message: "Give the subject (at least 5 characters)." }]}>
              <Input id="out-subject" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="mode" label="Send by">
              <Select options={modes} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="body" label="Text of the letter" rules={[{ required: true, min: 20, message: "Write the letter (at least a sentence)." }]} extra="Separate paragraphs with a blank line. Reference, date, address, signature and QR code are added from the standard template.">
          <Input.TextArea id="out-body" rows={7} />
        </Form.Item>
        <Form.Item name="linkedRef" label="About case, appeal or court case">
          <Select allowClear showSearch optionFilterProp="label" placeholder="None" options={linkOptions(options, kind === "inst" ? instId : undefined)} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default function CorrespondenceList({ data, canManage, username, options, initialTab, replyTo }: { data: Data; canManage: boolean; username: string; options: CorrespondenceOptions | null; initialTab: Tab; replyTo: string | null }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState<null | "in" | "out">(replyTo && canManage ? "out" : null);
  const rows = useMemo(
    () =>
      data.letters.filter(
        (l) =>
          (tab === "in" ? l.direction === "IN" : tab === "out" ? l.direction === "OUT" : l.direction === "IN" && l.markedTo === username && l.status === "OPEN") &&
          (!q || `${l.ref} ${l.party} ${l.subject} ${l.linkedRef ?? ""} ${l.markedToName ?? ""}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [data.letters, tab, q, username],
  );
  const inward = tab !== "out";

  return (
    <>
      <PageTitle
        eyebrow="Casework"
        title="Correspondence"
        sub="The diary of letters received and the register of letters sent. Every letter to or from an institution is also filed in its Correspondence folder and shows on the case it is about."
        extra={
          <>
            <ScreenGuide
              title="Correspondence"
              steps={[
                "**Register inward letter** enters a letter in the diary (IN-year-number) with its sender, subject, how it came, and its scan.",
                "Mark it to an officer with an action date. It goes on their work list on the dashboard, and they are notified.",
                "The officer opens the letter and records the action taken, or replies with an outward letter.",
                "**New outward letter** generates the letter on the PCP letterhead (OUT-year-number). **Dispatch** sends it: an email copy goes to the institution and the dispatch is recorded.",
                "**Excel** and **PDF** export the register you are looking at.",
              ]}
              note={canManage ? undefined : "Only register keepers enter and send letters. You can act on letters marked to you."}
            />
            <ExportButtons href={`/api/governance/export?what=correspondence&dir=${tab === "out" ? "OUT" : "IN"}`} />
            {canManage ? (
              <>
                <Button icon={<InboxOutlined />} onClick={() => setModal("in")}>
                  Register inward letter
                </Button>
                <Button type="primary" icon={<SendOutlined />} onClick={() => setModal("out")}>
                  New outward letter
                </Button>
              </>
            ) : null}
          </>
        }
      />
      <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
        <Col xs={12} lg={6}>
          <StatCard label="Open inward letters" icon={<InboxOutlined />} value={data.counts.openIn} hint="Waiting for action" />
        </Col>
        <Col xs={12} lg={6}>
          <div onClick={() => setTab("mine")} style={{ cursor: "pointer" }}>
            <StatCard clickable label="Marked to you" icon={<UserOutlined />} tone="violet" value={data.counts.mine} hint="On your work list" />
          </div>
        </Col>
        <Col xs={12} lg={6}>
          <StatCard label="Past the action date" icon={<WarningOutlined />} tone={data.counts.overdue ? "bad" : "neutral"} value={data.counts.overdue} hint="A reminder goes to the officer" />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard label="Dispatched this month" icon={<MailOutlined />} tone="info" value={data.counts.dispatchedMonth} hint={data.counts.drafts ? `${data.counts.drafts} draft${data.counts.drafts === 1 ? "" : "s"} not sent yet` : "Email copy to each institution"} />
        </Col>
      </Row>
      <Card
        styles={{ body: { padding: 0 } }}
        title={
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 0" }}>
            <Segmented
              value={tab}
              onChange={(v) => setTab(v as Tab)}
              options={[
                { value: "in", label: `Inward (diary) · ${data.letters.filter((l) => l.direction === "IN").length}` },
                { value: "out", label: `Outward (dispatch) · ${data.letters.filter((l) => l.direction === "OUT").length}` },
                { value: "mine", label: `Marked to me · ${data.counts.mine}` },
              ]}
            />
            <Input.Search allowClear placeholder="Number, sender, subject, case" style={{ width: 300 }} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        }
      >
        <Table<LetterRow>
          rowKey="ref"
          dataSource={rows}
          pagination={{ pageSize: 15, hideOnSinglePage: true }}
          locale={{ emptyText: <Empty description={tab === "mine" ? "No open letters are marked to you." : "No letters in this register yet."} /> }}
          columns={[
            {
              title: inward ? "Diary no." : "Dispatch no.",
              dataIndex: "ref",
              render: (v, r) => (
                <Link href={`/pcp/correspondence/${v}`} style={{ display: "inline-flex", flexDirection: "column" }} data-letter={v}>
                  <span className="mono" style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap" }}>
                    {v}
                  </span>
                  <span className="faint" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{fmtDate(r.date)}</span>
                </Link>
              ),
            },
            {
              title: inward ? "From" : "To",
              render: (_, r) => (
                <span style={{ display: "inline-flex", flexDirection: "column" }}>
                  <span>{r.party}</span>
                  <span className="faint" style={{ fontSize: 12 }}>{MODE_LABELS[r.mode] ?? r.mode}</span>
                </span>
              ),
            },
            { title: "Subject", dataIndex: "subject", render: (v) => <span style={{ fontSize: 13 }}>{v}</span> },
            { title: "About", dataIndex: "linkedRef", render: (v) => <RefLink refNo={v} /> },
            ...(inward
              ? [
                  { title: "Marked to", dataIndex: "markedToName", width: 130, render: (v: string | null) => v ?? <span className="faint">Nobody yet</span> },
                  {
                    title: "Action due",
                    dataIndex: "actionDue",
                    render: (v: string | null, r: LetterRow) =>
                      v ? (
                        <span style={{ color: r.overdue ? "#b4141f" : undefined, fontWeight: r.overdue ? 600 : 400, whiteSpace: "nowrap" }}>
                          {r.overdue ? <ClockCircleOutlined /> : null} {fmtDate(v)}
                        </span>
                      ) : (
                        <span className="faint">—</span>
                      ),
                  },
                ]
              : [{ title: "Dispatched", dataIndex: "dispatchedAt", render: (v: string | null) => (v ? <span style={{ whiteSpace: "nowrap" }}>{fmtDate(v)}</span> : <span className="faint">Not yet</span>) }]),
            { title: "Status", render: (_, r) => <LetterStatus status={r.status} direction={r.direction} dispatchedAt={r.dispatchedAt} /> },
          ]}
        />
      </Card>
      {modal === "in" && options ? <InwardModal options={options} onClose={() => setModal(null)} /> : null}
      {modal === "out" && options ? <OutwardModal options={options} replyTo={replyTo} onClose={() => setModal(null)} /> : null}
    </>
  );
}
