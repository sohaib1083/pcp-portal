"use client";
import { useMemo, useState, useTransition } from "react";
import { Alert, App, Button, Card, Col, Drawer, Form, Input, InputNumber, Row, Select, Table, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { addStudent } from "@/app/actions/students";
import { PageTitle, Person, Pill, programLabel } from "./common";

type Row = { id: number; pcpId: string; fullName: string; fatherName: string; cnic: string; programType: string; shift: string; enrollmentYear: number; currentYear: number; status: string };

export default function StudentsView(props: {
  rows: Row[];
  canEdit: boolean;
  byYear: { year: number; type: string; n: number }[];
  intake: Record<string, number>;
  approved: string[];
}) {
  const { message } = App.useApp();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; level?: string } | null>(null);
  const [pending, start] = useTransition();
  const [form] = Form.useForm();
  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return s ? props.rows.filter((r) => r.fullName.toLowerCase().includes(s) || r.pcpId.toLowerCase().includes(s)) : props.rows;
  }, [q, props.rows]);

  return (
    <>
      <PageTitle
        eyebrow="Registry"
        title="Students"
        sub="Central student registry: each student gets one PCP student ID, and enrolment is checked against the approved intake."
        extra={
          props.canEdit ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setResult(null); setOpen(true); }}>
              Enrol student
            </Button>
          ) : null
        }
      />
      <Card title="Enrolment by year against approved intake" style={{ marginBottom: 18 }}>
        <Row gutter={[12, 12]}>
          {props.byYear.map((b) => {
            const limit = props.intake[b.type] ?? 0;
            return (
              <Col key={`${b.year}-${b.type}`} xs={12} md={6} xl={4}>
                <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px" }}>
                  <div className="faint" style={{ fontSize: 12 }}>
                    {b.year} · {programLabel(b.type)}
                  </div>
                  <div className="tnum" style={{ fontSize: 20, fontWeight: 700 }}>
                    {b.n} <span className="faint" style={{ fontSize: 12, fontWeight: 500 }}>/ {limit || "—"} approved</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 5, background: "var(--line-2)", overflow: "hidden", marginTop: 6 }}>
                    <div style={{ height: "100%", width: `${Math.min(100, limit ? (b.n / limit) * 100 : 0)}%`, background: limit && b.n > limit ? "#d03b3b" : "#0f8a63" }} />
                  </div>
                  {limit && b.n > limit ? <Tag color="red" style={{ marginTop: 6 }}>Over intake</Tag> : null}
                </div>
              </Col>
            );
          })}
        </Row>
      </Card>
      <Card extra={<Input.Search placeholder="Search name or PCP ID" allowClear onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />} title={`${filtered.length} students`} styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          dataSource={filtered}
          pagination={{ pageSize: 12, hideOnSinglePage: true }}
          columns={[
            { title: "Student", dataIndex: "fullName", render: (v, r) => <Person name={v} sub={<span className="mono">{r.pcpId}</span>} /> },
            { title: "Father's name", dataIndex: "fatherName" },
            { title: "CNIC", dataIndex: "cnic", render: (v) => <span className="mono">{v}</span> },
            { title: "Program", dataIndex: "programType", render: programLabel },
            { title: "Shift", dataIndex: "shift" },
            { title: "Enrolled", dataIndex: "enrollmentYear", sorter: (a, b) => a.enrollmentYear - b.enrollmentYear },
            { title: "Year of study", dataIndex: "currentYear" },
            { title: "Status", dataIndex: "status", render: (v) => <Pill value={v} /> },
          ]}
        />
      </Card>
      <Drawer title="Enrol student" open={open} onClose={() => setOpen(false)} size="large">
        {result ? <Alert style={{ marginBottom: 16 }} showIcon type={result.level === "warning" ? "warning" : result.ok ? "success" : "error"} message={result.message} /> : null}
        <Form
          form={form}
          layout="vertical"
          initialValues={{ programType: props.approved[0], shift: "Morning", enrollmentYear: 2026 }}
          onFinish={(v) =>
            start(async () => {
              const r = await addStudent(v);
              setResult(r);
              if (r.ok) {
                form.resetFields();
                message.success("Student enrolled");
              }
            })
          }
        >
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="cnic" label="CNIC / B-Form" rules={[{ required: true }]}>
                <Input placeholder="17301-0000000-0" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="programType" label="Program" rules={[{ required: true }]}>
                <Select options={props.approved.map((p) => ({ value: p, label: programLabel(p) }))} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="fullName" label="Full name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="fatherName" label="Father's name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="mobile" label="Mobile">
                <Input placeholder="03xx xxxxxxx" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="email" label="Email">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="shift" label="Program details" rules={[{ required: true }]}>
                <Select options={["Morning", "Evening", "Self-finance"].map((v) => ({ value: v }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="enrollmentYear" label="Enrolment year" rules={[{ required: true }]}>
                <InputNumber min={2015} max={2030} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Button type="primary" htmlType="submit" loading={pending}>
            Enrol and generate PCP student ID
          </Button>
        </Form>
      </Drawer>
    </>
  );
}
