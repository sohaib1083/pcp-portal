"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Badge, Button, Card, Col, Empty, Input, Modal, Row, Table, Tabs, Tag } from "antd";
import { CheckOutlined, CloseOutlined, MergeCellsOutlined, SafetyCertificateOutlined, SplitCellsOutlined } from "@ant-design/icons";
import { decideFacultyChange } from "@/app/actions/faculty";
import { resolveDuplicate, verifyFaculty } from "@/app/actions/pcp";
import { CHANGE_KIND_LABELS } from "@/lib/registry-shared";
import { Avatar, PageTitle, Pill, fmtDate, programLabel, timeAgo } from "./common";
import { useOtp } from "./OtpConfirm";
import { ChangeLines, RegStatus, useBusy } from "./registry-ui";

type Appointment = { inst: string; code: string; programType: string; status: string; startDate: string; endDate: string | null };
type Person = {
  id: number;
  pcpId: string;
  fullName: string;
  fatherName: string;
  cnic: string;
  qualification: string;
  specialization: string;
  designation: string;
  pcpRegNo?: string | null;
  status: string;
  institutions: string[];
  appointments?: Appointment[];
};
type Request = {
  id: number;
  ref: string;
  kind: string;
  status: string;
  changes: Record<string, { from: string | null; to: string | null }>;
  category: string | null;
  reason: string;
  requestedBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  inst: string;
  instCode: string;
  programType: string | null;
  linkStatus: string | null;
  flagged: boolean;
  person: Person;
};

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

