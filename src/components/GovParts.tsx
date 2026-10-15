"use client";
// Small pieces shared by the court case, correspondence and committee screens.
import Link from "next/link";
import { Button, Upload } from "antd";
import { DownloadOutlined, FilePdfOutlined, InboxOutlined, StopOutlined } from "@ant-design/icons";
import { COURT_STATUS, LETTER_STATUS, TASK_STATUS, refHref } from "@/lib/governance-shared";
import { StatusDot, fmtDate } from "./common";
import { SamplePdfButton } from "./demo-helpers";

export function CourtStatus({ status }: { status: string }) {
  const s = COURT_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <StatusDot tone={s.tone}>{s.label}</StatusDot>;
}

export function LetterStatus({ status, direction, dispatchedAt }: { status: string; direction?: string; dispatchedAt?: string | null }) {
  if (direction === "OUT" && !dispatchedAt && status !== "CLOSED") return <StatusDot tone="warn">Draft, not sent</StatusDot>;
  const s = LETTER_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <StatusDot tone={s.tone}>{direction === "OUT" && status === "ACTIONED" ? "Dispatched" : s.label}</StatusDot>;
}

export function TaskStatus({ status, overdue }: { status: string; overdue?: boolean }) {
  if (overdue && status !== "DONE") return <StatusDot tone="bad">Overdue</StatusDot>;
  const s = TASK_STATUS[status] ?? { label: status, tone: "info" as const };
  return <StatusDot tone={s.tone}>{s.label}</StatusDot>;
}

/** A reference that opens its PCP screen. */
export function RefLink({ refNo, strong = true }: { refNo: string | null | undefined; strong?: boolean }) {
  if (!refNo) return <span className="faint">—</span>;
  const href = refHref(refNo);
  const el = (
    <span className="mono" style={{ fontWeight: strong ? 600 : 500, fontSize: 13, whiteSpace: "nowrap" }}>
      {refNo}
    </span>
  );
  return href ? <Link href={href}>{el}</Link> : el;
}

/** For the demo fill: an open case of the institution (not issued, rejected or withdrawn), else any of its cases. */
export function openCaseOf(refs: { ref: string; kind: string; institutionId: number | null; label: string }[], institutionId: number) {
  const mine = refs.filter((r) => r.institutionId === institutionId && r.kind === "case");
  return (mine.find((r) => !/issued|rejected|withdrawn|approved/.test(r.label)) ?? mine[0])?.ref;
}

