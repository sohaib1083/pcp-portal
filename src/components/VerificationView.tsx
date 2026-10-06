"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Col, Empty, Row, Table, Tag } from "antd";
import { CheckOutlined, MergeCellsOutlined, SafetyCertificateOutlined, SplitCellsOutlined } from "@ant-design/icons";
import { resolveDuplicate, verifyFaculty } from "@/app/actions/pcp";
import { Avatar, PageTitle, Pill, fmtDate } from "./common";

type Person = { id: number; pcpId: string; fullName: string; fatherName: string; cnic: string; qualification: string; specialization: string; designation: string; status: string; institutions: string[] };

function PersonCard({ p, label, other }: { p: Person; label: string; other: Person }) {
  const diff = (a: string, b: string) => (a !== b ? { background: "#fff7e6", borderRadius: 4, padding: "0 4px", margin: "0 -4px" } : undefined);
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14, height: "100%", background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span className="faint" style={{ fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {label}
        </span>
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <span className="mono">{p.pcpId}</span>
          <Pill value={p.status} />
        </span>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <Avatar name={p.fullName} size={38} />
        <div>
          <div style={{ fontWeight: 650, fontSize: 15 }}>
            <span style={diff(p.fullName, other.fullName)}>{p.fullName}</span>
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {p.designation} · {p.qualification} {p.specialization}
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "92px 1fr", rowGap: 6, fontSize: 13 }}>
        <span className="muted">Father</span>
        <span>
          <span style={diff(p.fatherName, other.fatherName)}>{p.fatherName}</span>
        </span>
        <span className="muted">CNIC</span>
        <span className="mono" style={{ fontSize: 13 }}>
          <span style={diff(p.cnic, other.cnic)}>{p.cnic}</span>
        </span>
        <span className="muted">Linked to</span>
        <span>
          {p.institutions.map((i) => (
            <Tag key={i} style={{ marginBottom: 2 }}>
              {i}
            </Tag>
          ))}
        </span>
      </div>
    </div>
  );
}

export default function VerificationView({ flags, pending, canAct }: { flags: { id: number; score: number; reason: string; record: Person; match: Person }[]; pending: { id: number; pcpId: string; fullName: string; qualification: string; designation: string; inst: string; createdAt: string }[]; canAct: boolean }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [busy, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const r = await fn();
      message[r.ok ? "success" : "error"](r.message);
      router.refresh();
    });

  return (
    <>
      <PageTitle eyebrow="Casework" title="Data verification" sub="Possible duplicate people and new faculty records waiting for PCP. The system raises the signal; a person decides." />
      {!canAct ? <Alert type="info" showIcon style={{ marginBottom: 16 }} message="View only: decisions belong to the PCP Officer." /> : null}
      <div className="pcp-section-title" style={{ marginBottom: 10, fontSize: 15 }}>
        Possible duplicates <span className="faint">({flags.length})</span>
      </div>
      {flags.length === 0 ? (
        <Card style={{ marginBottom: 18 }}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No open duplicate flags" />
        </Card>
      ) : null}
      {flags.map((f) => (
        <Card key={f.id} style={{ marginBottom: 16, borderColor: "#ffccc7" }} styles={{ body: { background: "#fffafa" } }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span className="tnum" style={{ fontSize: 28, fontWeight: 750, color: "#b4141f", letterSpacing: "-0.02em" }}>
                {Math.round(f.score * 100)}%
              </span>
              <span className="muted" style={{ fontSize: 12.5 }}>match</span>
            </div>
            <div style={{ flex: 1, minWidth: 240, fontSize: 13.5, color: "var(--ink-2)" }}>{f.reason}</div>
          </div>
          <Row gutter={[12, 12]}>
            <Col xs={24} md={12}>
              <PersonCard p={f.record} label="New record" other={f.match} />
            </Col>
            <Col xs={24} md={12}>
              <PersonCard p={f.match} label="Existing record" other={f.record} />
            </Col>
          </Row>
          {canAct ? (
            <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
              <Button danger icon={<MergeCellsOutlined />} loading={busy} onClick={() => run(() => resolveDuplicate(f.id, "SAME_PERSON"))}>
                Same person: deactivate new record
              </Button>
              <Button type="primary" icon={<SplitCellsOutlined />} loading={busy} onClick={() => run(() => resolveDuplicate(f.id, "DIFFERENT"))}>
                Different people: clear flag
              </Button>
              <span className="muted" style={{ fontSize: 12.5, marginLeft: "auto" }}>
                <SafetyCertificateOutlined /> In production a NADRA CNIC check settles most of these automatically.
              </span>
            </div>
          ) : null}
        </Card>
      ))}
      <Card title={`Faculty awaiting verification (${pending.length})`} style={{ marginTop: 8 }} styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          dataSource={pending}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          locale={{ emptyText: "Every faculty record is verified" }}
          columns={[
            { title: "PCP ID", dataIndex: "pcpId", render: (v) => <span className="mono">{v}</span> },
            { title: "Name", dataIndex: "fullName" },
            { title: "Qualification", dataIndex: "qualification" },
            { title: "Designation", dataIndex: "designation" },
            { title: "Institution", dataIndex: "inst" },
            { title: "Added", dataIndex: "createdAt", render: (v) => fmtDate(v) },
            ...(canAct
              ? [
                  {
                    title: "",
                    align: "right" as const,
                    render: (_: unknown, r: { id: number }) => (
                      <Button size="small" type="primary" icon={<CheckOutlined />} loading={busy} onClick={() => run(() => verifyFaculty(r.id))}>
                        Verify
                      </Button>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>
    </>
  );
}
