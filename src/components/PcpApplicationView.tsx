"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Col, DatePicker, Form, Input, InputNumber, Row, Select, Space, Table, Tag, Typography } from "antd";
import { AuditOutlined, CheckOutlined, CloseOutlined, PauseOutlined, SafetyCertificateOutlined, SendOutlined, StopOutlined, UserOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { forwardToCouncil, issueCertificate, raiseDeficiency, recordDecision, reviewDeficiency, scheduleInspection, startScrutiny } from "@/app/actions/pcp";
import type { ActionResult } from "@/app/actions/faculty";
import type { AppDetail } from "@/lib/appdetail";
import { formatPKR } from "@/lib/format";
import { AppHeader, CertificateCard, ChecksCard, DataDescriptions, DocumentsCard, TimelineCard } from "./AppParts";
import { Avatar, Pill, fmtDate } from "./common";
import CouncilAgendaNote from "./CouncilAgendaNote";
import { FillDemo } from "./demo-helpers";

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

export default function PcpApplicationView({ d, roles, username, inspectors }: { d: AppDetail; roles: string[]; username: string; inspectors: { username: string; name: string; province: string }[] }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [inspector, setInspector] = useState<string>();
  const [date, setDate] = useState<string>(dayjs().add(10, "day").format("YYYY-MM-DD"));
  const [defForm] = Form.useForm();
  const s = d.app.status;
  const has = (r: string) => roles.includes(r);

  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      message[r.ok ? "success" : "error"](r.message, r.ok ? 3 : 6);
      if (r.ok) setNote("");
      router.refresh();
    });

  const coi = inspector ? inspectors.find((i) => i.username === inspector)?.province === d.inst?.province : false;
  const myInspection = d.inspections.find((i) => i.inspector === username && i.status === "SCHEDULED");

  const panels: React.ReactNode[] = [];

  if (has("pcp_officer")) {
    if (s === "SUBMITTED")
      panels.push(
        <ActionBlock key="scrutiny" title="Start scrutiny" sub="Assigns the case to you; the institution sees your name.">
          <Button type="primary" block size="large" icon={<UserOutlined />} loading={pending} onClick={() => run(() => startScrutiny(d.app.ref))}>
            Start scrutiny (assign to me)
          </Button>
        </ActionBlock>,
      );
    if (["UNDER_SCRUTINY", "DEFERRED", "RESPONDED"].includes(s))
      panels.push(
        <ActionBlock
          key="def"
          title="Raise a formal deficiency"
          sub="Gets an ID, a deadline and the evidence required."
          extra={<FillDemo onClick={() => defForm.setFieldsValue({ criterion: "Laboratories", requiredAction: "Upload the lab safety certificate for the Pharmaceutics lab", evidenceRequired: "Safety certificate", dueDays: 30 })} />}
        >
          <Form form={defForm} layout="vertical" requiredMark={false} initialValues={{ dueDays: 30, criterion: "Faculty" }} onFinish={(v) => run(() => raiseDeficiency(d.app.ref, v))}>
            <Row gutter={10}>
              <Col span={14}>
                <Form.Item name="criterion" label="Criterion" rules={[{ required: true }]}>
                  <Select options={["Faculty", "Laboratories", "Library", "Infrastructure", "Documents", "Finance"].map((x) => ({ value: x }))} />
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
    if (s === "INSPECTION_SUBMITTED")
      panels.push(
        <ActionBlock key="fwd" title="Forward to council" sub="Your recommendation goes on the council agenda." extra={<FillDemo onClick={() => setNote("Recommend approval for an intake of 60. Inspection found all criteria compliant.")} />}>
          <Input.TextArea rows={3} placeholder="Recommendation for the council" value={note} onChange={(e) => setNote(e.target.value)} style={{ marginBottom: 10 }} />
          <Button type="primary" block icon={<SendOutlined />} loading={pending} onClick={() => run(() => forwardToCouncil(d.app.ref, note))}>
            Forward to council agenda
          </Button>
        </ActionBlock>,
      );
  }

  if (has("pcp_officer") && s === "UNDER_SCRUTINY")
    panels.push(
      <ActionBlock key="insp" title="Schedule inspection" sub="No inspector may inspect an institution in their own province.">
        <Space direction="vertical" style={{ width: "100%" }}>
          <Select
            className="pcp-inspector-select"
            placeholder="Inspection panel member"
            style={{ width: "100%" }}
            value={inspector}
            onChange={setInspector}
            options={inspectors.map((i) => ({
              value: i.username,
              label: (
                <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span>
                    {i.name} · {i.province}
                  </span>
                  {i.province === d.inst?.province ? <span style={{ color: "#b4141f", fontSize: 12 }}>conflict</span> : null}
                </span>
              ),
            }))}
          />
          {coi ? (
            <Alert type="error" showIcon icon={<StopOutlined />} message="Conflict of interest" description={`This member belongs to ${d.inst?.province}, the institution's own province. The system will refuse the booking.`} />
          ) : null}
          <DatePicker style={{ width: "100%" }} value={dayjs(date)} onChange={(v) => v && setDate(v.format("YYYY-MM-DD"))} />
          <Button type="primary" block loading={pending} disabled={!inspector} onClick={() => run(() => scheduleInspection(d.app.ref, inspector!, date))}>
            Schedule and notify
          </Button>
        </Space>
      </ActionBlock>,
    );

  if (has("pcp_inspector") && myInspection)
    panels.push(
      <ActionBlock key="fill" title="Your inspection" sub={`Scheduled for ${fmtDate(myInspection.scheduledFor)}`}>
        <Link href={`/pcp/inspections/${myInspection.id}`}>
          <Button type="primary" block size="large">
            Open my inspection checklist
          </Button>
        </Link>
      </ActionBlock>,
    );

  if (has("pcp_secretary")) {
    if (s === "COUNCIL_REVIEW")
      panels.push(
        <ActionBlock key="council" title="Record council decision" sub="The decision and its conditions are recorded against the case." extra={<FillDemo onClick={() => setNote("Approved; lab signage within 3 months.")} />}>
          <Input.TextArea rows={2} placeholder="Decision note / conditions" value={note} onChange={(e) => setNote(e.target.value)} style={{ marginBottom: 10 }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <Button type="primary" icon={<CheckOutlined />} loading={pending} onClick={() => run(() => recordDecision(d.app.ref, "APPROVED", note))}>
              Approved
            </Button>
            <Button icon={<PauseOutlined />} loading={pending} onClick={() => run(() => recordDecision(d.app.ref, "DEFERRED", note))}>
              Deferred
            </Button>
            <Button danger icon={<CloseOutlined />} loading={pending} onClick={() => run(() => recordDecision(d.app.ref, "REJECTED", note))}>
              Rejected
            </Button>
          </div>
        </ActionBlock>,
      );
    if (s === "APPROVED")
      panels.push(
        <ActionBlock key="issue" title="Issue the certificate" sub="Generates a signed PDF with a QR code and files it in the institution's folder.">
          <Button type="primary" block size="large" icon={<SafetyCertificateOutlined />} loading={pending} onClick={() => run(() => issueCertificate(d.app.ref))}>
            Issue NOC certificate (QR + signed PDF)
          </Button>
        </ActionBlock>,
      );
  }

  const inspection = d.inspections.find((i) => i.status === "SUBMITTED");

  return (
    <>
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
      <Row gutter={18}>
        <Col xs={24} lg={15}>
          {inspection ? (
            <Card
              size="small"
              style={{ marginBottom: 16 }}
              title={
                <span>
                  <AuditOutlined style={{ marginRight: 8, color: "#5b3cc4" }} />
                  Inspection report · {inspection.inspectorName} · {fmtDate(inspection.scheduledFor)}
                </span>
              }
            >
              <Table
                size="small"
                rowKey="criterion"
                pagination={false}
                dataSource={inspection.checklist}
                columns={[
                  { title: "Criterion", dataIndex: "criterion" },
                  { title: "Result", dataIndex: "result", render: (v) => <Pill value={v} /> },
                  { title: "Remarks", dataIndex: "remarks", render: (v) => v || <span className="faint">—</span> },
                ]}
              />
              <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--bg)", borderRadius: 10, fontSize: 13.5 }}>
                <b>Inspector&apos;s summary:</b> {inspection.summary}
              </div>
            </Card>
          ) : d.inspections[0] ? (
            <Card size="small" style={{ marginBottom: 16 }}>
              Inspection by <b>{d.inspections[0].inspectorName}</b> scheduled for {fmtDate(d.inspections[0].scheduledFor)}.
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
                      has("pcp_officer") && r.status === "RESPONDED" ? (
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
          <Card size="small" title="Application data" style={{ marginBottom: 16 }}>
            <DataDescriptions data={d.app.data} />
          </Card>
          <DocumentsCard d={d} uploadable={false} />
        </Col>
        <Col xs={24} lg={9}>
          <Card
            size="small"
            title="Your next step"
            style={{ marginBottom: 16, borderColor: panels.length ? "#95d5b2" : undefined, boxShadow: panels.length ? "0 0 0 3px #e8f3ee" : undefined }}
            styles={{ body: { background: panels.length ? "#fbfdfc" : undefined } }}
          >
            {panels.length ? (
              <Space direction="vertical" style={{ width: "100%" }} size={12}>
                {panels}
              </Space>
            ) : (
              <Typography.Text type="secondary">Nothing for your role at this stage. The banner above shows who holds the file.</Typography.Text>
            )}
          </Card>
          <CertificateCard d={d} />
          <Card size="small" title="Fee" style={{ marginBottom: 16 }} extra={d.app.feePaidAt ? <Pill value="APPROVED" label={`Paid ${fmtDate(d.app.feePaidAt)}`} /> : <Pill value="REJECTED" label="Unpaid" />}>
            <div className="tnum" style={{ fontSize: 20, fontWeight: 700 }}>{formatPKR(d.app.feeAmount)}</div>
            <div className="mono muted" style={{ marginTop: 2 }}>
              PSID {d.app.feePsid ?? "—"} · {d.app.feeMethod ?? ""}
            </div>
          </Card>
          <div style={{ marginBottom: 16 }}>
            <ChecksCard checks={d.app.checks} />
          </div>
          <TimelineCard d={d} />
        </Col>
      </Row>
    </>
  );
}
