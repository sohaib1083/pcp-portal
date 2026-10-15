"use client";
// Queues for requests people raise from their own logins (RFP 4.1.2): students' requests at the institution
// (examination officer) and at PCP (verification), and teachers' profile and verification requests at PCP.
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Empty, Input, Modal, Table, Tag } from "antd";
import { CheckOutlined, CloseOutlined, FilePdfOutlined, RightOutlined, SendOutlined, UndoOutlined } from "@ant-design/icons";
import { decideFacultyRequest, decideStudentRequest, forwardStudentRequest, returnStudentRequest } from "@/app/actions/people";
import type { FacultyRequestDetails, StudentRequestDetails } from "@/db/modules/people";
import { FACULTY_REQUEST_LABELS, STUDENT_DOCUMENT, STUDENT_FIELD_LABELS, STUDENT_REQUEST_LABELS, STUDENT_STATUS_LABELS } from "@/lib/people-shared";
import { Avatar, fmtDate, programLabel, timeAgo } from "./common";
import { useOtp } from "./OtpConfirm";
import { ChangeLines, RegStatus, useBusy } from "./registry-ui";

export type StudentRequestRow = {
  id: number;
  ref: string;
  kind: string;
  status: string;
  details: StudentRequestDetails;
  reason: string | null;
  createdAt: string;
  student: { pcpId: string; fullName: string; fatherName: string; status: string; degreeVerified: boolean; programType: string; shift: string; enrollmentYear: number; currentYear: number; resultYear: number | null };
  inst: { shortCode: string; name: string };
  evidenceDocumentId: number | null;
  institutionBy: string | null;
  institutionAt: string | null;
  institutionNote: string | null;
  pcpBy: string | null;
  pcpAt: string | null;
  pcpNote: string | null;
  certificateNo: string | null;
  certificateDocumentId: number | null;
};

const TONE: Record<string, string> = { WITH_INSTITUTION: "PENDING", WITH_PCP: "SUBMITTED", ISSUED: "APPROVED", APPLIED: "APPROVED", RETURNED: "RETURNED", REJECTED: "REJECTED", WITHDRAWN: "WITHDRAWN" };
const STUDENT_STATUS: Record<string, string> = { ENROLLED: "Enrolled", PROMOTED: "Promoted", REPEAT: "Repeating", GRADUATED: "Graduated", WITHDRAWN: "Withdrawn" };

function StudentLine({ r }: { r: StudentRequestRow }) {
  const s = r.student;
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <Avatar name={s.fullName} size={36} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 650 }}>
          {s.fullName} <span className="mono faint" style={{ fontSize: 12.5, fontWeight: 400 }}>{s.pcpId}</span>
        </div>
        <div className="muted" style={{ fontSize: 12.5 }}>
          Father: {s.fatherName} · {programLabel(s.programType)}, {s.shift} · enrolled {s.enrollmentYear} · <RegStatus value={s.status} label={STUDENT_STATUS[s.status]} />
          {s.status === "GRADUATED" ? <> · degree {s.degreeVerified ? "verified" : "not checked yet"}</> : null}
        </div>
      </div>
    </div>
  );
}

function RequestBody({ r, evidenceHref }: { r: StudentRequestRow; evidenceHref: (id: number) => string }) {
  return (
    <div style={{ marginTop: 12, padding: 12, background: "var(--bg)", borderRadius: 10, display: "grid", gap: 6 }}>
      {r.kind === "ELIGIBILITY" ? (
        <div style={{ fontSize: 13 }}>
          {r.student.status === "GRADUATED" ? `Graduated ${r.student.resultYear ?? ""}. ` : "Not graduated on the record. "}
          {r.student.degreeVerified ? "Degree verified with the university and HEC." : "The degree is checked with the university and HEC (simulated) when the institution forwards the request."}
        </div>
      ) : null}
      {r.kind === "ENROLMENT_LETTER" ? <div style={{ fontSize: 13 }}>Year {r.student.currentYear} of study, {r.student.shift} session.</div> : null}
      {r.details.changes ? <ChangeLines changes={Object.fromEntries(Object.entries(r.details.changes).map(([k, c]) => [STUDENT_FIELD_LABELS[k] ?? k, c]))} /> : null}
      {r.details.purpose ? <div style={{ fontSize: 13 }}>For: {r.details.purpose}</div> : null}
      {r.reason ? <div style={{ fontSize: 13 }}>Student says: {r.reason}</div> : null}
      {r.details.degreeRef ? <div style={{ fontSize: 13 }}>Degree confirmed with the university and HEC (simulated), ref <span className="mono">{r.details.degreeRef}</span></div> : null}
      {r.institutionNote ? <div style={{ fontSize: 13 }}>{r.inst.shortCode} note: {r.institutionNote}</div> : null}
      {r.evidenceDocumentId ? (
        <a href={evidenceHref(r.evidenceDocumentId)} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
          <FilePdfOutlined /> Evidence the student attached
        </a>
      ) : null}
    </div>
  );
}

