"use client";
// One faculty record at PCP: the person, every institutional link (history kept), registry requests, the
// teacher's own requests and their portal login (RFP 4.1.2 Teachers/Faculty, 4.1.11 one person, one ID).
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Col, Empty, Modal, Row, Table, Typography } from "antd";
import { KeyOutlined } from "@ant-design/icons";
import { createFacultyLogin } from "@/app/actions/people";
import { CHANGE_KIND_LABELS } from "@/lib/registry-shared";
import { FACULTY_REQUEST_LABELS } from "@/lib/people-shared";
import { KV, PageTitle, fmtDate, programLabel } from "./common";
import type { FacultyRequestRow } from "./PeopleQueues";
import { ChangeLines, RegStatus, useBusy } from "./registry-ui";

type P = { id: number; pcpId: string; fullName: string; fatherName: string; cnic: string; qualification: string; specialization: string; designation: string; pcpRegNo: string | null; verificationStatus: string };

export default function FacultyRecordView({
  canAct,
  p,
  links,
  changes,
  account,
  requests,
}: {
  canAct: boolean;
  p: P;
  links: { id: number; inst: { code: string; name: string; shortCode: string }; programType: string; status: string; startDate: string; endDate: string | null }[];
  changes: { id: number; ref: string; kind: string; status: string; inst: string; requestedBy: string; declaredByTeacher: boolean; changes: Record<string, { from: string | null; to: string | null }>; createdAt: string; decisionNote: string | null }[];
  account: { username: string; createdBy: string; createdAt: string } | null;
  requests: FacultyRequestRow[];
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [busy, run] = useBusy();
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);
  const makeLogin = () =>
    run(async () => {
      const r = await createFacultyLogin(p.id);
      if (r.ok && r.username && r.password) setIssued({ username: r.username, password: r.password });
      else message[r.level === "warning" ? "warning" : "error"](r.message);
      router.refresh();
    });
  return (
    <>
      <PageTitle eyebrow={<Link href="/pcp/verification?tab=faculty-requests">Data verification</Link>} title={p.fullName} sub={<span><span className="mono">{p.pcpId}</span> · <RegStatus value={p.verificationStatus} /></span>} />
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card title="Faculty record" style={{ marginBottom: 16 }}>
            <KV
              rows={[
                ["Faculty ID", <span key="i" className="mono">{p.pcpId}</span>],
                ["Father's name", p.fatherName],
                ["CNIC", <span key="c" className="mono">{p.cnic}</span>],
                ["Highest qualification", `${p.qualification}, ${p.specialization}`],
                ["Designation", p.designation],
                ["Pharmacist registration", p.pcpRegNo ?? "Not recorded"],
              ]}
            />
          </Card>
          <Card title={`Institutional links (${links.length})`} styles={{ body: { padding: 0 } }} style={{ marginBottom: 16 }}>
            <Table
              rowKey="id"
              size="small"
              dataSource={links}
              pagination={false}
              scroll={{ x: true }}
              locale={{ emptyText: "No institutional link" }}
              columns={[
                { title: "Institution", render: (_, l) => <span>{l.inst.name}<div className="faint mono" style={{ fontSize: 12 }}>{l.inst.code}</div></span> },
                { title: "Programme", dataIndex: "programType", render: (v) => programLabel(v) },
                { title: "From", dataIndex: "startDate", render: (v) => fmtDate(v) },
                { title: "To", dataIndex: "endDate", render: (v, l) => (v ? fmtDate(v) : l.status === "ACTIVE" ? "Now" : "") },
                { title: "Status", dataIndex: "status", render: (v) => <RegStatus value={v} /> },
              ]}
            />
          </Card>
          <Card title={`Registry requests (${changes.length})`} styles={{ body: { padding: 0 } }}>
            <Table
              rowKey="id"
              size="small"
              dataSource={changes}
              pagination={changes.length > 8 ? { pageSize: 8, showSizeChanger: false } : false}
              scroll={{ x: true }}
              locale={{ emptyText: "No link or change requests" }}
              columns={[
                { title: "Request", render: (_, r) => <span><span className="mono">{r.ref}</span><div className="faint" style={{ fontSize: 12 }}>{CHANGE_KIND_LABELS[r.kind] ?? r.kind} · {r.inst}</div></span> },
                { title: "Change", render: (_, r) => <ChangeLines changes={r.changes} />, responsive: ["md"] },
                { title: "Raised by", render: (_, r) => <span style={{ fontSize: 12.5 }}>{r.requestedBy}{r.declaredByTeacher ? <div className="faint">the teacher&apos;s own declaration</div> : null}</span> },
                { title: "Status", render: (_, r) => <span><RegStatus value={r.status} />{r.decisionNote ? <div className="faint" style={{ fontSize: 12 }}>{r.decisionNote}</div> : null}</span> },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card title="Portal login" style={{ marginBottom: 16 }} data-testid="faculty-login-card">
            {account ? (
              <span>
                <KeyOutlined style={{ color: "var(--brand)" }} /> Signs in as <span className="mono">{account.username}</span> (created by {account.createdBy}, {fmtDate(account.createdAt)}). They keep their academic profile current, declare institutional attachments and request verification.
              </span>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <span className="muted">No faculty login yet. With one, the teacher sees this record, sends qualification updates with evidence, declares joining or leaving an institution, and requests verification.</span>
                {canAct ? (
                  <span>
                    <Button icon={<KeyOutlined />} loading={busy} disabled={p.verificationStatus === "REJECTED"} onClick={makeLogin}>
                      Create a faculty login
                    </Button>
                  </span>
                ) : null}
              </div>
            )}
          </Card>
          <Card title={`The teacher's own requests (${requests.length})`} styles={{ body: { padding: 0 } }}>
            {requests.length ? (
              <Table
                rowKey="id"
                size="small"
                dataSource={requests}
                pagination={false}
                columns={[
                  { title: "Request", render: (_, r) => <span><span className="mono">{r.ref}</span><div className="faint" style={{ fontSize: 12 }}>{FACULTY_REQUEST_LABELS[r.kind]}</div></span> },
                  { title: "Change", render: (_, r) => (r.kind === "PROFILE" ? <ChangeLines changes={r.details.changes ?? {}} /> : "Verification") },
                  { title: "Status", render: (_, r) => <RegStatus value={r.status} /> },
                ]}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="None" style={{ padding: 16 }} />
            )}
          </Card>
        </Col>
      </Row>
      <Modal open={!!issued} title={`Login for ${p.fullName}`} onCancel={() => setIssued(null)} footer={<Button type="primary" onClick={() => setIssued(null)}>I have handed it over</Button>}>
        <Alert type="warning" showIcon title="Copy the temporary password now. PCP does not keep it, so it cannot be shown again. The teacher sets their own password at first sign-in." style={{ marginBottom: 12 }} />
        <div data-testid="faculty-login-issued">
          <KV
            rows={[
              ["Username", <Typography.Text key="u" code copyable>{issued?.username}</Typography.Text>],
              ["Temporary password", <Typography.Text key="p" code copyable>{issued?.password}</Typography.Text>],
            ]}
          />
        </div>
      </Modal>
    </>
  );
}
