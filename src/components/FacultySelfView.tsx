"use client";
// Faculty self-service (RFP 4.1.2: academic profile updates, institutional attachment declarations, verification
// requests; 4.1.11: one person, one ID). The teacher sees their own record and asks; PCP decides.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, AutoComplete, Button, Card, Col, Empty, Form, Input, InputNumber, Modal, Result, Row, Segmented, Select, Table, Upload } from "antd";
import { BankOutlined, FilePdfOutlined, IdcardOutlined, PaperClipOutlined, SafetyCertificateOutlined, SendOutlined, SwapOutlined } from "@ant-design/icons";
import { declareAttachment, requestFacultyVerification, withdrawFacultyRequest } from "@/app/actions/people";
import type { FacultyRequestDetails } from "@/db/modules/people";
import { FACULTY_REQUEST_LABELS } from "@/lib/people-shared";
import { CHANGE_KIND_LABELS, DESIGNATIONS, QUALIFICATIONS, SPECIALIZATIONS } from "@/lib/registry-shared";
import { KV, PageTitle, fmtDate, programLabel, timeAgo } from "./common";
import { FillDemo, SamplePdfButton } from "./demo-helpers";
import { ChangeLines, RegStatus, useBusy } from "./registry-ui";

type Me = { pcpId: string; fullName: string; fatherName: string; cnic: string; qualification: string; specialization: string; designation: string; pcpRegNo: string | null; verificationStatus: string };
type Link = { id: number; inst: { code: string; shortCode: string; name: string; city: string }; programType: string; status: string; startDate: string; endDate: string | null };
type Req = { id: number; ref: string; kind: string; status: string; details: FacultyRequestDetails; note: string | null; createdAt: string; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; evidence: { id: number; fileName: string } | null };
type RegistryChange = { id: number; ref: string; kind: string; status: string; inst: string; reason: string; changes: Record<string, { from: string | null; to: string | null }>; createdAt: string; decidedAt: string | null; decisionNote: string | null };
type Inst = { code: string; shortCode: string; name: string; city: string; programmes: string[] };

const VERIFY_TEXT: Record<string, { label: string; help: string }> = {
  VERIFIED: { label: "Verified by PCP", help: "PCP checked your qualification and your appointment." },
  PENDING: { label: "Waiting for PCP", help: "PCP has not verified your record yet. You can ask for it below." },
  FLAGGED: { label: "Being checked", help: "PCP is checking whether your record duplicates another one." },
  REJECTED: { label: "Deactivated", help: "PCP deactivated this record as a duplicate. Contact PCP's verification desk." },
};

const LINK_LABEL: Record<string, string> = { ACTIVE: "Current", ENDED: "Ended", REQUESTED: "Requested", DECLINED: "Declined", WITHDRAWN: "Withdrawn" };
const REQUEST_STATUS: Record<string, { value: string; label: string }> = {
  PENDING: { value: "PENDING", label: "With PCP" },
  APPROVED: { value: "APPROVED", label: "Approved" },
  REJECTED: { value: "REJECTED", label: "Not approved" },
  WITHDRAWN: { value: "WITHDRAWN", label: "Withdrawn" },
};

export function FacultyNotLinked({ name }: { name: string }) {
  return (
    <>
      <PageTitle eyebrow="Faculty" title="My academic profile" />
      <Card>
        <Result status="info" title="Your login is not linked to a PCP Faculty ID yet" subTitle={`${name}, ask PCP's verification desk to link your login to your Faculty ID. Until then there is nothing to show here.`} />
      </Card>
    </>
  );
}

function requestSummary(r: Req) {
  const d = r.details;
  if (r.kind === "PROFILE") return <ChangeLines changes={d.changes ?? {}} />;
  if (r.kind === "ATTACHMENT")
    return (
      <span style={{ fontSize: 13 }}>
        {d.action === "JOINED" ? "Joined" : "Left"} <b style={{ fontWeight: 600 }}>{d.institutionName}</b>
        {d.programType ? ` · ${programLabel(d.programType)}` : ""}
        {d.designation ? ` · ${d.designation}` : ""} · {fmtDate(d.date)}
        {d.fcrRef ? <div className="faint mono" style={{ fontSize: 12 }}>{d.fcrRef}</div> : null}
      </span>
    );
  return <span style={{ fontSize: 13 }}>{r.note ?? "Verify my record"}</span>;
}

