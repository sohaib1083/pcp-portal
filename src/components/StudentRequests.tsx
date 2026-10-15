"use client";
// A student's own requests (RFP 4.1.2: registration requests, tracking of application lifecycles, certificate
// print portals): raise one, follow it through the institution and PCP, and print what PCP issues.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Col, Empty, Input, Modal, Row, Select, Steps, Upload } from "antd";
import { DownloadOutlined, EditOutlined, FilePdfOutlined, FileProtectOutlined, PaperClipOutlined, PrinterOutlined, SafetyCertificateOutlined, SendOutlined } from "@ant-design/icons";
import { withdrawStudentRequest } from "@/app/actions/people";
import type { StudentRequestDetails } from "@/db/modules/people";
import { STUDENT_DOCUMENT, STUDENT_FIELD_LABELS, STUDENT_REQUEST_HELP, STUDENT_REQUEST_LABELS, STUDENT_REQUEST_SHORT, STUDENT_STATUS_LABELS, studentStage } from "@/lib/people-shared";
import { SHIFTS } from "@/lib/registry-shared";
import { fmtDate, timeAgo } from "./common";
import { FillDemo, SamplePdfButton } from "./demo-helpers";
import { ChangeLines, RegStatus, useBusy } from "./registry-ui";

type Req = {
  id: number;
  ref: string;
  kind: string;
  status: string;
  details: StudentRequestDetails;
  reason: string | null;
  createdAt: string;
  institutionBy: string | null;
  institutionAt: string | null;
  institutionNote: string | null;
  pcpAt: string | null;
  pcpNote: string | null;
  certificateNo: string | null;
  certificateDocumentId: number | null;
  evidenceDocumentId: number | null;
  checkUrl: string | null;
  qr: string | null;
};
type Student = { fullName: string; fatherName: string; shift: string; status: string; degreeVerified: boolean; institution: string };

const ICONS: Record<string, React.ReactNode> = { CORRECTION: <EditOutlined />, ENROLMENT_LETTER: <FileProtectOutlined />, ELIGIBILITY: <SafetyCertificateOutlined /> };
const OPEN = ["WITH_INSTITUTION", "WITH_PCP"];
const TONE: Record<string, string> = { WITH_INSTITUTION: "PENDING", WITH_PCP: "SUBMITTED", ISSUED: "APPROVED", APPLIED: "APPROVED", RETURNED: "RETURNED", REJECTED: "REJECTED", WITHDRAWN: "WITHDRAWN" };

function Tracker({ r, inst }: { r: Req; inst: string }) {
  const stage = studentStage(r.status);
  const failed = r.status === "RETURNED" || r.status === "REJECTED";
  const last = r.kind === "CORRECTION" ? "Record corrected" : `${STUDENT_DOCUMENT[r.kind]} issued`;
  return (
    <Steps
      size="small"
      current={stage}
      status={failed ? "error" : stage === 3 ? "finish" : "process"}
      responsive
      items={[
        { title: "Sent", content: fmtDate(r.createdAt) },
        { title: `${inst} examination office`, content: r.institutionAt ? (r.status === "RETURNED" ? "Returned" : `Checked ${fmtDate(r.institutionAt)}`) : "Checking" },
        { title: "PCP verification", content: r.pcpAt ? (r.status === "REJECTED" ? "Not approved" : `Decided ${fmtDate(r.pcpAt)}`) : stage >= 2 ? "Checking" : "Next" },
        { title: r.status === "REJECTED" ? "Not approved" : r.status === "WITHDRAWN" ? "Withdrawn" : last, content: r.status === "ISSUED" ? r.certificateNo : undefined },
      ]}
    />
  );
}