function DecidedTable({ rows, who }: { rows: StudentRequestRow[]; who: "institution" | "pcp" }) {
  return (
    <Card title="Decided" styles={{ body: { padding: 0 } }}>
      <Table
        rowKey="id"
        size="small"
        dataSource={rows}
        pagination={rows.length > 8 ? { pageSize: 8, showSizeChanger: false } : false}
        scroll={{ x: true }}
        locale={{ emptyText: "No decisions yet" }}
        columns={[
          { title: "Request", render: (_, r) => <span><span className="mono">{r.ref}</span><div className="faint" style={{ fontSize: 12 }}>{STUDENT_REQUEST_LABELS[r.kind]}</div></span> },
          { title: "Student", render: (_, r) => <span>{r.student.fullName}<div className="faint mono" style={{ fontSize: 12 }}>{r.student.pcpId}</div></span> },
          ...(who === "pcp" ? [{ title: "Institution", render: (_: unknown, r: StudentRequestRow) => r.inst.shortCode, responsive: ["md" as const] }] : []),
          {
            title: "Outcome",
            render: (_, r) => (
              <span>
                <RegStatus value={TONE[r.status] ?? r.status} label={STUDENT_STATUS_LABELS[r.status]} />
                {r.certificateNo ? (
                  <div style={{ fontSize: 12 }}>
                    <a href={`/verify/student/${r.certificateNo}`} target="_blank" rel="noreferrer" className="mono">{r.certificateNo}</a>
                  </div>
                ) : null}
                {r.pcpNote || r.institutionNote ? <div className="faint" style={{ fontSize: 12 }}>{r.pcpNote ?? r.institutionNote}</div> : null}
              </span>
            ),
          },
          { title: "When", render: (_, r) => <span className="faint" style={{ fontSize: 12 }}>{fmtDate(r.pcpAt ?? r.institutionAt ?? r.createdAt)}</span>, responsive: ["md"] },
        ]}
      />
    </Card>
  );
}