export default function FacultySelfView({ me, links, requests, registry, institutions }: { me: Me; links: Link[]; requests: Req[]; registry: RegistryChange[]; institutions: Inst[] }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [busy, run] = useBusy();
  const [open, setOpen] = useState<"profile" | "attachment" | "verify" | null>(null);
  const active = links.find((l) => l.status === "ACTIVE");
  const v = VERIFY_TEXT[me.verificationStatus] ?? VERIFY_TEXT.PENDING;
  const openVerification = requests.find((r) => r.kind === "VERIFICATION" && r.status === "PENDING");
  const done = (r: { ok: boolean; message: string; level?: string }) => {
    message[r.ok ? "success" : r.level === "warning" ? "warning" : "error"](r.message, 7);
    if (r.ok) {
      setOpen(null);
      router.refresh();
    }
  };

  return (
    <>
      <PageTitle eyebrow="Faculty" title="My academic profile" sub="Your record in PCP's faculty registry: one person, one Faculty ID. You can ask for changes; PCP verifies them before anything changes." />
      <div data-testid="faculty-card" style={{ borderRadius: 18, overflow: "hidden", border: "1px solid var(--line)", boxShadow: "var(--shadow-md)", background: "#fff", marginBottom: 18 }}>
        <div style={{ background: "linear-gradient(120deg, var(--forest) 0%, var(--brand) 100%)", color: "#fff", padding: "18px 22px", display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.7 }}>PCP Faculty ID</div>
            <div className="mono" style={{ fontSize: 24, fontWeight: 700, letterSpacing: "0.02em", marginTop: 4, color: "#fff" }}>
              {me.pcpId}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 18, fontWeight: 650 }}>{me.fullName}</div>
            <div style={{ fontSize: 12.5, opacity: 0.8 }}>
              {me.designation}
              {active ? `, ${active.inst.name}` : ""}
            </div>
          </div>
        </div>
        <div style={{ padding: "16px 22px" }}>
          <KV
            rows={[
              ["Verification", <span key="v"><RegStatus value={me.verificationStatus} label={v.label} /> <span className="muted" style={{ fontSize: 12.5 }}>{v.help}</span></span>],
              ["Highest qualification", <b key="q" style={{ fontWeight: 600 }}>{me.qualification}</b>],
              ["Specialization", me.specialization],
              ["Pharmacist registration", me.pcpRegNo ?? "Not recorded"],
              ["Father's name", me.fatherName],
              ["CNIC", <span key="c" className="mono">{me.cnic}</span>],
            ]}
          />
        </div>
      </div>

      <Card title="What do you need?" style={{ marginBottom: 18 }}>
        <Row gutter={[12, 12]}>
          <Col xs={24} md={8}>
            <Button block size="large" icon={<IdcardOutlined />} onClick={() => setOpen("profile")} disabled={me.verificationStatus === "REJECTED"}>
              Update my qualification
            </Button>
            <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>A new degree, specialization or registration number, with evidence.</div>
          </Col>
          <Col xs={24} md={8}>
            <Button block size="large" icon={<SwapOutlined />} onClick={() => setOpen("attachment")} disabled={me.verificationStatus === "REJECTED"}>
              Declare joining or leaving
            </Button>
            <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>The institution and PCP are told; PCP updates your link.</div>
          </Col>
          <Col xs={24} md={8}>
            <Button block size="large" icon={<SafetyCertificateOutlined />} onClick={() => setOpen("verify")} disabled={!!openVerification || me.verificationStatus === "REJECTED"}>
              Request verification
            </Button>
            <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>{openVerification ? `${openVerification.ref} is with PCP.` : "Ask PCP to check and verify your record."}</div>
          </Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card title="My institutions" styles={{ body: { padding: 0 } }} style={{ marginBottom: 16 }} data-testid="faculty-links">
            <Table
              rowKey="id"
              size="small"
              dataSource={links}
              pagination={false}
              scroll={{ x: true }}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No institutional link on record" /> }}
              columns={[
                { title: "Institution", render: (_, l) => <span><b style={{ fontWeight: 600 }}>{l.inst.name}</b><div className="faint" style={{ fontSize: 12 }}>{l.inst.city} · {programLabel(l.programType)}</div></span> },
                { title: "From", dataIndex: "startDate", render: (x) => <span className="tnum">{fmtDate(x)}</span> },
                { title: "To", dataIndex: "endDate", render: (x, l) => (x ? <span className="tnum">{fmtDate(x)}</span> : l.status === "ACTIVE" ? "Now" : "") },
                { title: "Status", dataIndex: "status", render: (x) => <RegStatus value={x} label={LINK_LABEL[x]} /> },
              ]}
            />
            <div className="faint" style={{ fontSize: 12.5, padding: "10px 16px" }}>Past links stay on your record and on the cases they supported.</div>
          </Card>
          {registry.length ? (
            <Card title="Changes institutions asked for" styles={{ body: { padding: 0 } }}>
              <Table
                rowKey="id"
                size="small"
                dataSource={registry}
                pagination={registry.length > 6 ? { pageSize: 6, showSizeChanger: false } : false}
                scroll={{ x: true }}
                columns={[
                  { title: "Request", render: (_, r) => <span><span className="mono">{r.ref}</span><div className="faint" style={{ fontSize: 12 }}>{CHANGE_KIND_LABELS[r.kind] ?? r.kind} · {r.inst}</div></span> },
                  { title: "Change", render: (_, r) => <ChangeLines changes={r.changes} />, responsive: ["md"] },
                  { title: "Decision", render: (_, r) => <span><RegStatus value={r.status} />{r.decisionNote ? <div className="faint" style={{ fontSize: 12 }}>{r.decisionNote}</div> : null}</span> },
                ]}
              />
            </Card>
          ) : null}
        </Col>
        <Col xs={24} xl={12}>
          <Card title="My requests and decisions" styles={{ body: { padding: 0 } }} data-testid="faculty-requests">
            <Table
              rowKey="id"
              size="small"
              dataSource={requests}
              pagination={requests.length > 8 ? { pageSize: 8, showSizeChanger: false } : false}
              scroll={{ x: true }}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="You have not sent any request" /> }}
              columns={[
                {
                  title: "Request",
                  render: (_, r) => (
                    <span>
                      <span className="mono">{r.ref}</span>
                      <div className="faint" style={{ fontSize: 12 }}>
                        {FACULTY_REQUEST_LABELS[r.kind]} · {timeAgo(r.createdAt)}
                      </div>
                    </span>
                  ),
                },
                {
                  title: "Details",
                  render: (_, r) => (
                    <div>
                      {requestSummary(r)}
                      {r.evidence ? (
                        <a href={`/api/people/documents/${r.evidence.id}`} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>
                          <FilePdfOutlined /> {r.evidence.fileName}
                        </a>
                      ) : null}
                    </div>
                  ),
                },
                {
                  title: "Decision",
                  render: (_, r) => (
                    <span>
                      <RegStatus value={REQUEST_STATUS[r.status]?.value ?? r.status} label={REQUEST_STATUS[r.status]?.label} />
                      {r.decisionNote ? <div className="faint" style={{ fontSize: 12 }}>{r.decisionNote}</div> : null}
                      {r.decidedAt ? <div className="faint" style={{ fontSize: 12 }}>{fmtDate(r.decidedAt)}</div> : null}
                      {r.status === "PENDING" && r.kind !== "ATTACHMENT" ? (
                        <Button size="small" type="link" style={{ paddingInline: 0, fontSize: 12.5, height: "auto" }} disabled={busy} onClick={() => run(async () => done(await withdrawFacultyRequest(r.id)))}>
                          Withdraw
                        </Button>
                      ) : null}
                    </span>
                  ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <ProfileModal open={open === "profile"} me={me} onClose={() => setOpen(null)} onDone={done} />
      <AttachmentModal open={open === "attachment"} me={me} links={links} institutions={institutions} onClose={() => setOpen(null)} onDone={done} />
      <VerifyModal open={open === "verify"} onClose={() => setOpen(null)} onSend={(note) => run(async () => done(await requestFacultyVerification(note)))} busy={busy} />
    </>
  );
}

function ProfileModal({ open, me, onClose, onDone }: { open: boolean; me: Me; onClose: () => void; onDone: (r: { ok: boolean; message: string }) => void }) {
  const [form] = Form.useForm();
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const send = async (v: { qualification: string; specialization: string; pcpRegNo?: string; awardingBody: string; awardYear: number; note?: string }) => {
    if (!file) return onDone({ ok: false, message: "Attach evidence: the degree or transcript, or the HEC attestation." });
    setSending(true);
    try {
      const fd = new FormData();
      for (const [k, x] of Object.entries(v)) if (x !== undefined && x !== null) fd.set(k, String(x));
      fd.set("evidence", file);
      const res = await fetch("/api/faculty/requests", { method: "POST", body: fd });
      const r = (await res.json().catch(() => ({ ok: false, message: "The server did not answer. Try again." }))) as { ok: boolean; message: string };
      onDone(r);
      if (r.ok) {
        form.resetFields();
        setFile(null);
      }
    } finally {
      setSending(false);
    }
  };
  return (
    <Modal open={open} title="Update my qualification" onCancel={onClose} footer={null} destroyOnHidden width={560}>
      <Alert type="info" showIcon style={{ marginBottom: 14 }} title="This goes to PCP's verification desk as a request. Your record does not change until PCP approves it." />
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <FillDemo onClick={() => form.setFieldsValue({ qualification: "PhD", specialization: me.specialization, awardingBody: "University of Peshawar", awardYear: new Date().getFullYear(), note: "PhD awarded this year; degree attached." })} />
      </div>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={send} initialValues={{ qualification: me.qualification, specialization: me.specialization, pcpRegNo: me.pcpRegNo ?? "" }}>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="qualification" label="Highest qualification" rules={[{ required: true, message: "Choose your highest qualification" }]}>
              <Select id="fq-qualification" options={QUALIFICATIONS.map((q) => ({ value: q, label: q }))} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="specialization" label="Specialization" rules={[{ required: true, min: 3, message: "Write your specialization" }]}>
              <AutoComplete id="fq-specialization" options={SPECIALIZATIONS.map((s) => ({ value: s }))} filterOption={(i, o) => String(o?.value ?? "").toLowerCase().includes(i.toLowerCase())} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={14}>
            <Form.Item name="awardingBody" label="Awarded by" rules={[{ required: true, min: 3, message: "Name the university that awarded it" }]}>
              <Input id="fq-awarded" placeholder="e.g. University of Peshawar" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={10}>
            <Form.Item name="awardYear" label="Year awarded" rules={[{ required: true, message: "Give the year" }]}>
              <InputNumber id="fq-year" min={1970} max={new Date().getFullYear()} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item name="pcpRegNo" label="Pharmacist registration no. (if any)">
              <Input id="fq-regno" placeholder="e.g. PC-50888" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item label="Evidence" required extra="The degree or transcript, or the HEC attestation. PDF, JPG or PNG, up to 5 MB.">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Upload accept=".pdf,.jpg,.jpeg,.png" maxCount={1} showUploadList={false} beforeUpload={(f) => (setFile(f), false)}>
              <Button icon={<PaperClipOutlined />}>Choose file</Button>
            </Upload>
            <SamplePdfButton docLabel="PhD degree" onFile={(f) => setFile(f)} />
            {file ? (
              <span data-testid="fq-evidence" style={{ fontSize: 13 }}>
                <FilePdfOutlined /> {file.name}
              </span>
            ) : null}
          </div>
        </Form.Item>
        <Form.Item name="note" label="Note for PCP (optional)">
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>
        <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={sending}>
          Send to PCP
        </Button>
      </Form>
    </Modal>
  );
}

function AttachmentModal({ open, me, links, institutions, onClose, onDone }: { open: boolean; me: Me; links: Link[]; institutions: Inst[]; onClose: () => void; onDone: (r: { ok: boolean; message: string; level?: string }) => void }) {
  const active = links.filter((l) => l.status === "ACTIVE");
  const [action, setAction] = useState<"JOINED" | "LEFT">(active.length ? "LEFT" : "JOINED");
  const [inst, setInst] = useState<string | undefined>();
  const [programType, setProgramType] = useState<string | undefined>();
  const [designation, setDesignation] = useState<string>(me.designation);
  const [linkId, setLinkId] = useState<number | undefined>(active[0]?.id);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<string>("Transfer");
  const [reason, setReason] = useState("");
  const [busy, run] = useBusy();
  const programmes = institutions.find((i) => i.code === inst)?.programmes ?? [];
  const send = () =>
    run(async () => {
      const r = await declareAttachment(action === "JOINED" ? { action, institutionCode: inst, programType, designation, date, reason } : { action, linkId, date, reason, category });
      onDone(r);
    });
  return (
    <Modal open={open} title="Declare an institutional attachment" onCancel={onClose} footer={null} destroyOnHidden width={560}>
      <Segmented
        block
        value={action}
        onChange={(x) => setAction(x as "JOINED" | "LEFT")}
        options={[
          { value: "LEFT", label: "I left an institution", disabled: !active.length },
          { value: "JOINED", label: "I joined an institution" },
        ]}
        style={{ marginBottom: 14 }}
      />
      {action === "LEFT" ? (
        <div style={{ display: "grid", gap: 10 }}>
          <label className="muted" style={{ fontSize: 12.5 }}>
            Appointment
            <Select style={{ width: "100%", marginTop: 4 }} value={linkId} onChange={setLinkId} options={active.map((l) => ({ value: l.id, label: `${l.inst.name} · ${programLabel(l.programType)}` }))} aria-label="Appointment you left" />
          </label>
          <label className="muted" style={{ fontSize: 12.5 }}>
            Why
            <Select style={{ width: "100%", marginTop: 4 }} value={category} onChange={setCategory} options={["Transfer", "Resignation", "Retirement", "Contract ended"].map((c) => ({ value: c, label: c }))} aria-label="Why the appointment ended" />
          </label>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {active.length ? <Alert type="warning" showIcon title={`You are active at ${active[0].inst.name}. Declare that you left it first; a teacher is active at one institution at a time.`} /> : null}
          <label className="muted" style={{ fontSize: 12.5 }}>
            Institution
            <Select
              showSearch
              style={{ width: "100%", marginTop: 4 }}
              value={inst}
              placeholder="Search by name"
              optionFilterProp="label"
              onChange={(c) => {
                setInst(c);
                setProgramType(institutions.find((i) => i.code === c)?.programmes[0]);
              }}
              options={institutions.map((i) => ({ value: i.code, label: `${i.name}, ${i.city}` }))}
              aria-label="Institution you joined"
            />
          </label>
          <Row gutter={10}>
            <Col xs={24} sm={12}>
              <label className="muted" style={{ fontSize: 12.5 }}>
                Programme
                <Select style={{ width: "100%", marginTop: 4 }} value={programType} onChange={setProgramType} options={programmes.map((p) => ({ value: p, label: programLabel(p) }))} aria-label="Programme" />
              </label>
            </Col>
            <Col xs={24} sm={12}>
              <label className="muted" style={{ fontSize: 12.5 }}>
                Designation
                <Select style={{ width: "100%", marginTop: 4 }} value={designation} onChange={setDesignation} options={DESIGNATIONS.map((d) => ({ value: d, label: d }))} aria-label="Designation" />
              </label>
            </Col>
          </Row>
        </div>
      )}
      <label className="muted" style={{ fontSize: 12.5, display: "block", marginTop: 10 }}>
        {action === "JOINED" ? "Joined on" : "Left on"}
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ marginTop: 4, maxWidth: 220, display: "block" }} aria-label="Date" />
      </label>
      <label className="muted" style={{ fontSize: 12.5, display: "block", marginTop: 10 }}>
        What happened
        <Input.TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={action === "JOINED" ? "e.g. Appointed Lecturer by letter of 1 October" : "e.g. Resigned with one month's notice"} style={{ marginTop: 4 }} aria-label="What happened" />
      </label>
      <Alert style={{ marginTop: 12 }} type="info" showIcon icon={<BankOutlined />} title="The institution and PCP are told at once. It becomes a request in PCP's faculty registry; your links change only when PCP approves it." />
      <Button style={{ marginTop: 14 }} type="primary" icon={<SendOutlined />} loading={busy} onClick={send} disabled={reason.trim().length < 5 || (action === "JOINED" ? !inst || !programType : !linkId)}>
        Send the declaration
      </Button>
    </Modal>
  );
}

function VerifyModal({ open, onClose, onSend, busy }: { open: boolean; onClose: () => void; onSend: (note: string) => void; busy: boolean }) {
  const [note, setNote] = useState("");
  return (
    <Modal open={open} title="Request verification of my record" okText="Send to PCP" confirmLoading={busy} onCancel={onClose} onOk={() => onSend(note)} destroyOnHidden>
      <p style={{ marginTop: 0 }}>PCP&apos;s verification officer checks your qualification and appointment against the evidence on file and records the result here.</p>
      <Input.TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional), e.g. My HEC attestation was renewed in 2026" aria-label="Note for PCP" />
    </Modal>
  );
}
