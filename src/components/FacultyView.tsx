"use client";
import { useState, useTransition } from "react";
import { Alert, App, Button, Card, Col, Drawer, Form, Input, Row, Select, Table, Typography } from "antd";
import { ClockCircleOutlined, ExperimentOutlined, IdcardOutlined, PlusOutlined, SafetyOutlined, SolutionOutlined, TeamOutlined } from "@ant-design/icons";
import { addFaculty, endFacultyLink } from "@/app/actions/faculty";
import { PageTitle, Person, Pill, StatCard, programLabel, fmtDate } from "./common";
import { DEMO } from "./demo-helpers";

type Row = {
  linkId: number;
  programType: string;
  linkStatus: string;
  startDate: string;
  endDate: string | null;
  pcpId: string;
  cnic: string;
  fullName: string;
  qualification: string;
  specialization: string;
  designation: string;
  verificationStatus: string;
};

const TRIES = [
  { label: "Try: active elsewhere", hint: "CNIC already active at another institution", values: { cnic: "35202-7654321-2", fullName: "Dr. Sara Malik", fatherName: "Javed Malik", programType: "TECH" } },
  { label: "Try: near-duplicate", hint: "New CNIC, but the name matches an existing person", values: { cnic: "17301-7777777-1", fullName: "Dr. Mohammad Ali Khan", fatherName: "Abdul Ghafoor Khan", programType: "TECH" } },
];