/** The examination officer's queue on the institution's Students page. */
export function InstitutionStudentRequests({ rows, canAct }: { rows: StudentRequestRow[]; canAct: boolean }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [busy, run] = useBusy();
  const [show, setShow] = useState(false);
  const [acting, setActing] = useState<{ r: StudentRequestRow; forward: boolean } | null>(null);
  const [note, setNote] = useState("");
  const waiting = rows.filter((r) => r.status === "WITH_INSTITUTION");
  const rest = rows.filter((r) => r.status !== "WITH_INSTITUTION");
  if (!rows.length) return null;
  const confirm = () =>
    acting &&
    run(async () => {
      const res = acting.forward ? await forwardStudentRequest(acting.r.id, note) : await returnStudentRequest(acting.r.id, note);
      message[res.ok ? "success" : res.level === "warning" ? "warning" : "error"](res.message, 7);
      if (res.ok) {
        setActing(null);
        router.refresh();
      }
    });
  return (
    <div id="requests" data-testid="institution-student-requests" style={{ marginBottom: 18 }}>
      <Card
        title={
          <span>
            Student requests {waiting.length ? <Tag color="gold" style={{ marginInlineStart: 6 }}>{waiting.length} waiting</Tag> : null}
          </span>
        }
        extra={rest.length ? <Button type="link" onClick={() => setShow((x) => !x)}>{show ? "Hide decided" : `Decided (${rest.length})`}</Button> : null}
        styles={{ body: { padding: waiting.length ? 0 : undefined } }}
      >
        {waiting.length ? (
          waiting.map((r) => (
            <div key={r.id} data-testid={`inst-srq-${r.ref}`} style={{ padding: "14px 18px", borderBottom: "1px solid var(--line-2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div className="pcp-eyebrow">
                  <span className="mono">{r.ref}</span> · {STUDENT_REQUEST_LABELS[r.kind]} · sent {timeAgo(r.createdAt)}
                </div>
              </div>
              <StudentLine r={r} />
              <RequestBody r={r} evidenceHref={(id) => `/api/documents/${id}`} />
              {canAct ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                  <Button type="primary" icon={<SendOutlined />} disabled={busy} onClick={() => { setNote(""); setActing({ r, forward: true }); }}>
                    {r.kind === "ELIGIBILITY" && !r.student.degreeVerified ? "Confirm degree and forward to PCP" : "Forward to PCP"}
                  </Button>
                  <Button icon={<UndoOutlined />} disabled={busy} onClick={() => { setNote(""); setActing({ r, forward: false }); }}>
                    Return to the student
                  </Button>
                </div>
              ) : (
                <div className="faint" style={{ fontSize: 12.5, marginTop: 8 }}>The examination officer or the head of institution forwards it.</div>
              )}
            </div>
          ))
        ) : (
          <span className="muted">No student request waiting for you.</span>
        )}
      </Card>
      {show ? <div style={{ marginTop: 12 }}><DecidedTable rows={rest} who="institution" /></div> : null}
      <Modal
        open={!!acting}
        title={acting ? `${acting.forward ? "Forward" : "Return"} ${acting.r.ref}` : ""}
        okText={acting?.forward ? "Forward to PCP" : "Return"}
        confirmLoading={busy}
        okButtonProps={{ disabled: !acting?.forward && note.trim().length < 10, danger: !acting?.forward }}
        onCancel={() => setActing(null)}
        onOk={confirm}
        destroyOnHidden
      >
        <p style={{ marginTop: 0 }}>
          {acting?.forward
            ? acting.r.kind === "ELIGIBILITY" && !acting.r.student.degreeVerified
              ? "You confirm the student graduated on your records. The degree is checked with the university and HEC (simulated) and the request goes to PCP's verification officer."
              : "You confirm the request matches your records. It goes to PCP's verification officer."
            : "The request goes back to the student with your note. Nothing reaches PCP."}
        </p>
        <Input.TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={acting?.forward ? "Note for PCP (optional), e.g. Checked against the admission file" : "Reason (required), e.g. The CNIC copy is unreadable; upload a clear scan"} aria-label="Note" />
      </Modal>
    </div>
  );
}

/** PCP verification: students' requests the institution forwarded. */
export function PcpStudentRequests({ rows, canAct }: { rows: StudentRequestRow[]; canAct: boolean }) {
  const { message } = App.useApp();
  const router = useRouter();
  const { withOtp, otpModal } = useOtp();
  const [deciding, setDeciding] = useState<{ r: StudentRequestRow; approve: boolean } | null>(null);
  const [note, setNote] = useState("");
  const waiting = rows.filter((r) => r.status === "WITH_PCP");
  const withInstitutions = rows.filter((r) => r.status === "WITH_INSTITUTION");
  const decided = rows.filter((r) => !["WITH_PCP", "WITH_INSTITUTION"].includes(r.status));
  const approveLabel = (r: StudentRequestRow) => (r.kind === "CORRECTION" ? "Approve and correct" : `Issue the ${STUDENT_DOCUMENT[r.kind].toLowerCase()}`);
  const confirm = () => {
    if (!deciding) return;
    const { r, approve } = deciding;
    if (!approve && note.trim().length < 5) return message.error("Give the reason, so the student and the institution know what to do.");
    setDeciding(null);
    withOtp(`decision:${r.ref}`, `${approve ? approveLabel(r) : "Reject"} ${r.ref}`, async (code) => {
      const res = await decideStudentRequest(r.id, approve, note, code);
      message[res.ok ? "success" : res.level === "warning" ? "warning" : "error"](res.message, 8);
      router.refresh();
    });
  };
  return (
    <>
      {otpModal}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14 }}
        title="Requests students raised from their own login. Their examination office checked and forwarded them. A correction is applied to the student record; a letter or certificate is issued as a PDF with a QR code that opens a public check without the CNIC."
      />
      {waiting.length ? (
        waiting.map((r) => (
          <Card
            key={r.id}
            data-testid={`pcp-srq-${r.ref}`}
            style={{ marginBottom: 14 }}
            title={
              <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span className="mono" style={{ fontSize: 13 }}>{r.ref}</span>
                <span>{STUDENT_REQUEST_LABELS[r.kind]}</span>
              </span>
            }
            extra={<span className="muted" style={{ fontSize: 12.5 }}>{r.inst.shortCode} · forwarded by {r.institutionBy} · {timeAgo(r.institutionAt)}</span>}
          >
            <StudentLine r={r} />
            <RequestBody r={r} evidenceHref={(id) => `/api/documents/${id}`} />
            {canAct ? (
              <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                <Button type="primary" icon={<CheckOutlined />} onClick={() => { setNote(""); setDeciding({ r, approve: true }); }}>
                  {approveLabel(r)}
                </Button>
                <Button danger icon={<CloseOutlined />} onClick={() => { setNote(""); setDeciding({ r, approve: false }); }}>
                  Reject
                </Button>
              </div>
            ) : null}
          </Card>
        ))
      ) : (
        <Card style={{ marginBottom: 14 }}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No student request waiting for PCP" />
        </Card>
      )}
      {withInstitutions.length ? (
        <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
          {withInstitutions.length} more {withInstitutions.length === 1 ? "request is" : "requests are"} still with the institutions: {withInstitutions.map((r) => `${r.ref} (${r.inst.shortCode})`).join(", ")}.
        </div>
      ) : null}
      <DecidedTable rows={decided} who="pcp" />
      <Modal
        open={!!deciding}
        title={deciding ? `${deciding.approve ? approveLabel(deciding.r) : "Reject"} ${deciding.r.ref}` : ""}
        okText="Continue"
        okButtonProps={{ danger: deciding ? !deciding.approve : false }}
        onCancel={() => setDeciding(null)}
        onOk={confirm}
        destroyOnHidden
      >
        <p style={{ marginTop: 0 }}>
          {deciding?.approve
            ? deciding.r.kind === "CORRECTION"
              ? "The student record is corrected now. The original values stay in the request and the audit log."
              : "PCP issues the PDF now, filed under the institution's student documents. The student can download and print it."
            : "Nothing changes. The student and the institution see your reason."}
        </p>
        <Input.TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={deciding?.approve ? "Note (optional)" : "Reason (required)"} aria-label="Decision note" />
      </Modal>
    </>
  );
}