/** One faculty person, as PCP sees them: full details and every appointment, named. */
function PersonSummary({ p }: { p: Person }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <Avatar name={p.fullName} size={38} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 650, fontSize: 15 }}>
          {p.fullName} <span className="mono" style={{ marginLeft: 6 }}>{p.pcpId}</span> <Pill value={p.status} />
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
          Father: {p.fatherName} · CNIC <span className="mono">{p.cnic}</span> · {p.qualification} {p.specialization} · {p.designation}
          {p.pcpRegNo ? ` · Reg. ${p.pcpRegNo}` : ""}
        </div>
        {p.appointments?.length ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {p.appointments.map((a, i) => (
              <Tag key={i} color={a.status === "ACTIVE" ? "green" : a.status === "REQUESTED" ? "gold" : undefined} style={{ marginInlineEnd: 0 }}>
                {a.code} · {programLabel(a.programType)} · {a.status.toLowerCase()} {fmtDate(a.startDate)}
                {a.endDate ? ` to ${fmtDate(a.endDate)}` : ""}
              </Tag>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function VerificationView({
  flags,
  pending,
  canAct,
  tab,
  linkRequests,
  changeRequests,
  decided,
}: {
  flags: { id: number; score: number; reason: string; record: Person; match: Person }[];
  pending: { id: number; pcpId: string; fullName: string; qualification: string; designation: string; inst: string; createdAt: string }[];
  canAct: boolean;
  tab: string | null;
  linkRequests: Request[];
  changeRequests: Request[];
  decided: Request[];
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [busy, start] = useBusy();
  const { withOtp, otpModal } = useOtp();
  const [active, setActive] = useState(tab && ["duplicates", "links", "changes", "decided"].includes(tab) ? tab : "duplicates");
  const [decide, setDecide] = useState<{ r: Request; approve: boolean } | null>(null);
  const [note, setNote] = useState("");
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const r = await fn();
      message[r.ok ? "success" : "error"](r.message);
      router.refresh();
    });

  const openDecision = (r: Request, approve: boolean) => {
    setNote("");
    setDecide({ r, approve });
  };
  const confirmDecision = () => {
    if (!decide) return;
    const { r, approve } = decide;
    if (!approve && note.trim().length < 5) return message.error("Give the reason for rejecting, so the institution knows what to fix.");
    setDecide(null);
    withOtp(`decision:${r.ref}`, `${approve ? "Approve" : "Reject"} ${r.ref}`, async (code) => {
      const res = await decideFacultyChange(r.id, approve, note, code);
      message[res.ok ? "success" : "error"](res.message);
      router.refresh();
    });
  };

  const requestCard = (r: Request) => (
    <Card
      key={r.id}
      data-testid={`request-${r.ref}`}
      style={{ marginBottom: 14 }}
      title={
        <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className="mono" style={{ fontSize: 13 }}>{r.ref}</span>
          <span>{CHANGE_KIND_LABELS[r.kind] ?? r.kind}</span>
          {r.category ? <span className="muted" style={{ fontWeight: 400 }}>· {r.category}</span> : null}
        </span>
      }
      extra={
        <span className="muted" style={{ fontSize: 12.5 }}>
          {r.instCode} · {r.requestedBy} · {timeAgo(r.createdAt)}
        </span>
      }
    >
      <PersonSummary p={r.person} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16, marginTop: 14, padding: 12, background: "var(--bg)", borderRadius: 10 }}>
        <div>
          <div className="faint" style={{ fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
            {r.kind === "NEW_LINK" ? "Requested appointment" : "Requested change"}
          </div>
          <div style={{ fontSize: 13, marginBottom: 4 }}>
            <b style={{ fontWeight: 600 }}>{r.inst}</b>
            {r.programType ? <span className="muted"> · {programLabel(r.programType)}</span> : null}
          </div>
          <ChangeLines changes={r.changes} />
        </div>
        <div>
          <div className="faint" style={{ fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
            Reason given
          </div>
          <div style={{ fontSize: 13 }}>{r.reason}</div>
        </div>
      </div>
      {r.flagged ? <Alert style={{ marginTop: 12 }} type="error" showIcon title="This person has an open duplicate flag. Resolve it on the first tab before approving." /> : null}
      {canAct ? (
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <Button type="primary" icon={<CheckOutlined />} onClick={() => openDecision(r, true)}>
            {r.kind === "NEW_LINK" ? "Approve link" : "Approve and apply"}
          </Button>
          <Button danger icon={<CloseOutlined />} onClick={() => openDecision(r, false)}>
            {r.kind === "NEW_LINK" ? "Decline link" : "Reject, keep original"}
          </Button>
        </div>
      ) : null}
    </Card>
  );

  const label = (text: string, n: number) => (
    <span>
      {text} {n ? <Badge count={n} size="small" style={{ marginLeft: 4, background: "#d48806" }} /> : null}
    </span>
  );

  return (
    <>
      {otpModal}
      <PageTitle eyebrow="Casework" title="Data verification" sub="Possible duplicate people, new faculty records, link requests and changes to verified appointments. The system raises the signal; a person decides." />
      {!canAct ? <Alert type="info" showIcon style={{ marginBottom: 16 }} title="View only: decisions belong to the verification officer." /> : null}
      <Tabs
        activeKey={active}
        onChange={setActive}
        items={[
          {
            key: "duplicates",
            label: label("Duplicates and new records", flags.length + pending.length),
            children: (
              <>
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
            ),
          },
          {
            key: "links",
            label: label("Link requests", linkRequests.length),
            children: (
              <>
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 14 }}
                  title="An institution linked an existing person by their PCP-FAC ID. The link stays Requested until you approve it; approving also verifies the person's record if it was pending."
                />
                {linkRequests.length ? linkRequests.map(requestCard) : <Card><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No link requests waiting" /></Card>}
              </>
            ),
          },
          {
            key: "changes",
            label: label("Change requests", changeRequests.length),
            children: (
              <>
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 14 }}
                  title="Changes to appointments PCP has verified. Approve applies the change (a programme change closes the old link and opens a new one); reject keeps the original. Every request stays on the faculty record."
                />
                {changeRequests.length ? changeRequests.map(requestCard) : <Card><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No change requests waiting" /></Card>}
              </>
            ),
          },
          {
            key: "decided",
            label: "Decided",
            children: (
              <Card styles={{ body: { padding: 0 } }}>
                <Table
                  rowKey="id"
                  dataSource={decided}
                  pagination={{ pageSize: 10, hideOnSinglePage: true }}
                  locale={{ emptyText: "No decisions yet" }}
                  columns={[
                    { title: "Ref", dataIndex: "ref", render: (v) => <span className="mono">{v}</span> },
                    { title: "Request", render: (_, r) => <span>{CHANGE_KIND_LABELS[r.kind]}<div className="faint" style={{ fontSize: 12 }}>{r.instCode} · {r.person.fullName}</div></span> },
                    { title: "Change", render: (_, r) => <ChangeLines changes={r.changes} /> },
                    { title: "Decision", dataIndex: "status", render: (v) => <RegStatus value={v} /> },
                    { title: "By", render: (_, r) => <span style={{ fontSize: 12.5 }}>{r.decidedBy}<div className="faint">{fmtDate(r.decidedAt)}</div></span> },
                    { title: "Note", dataIndex: "decisionNote", render: (v) => <span style={{ fontSize: 12.5 }}>{v ?? "—"}</span> },
                  ]}
                />
              </Card>
            ),
          },
        ]}
      />
      <Modal
        open={!!decide}
        title={decide ? `${decide.approve ? (decide.r.kind === "NEW_LINK" ? "Approve link" : "Approve") : decide.r.kind === "NEW_LINK" ? "Decline link" : "Reject"} ${decide.r.ref}` : ""}
        okText="Continue"
        okButtonProps={{ danger: decide ? !decide.approve : false }}
        onCancel={() => setDecide(null)}
        onOk={confirmDecision}
        destroyOnHidden
      >
        <p style={{ marginTop: 0 }}>
          {decide?.approve
            ? decide.r.kind === "NEW_LINK"
              ? `${decide.r.person.fullName} becomes Active at ${decide.r.inst}. The institution is notified.`
              : "The change is applied to the record now. The original values stay in the history."
            : "Nothing changes on the record. The institution sees your reason."}
        </p>
        <Input.TextArea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={decide?.approve ? "Note (optional), e.g. Appointment letter checked" : "Reason (required), e.g. The appointment letter is not signed"}
          aria-label="Decision note"
        />
      </Modal>
    </>
  );
}
