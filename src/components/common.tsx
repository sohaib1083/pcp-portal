"use client";
import { Tooltip } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import { STATUS_LABELS, KIND_LABELS, PROGRAM_LABELS } from "@/lib/workflow";

// ---------- Brand ----------

/** PCP Digital Portal mark: a shield with a capsule. Not PCP's official emblem. */
export function Logo({ size = 36, variant = "light" }: { size?: number; variant?: "light" | "dark" }) {
  const bg = variant === "light" ? "#ffffff" : "#0b6e4f";
  const shield = variant === "light" ? "#0b6e4f" : "#ffffff";
  const pill = variant === "light" ? "#ffffff" : "#0b6e4f";
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" style={{ flex: "none" }}>
      <rect width="40" height="40" rx="10" fill={bg} />
      <path d="M20 6.5l10.5 4v8.7c0 6.9-4.5 12.1-10.5 14.3-6-2.2-10.5-7.4-10.5-14.3v-8.7l10.5-4z" fill={shield} />
      <g transform="rotate(-40 20 20)">
        <rect x="13" y="16.6" width="14" height="6.8" rx="3.4" fill={pill} />
        <rect x="20" y="16.6" width="7" height="6.8" rx="3.4" fill="#c8a24a" />
        <rect x="20" y="16.6" width="3.4" height="6.8" fill="#c8a24a" />
      </g>
    </svg>
  );
}

// ---------- Status ----------

type Tone = "good" | "warn" | "bad" | "info" | "violet" | "teal" | "neutral";
const TONES: Record<Tone, { fg: string; bg: string; bd: string }> = {
  good: { fg: "#0d7a3d", bg: "#e9f7ef", bd: "#c9ecd8" },
  warn: { fg: "#a15c00", bg: "#fff7e6", bd: "#ffe1a8" },
  bad: { fg: "#b4141f", bg: "#fff1f0", bd: "#ffccc7" },
  info: { fg: "#1d5fb0", bg: "#eaf2fc", bd: "#c8dcf6" },
  violet: { fg: "#5b3cc4", bg: "#f2eefe", bd: "#ddd3fb" },
  teal: { fg: "#0b6e6e", bg: "#e6f6f6", bd: "#bfe6e6" },
  neutral: { fg: "#55625c", bg: "#f2f4f3", bd: "#e1e6e3" },
};

const WORKFLOW_TONE: Record<string, Tone> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  UNDER_SCRUTINY: "info",
  DEFICIENCY_RAISED: "warn",
  RESPONDED: "warn",
  TECHNICAL_REVIEW: "info",
  INSPECTION_SCHEDULED: "violet",
  INSPECTION_SUBMITTED: "violet",
  COUNCIL_REVIEW: "teal",
  APPROVED: "good",
  DEFERRED: "warn",
  REJECTED: "bad",
  NOC_ISSUED: "good",
};

const GENERIC_TONE: Record<string, Tone> = {
  APPROVED: "good",
  VALID: "good",
  VERIFIED: "good",
  ACTIVE: "good",
  ACCEPTED: "good",
  COMPLIANT: "good",
  ENROLLED: "good",
  PENDING: "warn",
  RESPONDED: "warn",
  PARTIAL: "warn",
  OUTSTANDING: "warn",
  FLAGGED: "bad",
  REJECTED: "bad",
  EXPIRED: "bad",
  NON_COMPLIANT: "bad",
  DISABLED: "bad",
  NONE: "neutral",
  NA: "neutral",
  ENDED: "neutral",
  GRADUATED: "neutral",
  WITHDRAWN: "neutral",
  SCHEDULED: "violet",
  SUBMITTED: "info",
};

export function StatusDot({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  const t = TONES[tone];
  return (
    <span className="pcp-status" title={title} style={{ color: t.fg, background: t.bg, borderColor: t.bd }}>
      <span className="pcp-status-dot" />
      {children}
    </span>
  );
}

export function StatusTag({ status }: { status: string }) {
  return <StatusDot tone={WORKFLOW_TONE[status] ?? "neutral"}>{STATUS_LABELS[status] ?? status}</StatusDot>;
}

const nice = (v: string) => v.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export function Pill({ value, label }: { value: string; label?: string }) {
  return <StatusDot tone={GENERIC_TONE[value] ?? "neutral"}>{label ?? nice(value)}</StatusDot>;
}

export const kindLabel = (k: string) => KIND_LABELS[k] ?? k;
export const programLabel = (p: string) => PROGRAM_LABELS[p] ?? p;

export function fmtDate(iso: string | null | undefined, withTime = false) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "—";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d < 30 ? `${d} day${d === 1 ? "" : "s"} ago` : fmtDate(iso);
}

