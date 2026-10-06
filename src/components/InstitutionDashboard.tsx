"use client";
import Link from "next/link";
import { Alert, Button, Card, Col, Empty, Progress, Row, Table } from "antd";
import {
  AlertOutlined,
  BookOutlined,
  ExclamationCircleFilled,
  FileProtectOutlined,
  InfoCircleFilled,
  PlusOutlined,
  RightOutlined,
  SolutionOutlined,
  TeamOutlined,
  WarningFilled,
} from "@ant-design/icons";
import { PageTitle, Pill, StatCard, StatusTag, fmtDate, kindLabel, programLabel, timeAgo } from "./common";
import { daysUntil } from "@/lib/format";

type Program = { type: string; nocStatus: string; nocNumber: string | null; accreditationStatus: string; validUntil: string | null; intake: number; students: number; faculty: number };

const LEVEL = {
  error: { icon: <ExclamationCircleFilled />, c: "#b4141f", bg: "#fff1f0" },
  warning: { icon: <WarningFilled />, c: "#a15c00", bg: "#fff7e6" },
  info: { icon: <InfoCircleFilled />, c: "#1d5fb0", bg: "#eaf2fc" },
};

function ProgramCard({ p }: { p: Program }) {
  const d = daysUntil(p.validUntil);
  // Accreditation runs 5 years; show how much of the current term is left.
  const left = d !== null ? Math.max(0, Math.min(100, Math.round((d / (5 * 365)) * 100))) : 0;
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 16, height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 650, fontSize: 15 }}>{programLabel(p.type)}</div>
          <div className="faint mono" style={{ marginTop: 2 }}>
            {p.nocNumber ?? "No NOC yet"}
          </div>
        </div>
        <Pill value={p.nocStatus} label={p.nocStatus === "APPROVED" ? "NOC approved" : p.nocStatus === "NONE" ? "No NOC" : undefined} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, margin: "16px 0" }}>
        {[
          ["Students", p.students],
          ["Faculty", p.faculty],
          ["Approved intake", p.intake || "—"],
        ].map(([l, v]) => (
          <div key={String(l)} style={{ background: "var(--bg)", borderRadius: 10, padding: "10px 12px" }}>
            <div className="faint" style={{ fontSize: 11.5 }}>
              {l}
            </div>
            <div className="tnum" style={{ fontSize: 20, fontWeight: 700 }}>
              {v}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
        <span>
          Accreditation <Pill value={p.accreditationStatus} />
        </span>
        <span className="muted">{p.validUntil ? `until ${fmtDate(p.validUntil)}` : "—"}</span>
      </div>
      {p.validUntil ? (
        <Progress percent={left} showInfo={false} size="small" strokeColor={d !== null && d <= 90 ? "#cf1322" : d !== null && d <= 180 ? "#d48806" : "#0b6e4f"} />
      ) : null}
      {d !== null && d <= 180 ? (
        <div style={{ fontSize: 12, color: d <= 90 ? "#b4141f" : "#a15c00", marginTop: 2 }}>Renewal due: {d} days left</div>
      ) : null}
    </div>
  );
}

export default function InstitutionDashboard(props: {
  denied: string | null;
  userName: string;
  inst: { name: string; code: string; status: string; city: string; province: string; sector: string };
  programs: Program[];
  actions: { text: string; level: "error" | "warning" | "info"; link?: string }[];
  apps: { ref: string; kind: string; programType: string; status: string; updatedAt: string }[];
  notifications: { id: number; title: string; body: string; link: string | null; createdAt: string }[];
}) {
  const { inst, programs } = props;
  const students = programs.reduce((a, p) => a + p.students, 0);
  const faculty = programs.reduce((a, p) => a + p.faculty, 0);
  const openApps = props.apps.filter((a) => !["NOC_ISSUED", "REJECTED"].includes(a.status)).length;
  const first = props.userName.replace(/^(Dr|Prof)\.\s+/, "").split(" ")[0];
  return (
    <>
      {props.denied ? <Alert type="error" showIcon style={{ marginBottom: 16 }} message={`Your role does not have access to that page (${props.denied}).`} /> : null}
      <PageTitle
        eyebrow={`Welcome back, ${first}`}
        title={inst.name}
        sub={
          <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span className="mono">{inst.code}</span>
            <span>·</span>
            <span>
              {inst.city}, {inst.province}
            </span>
            <span>·</span>
            <span>{inst.sector} sector</span>
            <Pill value={inst.status} />
          </span>
        }
        extra={
          <>
            <Link href="/institution/faculty">
              <Button icon={<TeamOutlined />}>Faculty</Button>
            </Link>
            <Link href="/institution/applications">
              <Button type="primary" icon={<PlusOutlined />}>
                New application
              </Button>
            </Link>
          </>
        }
      />
      <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
        <Col xs={12} lg={6}>
          <StatCard label="Current students" value={students} icon={<SolutionOutlined />} hint="Across all programs" />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard label="Active faculty" value={faculty} icon={<TeamOutlined />} tone="info" hint="Each with a PCP faculty ID" />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard label="Programs with a NOC" value={`${programs.filter((p) => p.nocStatus === "APPROVED").length} / ${programs.length || 0}`} icon={<BookOutlined />} tone="gold" />
        </Col>
        <Col xs={12} lg={6}>
          <Link href="/institution/applications">
            <StatCard label="Open applications" value={openApps} icon={<FileProtectOutlined />} tone="violet" hint="Tracked with PCP" />
          </Link>
        </Col>
      </Row>
      <Row gutter={[18, 18]}>
        <Col xs={24} xl={15}>
          <Card title="Programs" extra={<span className="muted" style={{ fontSize: 12.5 }}>NOC, accreditation and capacity</span>} style={{ marginBottom: 18 }}>
            {programs.length === 0 ? (
              <Empty
                description={
                  <span>
                    No programs yet. <Link href="/institution/applications">Start a NOC application</Link> for PharmD or Pharmacy Technician.
                  </span>
                }
              />
            ) : (
              <Row gutter={[14, 14]}>
                {programs.map((p) => (
                  <Col key={p.type} xs={24} md={12}>
                    <ProgramCard p={p} />
                  </Col>
                ))}
              </Row>
            )}
          </Card>
          <Card title="Applications" extra={<Link href="/institution/applications">All applications</Link>}>
            <Table
              size="small"
              rowKey="ref"
              pagination={false}
              dataSource={props.apps}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No applications yet" /> }}
              columns={[
                { title: "Reference", dataIndex: "ref", render: (v) => <Link href={`/institution/applications/${v}`} className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{v}</Link> },
                { title: "Type", render: (_, r) => `${kindLabel(r.kind)} · ${programLabel(r.programType)}` },
                { title: "Status", dataIndex: "status", render: (v) => <StatusTag status={v} /> },
                { title: "Updated", dataIndex: "updatedAt", render: (v) => <span className="muted">{timeAgo(v)}</span> },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card
            title={
              <span>
                <AlertOutlined style={{ color: "#b4141f", marginRight: 8 }} />
                Action required
              </span>
            }
            style={{ marginBottom: 18 }}
            styles={{ body: { padding: 10 } }}
          >
            {props.actions.map((a, i) => {
              const l = LEVEL[a.level];
              const row = (
                <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 10px", borderRadius: 10 }} className="pcp-action-row">
                  <span style={{ width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", background: l.bg, color: l.c, flex: "none" }}>{l.icon}</span>
                  <span style={{ flex: 1, fontSize: 13.5, color: "var(--ink)", lineHeight: 1.4 }}>{a.text}</span>
                  {a.link ? <RightOutlined style={{ color: "var(--faint)", fontSize: 11 }} /> : null}
                </div>
              );
              return a.link ? (
                <Link key={i} href={a.link}>
                  {row}
                </Link>
              ) : (
                <div key={i}>{row}</div>
              );
            })}
          </Card>
          <Card title="Latest from PCP" styles={{ body: { paddingTop: 6 } }}>
            {props.notifications.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No notifications" />
            ) : (
              props.notifications.map((n) => {
                const body = (
                  <div style={{ padding: "10px 0", borderBottom: "1px solid var(--line-2)" }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--ink)" }}>{n.title}</div>
                    <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
                      {n.body}
                    </div>
                    <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>
                      {timeAgo(n.createdAt)} · in-app + email
                    </div>
                  </div>
                );
                return n.link ? (
                  <Link key={n.id} href={n.link}>
                    {body}
                  </Link>
                ) : (
                  <div key={n.id}>{body}</div>
                );
              })
            )}
          </Card>
        </Col>
      </Row>
    </>
  );
}