/** "in 3 days", "tomorrow", "today", "2 days ago" */
export function relDays(days: number) {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** The red banner: a court's stay order stops action on this case. */
export function StayBanner({ text, courtRef, sub }: { text: string; courtRef: string; sub?: React.ReactNode }) {
  return (
    <div className="gov-stay-banner" role="alert" style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 16px", marginBottom: 16, borderRadius: 12, border: "1px solid #f5b5b0", background: "#fff1f0", color: "#8f1119" }}>
      <StopOutlined style={{ fontSize: 20, marginTop: 2, color: "#b4141f" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 650, fontSize: 14.5 }}>{text}</div>
        <div style={{ fontSize: 12.5, color: "#a8323a", marginTop: 2 }}>
          {sub ?? "Council decisions and certificates on this case are blocked until the legal officer lifts the stay."}{" "}
          <Link href={`/pcp/litigation/${courtRef}`} style={{ color: "#8f1119", fontWeight: 600, textDecoration: "underline" }}>
            Open {courtRef}
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Choose a PDF or image, or (demo) attach a generated sample PDF. */
export function FilePick({ file, onFile, sample, id }: { file: File | null; onFile: (f: File | null) => void; sample: string; id?: string }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <Upload
        accept=".pdf,.png,.jpg,.jpeg"
        maxCount={1}
        showUploadList={false}
        beforeUpload={(f) => {
          onFile(f);
          return false;
        }}
      >
        <Button icon={<InboxOutlined />}>{file ? "Replace file" : "Choose file"}</Button>
      </Upload>
      <SamplePdfButton docLabel={sample} onFile={(f) => onFile(f)} />
      {file ? (
        <span id={id} className="gov-file" style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          <FilePdfOutlined style={{ color: "#b4141f" }} /> {file.name} <span className="faint">({Math.max(1, Math.ceil(file.size / 1024))} KB)</span>
        </span>
      ) : (
        <span className="faint" style={{ fontSize: 13 }}>No file chosen</span>
      )}
    </div>
  );
}

/** Send a file to the governance upload route. */
export async function uploadGov(o: { target: "court" | "letter"; ref: string; file: File; docType?: string; orderId?: number }) {
  const fd = new FormData();
  fd.append("target", o.target);
  fd.append("ref", o.ref);
  fd.append("file", o.file);
  if (o.docType) fd.append("docType", o.docType);
  if (o.orderId) fd.append("orderId", String(o.orderId));
  const res = await fetch("/api/governance/upload", { method: "POST", body: fd });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
  return { ok: res.ok && !!j.ok, message: j.message ?? j.error ?? `Upload failed (HTTP ${res.status}).` };
}

/** Excel and PDF export buttons. */
export function ExportButtons({ href }: { href: string }) {
  const sep = href.includes("?") ? "&" : "?";
  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
      <a href={`${href}${sep}format=xlsx`}>
        <Button icon={<DownloadOutlined />}>Excel</Button>
      </a>
      <a href={`${href}${sep}format=pdf`}>
        <Button icon={<DownloadOutlined />}>PDF</Button>
      </a>
    </span>
  );
}

type Doc = { id: number; docType: string; fileName: string; version: number; sha256: string; uploadedBy: string | null; uploadedAt: string };

/** Documents with every version (newest first within each type). */
export function DocList({ docs, empty = "No documents filed yet." }: { docs: Doc[]; empty?: string }) {
  if (!docs.length) return <div className="faint" style={{ fontSize: 13 }}>{empty}</div>;
  const latest = new Map<string, number>();
  for (const d of docs) if (!latest.has(d.docType) || d.version > latest.get(d.docType)!) latest.set(d.docType, d.version);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {docs.map((d) => {
        const current = latest.get(d.docType) === d.version;
        return (
          <div key={d.id} style={{ display: "flex", gap: 10, alignItems: "center", opacity: current ? 1 : 0.65 }}>
            <FilePdfOutlined style={{ fontSize: 16, color: "#b4141f" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <a href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer" style={{ fontWeight: 500 }}>
                {d.docType}
              </a>{" "}
              <span className="faint" style={{ fontSize: 12 }}>
                v{d.version}
                {current ? "" : " (earlier version)"} · {d.fileName}
              </span>
              <div className="faint" style={{ fontSize: 11.5 }}>
                {d.uploadedBy} · {fmtDate(d.uploadedAt, true)} · SHA-256 {d.sha256.slice(0, 10)}…
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const ACTION_TEXT: Record<string, string> = {
  "litigation.case.created": "Entered in the ledger",
  "litigation.hearing.added": "Hearing listed",
  "litigation.hearing.recorded": "Hearing recorded",
  "litigation.hearing.reminder": "Hearing reminder sent",
  "litigation.order.recorded": "Order recorded",
  "litigation.stay.lifted": "Stay lifted",
  "litigation.status.changed": "Status changed",
  "litigation.document.filed": "Document filed",
  "correspondence.registered": "Entered in the diary",
  "correspondence.marked": "Marked to an officer",
  "correspondence.actioned": "Action recorded",
  "correspondence.closed": "Closed",
  "correspondence.generated": "Letter generated",
  "correspondence.regenerated": "Letter regenerated",
  "correspondence.dispatched": "Dispatched",
  "correspondence.document.filed": "Document filed",
  "correspondence.reminder": "Reminder sent",
};

export function History({ rows }: { rows: { id: number; action: string; actor: string; at: string; details?: Record<string, unknown> }[] }) {
  if (!rows.length) return <div className="faint" style={{ fontSize: 13 }}>Nothing yet.</div>;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {rows.map((h) => (
        <div key={h.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--brand)", marginTop: 6, flex: "none" }} />
          <div style={{ fontSize: 13 }}>
            <div style={{ fontWeight: 500 }}>{ACTION_TEXT[h.action] ?? h.action}</div>
            <div className="faint" style={{ fontSize: 12 }}>
              {h.actor === "system" ? "System" : h.actor} · {fmtDate(h.at, true)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