// ---------- Layout pieces ----------

export function PageTitle({ title, sub, extra, eyebrow }: { title: React.ReactNode; sub?: React.ReactNode; extra?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="pcp-page-head">
      <div style={{ minWidth: 0 }}>
        {eyebrow ? <div className="pcp-eyebrow">{eyebrow}</div> : null}
        <h1 className="pcp-page-title">{title}</h1>
        {sub ? <div className="pcp-page-sub">{sub}</div> : null}
      </div>
      {extra ? <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{extra}</div> : null}
    </div>
  );
}

const STAT_TONES: Record<string, { fg: string; bg: string }> = {
  brand: { fg: "#0b6e4f", bg: "#e8f3ee" },
  info: { fg: "#1d5fb0", bg: "#eaf2fc" },
  warn: { fg: "#a15c00", bg: "#fff4dc" },
  bad: { fg: "#b4141f", bg: "#fff1f0" },
  violet: { fg: "#5b3cc4", bg: "#f2eefe" },
  gold: { fg: "#8a6a1c", bg: "#faf4e4" },
  neutral: { fg: "#55625c", bg: "#f2f4f3" },
};

export function StatCard({
  label,
  value,
  icon,
  tone = "brand",
  hint,
  help,
  clickable,
  compact,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: React.ReactNode;
  tone?: keyof typeof STAT_TONES;
  hint?: React.ReactNode;
  help?: string;
  clickable?: boolean;
  compact?: boolean;
}) {
  const t = STAT_TONES[tone];
  if (compact)
    return (
      <div className={`pcp-stat compact${clickable ? " clickable" : ""}`}>
        <div className="pcp-stat-label">
          {icon ? (
            <span className="pcp-stat-icon" style={{ color: t.fg, background: t.bg }}>
              {icon}
            </span>
          ) : null}
          <span>{label}</span>
          {help ? (
            <Tooltip title={help}>
              <InfoCircleOutlined style={{ color: "#8a9892" }} />
            </Tooltip>
          ) : null}
        </div>
        <div className="pcp-stat-value" style={typeof value === "string" && value.length > 6 ? { fontSize: 20, marginTop: 8 } : undefined}>
          {value}
        </div>
        {hint ? <div className="pcp-stat-hint">{hint}</div> : null}
      </div>
    );
  return (
    <div className={`pcp-stat${clickable ? " clickable" : ""}`}>
      {icon ? (
        <div className="pcp-stat-icon" style={{ color: t.fg, background: t.bg }}>
          {icon}
        </div>
      ) : null}
      <div style={{ minWidth: 0 }}>
        <div className="pcp-stat-label">
          {label}{" "}
          {help ? (
            <Tooltip title={help}>
              <InfoCircleOutlined style={{ color: "#8a9892" }} />
            </Tooltip>
          ) : null}
        </div>
        <div className="pcp-stat-value" style={typeof value === "string" && value.length > 6 ? { fontSize: 17, marginTop: 8 } : undefined}>
          {value}
        </div>
        {hint ? <div className="pcp-stat-hint">{hint}</div> : null}
      </div>
    </div>
  );
}

const AVATAR_BG = ["#0b6e4f", "#1d5fb0", "#8a6a1c", "#5b3cc4", "#0b6e6e", "#a8431f", "#3d5a4f"];

export function initials(name: string) {
  const parts = name.replace(/^(Dr|Prof|Mr|Ms|Mrs)\.?\s+/i, "").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function Avatar({ name, size = 32, light = false }: { name: string; size?: number; light?: boolean }) {
  const i = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_BG.length;
  return (
    <span
      className="pcp-avatar"
      style={{ width: size, height: size, fontSize: size * 0.38, background: light ? "rgba(255,255,255,0.16)" : AVATAR_BG[i], color: "#fff" }}
    >
      {initials(name)}
    </span>
  );
}

export function Person({ name, sub, size = 30 }: { name: React.ReactNode; sub?: React.ReactNode; size?: number }) {
  return (
    <span className="pcp-person">
      {typeof name === "string" ? <Avatar name={name} size={size} /> : null}
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: 500, lineHeight: 1.3 }}>{name}</span>
        {sub ? <span className="pcp-person-sub">{sub}</span> : null}
      </span>
    </span>
  );
}

export function KV({ rows }: { rows: [React.ReactNode, React.ReactNode][] }) {
  return (
    <dl className="pcp-kv" style={{ margin: 0 }}>
      {rows.map(([k, v], i) => (
        <div key={i} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
