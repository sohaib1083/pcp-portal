"use client";
// Small UI pieces shared by the faculty and student registry screens.
import { ArrowRightOutlined } from "@ant-design/icons";
import { useCallback, useState, type ComponentProps } from "react";
import { DETAIL_FIELD_LABELS, FIGURE_KEYS, FIGURE_LABELS, type FigureKey } from "@/lib/registry-shared";
import { StatusDot, fmtDate, programLabel } from "./common";

type Tone = ComponentProps<typeof StatusDot>["tone"];

const TONE: Record<string, Tone> = {
  ACTIVE: "good",
  VERIFIED: "good",
  APPROVED: "good",
  ACCEPTED: "good",
  PASS: "good",
  PROMOTED: "good",
  ENROLLED: "info",
  GRADUATED: "teal",
  ELIGIBLE: "good",
  DONE: "good",
  REQUESTED: "warn",
  PENDING: "warn",
  DUE: "warn",
  DRAFT: "neutral",
  SUBMITTED: "info",
  RETURNED: "bad",
  REPEAT: "warn",
  FAIL: "bad",
  FLAGGED: "bad",
  REJECTED: "bad",
  DECLINED: "bad",
  WITHDRAWN: "neutral",
  ENDED: "neutral",
  APPLIED: "violet",
  LOCKED: "violet",
  NOT_FILED: "neutral",
};

const LABEL: Record<string, string> = {
  REQUESTED: "Requested",
  APPLIED: "Applied directly",
  NOT_FILED: "Not filed",
  REPEAT: "Repeating",
  PASS: "Pass",
  FAIL: "Fail",
  ACCEPTED: "Accepted",
  LOCKED: "Locked",
};

const nice = (v: string) => v.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/**
 * Busy flag for a server action. Unlike useTransition, it clears as soon as the action answers,
 * so the button is usable again the moment its result is on screen.
 */
export function useBusy(): [boolean, (fn: () => Promise<unknown>) => void] {
  const [busy, setBusy] = useState(false);
  const run = useCallback((fn: () => Promise<unknown>) => {
    setBusy(true);
    fn()
      .catch((e) => console.error(e))
      .finally(() => setBusy(false));
  }, []);
  return [busy, run];
}

export function RegStatus({ value, label, title }: { value: string; label?: string; title?: string }) {
  return (
    <StatusDot tone={TONE[value] ?? "neutral"} title={title}>
      {label ?? LABEL[value] ?? nice(value)}
    </StatusDot>
  );
}

const show = (field: string, v: string | number | null) => {
  if (v === null || v === "") return <span className="faint">none</span>;
  if (field === "programType") return programLabel(String(v));
  if (field === "endDate") return fmtDate(String(v));
  if (field === "status") return nice(String(v));
  return String(v);
};

/** "Designation: Assistant Professor → Associate Professor" lines for a faculty change or a figure correction. */
export function ChangeLines({ changes }: { changes: Record<string, { from: string | number | null; to: string | number | null }> }) {
  const entries = Object.entries(changes);
  if (!entries.length) return <span className="faint">No details</span>;
  return (
    <div style={{ display: "grid", gap: 3 }}>
      {entries.map(([k, c]) => (
        <div key={k} style={{ fontSize: 13 }}>
          <span className="muted">{DETAIL_FIELD_LABELS[k] ?? FIGURE_LABELS[k as FigureKey] ?? k}: </span>
          {c.from !== null && c.from !== undefined ? (
            <>
              <span style={{ textDecoration: "line-through", color: "var(--faint)" }}>{show(k, c.from)}</span> <ArrowRightOutlined style={{ fontSize: 10, color: "var(--faint)" }} />{" "}
            </>
          ) : null}
          <b style={{ fontWeight: 600 }}>{show(k, c.to)}</b>
        </div>
      ))}
    </div>
  );
}

/** Upload result or correction evidence through the permission-checked registry route. */
export async function uploadEvidence(file: File, ref: string, kind: "annual-return" | "correction") {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("ref", ref);
  fd.append("kind", kind);
  const res = await fetch("/api/registry/evidence", { method: "POST", body: fd });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? "Upload failed");
  return j as { id: number; fileName: string; version: number };
}

export function downloadText(fileName: string, text: string, mime = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Annual return figures side by side, e.g. original and corrected, or this year and last year. Changed cells are highlighted. */
export function FiguresTable({ columns, compareTo }: { columns: { title: React.ReactNode; figures: Partial<Record<FigureKey, number>> | null }[]; compareTo?: number }) {
  const base = compareTo !== undefined ? columns[compareTo]?.figures : null;
  const th: React.CSSProperties = { padding: "8px 10px", color: "var(--muted)", fontWeight: 600, fontSize: 12, borderBottom: "1px solid var(--line)" };
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
      <thead>
        <tr>
          <th style={{ ...th, textAlign: "left" }}>Figure</th>
          {columns.map((c, i) => (
            <th key={i} style={{ ...th, textAlign: "right" }}>
              {c.title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {FIGURE_KEYS.map((k) => (
          <tr key={k}>
            <td style={{ padding: "7px 10px", borderBottom: "1px solid var(--line-2)" }}>{FIGURE_LABELS[k]}</td>
            {columns.map((c, i) => {
              const v = c.figures?.[k];
              const changed = !!base && i !== compareTo && v !== undefined && v !== base[k];
              return (
                <td key={i} className="tnum" style={{ padding: "7px 10px", textAlign: "right", borderBottom: "1px solid var(--line-2)", fontWeight: changed ? 700 : 500, background: changed ? "#fff7e6" : undefined }}>
                  {v ?? "—"}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SectionLabel({ children, extra }: { children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, margin: "18px 0 8px" }}>
      <span className="faint" style={{ fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {children}
      </span>
      {extra}
    </div>
  );
}
