"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Empty, Input, Select, Space, Table, Tag } from "antd";
import { CalendarOutlined, CloseOutlined, EnvironmentOutlined, FilterOutlined, StopOutlined, TeamOutlined } from "@ant-design/icons";
import { declareConflict, withdrawConflict } from "@/app/actions/pcp";
import { PageTitle, Pill, StatusDot, fmtDate, kindLabel, programLabel } from "./common";
import { FillDemo } from "./demo-helpers";

type Row = {
  id: number;
  inspector: string;
  inspectorName: string;
  scheduledFor: string;
  status: string;
  scope: string | null;
  ref: string;
  appStatus: string;
  programType: string;
  kind: string;
  instName: string;
  city: string;
  province: string;
  team: { username: string; name: string; role: string }[];
  myRole: string | null;
  mine: boolean;
};
type Declaration = { id: number; username: string; name: string; institution: string; reason: string; active: boolean; createdAt: string };

function ConflictForm({ isCoordinator, username, inspectors, institutions }: { isCoordinator: boolean; username: string; inspectors: { username: string; name: string; province: string }[]; institutions: { id: number; name: string; shortCode: string; province: string }[] }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [member, setMember] = useState<string | undefined>(isCoordinator ? undefined : username);
  const [inst, setInst] = useState<number>();
  const [reason, setReason] = useState("");
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }} className="conflict-form">
      {isCoordinator ? (
        <Select className="conflict-member" style={{ flex: "1 1 200px" }} placeholder="Panel member" value={member} onChange={setMember} options={inspectors.map((i) => ({ value: i.username, label: `${i.name} · ${i.province}` }))} />
      ) : null}
      <Select className="conflict-institution" style={{ flex: "1 1 240px" }} showSearch={{ optionFilterProp: "label" }} placeholder="Institution" value={inst} onChange={setInst} options={institutions.map((i) => ({ value: i.id, label: `${i.name} (${i.shortCode})` }))} />
      <Input className="conflict-reason" style={{ flex: "2 1 260px" }} placeholder="Reason, e.g. close relative on the faculty" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Space style={{ flex: "none" }}>
        <FillDemo onClick={() => setReason("Close relative on the institution's faculty")} />
        <Button
          type="primary"
          loading={pending}
          disabled={!member || !inst || reason.trim().length < 5}
          onClick={() =>
            start(async () => {
              const r = await declareConflict({ username: member, institutionId: inst, reason });
              message[r.ok ? "success" : "error"](r.message);
              if (r.ok) {
                setReason("");
                router.refresh();
              }
            })
          }
        >
          Record conflict
        </Button>
      </Space>
    </div>
  );
}

