"use client";
// Pieces shared by the institution and PCP application screens.
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Card, Drawer, Empty, Table, Tag, Typography, Upload } from "antd";
import {
  CheckCircleFilled,
  CheckOutlined,
  ClockCircleOutlined,
  CloseCircleFilled,
  DownloadOutlined,
  FieldTimeOutlined,
  FilePdfOutlined,
  MailOutlined,
  MessageOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  SafetyCertificateFilled,
  UploadOutlined,
  WarningFilled,
} from "@ant-design/icons";
import type { AppDetail } from "@/lib/appdetail";
import { slaClock } from "@/lib/sla-view";
import { STATUS_LABELS, TRACK_LABELS, stepIndex } from "@/lib/workflow";
import { Avatar, Pill, StatusDot, StatusTag, fmtDate, kindLabel, programLabel, timeAgo } from "./common";
import { SamplePdfButton } from "./demo-helpers";

/** Upload through the permission-checked documents API. */
export async function uploadDocument(file: File, fields: Record<string, string>) {
  const fd = new FormData();
  fd.append("file", file);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch("/api/documents", { method: "POST", body: fd });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? "Upload failed");
  return j as { version: number; sha256: string };
}

type Court = { who: string; name?: string | null; what: string; tone: "brand" | "warn" | "info" | "violet" | "teal" | "good" | "bad" };
const COURT_TONE = {
  brand: { c: "#0b6e4f", bg: "#e8f3ee", bd: "#cfe6da" },
  info: { c: "#1d5fb0", bg: "#eaf2fc", bd: "#c8dcf6" },
  warn: { c: "#a15c00", bg: "#fff7e6", bd: "#ffe1a8" },
  violet: { c: "#5b3cc4", bg: "#f2eefe", bd: "#ddd3fb" },
  teal: { c: "#0b6e6e", bg: "#e6f6f6", bd: "#bfe6e6" },
  good: { c: "#0d7a3d", bg: "#e9f7ef", bd: "#c9ecd8" },
  bad: { c: "#b4141f", bg: "#fff1f0", bd: "#ffccc7" },
};

const today = () => new Date().toISOString().slice(0, 10);

/** Who holds the file right now. Applicants always see this (HEC's attestation system did not show it). */
export function courtFor(d: AppDetail): Court {
  const inspection = d.inspections.find((i) => i.status === "SCHEDULED");
  switch (d.app.status) {
    case "DRAFT":
      return { who: "Institution", name: d.inst?.name, what: "Pick the campus, link faculty by Faculty ID and attach the documents. Pay when every check passes; then the Head or Principal submits.", tone: "brand" };
    case "SUBMITTED":
      return { who: "PCP Officer", what: "Waiting for an officer to start the initial scrutiny.", tone: "info" };
    case "UNDER_SCRUTINY":
      return { who: "PCP Officer", name: d.app.assignedOfficerName, what: "Initial scrutiny: documents and data are checked. A deficiency may be raised.", tone: "info" };
    case "DEFICIENCY_RAISED":
      return { who: "Institution", name: d.inst?.name, what: `Respond to the formal deficiency by ${fmtDate(d.deficiencies.find((x) => x.status === "OUTSTANDING" || x.status === "REJECTED")?.dueDate)}.`, tone: "warn" };
    case "RESPONDED":
      return { who: "PCP Officer", name: d.app.assignedOfficerName, what: "Reviewing the institution's response and evidence.", tone: "info" };
    case "TECHNICAL_REVIEW":
      return d.reviewDone
        ? { who: "Inspection coordinator", what: "Technical review passed. An inspection team is being assigned.", tone: "violet" }
        : { who: "PCP Officer", name: d.app.assignedOfficerName, what: "Technical review: faculty, laboratories, library and intake are checked against PCP's academic standards.", tone: "info" };
    case "INSPECTION_SCHEDULED":
      return {
        who: "Inspection team",
        name: inspection?.inspectorName && inspection.inspector ? inspection.inspectorName : null,
        what: `On-site inspection on ${fmtDate(inspection?.scheduledFor)} with a team of ${inspection?.team.length ?? 1}. The lead submits the checklist.`,
        tone: "violet",
      };
    case "INSPECTION_SUBMITTED":
      return { who: "PCP Officer", name: d.app.assignedOfficerName, what: "Reviewing the inspection report before forwarding to the council.", tone: "info" };
    case "COUNCIL_REVIEW":
      return { who: "Council (Secretary)", what: "On the council agenda, awaiting a decision.", tone: "teal" };
    case "APPROVED":
      return { who: "Council (Secretary)", what: "Approved by the council. The certificate is being issued.", tone: "teal" };
    case "DEFERRED":
      return d.app.deferUntil && d.app.deferUntil > today()
        ? { who: "Institution", name: d.inst?.name, what: `Deferred until ${fmtDate(d.app.deferUntil)}: answer the reason for deferral. The case then returns to the council.`, tone: "warn" }
        : { who: "PCP Officer", name: d.app.assignedOfficerName, what: `The return date (${fmtDate(d.app.deferUntil)}) has come: the officer puts the case back on the council agenda.`, tone: "warn" };
    case "REJECTED":
      return { who: "Closed", what: "Rejected by the council. The grounds are in the decision letter.", tone: "bad" };
    case "NOC_ISSUED":
      return { who: "Closed", what: `Certificate ${d.app.certificateNo} issued ${fmtDate(d.app.issuedAt)}.`, tone: "good" };
    default:
      return { who: "—", what: "", tone: "info" };
  }
}

