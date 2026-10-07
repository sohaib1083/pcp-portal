"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Badge, Button, Card, Col, Empty, Input, Modal, Row, Table, Tabs, Tag } from "antd";
import { CheckOutlined, CloseOutlined, EditOutlined, MergeCellsOutlined, SafetyCertificateOutlined, SplitCellsOutlined } from "@ant-design/icons";
import { decideFacultyChange } from "@/app/actions/faculty";
import { resolveIdentityItem } from "@/app/actions/identity";
import { resolveDuplicate, verifyFaculty } from "@/app/actions/pcp";
import { ENTITY_LABELS, NADRA_RULE_TEXT, type IdentityBadge, type IdentityEntity } from "@/lib/identity-shared";
import { CHANGE_KIND_LABELS } from "@/lib/registry-shared";
import { Avatar, PageTitle, Pill, fmtDate, programLabel, timeAgo } from "./common";
import NadraBadge, { NadraStatus } from "./NadraBadge";
import { useOtp } from "./OtpConfirm";
import ScreenGuide from "./ScreenGuide";
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
  nadra?: IdentityBadge | null;
};

/** A NADRA check (simulated) that disagrees with PCP's record, waiting for (or resolved by) the verification desk. */
export type NadraItem = {
  id: number;
  entityType: IdentityEntity;
  entityId: number;
  ref: string;
  name: string;
  fatherName: string;
  cnic: string;
  where: string;
  status: string;
  nadraName: string | null;
  nameSent: string;
  txnId: string;
  checkedAt: string;
  checkedBy: string;
  source: string;
  reviewStatus: string | null;
  reviewOutcome: string | null;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

const SOURCE_LABEL: Record<string, string> = { REGISTRATION: "at registration", IMPORT: "on import", MANUAL: "on request", SEED: "in the first data load" };
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
        <span className="muted">NADRA</span>
        <span>
          <NadraStatus badge={p.nadra} />
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
  nadraOpen = [],
  nadraResolved = [],
}: {
  nadraOpen?: NadraItem[];
  nadraResolved?: NadraItem[];
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
  const [active, setActive] = useState(tab && ["duplicates", "links", "changes", "decided", "nadra"].includes(tab) ? tab : "duplicates");
  const [resolve, setResolve] = useState<{ item: NadraItem; outcome: "NAME_UPDATED" | "KEPT" } | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const confirmResolve = () =>
    start(async () => {
      if (!resolve) return;
      const r = await resolveIdentityItem(resolve.item.id, resolve.outcome, resolveNote);
      message[r.ok ? "success" : r.level === "warning" ? "warning" : "error"](r.message, 6);
      if (r.ok) setResolve(null);
      router.refresh();
    });
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
      <PageTitle
        eyebrow="Casework"
        title="Data verification"
        sub="Possible duplicate people, new faculty records, link requests, changes to verified appointments and NADRA checks that disagree with PCP's records. The system raises the signal; a person decides."
        extra={
          <ScreenGuide
            title="Data verification"
            steps={[
              "**Duplicates and new records**: compare the two people side by side, then decide whether they are the same person.",
              "**Link requests** and **Change requests**: approve or reject with a one-time code; the institution is told.",
              "**NADRA checks**: every new faculty member, student and imported pharmacist is checked with NADRA. A name difference or an unknown CNIC waits here until you resolve it with a note.",
              NADRA_RULE_TEXT,
            ]}
            note="The NADRA check is simulated in this demo: no NADRA system is called."
          />
        }
      />
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
                        <span className="muted" style={{ fontSize: 12.5, marginLeft: "auto", maxWidth: 420 }}>
                          <SafetyCertificateOutlined /> Both CNICs were checked with NADRA (simulated): see the NADRA line on each card. Two different CNICs that NADRA knows under these names are usually two different people.
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
            key: "nadra",
            label: label("NADRA checks", nadraOpen.length),
            children: (
              <>
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 14 }}
                  title="CNICs are checked with NADRA when a faculty member or student is registered and when pharmacists are imported. Here are the ones where NADRA disagrees with PCP's record. Simulated NADRA check: no NADRA system is called in this demo."
                />
                {nadraOpen.length === 0 ? (
                  <Card style={{ marginBottom: 16 }}>
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Every NADRA check matches PCP's records" />
                  </Card>
                ) : null}
                {nadraOpen.map((n) => (
                  <Card
                    key={n.id}
                    data-testid={`nadra-item-${n.ref}`}
                    style={{ marginBottom: 14, borderColor: n.status === "NOT_FOUND" ? "#ffccc7" : "#ffe1a8" }}
                    title={
                      <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <Tag style={{ marginInlineEnd: 0 }}>{ENTITY_LABELS[n.entityType]}</Tag>
                        <span className="mono" style={{ fontSize: 13 }}>{n.ref}</span>
                        <span>{n.status === "NOT_FOUND" ? "CNIC not found at NADRA" : "Name differs at NADRA"}</span>
                      </span>
                    }
                    extra={<span className="muted" style={{ fontSize: 12.5 }}>Checked {SOURCE_LABEL[n.source] ?? ""} · {timeAgo(n.checkedAt)}</span>}
                  >
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
                      <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12 }}>
                        <div className="faint" style={{ fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>PCP&apos;s record</div>
                        <div style={{ display: "grid", gridTemplateColumns: "92px 1fr", rowGap: 6, fontSize: 13 }}>
                          <span className="muted">Name</span>
                          <b style={{ fontWeight: 600 }}>{n.name}</b>
                          <span className="muted">Father</span>
                          <span>{n.fatherName}</span>
                          <span className="muted">CNIC</span>
                          <span className="mono">{n.cnic}</span>
                          <span className="muted">Where</span>
                          <span>{n.where}</span>
                        </div>
                      </div>
                      <div style={{ border: `1px solid ${n.status === "NOT_FOUND" ? "#ffccc7" : "#ffe1a8"}`, background: n.status === "NOT_FOUND" ? "#fffafa" : "#fffbf3", borderRadius: 12, padding: 12 }}>
                        <div className="faint" style={{ fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>NADRA (simulated)</div>
                        <div style={{ display: "grid", gridTemplateColumns: "92px 1fr", rowGap: 6, fontSize: 13 }}>
                          <span className="muted">Name</span>
                          {n.nadraName ? <b style={{ fontWeight: 600, color: "#a15c00" }}>{n.nadraName}</b> : <b style={{ fontWeight: 600, color: "#b4141f" }}>No record of this CNIC</b>}
                          <span className="muted">Transaction</span>
                          <span className="mono" style={{ fontSize: 12 }}>{n.txnId}</span>
                          <span className="muted">Checked</span>
                          <span>{fmtDate(n.checkedAt, true)} by {n.checkedBy}</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
                      {canAct ? (
                        <>
                          {n.status === "NAME_MISMATCH" ? (
                            <Button type="primary" icon={<EditOutlined />} onClick={() => (setResolveNote(""), setResolve({ item: n, outcome: "NAME_UPDATED" }))}>
                              Use NADRA&apos;s spelling
                            </Button>
                          ) : null}
                          <Button icon={<CheckOutlined />} onClick={() => (setResolveNote(""), setResolve({ item: n, outcome: "KEPT" }))}>
                            Keep the record as it is
                          </Button>
                        </>
                      ) : null}
                      <span style={{ marginLeft: "auto" }}>
                        <NadraBadge
                          entityType={n.entityType}
                          entityId={n.entityId}
                          badge={{ checkId: n.id, status: n.status as IdentityBadge["status"], nadraName: n.nadraName, nameSent: n.nameSent, txnId: n.txnId, checkedAt: n.checkedAt, checkedBy: n.checkedBy, reviewStatus: n.reviewStatus, reviewOutcome: n.reviewOutcome, reviewNote: n.reviewNote }}
                          canCheck={canAct}
                        />
                      </span>
                    </div>
                  </Card>
                ))}
                <Card title={`Resolved (${nadraResolved.length})`} styles={{ body: { padding: 0 } }}>
                  <Table
                    rowKey="id"
                    size="small"
                    dataSource={nadraResolved}
                    pagination={{ pageSize: 10, hideOnSinglePage: true }}
                    locale={{ emptyText: "Nothing resolved yet" }}
                    columns={[
                      { title: "Record", render: (_, n) => <span>{n.name}<div className="faint" style={{ fontSize: 12 }}>{ENTITY_LABELS[n.entityType]} · <span className="mono">{n.ref}</span></div></span> },
                      { title: "NADRA said", render: (_, n) => (n.status === "NOT_FOUND" ? "Not found" : `"${n.nadraName}" (record said "${n.nameSent}")`) },
                      { title: "Decision", render: (_, n) => <RegStatus value={n.reviewOutcome === "NAME_UPDATED" ? "APPROVED" : "VERIFIED"} label={n.reviewOutcome === "NAME_UPDATED" ? "NADRA spelling applied" : "Record kept"} /> },
                      { title: "Note", dataIndex: "reviewNote", render: (v) => <span style={{ fontSize: 12.5 }}>{v}</span> },
                      { title: "By", render: (_, n) => <span style={{ fontSize: 12.5 }}>{n.reviewedBy}<div className="faint">{fmtDate(n.reviewedAt)}</div></span> },
                    ]}
                  />
                </Card>
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
        open={!!resolve}
        title={resolve ? `${resolve.outcome === "NAME_UPDATED" ? "Use NADRA's spelling for" : "Keep"} ${resolve.item.ref}` : ""}
        okText={resolve?.outcome === "NAME_UPDATED" ? "Update the name and resolve" : "Resolve, keep the record"}
        confirmLoading={busy}
        onCancel={() => setResolve(null)}
        onOk={confirmResolve}
        okButtonProps={{ disabled: resolveNote.trim().length < 5 }}
        destroyOnHidden
      >
        <p style={{ marginTop: 0 }}>
          {resolve?.outcome === "NAME_UPDATED"
            ? `The record's name changes from "${resolve.item.name}" to "${resolve.item.nadraName}", as NADRA holds it. The change is kept in the record's history${resolve.item.entityType !== "pharmacist" ? " and the institution is told" : ""}.`
            : `The record stays as it is. Say what you checked, for example the CNIC copy or a call to the person${resolve?.item.entityType !== "pharmacist" ? "; the institution sees your note" : ""}.`}
        </p>
        <Input.TextArea
          rows={3}
          value={resolveNote}
          onChange={(e) => setResolveNote(e.target.value)}
          placeholder={resolve?.outcome === "NAME_UPDATED" ? "Note (required), e.g. CNIC copy checked; NADRA spelling is correct" : "Note (required), e.g. CNIC copy checked: the CNIC was typed wrongly and the institution will correct it"}
          aria-label="Resolution note"
        />
      </Modal>
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