export default function FacultyView({ rows, canEdit }: { rows: Row[]; canEdit: boolean }) {
  const { message, modal } = App.useApp();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; level?: string } | null>(null);
  const [pending, start] = useTransition();
  const [form] = Form.useForm();
  const active = rows.filter((r) => r.linkStatus === "ACTIVE");

  const submit = (values: Record<string, string>) =>
    start(async () => {
      const r = await addFaculty(values);
      setResult(r);
      if (r.ok) {
        form.resetFields();
        message[r.level === "warning" ? "warning" : "success"](r.ok ? "Faculty saved" : "Not saved");
      }
    });

  const endLink = (row: Row) => {
    let reason = "";
    modal.confirm({
      title: `End appointment of ${row.fullName}?`,
      content: (
        <div>
          <p>The record is kept as history and PCP is notified (change request).</p>
          <Input placeholder="Reason: transfer, resignation, retirement ..." onChange={(e) => (reason = e.target.value)} />
        </div>
      ),
      onOk: async () => {
        const r = await endFacultyLink(row.linkId, reason);
        message[r.ok ? "success" : "error"](r.message);
      },
    });
  };

  return (
    <>
      <PageTitle
        eyebrow="Registry"
        title="Faculty"
        sub="Central PCP faculty registry: one record per CNIC, active at one institution at a time."
        extra={
          canEdit ? (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setResult(null);
                setOpen(true);
              }}
            >
              Add faculty member
            </Button>
          ) : null
        }
      />
      <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
        <Col xs={12} md={6}><StatCard label="Active faculty" value={active.length} icon={<TeamOutlined />} /></Col>
        <Col xs={12} md={6}><StatCard label="PharmD" value={active.filter((r) => r.programType === "PHARMD").length} icon={<SolutionOutlined />} tone="gold" /></Col>
        <Col xs={12} md={6}><StatCard label="Pharmacy Technician" value={active.filter((r) => r.programType === "TECH").length} icon={<ExperimentOutlined />} tone="info" /></Col>
        <Col xs={12} md={6}><StatCard label="Awaiting PCP verification" value={active.filter((r) => r.verificationStatus !== "VERIFIED").length} icon={<ClockCircleOutlined />} tone="warn" /></Col>
      </Row>
      <Card styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="linkId"
          dataSource={rows}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          columns={[
            { title: "Name", dataIndex: "fullName", render: (v, r) => <Person name={v} sub={<span className="mono">{r.pcpId}</span>} /> },
            { title: "CNIC", dataIndex: "cnic", render: (v) => <span className="mono" style={{ whiteSpace: "nowrap" }}>{v}</span> },
            { title: "Qualification", dataIndex: "qualification", render: (v, r) => <span>{v}<div className="faint" style={{ fontSize: 12 }}>{r.specialization}</div></span> },
            {
              title: "Role",
              dataIndex: "designation",
              filters: [{ text: "PharmD", value: "PHARMD" }, { text: "Pharmacy Technician", value: "TECH" }],
              onFilter: (v, r) => r.programType === v,
              render: (v, r) => <span>{v}<div className="faint" style={{ fontSize: 12 }}>{programLabel(r.programType)}</div></span>,
            },
            { title: "PCP verification", dataIndex: "verificationStatus", render: (v) => <Pill value={v} /> },
            { title: "Appointment", render: (_, r) => (r.linkStatus === "ACTIVE" ? <Pill value="ACTIVE" /> : <span className="faint">Ended {fmtDate(r.endDate)}</span>) },
            ...(canEdit
              ? [{ title: "", align: "right" as const, render: (_: unknown, r: Row) => (r.linkStatus === "ACTIVE" ? <Button size="small" type="link" onClick={() => endLink(r)}>End</Button> : null) }]
              : []),
          ]}
        />
      </Card>

      <Drawer title="Add faculty member" open={open} onClose={() => setOpen(false)} size="large">
        <div style={{ display: "flex", gap: 12, padding: 14, borderRadius: 12, background: "var(--brand-50)", border: "1px solid var(--brand-100)", marginBottom: 16 }}>
          <SafetyOutlined style={{ color: "var(--brand)", fontSize: 18, marginTop: 2 }} />
          <div style={{ fontSize: 13, lineHeight: 1.55 }}>
            <b>Checks run when you save</b>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              <li>CNIC is the key: one PCP record per person (a NADRA check plugs in here in production).</li>
              <li>A person already active at another institution is blocked; the other institution is not revealed.</li>
              <li>Names are compared after normalisation (Muhammad / Mohammad, Umer / Umar …). Close matches are flagged for PCP.</li>
            </ul>
          </div>
        </div>
        {DEMO ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {TRIES.map((t) => (
              <Button
                key={t.label}
                size="small"
                type="dashed"
                icon={<IdcardOutlined />}
                title={t.hint}
                onClick={() => {
                  setResult(null);
                  form.setFieldsValue(t.values);
                }}
                style={{ borderColor: "#e3c97f", color: "#8a6a1c", background: "#fffbf0" }}
              >
                {t.label}
              </Button>
            ))}
          </div>
        ) : null}
        {result ? <Alert style={{ marginBottom: 16 }} showIcon type={result.level === "warning" ? "warning" : result.ok ? "success" : "error"} message={result.message} /> : null}
        <Form form={form} layout="vertical" onFinish={submit} initialValues={{ programType: "TECH", qualification: "MPhil", designation: "Lecturer", specialization: "Pharmaceutics" }}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="cnic" label="CNIC" rules={[{ required: true }]}>
                <Input placeholder="17301-1234567-1" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="programType" label="Program" rules={[{ required: true }]}>
                <Select options={[{ value: "PHARMD", label: "PharmD" }, { value: "TECH", label: "Pharmacy Technician" }]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="fullName" label="Full name" rules={[{ required: true }]}>
            <Input placeholder="Dr. ..." />
          </Form.Item>
          <Form.Item name="fatherName" label="Father's name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="qualification" label="Qualification" rules={[{ required: true }]}>
                <Select options={["PhD", "MPhil", "PharmD", "M.Pharm"].map((v) => ({ value: v }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="specialization" label="Specialization" rules={[{ required: true }]}>
                <Select options={["Pharmacology", "Pharmaceutics", "Pharmaceutical Chemistry", "Pharmacognosy", "Pharmacy Practice", "Clinical Pharmacy"].map((v) => ({ value: v }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="designation" label="Designation" rules={[{ required: true }]}>
                <Select options={["Professor", "Associate Professor", "Assistant Professor", "Lecturer"].map((v) => ({ value: v }))} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="pcpRegNo" label="PCP / provincial registration no.">
            <Input />
          </Form.Item>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Button type="primary" htmlType="submit" loading={pending}>
              Save and run checks
            </Button>
            <Typography.Text type="secondary">Saved records await PCP verification.</Typography.Text>
          </div>
        </Form>
      </Drawer>
    </>
  );
}