export default function StudentRequests({ student, requests }: { student: Student; requests: Req[] }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [busy, run] = useBusy();
  const [kind, setKind] = useState<string | null>(null);
  const openOf = (k: string) => requests.find((r) => r.kind === k && OPEN.includes(r.status));
  const issuedEligibility = requests.find((r) => r.kind === "ELIGIBILITY" && r.status === "ISSUED");
  const blockedReason = (k: string) => {
    const o = openOf(k);
    if (o) return `${o.ref} is open: follow it below.`;
    if (k === "ELIGIBILITY" && issuedEligibility) return `Issued as ${issuedEligibility.certificateNo}.`;
    if (k === "ELIGIBILITY" && student.status !== "GRADUATED") return "Opens after you graduate.";
    if (k === "ENROLMENT_LETTER" && student.status === "WITHDRAWN") return "Your record shows you withdrew.";
    return null;
  };

  return (
    <>
      <Card title="Requests and certificates" style={{ marginTop: 18 }} data-testid="student-requests">
        <p className="muted" style={{ marginTop: 0 }}>
          Ask for a correction or a document. Your institution&apos;s examination office checks it first, then PCP. You can follow every step here and print what PCP issues.
        </p>
        <Row gutter={[12, 12]}>
          {(["CORRECTION", "ENROLMENT_LETTER", "ELIGIBILITY"] as const).map((k) => {
            const why = blockedReason(k);
            return (
              <Col key={k} xs={24} md={8}>
                <Button block size="large" icon={ICONS[k]} disabled={!!why} onClick={() => setKind(k)} style={{ height: "auto", minHeight: 44, whiteSpace: "normal", textAlign: "left" }}>
                  {k === "ELIGIBILITY" ? "Eligibility certificate" : STUDENT_REQUEST_LABELS[k]}
                </Button>
                <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>{why ?? STUDENT_REQUEST_HELP[k]}</div>
              </Col>
            );
          })}
        </Row>
      </Card>

      <div style={{ marginTop: 18 }} data-testid="student-request-list">
        {requests.length ? (
          requests.map((r) => (
            <Card
              key={r.id}
              data-testid={`srq-${r.ref}`}
              style={{ marginBottom: 14 }}
              title={
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {ICONS[r.kind]} <span title={STUDENT_REQUEST_LABELS[r.kind]}>{STUDENT_REQUEST_SHORT[r.kind]}</span> <span className="mono faint" style={{ fontSize: 12.5, fontWeight: 400 }}>{r.ref}</span>
                </span>
              }
              extra={<RegStatus value={TONE[r.status] ?? r.status} label={STUDENT_STATUS_LABELS[r.status]} />}
            >
              <Tracker r={r} inst={student.institution} />
              {r.details.changes ? (
                <div style={{ marginTop: 12, padding: 10, background: "var(--bg)", borderRadius: 10 }}>
                  <ChangeLines changes={Object.fromEntries(Object.entries(r.details.changes).map(([k, c]) => [STUDENT_FIELD_LABELS[k] ?? k, c]))} />
                </div>
              ) : null}
              {r.details.purpose ? <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>For: {r.details.purpose}</div> : null}
              {r.institutionNote ? <Alert style={{ marginTop: 12 }} type={r.status === "RETURNED" ? "warning" : "info"} showIcon title={`${student.institution}: ${r.institutionNote}`} /> : null}
              {r.pcpNote ? <Alert style={{ marginTop: 12 }} type={r.status === "REJECTED" ? "error" : "success"} showIcon title={`PCP: ${r.pcpNote}`} /> : null}
              {r.status === "ISSUED" && r.certificateDocumentId ? (
                <div data-testid="certificate-issued" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginTop: 14, padding: 14, border: "1px solid #c9ecd8", background: "#f3fbf6", borderRadius: 12 }}>
                  {r.qr ? <img src={r.qr} alt={`QR code that opens the public check of ${r.certificateNo}`} width={96} height={96} style={{ borderRadius: 8, background: "#fff" }} /> : null}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 650 }}>
                      {STUDENT_DOCUMENT[r.kind]} <span className="mono">{r.certificateNo}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      Anyone can check it at <span style={{ wordBreak: "break-all" }}>{r.checkUrl}</span>. The check never shows your CNIC.
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                      <Button type="primary" icon={<DownloadOutlined />} href={`/api/people/documents/${r.certificateDocumentId}?download=1`}>
                        Download PDF
                      </Button>
                      <Button icon={<PrinterOutlined />} href={`/api/people/documents/${r.certificateDocumentId}`} target="_blank">
                        Print
                      </Button>
                      <Button type="link" href={`/verify/student/${r.certificateNo}`} target="_blank">
                        Open the public check
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="faint" style={{ fontSize: 12, marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span>Sent {timeAgo(r.createdAt)}</span>
                {r.evidenceDocumentId ? (
                  <a href={`/api/people/documents/${r.evidenceDocumentId}`} target="_blank" rel="noreferrer">
                    <FilePdfOutlined /> Your evidence
                  </a>
                ) : null}
                {r.status === "WITH_INSTITUTION" ? (
                  <Button size="small" type="link" style={{ paddingInline: 0 }} disabled={busy} onClick={() => run(async () => {
                    const res = await withdrawStudentRequest(r.id);
                    message[res.ok ? "success" : "error"](res.message);
                    router.refresh();
                  })}>
                    Withdraw
                  </Button>
                ) : null}
              </div>
            </Card>
          ))
        ) : (
          <Card>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="You have not raised a request yet" />
          </Card>
        )}
      </div>
      <RequestModal kind={kind} student={student} onClose={() => setKind(null)} onDone={(ok, msg) => {
        message[ok ? "success" : "error"](msg, 7);
        if (ok) {
          setKind(null);
          router.refresh();
        }
      }} />
    </>
  );
}

