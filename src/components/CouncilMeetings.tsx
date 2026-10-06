"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Card, Col, DatePicker, Empty, Form, Input, Modal, Row, Table } from "antd";
import { CalendarOutlined, CheckCircleOutlined, FileDoneOutlined, PlusOutlined, ScheduleOutlined, SolutionOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { createMeeting } from "@/app/actions/council";
import { PageTitle, StatCard, fmtDate, timeAgo } from "./common";
import { DocLink, ModuleStatus } from "./CouncilParts";
import ScreenGuide from "./ScreenGuide";

type Overview = {
  meetings: { ref: string; title: string; date: string; status: string; items: number; cases: number; appeals: number; decided: number; minutesDocumentId: number | null }[];
  next: { ref: string; date: string; status: string; title: string } | null;
  ready: { kind: "case" | "appeal"; ref: string; label: string; inst: string; since: string }[];
  decisionsThisYear: number;
};

export default function CouncilMeetings({ data, canManage }: { data: Overview; canManage: boolean }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [form] = Form.useForm();
  const n = data.meetings.filter((m) => m.date.startsWith(String(new Date().getFullYear()))).length + 1;

  const create = (v: { title: string; date: dayjs.Dayjs }) =>
    start(async () => {
      const r = await createMeeting({ title: v.title, date: v.date?.format("YYYY-MM-DD") });
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
        title="Council meetings"
        sub="The council decides cases that are ready and hears appeals. The Secretary builds each agenda from ready cases, records the decisions in session and files the minutes."
        extra={
          <>
            <ScreenGuide
              title="Council meetings"
              intro="Cases reach the council when an officer forwards them with a recommendation. Appeals reach it when an officer places them on the agenda."
              steps={[
                "**New meeting** creates a meeting with its reference (CM-year-number) and date.",
                "On the meeting, **Build agenda from ready cases** adds every case awaiting a council decision and every appeal ready for council, with the case file, inspection report and recommendation.",
                "Set a **draft decision** for each item before the meeting, then **Start session**.",
                "Record each decision. Every decision needs a one-time code; a deferral needs a reason and a return date, a rejection its grounds.",
                "**Close meeting and file minutes** generates the minutes as a PDF. Items not decided are carried forward.",
              ]}
              note={canManage ? undefined : "Only the Secretary manages meetings. You can read the agenda, recommendations and minutes."}
            />
            {canManage ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
                New meeting
              </Button>
            ) : null}
          </>
        }
      />
      <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
        <Col xs={12} lg={6}>
          {data.next ? (
            <Link href={`/pcp/council/${data.next.ref}`}>
              <StatCard clickable label="Next meeting" icon={<CalendarOutlined />} value={fmtDate(data.next.date)} hint={`${data.next.ref} · ${data.next.status === "IN_SESSION" ? "in session" : "planned"}`} />
            </Link>
          ) : (
            <StatCard label="Next meeting" icon={<CalendarOutlined />} value="None planned" hint={canManage ? "Create one with New meeting" : "The Secretary plans meetings"} />
          )}
        </Col>
        <Col xs={12} lg={6}>
          <StatCard label="Cases to schedule" icon={<SolutionOutlined />} tone={data.ready.some((r) => r.kind === "case") ? "warn" : "brand"} value={data.ready.filter((r) => r.kind === "case").length} hint="Awaiting a decision, not on an agenda" />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard label="Appeals to schedule" icon={<ScheduleOutlined />} tone="violet" value={data.ready.filter((r) => r.kind === "appeal").length} hint="Ready for council, not on an agenda" />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard label="Decisions this year" icon={<CheckCircleOutlined />} tone="info" value={data.decisionsThisYear} hint="Recorded in council meetings" />
        </Col>
      </Row>

      {data.ready.length ? (
        <Card size="small" title="Ready for council, not on an agenda yet" style={{ marginBottom: 16 }} extra={<span className="faint" style={{ fontSize: 12 }}>{canManage ? "Open a planned meeting and build its agenda" : "The Secretary adds these when building the next agenda"}</span>}>
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

      <Card styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="ref"
          dataSource={data.meetings}
          pagination={{ pageSize: 15, hideOnSinglePage: true }}
          locale={{ emptyText: <Empty description={canManage ? "No meetings yet. Create the first one with New meeting." : "No council meetings yet."} /> }}
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
            { title: "Date", dataIndex: "date", render: (v) => fmtDate(v), sorter: (a, b) => a.date.localeCompare(b.date) },
            { title: "Status", dataIndex: "status", render: (v) => <ModuleStatus status={v} /> },
            {
              title: "Agenda",
              render: (_, r) =>
                r.items ? (
                  <span>
                    {r.cases} case{r.cases === 1 ? "" : "s"}
                    {r.appeals ? `, ${r.appeals} appeal${r.appeals === 1 ? "" : "s"}` : ""}
                  </span>
                ) : (
                  <span className="faint">Empty</span>
                ),
            },
            {
              title: "Decided",
              align: "right",
              render: (_, r) => (
                <span className="tnum" style={{ fontWeight: 600, color: r.items && r.decided === r.items ? "var(--good)" : "var(--ink)" }}>
                  {r.decided} / {r.items}
                </span>
              ),
            },
            { title: "Minutes", render: (_, r) => (r.minutesDocumentId ? <DocLink id={r.minutesDocumentId} label="Minutes (PDF)" /> : <span className="faint">{r.status === "CLOSED" ? "—" : "After closing"}</span>) },
          ]}
        />
      </Card>

      <Modal
        open={open}
        title={
          <span>
            <FileDoneOutlined style={{ color: "var(--brand)", marginRight: 8 }} />
            New council meeting
          </span>
        }
        okText="Create meeting"
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={pending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false} onFinish={create} initialValues={{ title: `Council meeting ${n} of ${new Date().getFullYear()}`, date: dayjs().add(14, "day") }}>
          <Form.Item name="title" label="Title" rules={[{ required: true, message: "Give the meeting a title." }]}>
            <Input id="meeting-title" />
          </Form.Item>
          <Form.Item name="date" label="Meeting date" rules={[{ required: true, message: "Pick the meeting date." }]} extra="The reference (CM-year-number) is assigned when you create the meeting.">
            <DatePicker id="meeting-date" style={{ width: "100%" }} disabledDate={(d) => d.isBefore(dayjs().startOf("day"))} format="D MMM YYYY" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
