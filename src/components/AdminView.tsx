"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Col, Drawer, Form, Input, Modal, Popconfirm, Row, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import { BankOutlined, KeyOutlined, PlusOutlined, StopOutlined, CheckOutlined } from "@ant-design/icons";
import { createAccount, onboardInstitution, resetAccountPassword, setAccountActive, type AdminResult } from "@/app/actions/admin";
import { INST_ROLES, PCP_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/roles";
import { PageTitle, Person, Pill } from "./common";
import { FillDemo } from "./demo-helpers";

type User = { username: string; displayName: string; email: string | null; role: string; province: string | null; active: boolean; inKeycloak: boolean; createdAt: string };
type Inst = { code: string; shortCode: string; name: string; city: string; province: string; sector: string; status: string; pocs: User[]; members: User[] };

const PROVINCES = ["Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan", "Gilgit-Baltistan", "Islamabad Capital Territory", "Azad Jammu and Kashmir"];
const isInstRole = (r: string) => (INST_ROLES as readonly string[]).includes(r);
const roleOption = (r: string) => ({
  value: r,
  title: ROLE_LABELS[r],
  label: (
    <div style={{ whiteSpace: "normal", lineHeight: 1.35, padding: "2px 0" }}>
      <b style={{ fontWeight: 600 }}>{ROLE_LABELS[r]}</b>
      <div className="muted" style={{ fontSize: 12 }}>{ROLE_DESCRIPTIONS[r]}</div>
    </div>
  ),
});

export default function AdminView({ me, institutions, staff, kcError }: { me: string; institutions: Inst[]; staff: User[]; kcError: string | null }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [creds, setCreds] = useState<AdminResult["credentials"] | null>(null);
  const [tenantOpen, setTenantOpen] = useState(false);
  const [userOpen, setUserOpen] = useState<null | { role: string; institutionCode?: string }>(null);
  const [tenantForm] = Form.useForm();
  const [userForm] = Form.useForm();

  const run = (fn: () => Promise<AdminResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        message.success(r.message);
        if (r.credentials) setCreds(r.credentials);
        after?.();
        router.refresh();
      } else message.error(r.message, 6);
    });

  const actions = (u: User) => (
    <Space size={4}>
      <Button size="small" icon={<KeyOutlined />} disabled={!u.active} loading={pending} onClick={() => run(() => resetAccountPassword(u.username))}>
        Reset password
      </Button>
      {u.username === me ? null : u.active ? (
        <Popconfirm title={`Disable ${u.username}?`} description="They are signed out everywhere at once." onConfirm={() => run(() => setAccountActive(u.username, false))}>
          <Button size="small" danger icon={<StopOutlined />} loading={pending}>Disable</Button>
        </Popconfirm>
      ) : (
        <Button size="small" icon={<CheckOutlined />} loading={pending} onClick={() => run(() => setAccountActive(u.username, true))}>Enable</Button>
      )}
    </Space>
  );

  const status = (u: User) => (u.active ? <Pill value="ACTIVE" /> : <Tag>Disabled</Tag>);

  return (
    <>
      <PageTitle
        eyebrow="Administration"
        title="Users & institutions"
        sub="The Super Admin creates PCP accounts and each institution's Head account. A Head then adds the institution's own staff. New institutions can also register themselves for PCP's approval."
        extra={
          <Space>
            <Button icon={<PlusOutlined />} onClick={() => { userForm.resetFields(); userForm.setFieldsValue({ role: "pcp_officer" }); setUserOpen({ role: "pcp_officer" }); }}>Add user</Button>
            <Button type="primary" icon={<BankOutlined />} onClick={() => { tenantForm.resetFields(); setTenantOpen(true); }}>Onboard institution</Button>
          </Space>
        }
      />
      {kcError ? <Alert type="error" showIcon style={{ marginBottom: 16 }} title="Keycloak admin API unreachable" description={kcError} /> : null}
      <Tabs
        items={[
          {
            key: "tenants",
            label: `Institutions (${institutions.length})`,
            children: (
              <Card styles={{ body: { padding: 0 } }}>
                <Table
                  rowKey="code"
                  pagination={false}
                  dataSource={institutions}
                  columns={[
                    { title: "Institution", dataIndex: "name", render: (v, r) => <span><span style={{ fontWeight: 500 }}>{v}</span> <Tag>{r.shortCode}</Tag><div className="faint" style={{ fontSize: 12 }}><span className="mono">{r.code}</span> · {r.city}, {r.province} · {r.sector}</div></span> },
                    {
                      title: "POC account",
                      render: (_, r) => {
                        const active = r.pocs.find((p) => p.active);
                        return active ? (
                          <Person name={active.displayName} sub={<span><span className="mono">{active.username}</span> · {active.email}</span>} />
                        ) : (
                          <Tag color="orange">No active POC</Tag>
                        );
                      },
                    },
                    { title: "Status", render: (_, r) => { const a = r.pocs.find((p) => p.active); return a ? status(a) : null; } },
                    { title: "Staff", align: "right", render: (_, r) => <span className="tnum muted" title="Active accounts besides the Head">{r.members.filter((m) => m.active).length}</span> },
                    {
                      title: "",
                      render: (_, r) => {
                        const active = r.pocs.find((p) => p.active);
                        return active ? actions(active) : (
                          <Button size="small" type="primary" onClick={() => { userForm.resetFields(); userForm.setFieldsValue({ role: "inst_poc", institutionCode: r.code }); setUserOpen({ role: "inst_poc", institutionCode: r.code }); }}>
                            Add POC
                          </Button>
                        );
                      },
                    },
                  ]}
                  expandable={{
                    rowExpandable: (r) => r.pocs.some((p) => !p.active) || r.members.length > 0,
                    expandedRowRender: (r) => (
                      <div style={{ fontSize: 12, display: "grid", gap: 6 }}>
                        {r.members.length ? (
                          <div>
                            <b>Staff added by the Head:</b>{" "}
                            {r.members.map((m) => (
                              <Tag key={m.username} color={m.active ? undefined : "red"}>
                                {m.displayName} · {ROLE_LABELS[m.role] ?? m.role}
                                {m.active ? "" : " · disabled"}
                              </Tag>
                            ))}
                          </div>
                        ) : null}
                        {r.pocs.some((p) => !p.active) ? (
                          <div>
                            <b>Previous POCs (history kept):</b>{" "}
                            {r.pocs.filter((p) => !p.active).map((p) => <Tag key={p.username}>{p.displayName} · {p.username}</Tag>)}
                          </div>
                        ) : null}
                      </div>
                    ),
                  }}
                />
              </Card>
            ),
          },
          {
            key: "staff",
            label: `PCP staff (${staff.length})`,
            children: (
              <>
                <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
                  {PCP_ROLES.map((r) => (
                    <Col key={r} xs={24} md={12} xl={6}>
                      <div className="pcp-stat" style={{ display: "block" }}>
                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{ROLE_LABELS[r]}</div>
                        <div className="muted" style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.45 }}>{ROLE_DESCRIPTIONS[r]}</div>
                      </div>
                    </Col>
                  ))}
                </Row>
                <Card styles={{ body: { padding: 0 } }}>
                <Table
                  rowKey="username"
                  pagination={false}
                  dataSource={staff}
                  columns={[
                    { title: "Person", dataIndex: "displayName", render: (v, r) => <Person name={v} sub={<span><span className="mono">{r.username}</span> · {r.email}</span>} /> },
                    { title: "Role", dataIndex: "role", render: (v) => <Tag color="blue">{ROLE_LABELS[v] ?? v}</Tag>, filters: PCP_ROLES.map((r) => ({ text: ROLE_LABELS[r], value: r })), onFilter: (v, r) => r.role === v },
                    { title: "Province", dataIndex: "province", render: (v, r) => (r.role === "pcp_inspector" ? v : "—") },
                    { title: "Status", render: (_, r) => status(r) },
                    { title: "", render: (_, r) => actions(r) },
                  ]}
                />
                </Card>
              </>
            ),
          },
        ]}
      />

      <Drawer title="Onboard a new institution (tenant)" open={tenantOpen} onClose={() => setTenantOpen(false)} size="large">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="What this does"
          description={
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              <li>Generates the next PCP institution ID (PCP-UNI-…)</li>
              <li>Creates the institution&apos;s group in Keycloak, which scopes all its data</li>
              <li>Creates its single POC account with a temporary password (changed at first sign-in)</li>
            </ol>
          }
        />
        <Form form={tenantForm} layout="vertical" initialValues={{ sector: "Private", province: "Punjab" }} onFinish={(v) => run(() => onboardInstitution({ ...v, poc: { fullName: v.pocName, email: v.pocEmail, username: v.pocUsername } }), () => setTenantOpen(false))}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography.Title level={5} style={{ margin: "0 0 12px" }}>Institution</Typography.Title>
            <FillDemo
              onClick={() =>
                tenantForm.setFieldsValue({ name: "Margalla Institute of Pharmacy", shortCode: "MIP", city: "Islamabad", sector: "Private", province: "Islamabad Capital Territory", pocName: "Dr. Hina Abbasi", pocEmail: "hina.abbasi@mip.demo", pocUsername: "mip.poc" })
              }
            />
          </div>
          <Form.Item name="name" label="Institution name" rules={[{ required: true }]}><Input placeholder="e.g. Margalla Institute of Pharmacy" /></Form.Item>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="shortCode" label="Short code" rules={[{ required: true, pattern: /^[A-Z]{2,6}$/, message: "2–6 capital letters" }]}><Input placeholder="MIP" /></Form.Item></Col>
            <Col span={8}><Form.Item name="city" label="City" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={8}><Form.Item name="sector" label="Sector"><Select options={["Public", "Private"].map((v) => ({ value: v }))} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="province" label="Province / region"><Select options={PROVINCES.map((v) => ({ value: v }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="affiliatedUniversity" label="Affiliated university (if a college)"><Input /></Form.Item></Col>
          </Row>
          <Typography.Title level={5}>POC (focal person)</Typography.Title>
          <Form.Item name="pocName" label="Full name" rules={[{ required: true }]}><Input /></Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="pocEmail" label="Official email" rules={[{ required: true, type: "email" }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="pocUsername" label="Username" rules={[{ required: true, pattern: /^[a-z0-9][a-z0-9._-]{2,40}$/, message: "lowercase letters, digits, dot, dash" }]}><Input placeholder="mip.poc" /></Form.Item></Col>
          </Row>
          <Button type="primary" htmlType="submit" loading={pending}>Onboard institution</Button>
        </Form>
      </Drawer>

      <Drawer title={userOpen?.role === "inst_poc" ? "Add institution POC" : "Add a user"} open={!!userOpen} onClose={() => setUserOpen(null)} size="large">
        <Form form={userForm} layout="vertical" initialValues={userOpen ?? {}} onFinish={(v) => run(() => createAccount(v), () => setUserOpen(null))}>
          <Form.Item name="role" label="Role" rules={[{ required: true }]} extra="PCP roles work across the system. Institution roles belong to one institution you choose below.">
            <Select
              optionLabelProp="title"
              listHeight={420}
              virtual={false}
              options={
                userOpen?.role === "inst_poc"
                  ? [{ label: "Institution role", options: [roleOption("inst_poc")] }]
                  : [
                      { label: "PCP roles", options: PCP_ROLES.map(roleOption) },
                      { label: "Institution roles (for a chosen institution)", options: INST_ROLES.map(roleOption) },
                    ]
              }
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.role !== b.role}>
            {({ getFieldValue }) =>
              isInstRole(getFieldValue("role") ?? "") ? (
                <Form.Item name="institutionCode" label="Institution" rules={[{ required: true, message: "Choose the institution" }]} extra={getFieldValue("role") === "inst_poc" ? "One active Head (POC) per institution." : "The account joins this institution's group and sees only its data."}>
                  <Select showSearch optionFilterProp="label" options={institutions.map((i) => ({ value: i.code, label: `${i.code} · ${i.name}` }))} />
                </Form.Item>
              ) : getFieldValue("role") === "pcp_inspector" ? (
                <Form.Item name="province" label="Home province (conflict-of-interest rule)" rules={[{ required: true }]}>
                  <Select options={PROVINCES.map((v) => ({ value: v }))} />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Form.Item name="fullName" label="Full name" rules={[{ required: true }]}><Input /></Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="email" label="Email" rules={[{ required: true, type: "email" }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="username" label="Username" rules={[{ required: true, pattern: /^[a-z0-9][a-z0-9._-]{2,40}$/, message: "lowercase letters, digits, dot, dash" }]}><Input /></Form.Item></Col>
          </Row>
          <Button type="primary" htmlType="submit" loading={pending}>Create account</Button>
        </Form>
      </Drawer>

      <Modal open={!!creds} title="Account created: temporary password" onOk={() => setCreds(null)} onCancel={() => setCreds(null)} cancelButtonProps={{ style: { display: "none" } }}>
        <p>Share these with the user over a secure channel. They must set a new password at first sign-in. This is shown only once.</p>
        <p>Username: <Typography.Text code copyable>{creds?.username}</Typography.Text></p>
        <p>Temporary password: <Typography.Text code copyable>{creds?.password}</Typography.Text></p>
      </Modal>
    </>
  );
}
