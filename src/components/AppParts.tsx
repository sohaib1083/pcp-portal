"use client";
// Pieces shared by the institution and PCP application screens.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { App, Button, Card, List, Table, Typography, Upload } from "antd";
import {
  CheckCircleFilled,
  CheckOutlined,
  ClockCircleOutlined,
  CloseCircleFilled,
  DownloadOutlined,
  FilePdfOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  SafetyCertificateFilled,
  UploadOutlined,
} from "@ant-design/icons";
import type { AppDetail } from "@/lib/appdetail";
import { STATUS_LABELS, stepIndex } from "@/lib/workflow";
import { Avatar, Pill, StatusTag, fmtDate, kindLabel, programLabel, timeAgo } from "./common";
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

const TRACK = ["Draft", "Submitted", "Scrutiny", "Inspection", "Report", "Council", "Certificate"];

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

/** Who holds the file right now. Applicants always see this (HEC's attestation system did not show it). */
export function courtFor(d: AppDetail): Court {
  const inspection = d.inspections.find((i) => i.status === "SCHEDULED");
  switch (d.app.status) {
    case "DRAFT":
      return { who: "Institution", name: d.inst?.name, what: "Complete the form, pass the automatic checks, pay the fee and submit.", tone: "brand" };
    case "SUBMITTED":
      return { who: "PCP Officer", what: "Waiting for an officer to start scrutiny.", tone: "info" };
    case "UNDER_SCRUTINY":
      return { who: "PCP Officer", name: d.app.assignedOfficerName, what: "Scrutiny in progress: deficiencies may be raised, then an inspection is scheduled.", tone: "info" };
    case "DEFICIENCY_RAISED":
      return { who: "Institution", name: d.inst?.name, what: `Respond to the formal deficiency by ${fmtDate(d.deficiencies.find((x) => x.status === "OUTSTANDING" || x.status === "REJECTED")?.dueDate)}.`, tone: "warn" };
    case "RESPONDED":
      return { who: "PCP Officer", name: d.app.assignedOfficerName, what: "Reviewing the institution's response and evidence.", tone: "info" };
    case "INSPECTION_SCHEDULED":
      return { who: "PCP Inspector", name: inspection?.inspectorName, what: `On-site inspection scheduled for ${fmtDate(inspection?.scheduledFor)}.`, tone: "violet" };
    case "INSPECTION_SUBMITTED":
      return { who: "PCP Officer", name: d.app.assignedOfficerName, what: "Reviewing the inspection report before forwarding to the council.", tone: "info" };
    case "COUNCIL_REVIEW":
      return { who: "Council (Secretary)", what: "On the council agenda for a recorded decision.", tone: "teal" };
    case "APPROVED":
      return { who: "Council (Secretary)", what: "Approved by the council. The certificate is being issued.", tone: "teal" };
    case "DEFERRED":
      return { who: "PCP Officer", name: d.app.assignedOfficerName, what: "Deferred by the council: open points go back to the institution.", tone: "warn" };
    case "REJECTED":
      return { who: "Closed", what: "Rejected by the council. A rejection letter is on file.", tone: "bad" };
    case "NOC_ISSUED":
      return { who: "Closed", what: `Certificate ${d.app.certificateNo} issued ${fmtDate(d.app.issuedAt)}.`, tone: "good" };
    default:
      return { who: "—", what: "", tone: "info" };
  }
}