function RequestModal({ kind, student, onClose, onDone }: { kind: string | null; student: Student; onClose: () => void; onDone: (ok: boolean, message: string) => void }) {
  const [fullName, setFullName] = useState(student.fullName);
  const [fatherName, setFatherName] = useState(student.fatherName);
  const [shift, setShift] = useState(student.shift);
  const [reason, setReason] = useState("");
  const [purpose, setPurpose] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const send = async () => {
    if (!kind) return;
    setSending(true);
    try {
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("reason", reason);
      if (kind === "CORRECTION") {
        fd.set("fullName", fullName);
        fd.set("fatherName", fatherName);
        fd.set("shift", shift);
        if (file) fd.set("evidence", file);
      }
      if (kind === "ENROLMENT_LETTER") fd.set("purpose", purpose);
      const res = await fetch("/api/student/requests", { method: "POST", body: fd });
      const r = (await res.json().catch(() => ({ ok: false, message: "The server did not answer. Try again." }))) as { ok: boolean; message: string };
      onDone(r.ok, r.message);
      if (r.ok) {
        setReason("");
        setPurpose("");
        setFile(null);
      }
    } finally {
      setSending(false);
    }
  };
  return (
    <Modal open={!!kind} title={kind ? STUDENT_REQUEST_LABELS[kind] : ""} onCancel={onClose} footer={null} destroyOnHidden width={540}>
      {kind ? <p className="muted" style={{ marginTop: 0 }}>{STUDENT_REQUEST_HELP[kind]}</p> : null}
      {kind === "CORRECTION" ? (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <FillDemo onClick={() => { setFatherName(student.fatherName.replace(/Ahmed$/, "Ahmad")); setReason("My father's name is spelt Ahmad on my CNIC, not Ahmed."); }} />
          </div>
          <label className="muted" style={{ fontSize: 12.5 }}>
            Full name
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} style={{ marginTop: 4 }} aria-label="Full name" />
          </label>
          <label className="muted" style={{ fontSize: 12.5 }}>
            Father&apos;s name
            <Input value={fatherName} onChange={(e) => setFatherName(e.target.value)} style={{ marginTop: 4 }} aria-label="Father's name" />
          </label>
          <label className="muted" style={{ fontSize: 12.5 }}>
            Session
            <Select value={shift} onChange={setShift} options={SHIFTS.map((x) => ({ value: x, label: x }))} style={{ width: "100%", marginTop: 4 }} aria-label="Session" />
          </label>
          <label className="muted" style={{ fontSize: 12.5 }}>
            What is wrong
            <Input.TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} style={{ marginTop: 4 }} placeholder="e.g. My father's name is spelt Ahmad on my CNIC" aria-label="What is wrong" />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Upload accept=".pdf,.jpg,.jpeg,.png" maxCount={1} showUploadList={false} beforeUpload={(f) => (setFile(f), false)}>
              <Button icon={<PaperClipOutlined />}>Attach evidence</Button>
            </Upload>
            <SamplePdfButton docLabel="CNIC copy" onFile={(f) => setFile(f)} />
            {file ? <span style={{ fontSize: 13 }}><FilePdfOutlined /> {file.name}</span> : <span className="faint" style={{ fontSize: 12.5 }}>CNIC or B-Form, or the admission letter</span>}
          </div>
        </div>
      ) : kind === "ENROLMENT_LETTER" ? (
        <label className="muted" style={{ fontSize: 12.5, display: "block" }}>
          What is the letter for?
          <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} style={{ marginTop: 4 }} placeholder="e.g. Scholarship application" maxLength={120} aria-label="What the letter is for" />
        </label>
      ) : kind === "ELIGIBILITY" ? (
        <Alert
          type="info"
          showIcon
          title={student.degreeVerified ? "Your degree is already verified." : "Your institution confirms your degree with the university and HEC when it forwards the request."}
          description="PCP then issues the certificate as a PDF with a QR code. Your provincial pharmacy council can check it online; the check shows your name, student ID, institution, programme and status, never your CNIC."
        />
      ) : null}
      <Button style={{ marginTop: 16 }} type="primary" icon={<SendOutlined />} loading={sending} onClick={send}>
        Send the request
      </Button>
    </Modal>
  );
}
