"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Col, Empty, Input, Modal, Radio, Row, Table, Timeline, Typography } from "antd";
import {
  ArrowLeftOutlined,
  CheckOutlined,
  CloseOutlined,
  EditOutlined,
  FilePdfOutlined,
  FileSearchOutlined,
  GlobalOutlined,
  IdcardOutlined,
  KeyOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { changePharmacistStatus, createPharmacistLogin, reviewPracticeUpdate } from "@/app/actions/pharmacists";
import { CATEGORY_LABELS, COUNCIL_INFO, STATUSES, STATUS_LABELS, isCouncil, validityLapsed } from "@/lib/register";
import { useOtp } from "./OtpConfirm";
import { KV, PageTitle, Pill, fmtDate, timeAgo } from "./common";
import { RegStatus, bannerTone, statusSentence } from "./pharmacist-parts";

type Rec = {
  id: number;
  regNo: string;
  fullName: string;
  fatherName: string;
  cnic: string;
  gender: string | null;
  university: string;
  graduationYear: number;
  category: string;
  council: string;
  issueDate: string;
  validUntil: string | null;
  status: string;
  practicePlace: string | null;
  designation: string | null;
  practiceConfirmed: boolean;
  practiceConfirmedAt: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
  username: string | null;
  createdAt: string;
  updatedAt: string;
};
type Ev = { id: number; kind: string; fromStatus: string | null; toStatus: string | null; note: string | null; actor: string; createdAt: string };
type Upd = { id: number; practicePlace: string; designation: string; status: string; submittedAt: string; reviewedBy: string | null; reviewedAt: string | null; reviewNote: string | null; evidence: { id: number; fileName: string } | null };
type Doc = { id: number; docType: string; fileName: string; version: number; verificationStatus: string; uploadedBy: string; uploadedAt: string; sha256: string };

const STATUS_HELP: Record<string, string> = {
  ACTIVE: "Registered and in date. May practise.",
  DORMANT: "Not renewed. May not practise until renewed with the council.",
  SUSPENDED: "Suspended by the council. May not practise while it lasts.",
  CANCELLED: "Removed from the council's register. May not practise.",
};
const EVENT_COLOR: Record<string, string> = { IMPORTED: "gray", STATUS: "orange", PRACTICE: "green", LOGIN: "blue", CARD: "gray" };
const EVENT_LABEL: Record<string, string> = { IMPORTED: "Imported", STATUS: "Status changed", PRACTICE: "Practice details", LOGIN: "Portal login", CARD: "Registration card" };

export default function PharmacistRecord({ canManage, p, imported, events, updates, documents }: { canManage: boolean; p: Rec; imported: { ref: string; fileName: string; createdAt: string } | null; events: Ev[]; updates: Upd[]; documents: Doc[] }) {
  const { message } = App.useApp();
  const router = useRouter();
  const { withOtp, otpModal } = useOtp();
  const [busy, start] = useTransition();
  const [statusOpen, setStatusOpen] = useState(false);
  const [newStatus, setNewStatus] = useState<string>("");
  const [reason, setReason] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [login, setLogin] = useState<{ username: string; password: string } | null>(null);
  const council = isCouncil(p.council) ? COUNCIL_INFO[p.council].name : p.council;
  const tone = bannerTone(p.status, p.validUntil);
  const pending = updates.find((u) => u.status === "PENDING");
  const lapsed = p.status === "ACTIVE" && validityLapsed(p.validUntil);

  const saveStatus = () =>
    withOtp(`pharmacist-status:${p.regNo}`, `Change ${p.regNo} to ${STATUS_LABELS[newStatus]?.toLowerCase()}`, (code) =>
      new Promise<void>((resolve) =>
        start(async () => {
          const r = await changePharmacistStatus(p.id, newStatus, reason, code);
          message[r.ok ? "success" : r.level === "warning" ? "warning" : "error"](r.message);
          if (r.ok) {
            setStatusOpen(false);
            setReason("");
          }
          router.refresh();
          resolve();
        }),
      ),
    );

  const decide = (decision: "VERIFIED" | "REJECTED") =>
    pending &&
    withOtp(`practice-update:${pending.id}`, decision === "VERIFIED" ? "Verify the practice place" : "Reject the practice update", (code) =>
      new Promise<void>((resolve) =>
        start(async () => {
          const r = await reviewPracticeUpdate(pending.id, decision, decision === "REJECTED" ? rejectNote : "", code);
          message[r.ok ? "success" : r.level === "warning" ? "warning" : "error"](r.message);
          if (r.ok) setRejectOpen(false);
          router.refresh();
          resolve();
        }),
      ),
    );

  const makeLogin = () =>
    start(async () => {
      const r = await createPharmacistLogin(p.id);
      if (r.ok && r.username && r.password) setLogin({ username: r.username, password: r.password });
      else message[r.level === "warning" ? "warning" : "error"](r.message);
      router.refresh();
    });

  const preview = newStatus ? statusSentence({ status: newStatus, validUntil: p.validUntil, council: p.council }) : "";

  return (
    <>
      {otpModal}
      <PageTitle
        eyebrow={
          <Link href="/pcp/pharmacists" style={{ color: "inherit" }}>
            <ArrowLeftOutlined /> Pharmacist register
          </Link>
        }
        title={p.fullName}
        sub={
          <span>
            <span className="mono" style={{ fontSize: 13 }}>
              {p.regNo}
            </span>{" "}
            · {council} · {CATEGORY_LABELS[p.category] ?? p.category}
          </span>
        }
        extra={
          <>
            <Link href={`/verify?reg=${encodeURIComponent(p.regNo)}`} target="_blank">
              <Button icon={<GlobalOutlined />}>Public check</Button>
            </Link>
            {canManage ? (
              <>
                <a href={`/api/pharmacist/card?id=${p.id}`} target="_blank" rel="noreferrer">
                  <Button icon={<IdcardOutlined />}>Registration card</Button>
                </a>
                <Button
                  type="primary"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setNewStatus(STATUSES.find((s) => s !== p.status) ?? "");
                    setStatusOpen(true);
                  }}
                >
                  Change status
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="pcp-court" style={{ background: tone.bg, borderColor: tone.bd, marginBottom: 16 }} data-testid="record-status">
        <RegStatus status={p.status} validUntil={p.validUntil} />
        <div style={{ minWidth: 0 }}>
          <div className="pcp-court-title" style={{ color: tone.fg }}>
            {lapsed ? "Active, but the validity has ended" : STATUS_HELP[p.status]}
          </div>
          <div className="pcp-court-sub">The public check says: “{statusSentence(p)}”</div>
        </div>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card title="Registration" style={{ marginBottom: 16 }}>
            <KV
              rows={[
                ["Registration number", <span key="r" className="mono" style={{ fontSize: 13 }}>{p.regNo}</span>],
                ["Category", CATEGORY_LABELS[p.category] ?? p.category],
                ["Issuing council", council],
                ["Status", <RegStatus key="s" status={p.status} validUntil={p.validUntil} />],
                ["Issued", fmtDate(p.issueDate)],
                ["Valid until", p.validUntil ? <span key="v" style={{ color: lapsed ? "#a15c00" : undefined }}>{fmtDate(p.validUntil)}{lapsed ? " · ended" : ""}</span> : "No end date in the council's file"],
                ["University", p.university],
                ["Graduation year", String(p.graduationYear)],
                ["Source", imported ? <span key="i"><span className="mono">{imported.ref}</span> · {imported.fileName} · {fmtDate(imported.createdAt)}</span> : "Entered before the import log"],
              ]}
            />
          </Card>

          <Card
            title="Practice place and designation"
            extra={<span className="muted" style={{ fontSize: 12.5 }}>Shown only once confirmed, and never on the public check</span>}
            style={{ marginBottom: 16 }}
          >
            {p.practiceConfirmed && p.practicePlace ? (
              <KV
                rows={[
                  ["Practice place", <b key="pp" style={{ fontWeight: 600 }}>{p.practicePlace}</b>],
                  ["Designation", p.designation],
                  ["Confirmed", <span key="c"><Pill value="VERIFIED" label="Verified by PCP" /> {fmtDate(p.practiceConfirmedAt)}</span>],
                ]}
              />
            ) : (
              <span className="muted">Not confirmed. The pharmacist adds it from their portal with evidence, and PCP verifies it.</span>
            )}
            {pending ? (
              <div data-testid="pending-update" style={{ marginTop: 16, padding: 14, borderRadius: 12, border: "1px solid #ddd3fb", background: "#f8f5ff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <div>
                    <div className="pcp-eyebrow" style={{ color: "#5b3cc4" }}>
                      Update waiting for verification · sent {timeAgo(pending.submittedAt)}
                    </div>
                    <b style={{ fontWeight: 600 }}>{pending.designation}</b>, {pending.practicePlace}
                    <div style={{ marginTop: 4 }}>
                      {pending.evidence ? (
                        <a href={`/api/documents/${pending.evidence.id}`} target="_blank" rel="noreferrer">
                          <FileSearchOutlined /> {pending.evidence.fileName}
                        </a>
                      ) : (
                        <span className="faint">No evidence attached</span>
                      )}
                    </div>
                  </div>
                  {canManage ? (
                    <span style={{ display: "inline-flex", gap: 6 }}>
                      <Button type="primary" icon={<CheckOutlined />} loading={busy} onClick={() => decide("VERIFIED")}>
                        Verify
                      </Button>
                      <Button danger icon={<CloseOutlined />} disabled={busy} onClick={() => setRejectOpen(true)}>
                        Reject
                      </Button>
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </Card>

          <Card title={`Practice updates (${updates.length})`} styles={{ body: { padding: 0 } }} style={{ marginBottom: 16 }}>
            <Table
              rowKey="id"
              size="small"
              dataSource={updates}
              pagination={false}
              locale={{ emptyText: "The pharmacist has not sent any practice update" }}
              columns={[
                { title: "Sent", dataIndex: "submittedAt", render: (v) => fmtDate(v) },
                { title: "Practice details", render: (_, u) => `${u.designation}, ${u.practicePlace}` },
                { title: "Evidence", render: (_, u) => (u.evidence ? <a href={`/api/documents/${u.evidence.id}`} target="_blank" rel="noreferrer">{u.evidence.fileName}</a> : <span className="faint">—</span>), responsive: ["md"] },
                { title: "Result", dataIndex: "status", render: (v, u) => <span title={u.reviewNote ?? undefined}><Pill value={v} /></span> },
                { title: "Note", dataIndex: "reviewNote", render: (v) => <span className="muted" style={{ fontSize: 12.5 }}>{v ?? "—"}</span>, responsive: ["lg"] },
              ]}
            />
          </Card>

          <Card title="History">
            {events.length ? (
              <Timeline
                items={events.map((e) => ({
                  color: EVENT_COLOR[e.kind] ?? "gray",
                  content: (
                    <div>
                      <b style={{ fontWeight: 600 }}>{EVENT_LABEL[e.kind] ?? e.kind}</b>
                      {e.kind === "STATUS" && e.fromStatus && e.toStatus ? (
                        <span>
                          {" "}
                          · {STATUS_LABELS[e.fromStatus] ?? e.fromStatus} to {STATUS_LABELS[e.toStatus] ?? e.toStatus}
                        </span>
                      ) : null}
                      {e.note ? <div style={{ color: "var(--ink-2)", fontSize: 13 }}>{e.note}</div> : null}
                      <div className="faint" style={{ fontSize: 12 }}>
                        {e.actor} · {fmtDate(e.createdAt, true)}
                      </div>
                    </div>
                  ),
                }))}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No history yet" />
            )}
          </Card>
        </Col>

        <Col xs={24} xl={10}>
          <Card
            title={
              <span>
                <GlobalOutlined style={{ color: "var(--brand)", marginInlineEnd: 8 }} />
                What the public check shows
              </span>
            }
            style={{ marginBottom: 16 }}
          >
            <KV
              rows={[
                ["Name", p.fullName],
                ["Registration number", <span key="r" className="mono">{p.regNo}</span>],
                ["Category", CATEGORY_LABELS[p.category] ?? p.category],
                ["Status", <RegStatus key="s" status={p.status} validUntil={p.validUntil} />],
                ["Valid until", p.validUntil ? fmtDate(p.validUntil) : "—"],
              ]}
            />
            <p className="muted" style={{ fontSize: 12.5, margin: "12px 0 0" }}>
              <LockOutlined /> Nothing else: no CNIC, phone, email, home address or practice place.
            </p>
          </Card>

          <Card
            title="Person"
            extra={
              <span className="muted" style={{ fontSize: 12.5 }}>
                {canManage ? "Held for the council, never public" : "CNIC masked for your role"}
              </span>
            }
            style={{ marginBottom: 16 }}
          >
            <KV
              rows={[
                ["Full name", p.fullName],
                ["Father's name", p.fatherName],
                ["CNIC", <span key="c" className="mono" style={{ fontSize: 13 }}>{p.cnic}</span>],
                ["Gender", p.gender === "F" ? "Female" : p.gender === "M" ? "Male" : "—"],
                ["Mobile", p.mobile ?? "—"],
                ["Email", p.email ?? "—"],
                ["Home address", p.address ?? "—"],
              ]}
            />
          </Card>

          <Card title="Portal login" style={{ marginBottom: 16 }}>
            {p.username ? (
              <span>
                <KeyOutlined style={{ color: "var(--brand)" }} /> Signs in as <span className="mono">{p.username}</span>. They see their registration, update their practice place and download their card.
              </span>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <span className="muted">No portal login yet. With one, the pharmacist can update their practice place and download their registration card.</span>
                {canManage ? (
                  <span>
                    <Button icon={<KeyOutlined />} loading={busy} disabled={p.status === "CANCELLED"} onClick={makeLogin}>
                      Create a login
                    </Button>
                  </span>
                ) : null}
              </div>
            )}
          </Card>

          <Card title={`Documents (${documents.length})`} styles={{ body: { padding: 0 } }}>
            <Table
              rowKey="id"
              size="small"
              dataSource={documents}
              pagination={false}
              locale={{ emptyText: "No documents yet" }}
              columns={[
                {
                  title: "Document",
                  render: (_, d) => (
                    <a href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer">
                      <FilePdfOutlined /> {d.docType} <span className="faint">v{d.version}</span>
                    </a>
                  ),
                },
                { title: "Status", dataIndex: "verificationStatus", render: (v) => <Pill value={v} /> },
                { title: "Added", dataIndex: "uploadedAt", render: (v, d) => <span className="faint" style={{ fontSize: 12 }}>{fmtDate(v)} · {d.uploadedBy}</span> },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Modal
        open={statusOpen}
        title={`Change the status of ${p.regNo}`}
        okText="Record the change"
        okButtonProps={{ disabled: !newStatus || newStatus === p.status || reason.trim().length < 10, loading: busy }}
        onOk={saveStatus}
        onCancel={() => setStatusOpen(false)}
        destroyOnHidden
        width={560}
      >
        <p className="muted" style={{ marginTop: 0 }}>
          Record the {council}&apos;s decision. Now: <RegStatus status={p.status} validUntil={p.validUntil} />
        </p>
        <Radio.Group value={newStatus} onChange={(e) => setNewStatus(e.target.value)} style={{ display: "grid", gap: 8, marginBottom: 14 }}>
          {STATUSES.map((s) => (
            <Radio key={s} value={s} disabled={s === p.status}>
              <b style={{ fontWeight: 600 }}>{STATUS_LABELS[s]}</b> <span className="muted">· {STATUS_HELP[s]}</span>
            </Radio>
          ))}
        </Radio.Group>
        <div style={{ fontWeight: 500, marginBottom: 6 }}>Reason (required)</div>
        <Input.TextArea
          id="status-reason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={400}
          showCount
          placeholder={`e.g. ${COUNCIL_INFO[isCouncil(p.council) ? p.council : "Punjab"].code} letter REG/2026/311 of 2 Oct 2026: renewal fee not paid`}
        />
        {preview ? <Alert type="info" showIcon style={{ marginTop: 14 }} title="The public check will then say" description={preview} /> : null}
        <p className="faint" style={{ fontSize: 12.5, margin: "12px 0 0" }}>
          <SafetyCertificateOutlined /> Needs a one-time code. The change is audited, and the pharmacist and the council are told.
        </p>
      </Modal>

      <Modal
        open={rejectOpen}
        title="Reject the practice update"
        okText="Reject and tell the pharmacist"
        okButtonProps={{ danger: true, disabled: rejectNote.trim().length < 10, loading: busy }}
        onOk={() => decide("REJECTED")}
        onCancel={() => setRejectOpen(false)}
        destroyOnHidden
      >
        <Input.TextArea rows={3} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} maxLength={400} showCount placeholder="What is wrong and what to send instead" />
      </Modal>

      <Modal open={!!login} title="Login created" onOk={() => setLogin(null)} onCancel={() => setLogin(null)} okText="Done" cancelButtonProps={{ style: { display: "none" } }}>
        <p style={{ marginTop: 0 }}>Give these to {p.fullName}. The password is shown only now and must be changed at first sign-in.</p>
        <KV
          rows={[
            ["Username", <Typography.Text key="u" code copyable>{login?.username}</Typography.Text>],
            ["Temporary password", <Typography.Text key="p" code copyable data-testid="temp-password">{login?.password}</Typography.Text>],
          ]}
        />
        <Alert type="warning" showIcon style={{ marginTop: 12 }} title="PCP does not store this password. If it is lost, the Super administrator can reset it." />
      </Modal>
    </>
  );
}