export function AppHeader({ d, extra }: { d: AppDetail; extra?: React.ReactNode }) {
  const status = d.app.status;
  const cur = stepIndex(status);
  const issued = status === "NOC_ISSUED";
  const mark = status === "REJECTED" ? "error" : ["DEFICIENCY_RAISED", "RESPONDED", "DEFERRED"].includes(status) ? "alert" : "";
  const court = courtFor(d);
  const t = COURT_TONE[court.tone];
  const last = d.events[d.events.length - 1];
  return (
    <Card style={{ marginBottom: 18 }} styles={{ body: { padding: "20px 22px" } }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div className="pcp-eyebrow">
            {kindLabel(d.app.kind)} · {programLabel(d.app.programType)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 className="pcp-page-title mono" style={{ fontSize: 24, letterSpacing: "-0.01em" }}>
              {d.app.ref}
            </h1>
            <StatusTag status={status} />
          </div>
          <div className="muted" style={{ marginTop: 6, fontSize: 13.5 }}>
            {d.inst?.name} <span className="mono">({d.inst?.code})</span> · {d.inst?.city}, {d.inst?.province}
          </div>
        </div>
        {extra}
      </div>
      <div className="pcp-track">
        {TRACK.map((label, i) => {
          const cls = issued || i < cur ? "done" : i === cur ? `current ${mark}` : "";
          const title = i === 2 && (status === "DEFICIENCY_RAISED" || status === "RESPONDED") ? STATUS_LABELS[status] : i === 5 && ["APPROVED", "DEFERRED", "REJECTED"].includes(status) ? STATUS_LABELS[status] : label;
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
        {last ? (
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

export function ChecksCard({ checks, onRecheck, recheckLoading }: { checks: AppDetail["app"]["checks"]; onRecheck?: () => void; recheckLoading?: boolean }) {
  const failing = checks.filter((c) => !c.ok).length;
  const passed = checks.length - failing;
  return (
    <Card
      size="small"
      title={
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          Automatic checks
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
      <List
        size="small"
        dataSource={checks}
        locale={{ emptyText: "Save the form to run the checks" }}
        renderItem={(c) => (
          <List.Item style={{ paddingInline: 0 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              {c.ok ? <CheckCircleFilled style={{ color: "#12a150", marginTop: 3 }} /> : <CloseCircleFilled style={{ color: "#cf1322", marginTop: 3 }} />}
              <div>
                <div style={{ fontWeight: 500 }}>{c.label}</div>
                <div style={{ fontSize: 12.5, color: c.ok ? "var(--muted)" : "#b4141f" }}>{c.detail}</div>
              </div>
            </div>
          </List.Item>
        )}
      />
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: "8px 0 0" }}>
        Rules come from a versioned table (faculty ratio, intake limit, labs, library, documents), so PCP can change them without code changes.
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
    <Card size="small" title={title}>
      {d.requiredDocs.length && d.app.status === "DRAFT" ? (
        <List
          size="small"
          header={
            <span style={{ fontWeight: 600 }}>
              Required for this application · {d.requiredDocs.filter((r) => have.has(r)).length} of {d.requiredDocs.length} attached
            </span>
          }
          dataSource={d.requiredDocs}
          renderItem={(r) => (
            <List.Item actions={uploadable ? [!have.has(r) ? <SamplePdfButton key="s" docLabel={r} onFile={(f) => send(f, r)} /> : null, upload(r)].filter(Boolean) : []}>
              <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
                {have.has(r) ? <CheckCircleFilled style={{ color: "#12a150" }} /> : <span style={{ width: 14, height: 14, borderRadius: 7, border: "2px solid #c9d1cd", display: "inline-block" }} />}
                {r}
              </span>
            </List.Item>
          )}
        />
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
  return (
    <div style={{ marginBottom: 16, borderRadius: 14, padding: 18, color: "#fff", background: "linear-gradient(135deg,#0a3d2e,#0b6e4f)", boxShadow: "var(--shadow-md)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#f3e7c6", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        <SafetyCertificateFilled /> Certificate issued
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

export function DataDescriptions({ data }: { data: AppDetail["app"]["data"] }) {
  const rows: [string, React.ReactNode][] = [
    ["Campus", data.campus],
    ["Proposed intake", data.proposedIntake ? `${data.proposedIntake} students / year` : null],
    ["Classrooms", data.classrooms],
    ["Laboratories", data.labs],
    ["Lab list", data.labList],
    ["Library books", data.libraryBooks],
    ["Journals", data.libraryJournals],
    ["Building area", data.buildingAreaSqft ? `${Number(data.buildingAreaSqft).toLocaleString()} sq ft` : null],
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