export default function InspectionsList({
  rows,
  isCoordinator,
  isInspector,
  username,
  month,
  awaiting,
  inspectors,
  institutions,
  declarations,
}: {
  rows: Row[];
  isCoordinator: boolean;
  isInspector: boolean;
  username: string;
  month: string | null;
  awaiting: { ref: string; instName: string; province: string; programType: string; kind: string }[];
  inspectors: { username: string; name: string; province: string }[];
  institutions: { id: number; name: string; shortCode: string; province: string }[];
  declarations: Declaration[];
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const upcoming = rows.filter((r) => r.mine && r.status === "SCHEDULED");
  const monthName = month ? new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : null;
  return (
    <>
      <PageTitle
        eyebrow="Casework"
        title={monthName ? `Inspections in ${monthName}` : "Inspections"}
        sub={
          isCoordinator
            ? "Assign teams. Every member passes the conflict check: no inspection in their own province, none where they declared a conflict."
            : "The visits you are on. The team lead submits the checklist; members see the visit and its scope."
        }
      />
      {month ? (
        <Alert type="info" showIcon icon={<FilterOutlined />} style={{ marginBottom: 14 }} title={`Showing inspections scheduled in ${monthName}`} action={<Link href="/pcp/inspections"><Button size="small" icon={<CloseOutlined />}>Clear filter</Button></Link>} />
      ) : null}
      {isInspector ? (
        <Card style={{ marginBottom: 18 }} title="Your next visits">
          {upcoming.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No inspections waiting for you." />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
              {upcoming.map((r) => (
                <div key={r.id} style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 16, borderTop: "3px solid #5b3cc4" }} data-testid={`visit-${r.ref}`}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, color: "#5b3cc4", fontWeight: 600, fontSize: 13 }}>
                    <span><CalendarOutlined /> {fmtDate(r.scheduledFor)}</span>
                    <Tag color={r.myRole === "LEAD" ? "purple" : "default"}>{r.myRole === "LEAD" ? "Team lead" : "Team member"}</Tag>
                  </div>
                  <div style={{ fontWeight: 650, fontSize: 15, marginTop: 6 }}>{r.instName}</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    <EnvironmentOutlined /> {r.city}, {r.province} · {kindLabel(r.kind)} · {programLabel(r.programType)}
                  </div>
                  <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>
                    <TeamOutlined /> {r.team.map((m) => m.name).join(", ")}
                  </div>
                  <div className="mono faint" style={{ marginTop: 4 }}>{r.ref}</div>
                  <Link href={`/pcp/inspections/${r.id}`}>
                    <Button type={r.myRole === "LEAD" ? "primary" : "default"} block style={{ marginTop: 12 }}>
                      {r.myRole === "LEAD" ? "Open checklist" : "Open visit"}
                    </Button>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}
      {isCoordinator && awaiting.length ? (
        <Card title="Ready for an inspection team" style={{ marginBottom: 18, borderColor: "#ffd591" }} styles={{ body: { padding: 0 } }}>
          <Table
            rowKey="ref"
            pagination={false}
            dataSource={awaiting}
            columns={[
              { title: "Application", dataIndex: "ref", render: (v) => <Link href={`/pcp/applications/${v}`} className="mono" style={{ fontWeight: 600 }}>{v}</Link> },
              { title: "Institution", dataIndex: "instName" },
              { title: "Province", dataIndex: "province", render: (v) => <span>{v} <span className="faint" style={{ fontSize: 12 }}><StopOutlined /> {v} members excluded</span></span> },
              { title: "Type", render: (_, r) => `${kindLabel(r.kind)} · ${programLabel(r.programType)}` },
              { title: "", align: "right", render: (_, r) => <Link href={`/pcp/applications/${r.ref}`}><Button size="small" type="primary">Assign team</Button></Link> },
            ]}
          />
        </Card>
      ) : null}
      <Card title={isCoordinator ? "All inspections" : "Your visits"} styles={{ body: { padding: 0 } }} style={{ marginBottom: 18 }}>
        <Table
          rowKey="id"
          dataSource={rows}
          pagination={false}
          locale={{ emptyText: month ? "No inspections that month" : "No inspections yet" }}
          columns={[
            { title: "Date", dataIndex: "scheduledFor", render: (v) => fmtDate(v) },
            { title: "Application", dataIndex: "ref", render: (v) => <Link href={`/pcp/applications/${v}`} className="mono" style={{ fontWeight: 600 }}>{v}</Link> },
            { title: "Institution", render: (_, r) => <span>{r.instName}<div className="faint" style={{ fontSize: 12 }}>{r.city}, {r.province}</div></span> },
            { title: "Type", render: (_, r) => `${kindLabel(r.kind)} · ${programLabel(r.programType)}` },
            {
              title: "Team",
              render: (_, r) => (
                <span style={{ fontSize: 12.5 }}>
                  {r.team.map((m) => (
                    <div key={m.username}>
                      {m.name}
                      {m.role === "LEAD" ? <span className="faint"> (lead)</span> : null}
                    </div>
                  ))}
                </span>
              ),
            },
            { title: "Status", dataIndex: "status", render: (v) => <Pill value={v} /> },
            {
              title: "",
              align: "right",
              render: (_, r) =>
                r.mine && r.status === "SCHEDULED" ? (
                  <Link href={`/pcp/inspections/${r.id}`}>
                    <Button type={r.myRole === "LEAD" ? "primary" : "default"} size="small">
                      {r.myRole === "LEAD" ? "Open checklist" : "Open visit"}
                    </Button>
                  </Link>
                ) : null,
            },
          ]}
        />
      </Card>
      {isCoordinator || isInspector ? (
        <Card
          title={
            <span>
              <StopOutlined style={{ color: "#b4141f", marginRight: 8 }} />
              Declared conflicts of interest
            </span>
          }
          extra={<span className="muted" style={{ fontSize: 12.5 }}>Checked with the same-province rule whenever a team is assigned</span>}
          data-testid="conflicts"
        >
          <ConflictForm isCoordinator={isCoordinator} username={username} inspectors={inspectors} institutions={institutions} />
          <Table
            style={{ marginTop: 14 }}
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={declarations}
            locale={{ emptyText: "No conflicts declared" }}
            columns={[
              { title: "Member", dataIndex: "name" },
              { title: "Institution", dataIndex: "institution" },
              { title: "Reason", dataIndex: "reason" },
              { title: "Recorded", dataIndex: "createdAt", render: (v) => fmtDate(v) },
              { title: "Status", dataIndex: "active", render: (v) => <StatusDot tone={v ? "bad" : "neutral"}>{v ? "Active" : "Withdrawn"}</StatusDot> },
              {
                title: "",
                align: "right",
                render: (_, r) =>
                  r.active && (isCoordinator || r.username === username) ? (
                    <Button
                      size="small"
                      loading={pending}
                      onClick={() =>
                        start(async () => {
                          const x = await withdrawConflict(r.id);
                          message[x.ok ? "success" : "error"](x.message);
                          router.refresh();
                        })
                      }
                    >
                      Withdraw
                    </Button>
                  ) : null,
              },
            ]}
          />
        </Card>
      ) : null}
    </>
  );
}
