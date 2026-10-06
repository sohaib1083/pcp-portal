"use client";
// Small pieces shared by the council, appeal and help desk screens.
import { ClockCircleOutlined, FilePdfOutlined } from "@ant-design/icons";
import { StatusDot, fmtDate } from "./common";

type Tone = Parameters<typeof StatusDot>[0]["tone"];

const LABELS: Record<string, [string, Tone]> = {
  // meetings
  PLANNED: ["Planned", "info"],
  IN_SESSION: ["In session", "teal"],
  CLOSED: ["Closed", "neutral"],
  // appeals
  FILED: ["Filed", "info"],
  UNDER_REVIEW: ["Under review", "violet"],
  ON_AGENDA: ["Ready for council", "teal"],
  UPHELD: ["Upheld", "good"],
  DISMISSED: ["Dismissed", "bad"],
  WITHDRAWN: ["Withdrawn", "neutral"],
  // tickets
  OPEN: ["Open", "info"],
  IN_PROGRESS: ["In progress", "violet"],
  RESOLVED: ["Resolved", "good"],
  // decisions
  APPROVED: ["Approved", "good"],
  DEFERRED: ["Deferred", "warn"],
  REJECTED: ["Rejected", "bad"],
};

export function ModuleStatus({ status, label }: { status: string; label?: string }) {
  const [l, tone] = LABELS[status] ?? [status.replace(/_/g, " ").toLowerCase(), "neutral" as Tone];
  return <StatusDot tone={tone}>{label ?? l}</StatusDot>;
}

export const DECISION_TEXT: Record<string, string> = {
  APPROVED: "Approve",
  DEFERRED: "Defer",
  REJECTED: "Reject",
  UPHELD: "Uphold the appeal",
  DISMISSED: "Dismiss the appeal",
};

export function DecisionPill({ decision }: { decision: string }) {
  const label = { APPROVED: "Approved", DEFERRED: "Deferred", REJECTED: "Rejected", UPHELD: "Appeal upheld", DISMISSED: "Appeal dismissed" }[decision] ?? decision;
  return <ModuleStatus status={decision} label={label} />;
}

function span(ms: number) {
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.max(1, Math.floor((abs % 3600000) / 60000));
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** The service-level clock: time left, or how long overdue. Computed on the server so it never flickers. */
export function SlaClock({ sla, dueAt, compact }: { sla: { state: string; msLeft: number }; dueAt: string | null; compact?: boolean }) {
  const style: Record<string, { c: string; bg: string; bd: string; text: string }> = {
    OVERDUE: { c: "#b4141f", bg: "#fff1f0", bd: "#ffccc7", text: `Overdue by ${span(sla.msLeft)}` },
    DUE_SOON: { c: "#a15c00", bg: "#fff7e6", bd: "#ffe1a8", text: `${span(sla.msLeft)} left` },
    ON_TRACK: { c: "#0d7a3d", bg: "#e9f7ef", bd: "#c9ecd8", text: `${span(sla.msLeft)} left` },
    MET: { c: "#55625c", bg: "#f2f4f3", bd: "#e1e6e3", text: "Resolved in time" },
    MISSED: { c: "#a15c00", bg: "#fff7e6", bd: "#ffe1a8", text: `Resolved ${span(sla.msLeft)} late` },
  };
  const s = style[sla.state] ?? style.ON_TRACK;
  return (
    <span className="pcp-sla" title={dueAt ? `Time limit: ${fmtDate(dueAt, true)}` : undefined} style={{ display: "inline-flex", flexDirection: "column", gap: 2, lineHeight: 1.2 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: s.c, background: s.bg, border: `1px solid ${s.bd}`, borderRadius: 999, padding: "2px 9px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", width: "fit-content" }}>
        <ClockCircleOutlined />
        {s.text}
      </span>
      {!compact && dueAt ? <span className="faint" style={{ fontSize: 11.5 }}>Due {fmtDate(dueAt, true)}</span> : null}
    </span>
  );
}

export function DocLink({ id, label, sub }: { id: number; label: string; sub?: string }) {
  return (
    <a href={`/api/documents/${id}`} target="_blank" rel="noreferrer" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <FilePdfOutlined style={{ fontSize: 16, color: "#b4141f" }} />
      <span>
        <span style={{ fontWeight: 500 }}>{label}</span>
        {sub ? <span className="faint" style={{ fontSize: 12, display: "block" }}>{sub}</span> : null}
      </span>
    </a>
  );
}

/** A quoted block of text: recommendation, grounds, review note. */
export function Quote({ label, children, tone = "neutral" }: { label: React.ReactNode; children: React.ReactNode; tone?: "neutral" | "brand" | "warn" }) {
  const c = { neutral: ["var(--bg)", "var(--line)"], brand: ["#f3f9f6", "#cfe6da"], warn: ["#fffaf0", "#ffe1a8"] }[tone];
  return (
    <div style={{ background: c[0], border: `1px solid ${c[1]}`, borderRadius: 10, padding: "10px 12px", fontSize: 13.5 }}>
      <div className="faint" style={{ fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}
