"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Card, Col, DatePicker, Empty, Form, Input, Modal, Row, Segmented, Select, Table, Tabs, Tag } from "antd";
import { CalendarOutlined, CheckSquareOutlined, FileDoneOutlined, PlusOutlined, ScheduleOutlined, SolutionOutlined, TeamOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { createMeeting } from "@/app/actions/council";
import { PageTitle, StatCard, fmtDate, timeAgo } from "./common";
import { DocLink, ModuleStatus } from "./CouncilParts";
import { TaskStatus, relDays } from "./GovParts";
import ScreenGuide from "./ScreenGuide";

type Overview = {
  meetings: { ref: string; committee: string; title: string; date: string; status: string; items: number; cases: number; appeals: number; others: number; decided: number; actions: number; actionsOpen: number; minutesDocumentId: number | null }[];
  next: { ref: string; date: string; status: string; title: string } | null;
  ready: { kind: "case" | "appeal"; ref: string; label: string; inst: string; since: string }[];
  decisionsThisYear: number;
};
type Committee = { name: string; prefix: string; chairName: string | null; memberNames: string[]; remit: string; decides: boolean };
type OpenAction = { id: number; title: string; owner: string; dueDate: string; days: number; status: string; meetingRef: string; committee: string };

const COUNCIL = "Council";
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export default function CouncilMeetings({
  data,
  committees,
  actions,
  canManage,
  tab = "meetings",
  members,
}: {
  data: Overview;
  committees: Committee[];
  actions: OpenAction[];
  canManage: boolean;
  tab?: "meetings" | "members";
  /** The members register (Annexure-III "Members Ledger"), rendered in its own tab. */
  members?: React.ReactNode;
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [pending, start] = useTransition();
  const [form] = Form.useForm();
  const chosen = (Form.useWatch("committee", form) as string | undefined) ?? COUNCIL;
  const year = new Date().getFullYear();
  const titleFor = (committee: string) => {
    const n = data.meetings.filter((m) => m.committee === committee && m.date.startsWith(String(year))).length + 1;
    return committee === COUNCIL ? `Council meeting ${n} of ${year}` : `${committee} meeting ${n} of ${year}`;
  };
  const rows = useMemo(() => data.meetings.filter((m) => filter === "all" || m.committee === filter), [data.meetings, filter]);
  const overdue = actions.filter((a) => a.days < 0).length;
  const today = new Date().toISOString().slice(0, 10);

  const create = (v: { title: string; date: dayjs.Dayjs; committee: string }) =>
    start(async () => {
      const r = await createMeeting({ title: v.title, date: v.date?.format("YYYY-MM-DD"), committee: v.committee });
      message[r.ok ? "success" : "error"](r.message, r.ok ? 3 : 6);
      if (r.ok && r.ref) {
        setOpen(false);
        router.push(`/pcp/council/${r.ref}`);
      }
    });

  return (
    <>
      <PageTitle
        eyebrow="Casework"
        title="Council and committee meetings"
        sub="The council decides cases that are ready and hears appeals. Committees review cases, appeals, court cases and letters and recommend to the council. Action points from any meeting become tracked tasks."
        extra={
          <>
            <ScreenGuide
              title="Council and committee meetings"
              intro="Cases reach the council when an officer forwards them with a recommendation. Appeals reach it when an officer places them on the agenda. Committees take any item the Secretary adds."
              steps={[
                "**New meeting** creates a meeting of the Council or of a committee, with its reference (CM-year-number for the Council, the committee's own prefix otherwise) and date. Committee members are notified.",
                "On a council meeting, **Build agenda from ready cases** adds every case awaiting a decision and every appeal ready for council. **Add agenda item** adds a case, appeal, court case, letter or other matter to any meeting.",
                "In session, the council records each decision with a one-time code. A committee records a **recommendation** on each item; it does not decide.",
                "**Add action point** records a task with an owner and a due date. It goes on the owner's work list, with reminders before it is due and when it is overdue.",
                "**Close meeting and file minutes** generates the minutes PDF with decisions or recommendations and the action points.",
              ]}
              note={canManage ? undefined : "Only the Secretary manages meetings. You can read the agendas and minutes, and update action points you own."}
            />
            {canManage && tab === "meetings" ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
                New meeting
              </Button>
            ) : null}
          </>
        }
      />
      <Tabs
        activeKey={tab}
        onChange={(k) => router.push(k === "members" ? "/pcp/council?tab=members" : "/pcp/council")}
        items={[
          { key: "meetings", label: "Meetings" },
          { key: "members", label: <span data-testid="tab-members">Members</span> },
        ]}
        style={{ marginBottom: 4 }}
      />
      {tab === "members" ? members : null}
      {tab === "meetings" ? (
        <>
          <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
            <Col xs={12} lg={6}>
              {data.next ? (
                <Link href={`/pcp/council/${data.next.ref}`}>
                  <StatCard clickable label="Next council meeting" icon={<CalendarOutlined />} value={fmtDate(data.next.date)} hint={`${data.next.ref} · ${data.next.status === "IN_SESSION" ? "in session" : "planned"}`} />
                </Link>
              ) : (
                <StatCard label="Next council meeting" icon={<CalendarOutlined />} value="None planned" hint={canManage ? "Create one with New meeting" : "The Secretary plans meetings"} />
              )}
            </Col>
            <Col xs={12} lg={6}>
              <StatCard label="Cases to schedule" icon={<SolutionOutlined />} tone={data.ready.some((r) => r.kind === "case") ? "warn" : "brand"} value={data.ready.filter((r) => r.kind === "case").length} hint="Awaiting a decision, not on an agenda" />
            </Col>
            <Col xs={12} lg={6}>
              <StatCard label="Appeals to schedule" icon={<ScheduleOutlined />} tone="violet" value={data.ready.filter((r) => r.kind === "appeal").length} hint={`Ready for council · ${data.decisionsThisYear} decisions this year`} />
            </Col>
            <Col xs={12} lg={6}>
              <StatCard label="Open action points" icon={<CheckSquareOutlined />} tone={overdue ? "bad" : "info"} value={actions.length} hint={overdue ? `${overdue} overdue` : "From council and committee meetings"} />
            </Col>
          </Row>

          {data.ready.length ? (
            <Card size="small" title="Ready for council, not on an agenda yet" style={{ marginBottom: 16 }} extra={<span className="faint" style={{ fontSize: 12 }}>{canManage ? "Open a planned council meeting and build its agenda" : "The Secretary adds these when building the next agenda"}</span>}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {data.ready.map((r) => (
                  <Link key={r.ref} href={r.kind === "case" ? `/pcp/applications/${r.ref}` : `/pcp/appeals/${r.ref}`} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "8px 12px", background: "#fff", display: "inline-flex", flexDirection: "column", minWidth: 200 }}>
                    <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>
                      {r.ref}
                    </span>
                    <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                      {r.inst} · {r.label}
                    </span>
                    <span className="faint" style={{ fontSize: 11.5 }}>
                      Ready {timeAgo(r.since)}
                    </span>
                  </Link>
                ))}
              </div>
            </Card>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10, marginBottom: 16 }} data-testid="committees">
            {committees.map((c) => {
              const next = data.meetings.filter((m) => m.committee === c.name && m.status !== "CLOSED" && m.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
              const active = filter === c.name;
              return (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => setFilter(active ? "all" : c.name)}
                  title={c.remit}
                  style={{ textAlign: "left", cursor: "pointer", border: `1px solid ${active ? "var(--brand)" : "var(--line)"}`, boxShadow: active ? "0 0 0 3px #e8f3ee" : undefined, borderRadius: 12, padding: "10px 12px", background: "#fff", display: "grid", gap: 2, font: "inherit" }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 13.5 }}>
                    <TeamOutlined style={{ color: c.decides ? "var(--brand)" : "#5b3cc4" }} /> {c.name}
                  </span>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {c.decides ? `Decides · run by the Secretary${c.chairName ? `, ${c.chairName}` : ""}` : `Recommends · ${plural(c.memberNames.length, "member")}${c.chairName ? ` · chair ${c.chairName}` : ""}`}
                  </span>
                  <span style={{ fontSize: 12, color: next ? "var(--ink-2)" : "var(--faint)" }}>{next ? `Next: ${next.ref}, ${fmtDate(next.date)}` : "No meeting planned"}</span>
                </button>
              );
            })}
          </div>

          <Card
            styles={{ body: { padding: 0 } }}
            title={
              <div style={{ padding: "8px 0" }}>
                <Segmented value={filter} onChange={(v) => setFilter(String(v))} options={[{ value: "all", label: "All meetings" }, ...committees.map((c) => ({ value: c.name, label: c.name === COUNCIL ? "Council" : c.name.replace(" Committee", "") }))]} />
              </div>
            }
          >
            <Table
              rowKey="ref"
              dataSource={rows}
              pagination={{ pageSize: 15, hideOnSinglePage: true }}
              locale={{ emptyText: <Empty description={canManage ? "No meetings yet. Create the first one with New meeting." : "No meetings yet."} /> }}
              columns={[
                {
                  title: "Meeting",
                  dataIndex: "ref",
                  render: (v, r) => (
                    <Link href={`/pcp/council/${v}`} style={{ display: "inline-flex", flexDirection: "column" }}>
                      <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>
                        {v}
                      </span>
                      <span style={{ color: "var(--ink-2)", fontSize: 12.5 }}>{r.title}</span>
                    </Link>
                  ),
                },
                { title: "Committee", dataIndex: "committee", render: (v) => <Tag color={v === COUNCIL ? "green" : "purple"} style={{ margin: 0 }}>{v}</Tag> },
                { title: "Date", dataIndex: "date", render: (v) => <span style={{ whiteSpace: "nowrap" }}>{fmtDate(v)}</span>, sorter: (a, b) => a.date.localeCompare(b.date) },
                { title: "Status", dataIndex: "status", render: (v) => <ModuleStatus status={v} /> },
                {
                  title: "Agenda",
                  render: (_, r) =>
                    r.items ? (
                      <span>
                        {[r.cases ? plural(r.cases, "case") : "", r.appeals ? plural(r.appeals, "appeal") : "", r.others ? plural(r.others, "other item") : ""].filter(Boolean).join(", ")}
                      </span>
                    ) : (
                      <span className="faint">Empty</span>
                    ),
                },
                {
                  title: "Done",
                  align: "right",
                  render: (_, r) => (
                    <span className="tnum" title={r.committee === COUNCIL ? "Decided or noted" : "Recommendations recorded"} style={{ fontWeight: 600, color: r.items && r.decided === r.items ? "var(--good)" : "var(--ink)" }}>
                      {r.decided} / {r.items}
                    </span>
                  ),
                },
                { title: "Action points", align: "right", render: (_, r) => (r.actions ? <span className="tnum">{r.actionsOpen ? `${r.actionsOpen} open of ${r.actions}` : `${r.actions} done`}</span> : <span className="faint">—</span>) },
                { title: "Minutes", render: (_, r) => (r.minutesDocumentId ? <DocLink id={r.minutesDocumentId} label="Minutes (PDF)" /> : <span className="faint">{r.status === "CLOSED" ? "—" : "After closing"}</span>) },
              ]}
            />
          </Card>

          {actions.length ? (
            <Card size="small" title={<span><CheckSquareOutlined style={{ color: "var(--brand)", marginRight: 8 }} />Open action points</span>} style={{ marginTop: 16 }} styles={{ body: { padding: 0 } }} data-testid="open-actions">
              <Table
                size="small"
                rowKey="id"
                pagination={{ pageSize: 8, hideOnSinglePage: true }}
                dataSource={actions}
                columns={[
                  { title: "Action point", dataIndex: "title" },
                  { title: "Meeting", render: (_, a) => <Link href={`/pcp/council/${a.meetingRef}#actions`} className="mono">{a.meetingRef}</Link> },
                  { title: "Owner", dataIndex: "owner" },
                  { title: "Due", render: (_, a) => <span style={{ color: a.days < 0 ? "#b4141f" : undefined }}>{fmtDate(a.dueDate)} <span className="faint">· {relDays(a.days)}</span></span> },
                  { title: "Status", render: (_, a) => <TaskStatus status={a.status} overdue={a.days < 0} /> },
                ]}
              />
            </Card>
          ) : null}
        </>
      ) : null}

      <Modal
        open={open}
        title={
          <span>
            <FileDoneOutlined style={{ color: "var(--brand)", marginRight: 8 }} />
            New meeting
          </span>
        }
        okText="Create meeting"
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={pending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false} onFinish={create} initialValues={{ committee: filter !== "all" ? filter : COUNCIL, title: titleFor(filter !== "all" ? filter : COUNCIL), date: dayjs().add(14, "day") }}>
          <Form.Item name="committee" label="Council or committee" extra={committees.find((c) => c.name === chosen)?.remit}>
            <Select id="meeting-committee" options={committees.map((c) => ({ value: c.name, label: c.name }))} onChange={(v: string) => form.setFieldsValue({ title: titleFor(v) })} />
          </Form.Item>
          <Form.Item name="title" label="Title" rules={[{ required: true, message: "Give the meeting a title." }]}>
            <Input id="meeting-title" />
          </Form.Item>
          <Form.Item name="date" label="Meeting date" rules={[{ required: true, message: "Pick the meeting date." }]} extra="The reference is assigned when you create the meeting.">
            <DatePicker id="meeting-date" style={{ width: "100%" }} disabledDate={(d) => d.isBefore(dayjs().startOf("day"))} format="D MMM YYYY" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
