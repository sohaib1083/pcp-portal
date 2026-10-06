"use client";
// The Head of institution manages the institution's own staff accounts (guide section 2:
// "people inside that account have jobs, not a shared password").
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Col, Drawer, Form, Input, Modal, Popconfirm, Row, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import { CheckOutlined, KeyOutlined, StopOutlined, UserAddOutlined } from "@ant-design/icons";
import { addInstitutionUser, resetInstitutionUserPassword, setInstitutionUserActive, type UserActionResult } from "@/app/actions/institution";
import { INST_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/roles";
import { PageTitle, Person, Pill, fmtDate } from "./common";
import { FillDemo } from "./demo-helpers";

type User = { username: string; displayName: string; email: string | null; role: string; active: boolean; createdAt: string; createdBy: string | null };

// What each job may not do (guide section 2), shown next to what it may do.
const MAY_NOT: Record<string, string> = {
  inst_poc: "Edit an approved faculty link in place",
  inst_principal: "See another institution",
  inst_dept_admin: "Issue an NOC",
  inst_data_entry: "Submit without a second check",
  inst_exam: "Change a locked year",
  inst_finance: "Alter academic records",
};

export default function InstitutionUsersView({ me, inst, users }: { me: string; inst: { code: string; name: string; shortCode: string }; users: User[] }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [creds, setCreds] = useState<{ username: string; password: string; title: string } | null>(null);
  const [form] = Form.useForm();
  const prefix = inst.shortCode.toLowerCase();
  const active = users.filter((u) => u.active).length;

  const run = (fn: () => Promise<UserActionResult>, title: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      message[r.ok ? "success" : "error"](r.message, r.ok ? 3 : 7);
      if (r.ok) {
        if (r.credentials) setCreds({ ...r.credentials, title });
        after?.();
        router.refresh();
      }
    });

  return (
    <>
      <PageTitle
        eyebrow="Administration"
        title="Users & roles"
        sub={`Everyone at ${inst.name} signs in with their own account and one job. Only the Head of institution adds, disables or resets accounts.`}
        extra={
          <Button
            type="primary"
            icon={<UserAddOutlined />}
            onClick={() => {
              form.resetFields();
              setOpen(true);
            }}
          >
            Add user
          </Button>
        }
      />
      <Card title={`Accounts (${active} active of ${users.length})`} styles={{ body: { padding: 0 } }} style={{ marginBottom: 18 }}>
        <Table
          rowKey="username"
          pagination={false}
          dataSource={users}
          columns={[
            {
              title: "Person",
              dataIndex: "displayName",
              render: (v, u) => (
                <Person
                  name={v}
                  sub={
                    <span>
                      <span className="mono">{u.username}</span> · {u.email}
                      {u.username === me ? <Tag style={{ marginLeft: 6 }}>You</Tag> : null}
                    </span>
                  }
                />
              ),
            },
            {
              title: "Role",
              dataIndex: "role",
              render: (v) => (
                <Tooltip title={ROLE_DESCRIPTIONS[v]}>
                  <Tag color={v === "inst_poc" ? "green" : "blue"}>{ROLE_LABELS[v] ?? v}</Tag>
                </Tooltip>
              ),
              filters: INST_ROLES.map((r) => ({ text: ROLE_LABELS[r], value: r })),
              onFilter: (v, u) => u.role === v,
            },
            { title: "Status", dataIndex: "active", render: (v) => (v ? <Pill value="ACTIVE" /> : <Pill value="DISABLED" label="Disabled" />) },
            { title: "Added", render: (_, u) => <span style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{fmtDate(u.createdAt)}<div className="faint">{u.createdBy === "system" ? "by PCP" : u.createdBy === "self-registration" ? "self-registered" : u.createdBy ? `by ${u.createdBy}` : ""}</div></span> },
            {
              title: "",
              align: "right",
              render: (_, u) =>
                u.role === "inst_poc" && u.username !== me ? null : (
                  <Space size={4}>
                    <Button size="small" icon={<KeyOutlined />} disabled={!u.active} loading={pending} onClick={() => run(() => resetInstitutionUserPassword(u.username), "Temporary password issued")}>
                      Reset password
                    </Button>
                    {u.username === me ? null : u.active ? (
                      <Popconfirm title={`Disable ${u.displayName}?`} description="They are signed out everywhere at once." okText="Disable" onConfirm={() => run(() => setInstitutionUserActive(u.username, false), "")}>
                        <Button size="small" danger icon={<StopOutlined />} loading={pending}>
                          Disable
                        </Button>
                      </Popconfirm>
                    ) : (
                      <Button size="small" icon={<CheckOutlined />} loading={pending} onClick={() => run(() => setInstitutionUserActive(u.username, true), "")}>
                        Enable
                      </Button>
                    )}
                  </Space>
                ),
            },
          ]}
        />
      </Card>

      <Card title="The six institution roles" extra={<span className="muted" style={{ fontSize: 12.5 }}>From PCP&apos;s working guide</span>}>
        <Row gutter={[12, 12]}>
          {INST_ROLES.map((r) => (
            <Col key={r} xs={24} md={12} xl={8}>
              <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "12px 14px", height: "100%" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <b style={{ fontSize: 13.5 }}>{ROLE_LABELS[r]}</b>
                  <span className="faint tnum" style={{ fontSize: 12 }}>
                    {users.filter((u) => u.role === r && u.active).length} active
                  </span>
                </div>
                <div style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.45 }}>
                  <span style={{ color: "var(--good)", fontWeight: 600 }}>May:</span> {ROLE_DESCRIPTIONS[r]}
                </div>
                <div style={{ fontSize: 12.5, marginTop: 2, lineHeight: 1.45 }} className="muted">
                  <span style={{ color: "var(--bad)", fontWeight: 600 }}>May not:</span> {MAY_NOT[r]}
                </div>
              </div>
            </Col>
          ))}
        </Row>
      </Card>

      <Drawer title="Add a user" open={open} onClose={() => setOpen(false)} size="large">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="What this does"
          description={`Creates a sign-in account inside ${inst.name} (${inst.code}) with the role you choose and a temporary password, which you see once. The person sets their own password at first sign-in.`}
        />
        <Form
          form={form}
          layout="vertical"
          requiredMark="optional"
          onFinish={(v) => run(() => addInstitutionUser(v), "Account created: temporary password", () => setOpen(false))}
        >
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
            <FillDemo
              onClick={() => {
                const n = Math.floor(100 + Math.random() * 900);
                form.setFieldsValue({ role: "inst_data_entry", fullName: "Mehwish Alam", email: `mehwish.alam${n}@${prefix}.demo`, username: `${prefix}.entry${n}` });
              }}
            />
          </div>
          <Form.Item name="role" label="Role" rules={[{ required: true, message: "Choose a role" }]}>
            <Select
              placeholder="Choose the person's job"
              optionLabelProp="title"
              options={INST_ROLES.map((r) => ({
                value: r,
                title: ROLE_LABELS[r],
                disabled: r === "inst_poc",
                label: (
                  <div style={{ whiteSpace: "normal", lineHeight: 1.35, padding: "2px 0" }}>
                    <b style={{ fontWeight: 600 }}>{ROLE_LABELS[r]}</b>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {r === "inst_poc" ? "One Head per institution. A handover goes through PCP." : ROLE_DESCRIPTIONS[r]}
                    </div>
                  </div>
                ),
              }))}
            />
          </Form.Item>
          <Form.Item name="fullName" label="Full name" rules={[{ required: true, min: 3, message: "Enter the person's full name" }]}>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="email" label="Email" rules={[{ required: true, type: "email", message: "Enter a valid email address" }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="username"
                label="Username"
                normalize={(v: string) => v?.toLowerCase()}
                rules={[{ required: true, pattern: /^[a-z0-9][a-z0-9._-]{2,40}$/, message: "3 or more lowercase letters, digits, dots or dashes" }]}
                extra={`Tip: start with ${prefix}. so it is clear where the person works`}
              >
                <Input placeholder={`${prefix}.name`} />
              </Form.Item>
            </Col>
          </Row>
          <Button type="primary" htmlType="submit" loading={pending}>
            Create account
          </Button>
        </Form>
      </Drawer>

      <Modal open={!!creds} title={creds?.title} onOk={() => setCreds(null)} onCancel={() => setCreds(null)} cancelButtonProps={{ style: { display: "none" } }}>
        <p>Give these to the person over a secure channel. They must set a new password at first sign-in. This is shown only once.</p>
        <p>
          Username: <Typography.Text code copyable>{creds?.username}</Typography.Text>
        </p>
        <p>
          Temporary password: <Typography.Text code copyable>{creds?.password}</Typography.Text>
        </p>
      </Modal>
    </>
  );
}