export type FacultyRequestRow = {
  id: number;
  ref: string;
  kind: string;
  status: string;
  details: FacultyRequestDetails;
  note: string | null;
  createdAt: string;
  requestedBy: string;
  person: { pcpId: string; fullName: string; fatherName: string; qualification: string; specialization: string; designation: string; pcpRegNo: string | null; verificationStatus: string; currentInst: string | null };
  evidence: { id: number; fileName: string } | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
};

/** PCP verification: teachers' own qualification updates and verification requests. */
export function PcpFacultyRequests({ rows, canAct }: { rows: FacultyRequestRow[]; canAct: boolean }) {
  const { message } = App.useApp();
  const router = useRouter();
  const { withOtp, otpModal } = useOtp();
  const [deciding, setDeciding] = useState<{ r: FacultyRequestRow; approve: boolean } | null>(null);
  const [note, setNote] = useState("");
  const waiting = rows.filter((r) => r.status === "PENDING");
  const decided = rows.filter((r) => r.status === "APPROVED" || r.status === "REJECTED");
  const confirm = () => {
    if (!deciding) return;
    const { r, approve } = deciding;
    if (!approve && note.trim().length < 5) return message.error("Give the reason, so the teacher knows what to send instead.");
    setDeciding(null);
    withOtp(`decision:${r.ref}`, `${approve ? "Approve" : "Reject"} ${r.ref}`, async (code) => {
      const res = await decideFacultyRequest(r.id, approve, note, code);
      message[res.ok ? "success" : res.level === "warning" ? "warning" : "error"](res.message, 7);
      router.refresh();
    });
  };
  return (
    <>
      {otpModal}
      <Input.Search
        placeholder="Open a faculty record by Faculty ID, e.g. PCP-FAC-000094"
        enterButton="Open"
        onSearch={(v) => v.trim() && router.push(`/pcp/faculty/${encodeURIComponent(v.trim())}`)}
        style={{ maxWidth: 480, marginBottom: 12 }}
        aria-label="Open a faculty record"
      />
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14 }}
        title="Requests teachers sent from their own faculty login. A qualification update changes the faculty record only when you approve it; the request and its evidence stay on the record. Attachment declarations arrive as link and change requests on the other tabs."
      />
      {waiting.length ? (
        waiting.map((r) => (
          <Card
            key={r.id}
            data-testid={`fur-${r.ref}`}
            style={{ marginBottom: 14 }}
            title={
              <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span className="mono" style={{ fontSize: 13 }}>{r.ref}</span>
                <span>{FACULTY_REQUEST_LABELS[r.kind]}</span>
              </span>
            }
            extra={<span className="muted" style={{ fontSize: 12.5 }}>{r.requestedBy} · {timeAgo(r.createdAt)}</span>}
          >
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <Avatar name={r.person.fullName} size={36} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 650 }}>
                  <Link href={`/pcp/faculty/${r.person.pcpId}`} style={{ color: "var(--ink)" }}>{r.person.fullName}</Link> <span className="mono faint" style={{ fontSize: 12.5, fontWeight: 400 }}>{r.person.pcpId}</span> <RegStatus value={r.person.verificationStatus} />
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {r.person.qualification} {r.person.specialization} · {r.person.designation}
                  {r.person.currentInst ? ` · ${r.person.currentInst}` : " · no current appointment"}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12, padding: 12, background: "var(--bg)", borderRadius: 10, display: "grid", gap: 6 }}>
              {r.kind === "PROFILE" ? (
                <>
                  <ChangeLines changes={r.details.changes ?? {}} />
                  <div style={{ fontSize: 13 }}>
                    Awarded by {r.details.awardingBody}, {r.details.awardYear}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 13 }}>The teacher asks PCP to verify their record.</div>
              )}
              {r.note ? <div style={{ fontSize: 13 }}>Teacher&apos;s note: {r.note}</div> : null}
              {r.evidence ? (
                <a href={`/api/documents/${r.evidence.id}`} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                  <FilePdfOutlined /> {r.evidence.fileName}
                </a>
              ) : null}
            </div>
            {canAct ? (
              <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                <Button type="primary" icon={<CheckOutlined />} onClick={() => { setNote(""); setDeciding({ r, approve: true }); }}>
                  {r.kind === "PROFILE" ? "Approve and apply" : "Verify the record"}
                </Button>
                <Button danger icon={<CloseOutlined />} onClick={() => { setNote(""); setDeciding({ r, approve: false }); }}>
                  Reject, keep the record
                </Button>
                <Link href={`/pcp/faculty/${r.person.pcpId}`}>
                  <Button type="link" icon={<RightOutlined />}>Open the faculty record</Button>
                </Link>
              </div>
            ) : null}
          </Card>
        ))
      ) : (
        <Card style={{ marginBottom: 14 }}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No teacher's request waiting" />
        </Card>
      )}
      <Card title="Decided" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          size="small"
          dataSource={decided}
          pagination={decided.length > 8 ? { pageSize: 8, showSizeChanger: false } : false}
          scroll={{ x: true }}
          locale={{ emptyText: "No decisions yet" }}
          columns={[
            { title: "Request", render: (_, r) => <span><span className="mono">{r.ref}</span><div className="faint" style={{ fontSize: 12 }}>{FACULTY_REQUEST_LABELS[r.kind]}</div></span> },
            { title: "Teacher", render: (_, r) => <Link href={`/pcp/faculty/${r.person.pcpId}`}>{r.person.fullName}</Link> },
            { title: "Change", render: (_, r) => (r.kind === "PROFILE" ? <ChangeLines changes={r.details.changes ?? {}} /> : "Verification"), responsive: ["md"] },
            { title: "Decision", render: (_, r) => <span><RegStatus value={r.status} />{r.decisionNote ? <div className="faint" style={{ fontSize: 12 }}>{r.decisionNote}</div> : null}</span> },
            { title: "By", render: (_, r) => <span style={{ fontSize: 12.5 }}>{r.decidedBy}<div className="faint">{fmtDate(r.decidedAt)}</div></span>, responsive: ["md"] },
          ]}
        />
      </Card>
      <Modal
        open={!!deciding}
        title={deciding ? `${deciding.approve ? "Approve" : "Reject"} ${deciding.r.ref}` : ""}
        okText="Continue"
        okButtonProps={{ danger: deciding ? !deciding.approve : false }}
        onCancel={() => setDeciding(null)}
        onOk={confirm}
        destroyOnHidden
      >
        <p style={{ marginTop: 0 }}>
          {deciding?.approve
            ? deciding.r.kind === "PROFILE"
              ? "The faculty record is updated now. The previous values stay in the request; the teacher and the institution are notified."
              : "The faculty record becomes Verified. The teacher is notified."
            : "Nothing changes on the record. The teacher sees your reason."}
        </p>
        <Input.TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={deciding?.approve ? "Note (optional), e.g. Degree checked with HEC" : "Reason (required), e.g. The degree copy is not attested"} aria-label="Decision note" />
      </Modal>
    </>
  );
}
