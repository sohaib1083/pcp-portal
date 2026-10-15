"use client";
// Council and committee members register (Annexure-III "Faculty, Members Ledger"): who sits where, for which
// term, nominated by whom, and their declared conflicts of interest. External members never sign in.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Card, Col, DatePicker, Empty, Form, Input, Modal, Popconfirm, Row, Segmented, Select, Space, Table, Tag, Tooltip } from "antd";
import { MailOutlined, PhoneOutlined, PlusOutlined, StopOutlined, TeamOutlined, UserAddOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { addMember, addSeat, declareMemberConflict, endSeat, withdrawMemberConflict } from "@/app/actions/members";
import type { ActionResult } from "@/app/actions/faculty";
import type { Register } from "@/lib/members";
import { Person, StatCard, StatusDot, fmtDate } from "./common";
import { FillDemo } from "./demo-helpers";

type Member = Register["members"][number];
const ROLE: Record<string, string> = { CHAIR: "Chair", VICE_CHAIR: "Vice chair", MEMBER: "Member", SECRETARY: "Secretary (ex officio)" };
const CATEGORY: Record<string, string> = { NOMINATED: "Nominated", ELECTED: "Elected", EX_OFFICIO: "Ex officio", CO_OPTED: "Co-opted" };
const SEAT_TONE: Record<string, "good" | "neutral" | "warn" | "info"> = { ACTIVE: "good", ENDED: "neutral", EXPIRED: "warn", UPCOMING: "info" };
const SEAT_LABEL: Record<string, string> = { ACTIVE: "Serving", ENDED: "Ended", EXPIRED: "Term expired", UPCOMING: "Starts later" };
const PROVINCES = ["Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan", "Gilgit-Baltistan", "Islamabad Capital Territory", "Azad Jammu and Kashmir"];

type Dialog = { kind: "member" } | { kind: "seat"; m: Member } | { kind: "conflict"; m: Member } | { kind: "end"; m: Member; seatId: number; committee: string } | null;

export default function CouncilMembers({ data, committees, canManage, contactShown }: { data: Register; committees: string[]; canManage: boolean; contactShown: boolean }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState("all");
  const [status, setStatus] = useState("SERVING");
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [form] = Form.useForm();

  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      message[r.ok ? "success" : "error"](r.message, r.ok ? 4 : 7);
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });

  const rows = useMemo(() => {
    const s = q.toLowerCase();
    return data.members.filter(
      (m) =>
        (status === "all" || m.status === status) &&
        (filter === "all" || m.seats.some((x) => x.committee === filter && x.status !== "ENDED")) &&
        (!s || `${m.name} ${m.designation} ${m.nominatingBody} ${m.ref}`.toLowerCase().includes(s)),
    );
  }, [data.members, filter, status, q]);
  const serving = data.members.filter((m) => m.status === "SERVING");
  const external = serving.filter((m) => !m.username);
  const withConflicts = serving.filter((m) => m.conflicts.some((c) => c.active));
  const expiring = serving.filter((m) => m.seats.some((s) => s.status === "ACTIVE" && s.termEnd && dayjs(s.termEnd).diff(dayjs(), "day") <= 90));

  const open = (d: Dialog) => {
    form.resetFields();
    setDialog(d);
  };
  const submit = (v: Record<string, unknown>) => {
    const ymd = (x: unknown) => (x ? dayjs(x as dayjs.Dayjs).format("YYYY-MM-DD") : null);
    if (dialog?.kind === "member") run(() => addMember({ ...v, termStart: ymd(v.termStart), termEnd: ymd(v.termEnd) }), () => setDialog(null));
    else if (dialog?.kind === "seat") run(() => addSeat(dialog.m.id, { ...v, termStart: ymd(v.termStart), termEnd: ymd(v.termEnd) }), () => setDialog(null));
    else if (dialog?.kind === "conflict") run(() => declareMemberConflict(dialog.m.id, v), () => setDialog(null));
    else if (dialog?.kind === "end") run(() => endSeat(dialog.seatId, String(v.reason ?? "")), () => setDialog(null));
  };

  return (
    <>
      <Row gutter={[14, 14]} style={{ marginBottom: 16 }}>
        <Col xs={12} lg={6}>
          <StatCard compact label="Serving members" icon={<TeamOutlined />} value={serving.length} hint={`${serving.filter((m) => m.seats.some((s) => s.committee === "Council" && s.status === "ACTIVE")).length} on the Council`} />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard compact label="External members" icon={<UserAddOutlined />} tone="violet" value={external.length} hint="Nominees who do not sign in" />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard compact label="Declared conflicts" icon={<StopOutlined />} tone={withConflicts.length ? "bad" : "neutral"} value={withConflicts.length} hint="Members recused from those institutions' items" />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard compact label="Terms ending in 90 days" icon={<TeamOutlined />} tone={expiring.length ? "warn" : "neutral"} value={expiring.length} />
        </Col>
      </Row>
      <Card
        styles={{ body: { padding: 0 } }}
        data-testid="members-register"
        title={
          <div style={{ padding: "8px 0", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Select value={filter} onChange={setFilter} style={{ width: 230 }} className="members-committee" options={[{ value: "all", label: "Council and all committees" }, ...committees.map((c) => ({ value: c, label: c }))]} />
            <Segmented
              value={status}
              onChange={(v) => setStatus(String(v))}
              options={[
                { value: "SERVING", label: "Serving" },
                { value: "FORMER", label: "Former" },
                { value: "all", label: "All" },
              ]}
            />
          </div>
        }
        extra={
          <Space>
            <Input.Search allowClear placeholder="Name, body or reference" onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
            {canManage ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => open({ kind: "member" })}>
                Add member
              </Button>
            ) : null}
          </Space>
        }
      >
        <Table
          rowKey="id"
          dataSource={rows}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          locale={{ emptyText: <Empty description="No members match these filters." /> }}
          expandable={{
            expandedRowRender: (m) => (
              <div style={{ display: "grid", gap: 10, fontSize: 13 }} className="member-detail">
                <div>
                  <b>Seats</b>
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    style={{ marginTop: 6 }}
                    dataSource={m.seats}
                    columns={[
                      { title: "Committee", dataIndex: "committee" },
                      { title: "Role", dataIndex: "role", render: (v) => ROLE[v] ?? v },
                      { title: "Term", render: (_, s) => `${fmtDate(s.termStart)} to ${s.termEnd ? fmtDate(s.termEnd) : "open"}` },
                      { title: "Status", render: (_, s) => <StatusDot tone={SEAT_TONE[s.status]}>{SEAT_LABEL[s.status]}{s.endReason ? `: ${s.endReason}` : ""}</StatusDot> },
                      {
                        title: "",
                        align: "right",
                        render: (_, s) =>
                          canManage && s.status !== "ENDED" ? (
                            <Button size="small" onClick={() => open({ kind: "end", m, seatId: s.id, committee: s.committee })}>
                              End seat
                            </Button>
                          ) : null,
                      },
                    ]}
                  />
                </div>
                <div>
                  <b>Declared conflicts of interest</b>
                  {m.conflicts.length ? (
                    <Table
                      size="small"
                      rowKey="id"
                      pagination={false}
                      style={{ marginTop: 6 }}
                      dataSource={m.conflicts}
                      columns={[
                        { title: "Institution", render: (_, c) => <span title={c.institutionName}>{c.institution}</span> },
                        { title: "Reason", dataIndex: "reason" },
                        { title: "Source", render: (_, c) => (c.source === "INSPECTION" ? "Inspection panel declaration" : "Register") },
                        { title: "Status", render: (_, c) => <StatusDot tone={c.active ? "bad" : "neutral"}>{c.active ? "Active" : "Withdrawn"}</StatusDot> },
                        {
                          title: "",
                          align: "right",
                          render: (_, c) =>
                            canManage && c.active && c.source === "REGISTER" ? (
                              <Popconfirm title="Withdraw this declaration?" description="It stays in the history." okText="Withdraw" onConfirm={() => run(() => withdrawMemberConflict(c.id))}>
                                <Button size="small" loading={pending}>
                                  Withdraw
                                </Button>
                              </Popconfirm>
                            ) : null,
                        },
                      ]}
                    />
                  ) : (
                    <div className="faint" style={{ marginTop: 4 }}>
                      None declared.
                    </div>
                  )}
                </div>
                {canManage ? (
                  <Space>
                    <Button size="small" icon={<PlusOutlined />} onClick={() => open({ kind: "seat", m })}>
                      Add a seat
                    </Button>
                    <Button size="small" danger icon={<StopOutlined />} onClick={() => open({ kind: "conflict", m })} className="declare-member-conflict">
                      Declare a conflict
                    </Button>
                  </Space>
                ) : null}
              </div>
            ),
          }}
          scroll={{ x: 1080 }}
          columns={[
            {
              title: "Member",
              width: 265,
              render: (_, m) => (
                <span data-member={m.ref} className="register-member">
                  <Person
                    name={m.name}
                    sub={
                      <>
                        <span className="mono">{m.ref}</span> · {m.designation}
                      </>
                    }
                  />
                </span>
              ),
            },
            {
              title: "Nominated by",
              width: 185,
              render: (_, m) => (
                <span style={{ display: "grid", lineHeight: 1.3 }}>
                  <span>{m.nominatingBody}</span>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {CATEGORY[m.category] ?? m.category}
                    {m.province ? ` · ${m.province}` : ""}
                    {m.username ? " · PCP officer" : " · external"}
                  </span>
                </span>
              ),
            },
            {
              title: "Committees",
              width: 160,
              render: (_, m) => (
                <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {m.seats
                    .filter((s) => s.status !== "ENDED")
                    .map((s) => (
                      <Tag key={s.id} color={s.status === "EXPIRED" ? "default" : s.committee === "Council" ? "green" : "purple"} style={{ margin: 0 }}>
                        {s.committee === "Council" ? "Council" : s.committee.replace(" Committee", "")}
                        {s.role !== "MEMBER" ? ` · ${ROLE[s.role]?.replace(" (ex officio)", "")}` : ""}
                      </Tag>
                    ))}
                </span>
              ),
            },
            {
              title: "Term and status",
              width: 125,
              render: (_, m) => {
                const s = m.seats.find((x) => x.status === "ACTIVE") ?? m.seats[m.seats.length - 1];
                return (
                  <span style={{ display: "grid", gap: 4, justifyItems: "start", fontSize: 12.5, lineHeight: 1.35 }}>
                    {s ? (
                      <span style={{ whiteSpace: "nowrap" }}>
                        {fmtDate(s.termStart)}
                        <br />
                        <span className="faint">to</span> {s.termEnd ? fmtDate(s.termEnd) : "open"}
                      </span>
                    ) : null}
                    <StatusDot tone={m.status === "SERVING" ? "good" : m.status === "UPCOMING" ? "info" : "neutral"}>{m.status === "SERVING" ? "Serving" : m.status === "UPCOMING" ? "Starts later" : "Former"}</StatusDot>
                  </span>
                );
              },
            },
            {
              width: 205,
              title: (
                <Tooltip title={contactShown ? "Shown in full to the Secretary and the Super Administrator; every view is logged" : "Masked: only the Secretary and the Super Administrator see contact details"}>
                  Contact
                </Tooltip>
              ),
              render: (_, m) => (
                <span style={{ display: "grid", fontSize: 12, lineHeight: 1.45, minWidth: 0 }} className="member-contact">
                  {m.email ? (
                    <span title={m.email} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      <MailOutlined style={{ color: "var(--faint)", marginRight: 4 }} />
                      {m.email}
                    </span>
                  ) : null}
                  {m.mobile ? (
                    <span className="mono">
                      <PhoneOutlined style={{ color: "var(--faint)", marginRight: 4 }} />
                      {m.mobile}
                    </span>
                  ) : null}
                </span>
              ),
            },
            {
              title: "Conflicts",
              width: 80,
              render: (_, m) =>
                m.conflicts.filter((c) => c.active).length ? (
                  <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {m.conflicts
                      .filter((c) => c.active)
                      .map((c) => (
                        <Tooltip key={c.id} title={`${c.institutionName}: ${c.reason}`}>
                          <Tag color="red" style={{ margin: 0 }} className="member-conflict">
                            {c.institution}
                          </Tag>
                        </Tooltip>
                      ))}
                  </span>
                ) : (
                  <span className="faint">None</span>
                ),
            },
          ]}
        />
      </Card>

      <Modal
        open={!!dialog}
        width={dialog?.kind === "member" ? 640 : 520}
        title={dialog?.kind === "member" ? "Add a member to the register" : dialog?.kind === "seat" ? `Add a seat for ${dialog.m.name}` : dialog?.kind === "conflict" ? `Declare a conflict for ${dialog.m.name}` : dialog?.kind === "end" ? `End ${dialog.m.name}'s seat on the ${dialog.committee}` : ""}
        okText={dialog?.kind === "member" ? "Add member" : dialog?.kind === "seat" ? "Add seat" : dialog?.kind === "conflict" ? "Record conflict" : "End seat"}
        okButtonProps={{ danger: dialog?.kind === "end" }}
        confirmLoading={pending}
        onCancel={() => setDialog(null)}
        onOk={() => form.submit()}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false} onFinish={submit} initialValues={{ role: "MEMBER", category: "NOMINATED", committee: "Council", termStart: dayjs(), termEnd: dayjs().add(3, "year") }}>
          {dialog?.kind === "member" ? (
            <>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                <FillDemo
                  onClick={() =>
                    form.setFieldsValue({
                      honorific: "Prof. Dr.",
                      name: "Samina Rafiq",
                      designation: "Dean, Faculty of Pharmacy, University of the Punjab (fictional)",
                      nominatingBody: "Higher Education Commission",
                      category: "NOMINATED",
                      province: "Punjab",
                      email: "samina.rafiq@example.edu.pk",
                      mobile: "0300-5550123",
                      committee: "Accreditation Committee",
                      role: "MEMBER",
                    })
                  }
                />
              </div>
              <Row gutter={10}>
                <Col span={6}>
                  <Form.Item name="honorific" label="Title">
                    <Select allowClear options={["Prof. Dr.", "Prof.", "Dr.", "Mr.", "Ms."].map((x) => ({ value: x }))} />
                  </Form.Item>
                </Col>
                <Col span={18}>
                  <Form.Item name="name" label="Name" rules={[{ required: true, message: "Enter the member's name." }]}>
                    <Input id="member-name" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="designation" label="Designation" rules={[{ required: true, message: "Enter the designation." }]}>
                <Input />
              </Form.Item>
              <Row gutter={10}>
                <Col span={14}>
                  <Form.Item name="nominatingBody" label="Nominating body" rules={[{ required: true, message: "Enter the nominating body." }]} extra="For example HEC, a provincial government, a university">
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={10}>
                  <Form.Item name="category" label="How they sit">
                    <Select options={Object.entries(CATEGORY).map(([value, label]) => ({ value, label }))} />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={10}>
                <Col span={8}>
                  <Form.Item name="province" label="Province">
                    <Select allowClear options={PROVINCES.map((x) => ({ value: x }))} />
                  </Form.Item>
                </Col>
                <Col span={9}>
                  <Form.Item name="email" label="Email">
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={7}>
                  <Form.Item name="mobile" label="Mobile">
                    <Input placeholder="0300-1234567" />
                  </Form.Item>
                </Col>
              </Row>
            </>
          ) : null}
          {dialog?.kind === "member" || dialog?.kind === "seat" ? (
            <Row gutter={10}>
              <Col span={10}>
                <Form.Item name="committee" label="Council or committee">
                  <Select options={committees.map((c) => ({ value: c }))} />
                </Form.Item>
              </Col>
              <Col span={14}>
                <Form.Item name="role" label="Role">
                  <Select options={Object.entries(ROLE).map(([value, label]) => ({ value, label }))} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="termStart" label="Term starts" rules={[{ required: true, message: "Pick the start of the term." }]}>
                  <DatePicker style={{ width: "100%" }} format="D MMM YYYY" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="termEnd" label="Term ends">
                  <DatePicker style={{ width: "100%" }} format="D MMM YYYY" />
                </Form.Item>
              </Col>
            </Row>
          ) : null}
          {dialog?.kind === "conflict" ? (
            <>
              <Form.Item name="institutionId" label="Institution" rules={[{ required: true, message: "Choose the institution." }]}>
                <Select showSearch optionFilterProp="label" className="conflict-member-institution" options={data.institutions.map((i) => ({ value: i.id, label: `${i.shortCode} · ${i.name}` }))} />
              </Form.Item>
              <Form.Item name="reason" label="Reason" rules={[{ required: true, min: 5, message: "Give the reason for the conflict." }]}>
                <Input.TextArea rows={2} placeholder="e.g. Visiting professor at the institution" />
              </Form.Item>
              <div className="faint" style={{ fontSize: 12.5 }}>The member is recused from every agenda item about this institution, and the recusal is recorded in the minutes.</div>
            </>
          ) : null}
          {dialog?.kind === "end" ? (
            <Form.Item name="reason" label="Why the seat ends" rules={[{ required: true, min: 5, message: "Say why the seat ends." }]}>
              <Input placeholder="Term completed, resigned, nomination withdrawn" />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </>
  );
}
