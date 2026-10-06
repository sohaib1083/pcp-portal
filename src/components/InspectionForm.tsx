"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Alert, App, Button, Card, Col, Input, Row, Segmented, Table, Upload } from "antd";
import { CameraOutlined, CloudSyncOutlined, SendOutlined, TeamOutlined } from "@ant-design/icons";
import { submitInspection } from "@/app/actions/pcp";
import type { ChecklistItem } from "@/db/schema";
import { PageTitle, Pill, StatusDot, fmtDate, programLabel } from "./common";
import { FillDemo } from "./demo-helpers";

type Result = "COMPLIANT" | "PARTIAL" | "NON_COMPLIANT" | "NA";
const RESULT_COLOR: Record<Result, string> = { COMPLIANT: "#12a150", PARTIAL: "#e8a20c", NON_COMPLIANT: "#d03b3b", NA: "#aab5b0" };

export default function InspectionForm(props: {
  inspectionId: number;
  status: string;
  criteria: string[];
  canSubmit: boolean;
  team: { name: string; province: string; lead: boolean }[];
  report: { checklist: ChecklistItem[]; summary: string | null } | null;
  context: { ref: string; program: string; inst: string; city: string; date: string; scope: string | null; declaredIntake: number; declaredLabs: number; declaredBooks: number; facultyOnRecord: number };
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [items, setItems] = useState(props.criteria.map((c) => ({ criterion: c, result: "COMPLIANT" as Result, remarks: "" })));
  const [summary, setSummary] = useState("");
  const c = props.context;
  const fillDemo = () => {
    setItems(items.map((x, i) => ({ ...x, result: "COMPLIANT", remarks: ["Verified on site", "Matches the declared inventory", "Seen and counted", "Records produced and checked"][i % 4] })));
    setSummary(`Adequate for an intake of ${c.declaredIntake || 60}; recommend approval.`);
  };

  const teamCard = (
    <Card size="small" style={{ marginBottom: 16 }} title={<span><TeamOutlined style={{ marginRight: 8, color: "#5b3cc4" }} />Team and scope</span>} data-testid="visit-team">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: c.scope ? 10 : 0 }}>
        {props.team.map((m) => (
          <StatusDot key={m.name} tone={m.lead ? "violet" : "neutral"}>
            {m.name} · {m.province} {m.lead ? "(lead)" : ""}
          </StatusDot>
        ))}
      </div>
      {c.scope ? <div style={{ fontSize: 13.5 }}><b>The institution was asked to prepare:</b> {c.scope}</div> : null}
    </Card>
  );
  const head = (
    <PageTitle
      eyebrow="On-site inspection"
      title={c.inst}
      sub={
        <span>
          {c.city} · {programLabel(c.program)} · <span className="mono">{c.ref}</span> · {fmtDate(c.date)}
        </span>
      }
      extra={props.canSubmit && props.status === "SCHEDULED" ? <FillDemo onClick={fillDemo} /> : <Link href={`/pcp/applications/${c.ref}`}><Button>Open the case</Button></Link>}
    />
  );
  if (props.status !== "SCHEDULED")
    return (
      <>
        {head}
        <Alert type="success" showIcon style={{ marginBottom: 16 }} title="This inspection report has been submitted by the team lead." />
        {teamCard}
        {props.report ? (
          <Card size="small" title="Report">
            <Table size="small" rowKey="criterion" pagination={false} dataSource={props.report.checklist} columns={[{ title: "Criterion", dataIndex: "criterion" }, { title: "Result", dataIndex: "result", render: (v) => <Pill value={v} /> }, { title: "Remarks", dataIndex: "remarks" }]} />
            <div style={{ marginTop: 10 }}><b>Summary:</b> {props.report.summary}</div>
          </Card>
        ) : null}
      </>
    );
  if (!props.canSubmit)
    return (
      <>
        {head}
        <Alert type="info" showIcon style={{ marginBottom: 16 }} title="You are a member of this inspection team" description={`The lead, ${props.team.find((m) => m.lead)?.name ?? "the team lead"}, fills in and submits the checklist. Record your observations with the lead on site.`} />
        {teamCard}
      </>
    );
  const done = items.filter((x) => x.result !== "NA" || x.remarks).length;


  return (
    <>
      {head}
      {teamCard}
      <Alert
        type="info"
        showIcon
        icon={<CloudSyncOutlined />}
        style={{ marginBottom: 16 }}
        title="Designed for a tablet on site"
        description="In production this runs in ODK Collect: it works offline, keeps data encrypted on the device, geotags photos and syncs when the connection returns."
      />
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {[
          ["Proposed intake", c.declaredIntake],
          ["Laboratories declared", c.declaredLabs],
          ["Library books declared", c.declaredBooks],
          ["Faculty on record", c.facultyOnRecord],
        ].map(([l, v]) => (
          <Col key={String(l)} xs={12} md={6}>
            <div className="pcp-stat" style={{ display: "block" }}>
              <div className="pcp-stat-label">{l}</div>
              <div className="pcp-stat-value tnum">{v}</div>
            </div>
          </Col>
        ))}
      </Row>
      {items.map((it, i) => (
        <Card key={it.criterion} size="small" style={{ marginBottom: 10, borderLeft: `4px solid ${RESULT_COLOR[it.result]}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            <b>
              {i + 1}. {it.criterion}
            </b>
            <Segmented
              value={it.result}
              onChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, result: v as Result } : x)))}
              options={[
                { value: "COMPLIANT", label: "Compliant" },
                { value: "PARTIAL", label: "Partial" },
                { value: "NON_COMPLIANT", label: "Non-compliant" },
                { value: "NA", label: "N/A" },
              ]}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Input placeholder="Remarks" value={it.remarks} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, remarks: e.target.value } : x)))} />
            <Upload
              beforeUpload={() => {
                message.info("Photo attached (demo: kept on the device)");
                return false;
              }}
              showUploadList={false}
              accept="image/*"
            >
              <Button icon={<CameraOutlined />}>Photo</Button>
            </Upload>
          </div>
        </Card>
      ))}
      <Card title="Summary and recommendation" style={{ marginTop: 16 }}>
        <Input.TextArea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Overall finding and recommendation to PCP" />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {done} of {items.length} criteria recorded. Submitting files an inspection report PDF in the institution&apos;s folder and notifies the officer.
          </span>
          <Button
            type="primary"
            size="large"
            icon={<SendOutlined />}
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await submitInspection(props.inspectionId, { items, summary });
                message[r.ok ? "success" : "error"](r.message);
                if (r.ok) router.push(`/pcp/applications/${c.ref}`);
              })
            }
          >
            Submit inspection report
          </Button>
        </div>
      </Card>
    </>
  );
}
