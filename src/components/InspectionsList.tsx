"use client";
import Link from "next/link";
import { Button, Card, Empty, Table } from "antd";
import { CalendarOutlined, EnvironmentOutlined, StopOutlined } from "@ant-design/icons";
import { PageTitle, Pill, fmtDate, programLabel } from "./common";

type Row = { id: number; inspector: string; inspectorName: string; scheduledFor: string; status: string; ref: string; appStatus: string; programType: string; instName: string; city: string; province: string; mine: boolean };

export default function InspectionsList({ rows, isCoordinator, awaiting }: { rows: Row[]; isCoordinator: boolean; awaiting: { ref: string; instName: string; province: string; programType: string }[] }) {
  const upcoming = rows.filter((r) => r.mine && r.status === "SCHEDULED");
  return (
    <>
      <PageTitle
        eyebrow="Casework"
        title="Inspections"
        sub={isCoordinator ? "Plan inspections. The system blocks a member from inspecting an institution in their own province." : "Only the inspections assigned to you. The checklist is built for a tablet on site."}
      />
      {!isCoordinator ? (
        <Card style={{ marginBottom: 18 }} title="Your next visits">
          {upcoming.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No inspections waiting for you." />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
              {upcoming.map((r) => (
                <div key={r.id} style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 16, borderTop: "3px solid #5b3cc4" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#5b3cc4", fontWeight: 600, fontSize: 13 }}>
                    <CalendarOutlined /> {fmtDate(r.scheduledFor)}
                  </div>
                  <div style={{ fontWeight: 650, fontSize: 15, marginTop: 6 }}>{r.instName}</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    <EnvironmentOutlined /> {r.city}, {r.province} · {programLabel(r.programType)}
                  </div>
                  <div className="mono faint" style={{ marginTop: 4 }}>{r.ref}</div>
                  <Link href={`/pcp/inspections/${r.id}`}>
                    <Button type="primary" block style={{ marginTop: 12 }}>
                      Open checklist
                    </Button>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}
      {isCoordinator && awaiting.length ? (
        <Card title="Awaiting an inspection schedule" style={{ marginBottom: 18, borderColor: "#ffd591" }} styles={{ body: { padding: 0 } }}>
          <Table
            rowKey="ref"
            pagination={false}
            dataSource={awaiting}
            columns={[
              { title: "Application", dataIndex: "ref", render: (v) => <Link href={`/pcp/applications/${v}`} className="mono" style={{ fontWeight: 600 }}>{v}</Link> },
              { title: "Institution", dataIndex: "instName" },
              { title: "Province", dataIndex: "province", render: (v) => <span>{v} <span className="faint" style={{ fontSize: 12 }}><StopOutlined /> {v} inspectors excluded</span></span> },
              { title: "Program", dataIndex: "programType", render: programLabel },
              { title: "", align: "right", render: (_, r) => <Link href={`/pcp/applications/${r.ref}`}><Button size="small" type="primary">Schedule</Button></Link> },
            ]}
          />
        </Card>
      ) : null}
      <Card title={isCoordinator ? "All inspections" : "History"} styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          dataSource={rows}
          pagination={false}
          locale={{ emptyText: "No inspections yet" }}
          columns={[
            { title: "Date", dataIndex: "scheduledFor", render: (v) => fmtDate(v) },
            { title: "Application", dataIndex: "ref", render: (v) => <Link href={`/pcp/applications/${v}`} className="mono" style={{ fontWeight: 600 }}>{v}</Link> },
            { title: "Institution", render: (_, r) => <span>{r.instName}<div className="faint" style={{ fontSize: 12 }}>{r.city}, {r.province}</div></span> },
            { title: "Program", dataIndex: "programType", render: programLabel },
            { title: "Inspector", dataIndex: "inspectorName" },
            { title: "Status", dataIndex: "status", render: (v) => <Pill value={v} /> },
            {
              title: "",
              align: "right",
              render: (_, r) =>
                r.mine && r.status === "SCHEDULED" ? (
                  <Link href={`/pcp/inspections/${r.id}`}>
                    <Button type="primary" size="small">Open checklist</Button>
                  </Link>
                ) : null,
            },
          ]}
        />
      </Card>
    </>
  );
}