const CLOCK_TONE = { good: "good", warn: "warn", bad: "bad" } as const;

/** The service-level clock for the current stage, shown to both sides. */
export function StageClock({ d }: { d: AppDetail }) {
  const c = slaClock(d.app.status, d.app.stageDueAt);
  if (!c) return null;
  return (
    <span data-testid="sla-clock" title={`Due ${fmtDate(d.app.stageDueAt, true)}`}>
      <StatusDot tone={CLOCK_TONE[c.tone]}>
        <FieldTimeOutlined /> {c.stage} · {c.text}
      </StatusDot>
    </span>
  );
}

export function AppHeader({ d, extra }: { d: AppDetail; extra?: React.ReactNode }) {
  const status = d.app.status;
  const cur = stepIndex(status, d.deficiencyOrigin);
  const issued = status === "NOC_ISSUED";
  const mark = status === "REJECTED" ? "error" : ["DEFICIENCY_RAISED", "RESPONDED", "DEFERRED"].includes(status) ? "alert" : "";
  const court = courtFor(d);
  const t = COURT_TONE[court.tone];
  const last = d.events[d.events.length - 1];
  const clock = slaClock(status, d.app.stageDueAt);
  return (
    <Card style={{ marginBottom: 18 }} styles={{ body: { padding: "20px 22px" } }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div className="pcp-eyebrow">
            {kindLabel(d.app.kind)} · {programLabel(d.app.programType)}
            {d.app.campusName ? ` · ${d.app.campusName}` : ""}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 className="pcp-page-title mono" style={{ fontSize: 24, letterSpacing: "-0.01em" }}>
              {d.app.ref}
            </h1>
            <StatusTag status={status} />
            <StageClock d={d} />
          </div>
          <div className="muted" style={{ marginTop: 6, fontSize: 13.5 }}>
            {d.inst?.name} <span className="mono">({d.inst?.code})</span> · {d.inst?.city}, {d.inst?.province}
          </div>
        </div>
        {extra}
      </div>
      <div className="pcp-track" style={{ ["--track-n" as string]: TRACK_LABELS.length }}>
        {TRACK_LABELS.map((label, i) => {
          const cls = issued || i < cur ? "done" : i === cur ? `current ${mark}` : "";
          const title = i === cur && ["DEFICIENCY_RAISED", "RESPONDED", "APPROVED", "DEFERRED", "REJECTED"].includes(status) ? STATUS_LABELS[status] : label;
          return (
            <div key={label} className={`pcp-track-step ${cls}`}>
              <span className="pcp-track-dot">{issued || i < cur ? <CheckOutlined /> : i + 1}</span>
              {title}
            </div>
          );
        })}
      </div>
      <div className="pcp-court" style={{ marginTop: 18, background: t.bg, borderColor: t.bd }}>
        {court.name ? <Avatar name={court.name} size={36} /> : <span style={{ width: 36, height: 36, borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center", color: t.c }}>{court.who === "Closed" ? <SafetyCertificateFilled /> : <ClockCircleOutlined />}</span>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="pcp-court-title" style={{ color: t.c }}>
            {court.who === "Closed" ? "Closed" : `With: ${court.who}`}
            {court.name ? <span style={{ color: "var(--ink)", fontWeight: 500 }}> · {court.name}</span> : null}
          </div>
          <div className="pcp-court-sub">{court.what}</div>
        </div>
        {clock ? (
          <div style={{ fontSize: 12, textAlign: "right", whiteSpace: "nowrap" }}>
            <span className="faint">Due {fmtDate(d.app.stageDueAt)}</span>
            <br />
            <b style={{ color: clock.overdue ? "#b4141f" : clock.tone === "warn" ? "#a15c00" : "var(--ink-2)" }}>{clock.text}</b>
            {d.app.escalatedAt ? <div style={{ color: "#b4141f" }}>Escalated {fmtDate(d.app.escalatedAt)}</div> : null}
          </div>
        ) : last ? (
          <div className="faint" style={{ fontSize: 12, textAlign: "right", whiteSpace: "nowrap" }}>
            Last step
            <br />
            <span style={{ color: "var(--ink-2)" }}>{timeAgo(last.createdAt)}</span>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/** Where to fix each failing check on the institution's screen ("the user fixes that line"). */
const FIX: [RegExp, string][] = [
  [/^(fields|intake|labs|infrastructure|library|compliance)$/, "#case-form"],
  [/^(subject:|faculty_|duplicates|load)/, "#case-faculty"],
  [/^self_assessment$/, "#case-self"],
  [/^documents$/, "#case-documents"],
];

export function ChecksCard({ checks, onRecheck, recheckLoading, fixLinks, title = "Automatic checks" }: { checks: AppDetail["app"]["checks"]; onRecheck?: () => void; recheckLoading?: boolean; fixLinks?: boolean; title?: string }) {
  const failing = checks.filter((c) => !c.ok).length;
  const passed = checks.length - failing;
  const sorted = [...checks].sort((a, b) => Number(a.ok) - Number(b.ok));
  return (
    <Card
      size="small"
      id="case-checks"
      title={
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          {title}
          {checks.length ? failing ? <Pill value="FLAGGED" label={`${failing} failing`} /> : <Pill value="APPROVED" label="All passing" /> : <Pill value="NONE" label="Not run" />}
        </span>
      }
      extra={onRecheck ? <Button size="small" icon={<ReloadOutlined />} onClick={onRecheck} loading={recheckLoading}>Re-run</Button> : null}
    >
      {checks.length ? (
        <div style={{ height: 6, borderRadius: 6, background: "var(--line-2)", overflow: "hidden", marginBottom: 6 }}>
          <div style={{ height: "100%", width: `${(passed / checks.length) * 100}%`, background: failing ? "#e8a20c" : "#12a150", transition: "width .3s" }} />
        </div>
      ) : null}
      {sorted.length === 0 ? <div className="faint" style={{ padding: "12px 0", fontSize: 13 }}>Save the form to run the checks</div> : null}
      <div>
        {sorted.map((c, i) => {
          const fix = fixLinks && !c.ok ? FIX.find(([re]) => re.test(c.key))?.[1] : undefined;
          return (
            <div key={c.key} className={c.ok ? "check-ok" : "check-fail"} data-check={c.key} style={{ padding: "8px 0", borderTop: i ? "1px solid var(--line-2)" : undefined }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start", width: "100%" }}>
                {c.ok ? <CheckCircleFilled style={{ color: "#12a150", marginTop: 3 }} /> : <CloseCircleFilled style={{ color: "#cf1322", marginTop: 3 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{c.label}</div>
                  <div style={{ fontSize: 12.5, color: c.ok ? "var(--muted)" : "#b4141f" }}>{c.detail}</div>
                </div>
                {fix ? (
                  <a href={fix} style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>
                    Fix
                  </a>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: "8px 0 0" }}>
        Rules come from a versioned table (per-subject faculty, teacher load, intake, labs, library, documents, dues), so PCP can change them without code changes.
      </Typography.Paragraph>
    </Card>
  );
}

export function DocumentsCard({ d, uploadable, title = "Documents" }: { d: AppDetail; uploadable: boolean; title?: string }) {
  const router = useRouter();
  const { message } = App.useApp();
  const have = new Set(d.documents.filter((x) => !x.deficiencyId).map((x) => x.docType));
  const send = async (file: File, docType: string) => {
    try {
      const j = await uploadDocument(file, { docType, applicationRef: d.app.ref });
      message.success(`Uploaded v${j.version} · SHA-256 ${String(j.sha256).slice(0, 12)}…`);
      router.refresh();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Upload failed");
      throw e;
    }
  };
  const upload = (docType: string) => (
    <Upload
      showUploadList={false}
      customRequest={async ({ file, onSuccess, onError }) => {
        try {
          await send(file as File, docType);
          onSuccess?.({});
        } catch (e) {
          onError?.(e as Error);
        }
      }}
    >
      <Button size="small" icon={<UploadOutlined />}>
        {have.has(docType) ? "New version" : "Upload"}
      </Button>
    </Upload>
  );

  return (
    <Card size="small" title={title} id="case-documents" style={{ marginBottom: 16 }}>
      {d.requiredDocs.length && d.app.status === "DRAFT" ? (
        <div>
          <div style={{ fontWeight: 600, padding: "4px 0 8px", borderBottom: "1px solid var(--line-2)" }}>
            Required for this application · {d.requiredDocs.filter((r) => have.has(r)).length} of {d.requiredDocs.length} attached
          </div>
          {d.requiredDocs.map((r) => (
            <div key={r} className="required-doc" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--line-2)" }}>
              <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
                {have.has(r) ? <CheckCircleFilled style={{ color: "#12a150" }} /> : <span style={{ width: 14, height: 14, borderRadius: 7, border: "2px solid #c9d1cd", display: "inline-block" }} />}
                {r}
              </span>
              {uploadable ? (
                <span style={{ display: "inline-flex", gap: 8 }}>
                  {!have.has(r) ? <SamplePdfButton docLabel={r} onFile={(f) => send(f, r)} /> : null}
                  {upload(r)}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <Table
        size="small"
        rowKey="id"
        style={{ marginTop: 8 }}
        pagination={false}
        dataSource={d.documents}
        locale={{ emptyText: "No documents yet" }}
        columns={[
          {
            title: "Document",
            dataIndex: "fileName",
            render: (v, r) => (
              <a href={`/api/documents/${r.id}`} target="_blank" rel="noreferrer" style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
                <FilePdfOutlined style={{ fontSize: 18, color: "#b4141f" }} />
                <span>
                  <span style={{ display: "block", color: "var(--ink)", fontWeight: 500 }}>{r.docType}</span>
                  <span style={{ fontSize: 12 }}>
                    <DownloadOutlined /> {v} · v{r.version}
                  </span>
                </span>
              </a>
            ),
          },
          { title: "Fingerprint", dataIndex: "sha256", render: (v) => <Typography.Text className="mono" copyable={{ text: v }}>{v.slice(0, 10)}…</Typography.Text> },
          { title: "Status", dataIndex: "verificationStatus", render: (v) => <Pill value={v} /> },
          { title: "Uploaded", render: (_, r) => <span style={{ fontSize: 12.5 }}>{r.uploadedBy}<div className="faint">{fmtDate(r.uploadedAt, true)}</div></span> },
        ]}
      />
    </Card>
  );
}

export function TimelineCard({ d }: { d: AppDetail }) {
  const events = [...d.events].reverse();
  return (
    <Card size="small" title="Timeline" extra={<span className="faint" style={{ fontSize: 12 }}>Every step is in the audit log</span>}>
      <div style={{ position: "relative" }}>
        {events.map((e, i) => (
          <div key={e.id} style={{ display: "flex", gap: 12, paddingBottom: i === events.length - 1 ? 0 : 14, position: "relative" }}>
            {i < events.length - 1 ? <span style={{ position: "absolute", left: 13, top: 28, bottom: 0, width: 2, background: "var(--line)" }} /> : null}
            <Avatar name={e.actor} size={28} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{STATUS_LABELS[e.toStatus] ?? e.toStatus}</div>
              <div className="faint" style={{ fontSize: 12 }}>
                {e.actor} · {fmtDate(e.createdAt, true)}
              </div>
              {e.note ? <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 2 }}>{e.note}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function CertificateCard({ d }: { d: AppDetail }) {
  if (!d.app.certificateNo) return null;
  const acc = d.app.kind !== "NOC";
  return (
    <div style={{ marginBottom: 16, borderRadius: 14, padding: 18, color: "#fff", background: "linear-gradient(135deg,#0a3d2e,#0b6e4f)", boxShadow: "var(--shadow-md)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#f3e7c6", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        <SafetyCertificateFilled /> {acc ? "Accreditation certificate issued" : "Certificate issued"}
      </div>
      <div className="mono" style={{ fontSize: 17, marginTop: 8, color: "#fff" }}>
        {d.app.certificateNo}
      </div>
      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", marginTop: 2 }}>
        Issued {fmtDate(d.app.issuedAt)} · valid until {fmtDate(d.app.validUntil)}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <Link href={`/certificate/${d.app.certificateNo}`}>
          <Button style={{ background: "#fff", color: "#0a3d2e", border: 0, fontWeight: 600 }}>View / print certificate</Button>
        </Link>
        <Link href={`/verify/certificate/${d.app.certificateNo}`}>
          <Button ghost icon={<QrcodeOutlined />}>
            Public check
          </Button>
        </Link>
      </div>
    </div>
  );
}

/** The council's decision, its reason or grounds, the return date of a deferral, and the decision letter. */
export function DecisionCard({ d }: { d: AppDetail }) {
  const dec = d.app.decision;
  if (!dec || !["APPROVED", "DEFERRED", "REJECTED", "NOC_ISSUED"].includes(d.app.status)) return null;
  const tone = dec === "APPROVED" ? { c: "#0d7a3d", bg: "#f3fbf6", bd: "#c9ecd8", icon: <CheckCircleFilled /> } : dec === "DEFERRED" ? { c: "#a15c00", bg: "#fffaf0", bd: "#ffe1a8", icon: <ClockCircleOutlined /> } : { c: "#b4141f", bg: "#fff6f5", bd: "#ffccc7", icon: <CloseCircleFilled /> };
  const title = dec === "APPROVED" ? "Approved by the council" : dec === "DEFERRED" ? `Deferred until ${fmtDate(d.app.deferUntil)}` : "Rejected by the council";
  return (
    <Card size="small" style={{ marginBottom: 16, borderColor: tone.bd, background: tone.bg }} data-testid="decision-card">
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <span style={{ fontSize: 22, color: tone.c, lineHeight: 1 }}>{tone.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 650, color: tone.c }}>{title}</div>
          <div className="faint" style={{ fontSize: 12 }}>Decided {fmtDate(d.app.decidedAt, true)}</div>
          {dec === "DEFERRED" ? (
            <div style={{ marginTop: 8, fontSize: 13.5 }}>
              <b>Reason:</b> {d.app.decisionGrounds}
              <div style={{ marginTop: 4 }}>
                <b>Return date:</b> {fmtDate(d.app.deferUntil)}. Answer the reason before then; the case then goes back on the council agenda.
              </div>
            </div>
          ) : dec === "REJECTED" ? (
            <div style={{ marginTop: 8, fontSize: 13.5 }}>
              <b>Grounds:</b> {d.app.decisionGrounds}
            </div>
          ) : d.app.decisionNote ? (
            <div style={{ marginTop: 8, fontSize: 13.5 }}>
              <b>Conditions:</b> {d.app.decisionNote}
            </div>
          ) : null}
          {d.letter ? (
            <a href={`/api/documents/${d.letter.id}`} target="_blank" rel="noreferrer" data-testid="decision-letter" style={{ display: "inline-flex", gap: 8, alignItems: "center", marginTop: 10, fontWeight: 500 }}>
              <FilePdfOutlined style={{ color: "#b4141f", fontSize: 16 }} /> Decision letter (PDF, v{d.letter.version}) <DownloadOutlined />
            </a>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/** Every email and SMS stored on this case (guide section 12). */
export function MessagesCard({ d }: { d: AppDetail }) {
  const [open, setOpen] = useState<AppDetail["messages"][number] | null>(null);
  return (
    <Card size="small" title={<span><MailOutlined style={{ marginRight: 8, color: "var(--brand)" }} />Messages</span>} extra={<span className="faint" style={{ fontSize: 12 }}>{d.messages.length} stored on this case</span>} style={{ marginBottom: 16 }} styles={{ body: { padding: 0 } }} data-testid="case-messages">
      {d.messages.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No messages on this case yet" style={{ padding: 16 }} />
      ) : (
        <Table
          size="small"
          rowKey="id"
          dataSource={d.messages}
          pagination={{ pageSize: 6, hideOnSinglePage: true, size: "small" }}
          onRow={(r) => ({ onClick: () => setOpen(r), style: { cursor: "pointer" } })}
          columns={[
            { title: "Sent", dataIndex: "createdAt", width: 130, render: (v) => <span style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>{fmtDate(v, true)}</span> },
            { title: "", dataIndex: "channel", width: 34, render: (v) => (v === "SMS" ? <MessageOutlined style={{ color: "#5b3cc4" }} /> : <MailOutlined style={{ color: "#1d5fb0" }} />) },
            { title: "To", render: (_, r) => <span style={{ fontSize: 12.5 }}>{r.toName ?? r.toAddress}</span> },
            { title: "Subject", dataIndex: "subject", ellipsis: true },
          ]}
        />
      )}
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.subject} size="large">
        {open ? (
          <>
            <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
              {open.channel} to {open.toName ? `${open.toName} · ` : ""}
              <span className="mono">{open.toAddress}</span> · {fmtDate(open.createdAt, true)}
            </div>
            <Typography.Paragraph style={{ whiteSpace: "pre-wrap", background: "var(--bg)", padding: 16, borderRadius: 12, fontSize: 14 }}>{open.body}</Typography.Paragraph>
          </>
        ) : null}
      </Drawer>
    </Card>
  );
}

/** Per-subject count of linked teachers against the rule. */
export function SubjectChips({ d }: { d: AppDetail }) {
  if (!d.subjects.length) return null;
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      {d.subjects.map((s) => (
        <Tag key={s.name} color={s.linked >= s.required ? "green" : "red"} style={{ marginInlineEnd: 0 }}>
          {s.name} {s.linked}/{s.required}
        </Tag>
      ))}
    </span>
  );
}

type FacultyRow = AppDetail["faculty"][number];

/** Faculty linked to the case by Faculty ID. `actions` adds per-row controls (institution drafts only). */
export function CaseFacultyTable({ d, actions, subjectCell }: { d: AppDetail; actions?: (r: FacultyRow) => React.ReactNode; subjectCell?: (r: FacultyRow) => React.ReactNode }) {
  return (
    <Table
      size="small"
      rowKey="facultyId"
      pagination={false}
      dataSource={d.faculty}
      locale={{ emptyText: "No faculty linked yet. Find each teacher by Faculty ID, CNIC or name." }}
      columns={[
        { title: "Faculty ID", dataIndex: "pcpId", width: 140, render: (v) => <span className="mono" style={{ fontSize: 12.5 }}>{v}</span> },
        { title: "Teacher", render: (_, r) => <span>{r.fullName}<div className="faint" style={{ fontSize: 12 }}>{r.designation} · {r.qualification} {r.specialization}</div></span> },
        { title: "Subject", dataIndex: "subject", render: (v, r) => (subjectCell ? subjectCell(r) : v) },
        {
          title: "Record",
          render: (_, r) => {
            const warn = !r.activeHere ? "Not active here" : r.openFlag || r.verificationStatus === "FLAGGED" ? "Possible duplicate" : r.otherCases.length ? `Also on ${r.otherCases.join(", ")}` : r.appointedTo && r.appointedTo !== d.app.programType ? `Appointed to ${programLabel(r.appointedTo)}` : null;
            return warn ? (
              <span style={{ color: "#b4141f", fontSize: 12.5 }}>
                <WarningFilled /> {warn}
              </span>
            ) : (
              <Pill value={r.verificationStatus} />
            );
          },
        },
        ...(actions ? [{ title: "", width: 60, align: "right" as const, render: (_: unknown, r: FacultyRow) => actions(r) }] : []),
      ]}
    />
  );
}

const RATING: Record<string, { label: string; tone: "good" | "warn" | "bad" }> = { MET: { label: "Met", tone: "good" }, PARTLY: { label: "Partly met", tone: "warn" }, NOT_MET: { label: "Not met", tone: "bad" } };

export function SelfAssessmentTable({ items }: { items: AppDetail["app"]["selfAssessment"] }) {
  return (
    <Table
      size="small"
      rowKey="criterion"
      pagination={false}
      dataSource={items}
      locale={{ emptyText: "Not filed yet" }}
      columns={[
        { title: "Criterion", dataIndex: "criterion" },
        { title: "Rating", dataIndex: "rating", width: 120, render: (v) => <StatusDot tone={RATING[v]?.tone ?? "neutral"}>{RATING[v]?.label ?? v}</StatusDot> },
        { title: "Comment", dataIndex: "comment", render: (v) => v || <span className="faint">—</span> },
      ]}
    />
  );
}

export function DataDescriptions({ d }: { d: AppDetail }) {
  const data = d.app.data;
  const rows: [string, React.ReactNode][] = [
    ["Campus", d.app.campusName],
    ["Proposed intake", data.proposedIntake ? `${data.proposedIntake} students / year` : null],
    ...(d.period ? ([["Accreditation term", `${d.period.from}–${d.period.until}`]] as [string, React.ReactNode][]) : []),
    ["Classrooms", data.classrooms],
    ["Laboratories", data.labs],
    ["Lab list", data.labList],
    ["Library books", data.libraryBooks],
    ["Journals", data.libraryJournals],
    ["Building area", data.buildingAreaSqft ? `${Number(data.buildingAreaSqft).toLocaleString()} sq ft` : null],
    ...(d.app.kind === "RENEWAL" ? ([["Annual compliance", data.complianceConfirmed ? "Confirmed by the institution" : "Not confirmed"]] as [string, React.ReactNode][]) : []),
    ["Notes", data.notes],
  ];
  return (
    <dl className="pcp-kv" style={{ margin: 0 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
