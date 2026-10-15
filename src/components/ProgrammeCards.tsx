"use client";
// Programme card actions and history (guide section 5): start accreditation or renewal from the card;
// history rows stay; an open case shows as a pending row.
import Link from "next/link";
import { useTransition } from "react";
import { App, Button } from "antd";
import { ClockCircleOutlined, FileAddOutlined, HistoryOutlined, ReloadOutlined, RightOutlined } from "@ant-design/icons";
import { startProgrammeCase } from "@/app/actions/applications";
import type { HistoryRow, ProgrammeCardData } from "@/lib/programmes";
import { daysUntil } from "@/lib/format";
import { StatusDot, StatusTag, kindLabel, programmeLabel } from "./common";

export function HistoryList({ rows, limit = 4 }: { rows: HistoryRow[]; limit?: number }) {
  if (!rows.length) return <div className="faint" style={{ fontSize: 12.5 }}>No accreditation yet.</div>;
  return (
    <div style={{ display: "grid", gap: 4 }} data-testid="programme-history">
      {rows.slice(0, limit).map((h) => {
        const tone = h.pending ? "warn" : h.decision === "Approved" ? "good" : h.decision === "Rejected" ? "bad" : "neutral";
        const text = `${h.kind} ${h.from}–${h.until} for intake ${h.intake}`;
        return (
          <div key={h.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }} className={h.pending ? "history-pending" : undefined}>
            {h.pending ? <ClockCircleOutlined style={{ color: "#a15c00" }} /> : <HistoryOutlined style={{ color: "var(--faint)" }} />}
            <span style={{ flex: 1, minWidth: 0 }}>
              {text}
              {h.ref ? (
                <>
                  {" · "}
                  <Link href={`/institution/applications/${h.ref}`} className="mono" style={{ fontSize: 12 }}>
                    {h.ref}
                  </Link>
                </>
              ) : null}
            </span>
            <StatusDot tone={tone}>{h.pending ? h.decision : h.decision.toLowerCase()}</StatusDot>
          </div>
        );
      })}
    </div>
  );
}

/** "Apply for accreditation", "Start renewal" or "Open <case>" for one programme. */
export function ProgrammeActions({ p, canStart }: { p: ProgrammeCardData; canStart: boolean }) {
  const { message } = App.useApp();
  const [pending, start] = useTransition();
  const go = (kind: "ACCREDITATION" | "RENEWAL") =>
    start(async () => {
      const r = await startProgrammeCase(p.type, kind, p.field);
      if (r && !r.ok) message.error(r.message);
    });
  if (p.openCase)
    return (
      <Link href={`/institution/applications/${p.openCase.ref}`}>
        <Button size="small" icon={<RightOutlined />}>
          {p.openCase.status === "DRAFT" ? `Continue ${kindLabel(p.openCase.kind).toLowerCase()} ${p.openCase.ref}` : `Open ${p.openCase.ref}`}
        </Button>
      </Link>
    );
  // A postgraduate programme starts with PCP accreditation (the HEC issues its NOC).
  if (!p.postgraduate && p.nocStatus !== "APPROVED")
    return p.openNoc ? (
      <Link href={`/institution/applications/${p.openNoc.ref}`}>
        <Button size="small" icon={<RightOutlined />}>Open {p.openNoc.ref}</Button>
      </Link>
    ) : null;
  if (!canStart) return null;
  const d = daysUntil(p.validUntil);
  if (p.validUntil)
    return (
      <Button size="small" type={d !== null && d <= 180 ? "primary" : "default"} icon={<ReloadOutlined />} loading={pending} onClick={() => go("RENEWAL")} className="start-renewal">
        Start renewal
      </Button>
    );
  return (
    <Button size="small" type="primary" icon={<FileAddOutlined />} loading={pending} onClick={() => go("ACCREDITATION")} className="apply-accreditation">
      Apply for accreditation
    </Button>
  );
}

/** A compact card for the applications page: status, term, history and the next action. */
export function ProgrammeCard({ p, canStart }: { p: ProgrammeCardData; canStart: boolean }) {
  const d = daysUntil(p.validUntil);
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 16, height: "100%", display: "flex", flexDirection: "column", gap: 10 }} data-programme={p.type} data-field={p.field || undefined}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 650, fontSize: 15 }}>{programmeLabel(p.type, p.field)}</div>
          <div className="faint mono" style={{ marginTop: 2 }}>{p.postgraduate ? (p.nocNumber ? `HEC NOC ${p.nocNumber}` : "Postgraduate · HEC NOC on the case") : (p.nocNumber ?? "No NOC yet")}</div>
        </div>
        <ProgrammeActions p={p} canStart={canStart} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
        {p.postgraduate ? null : (
          <StatusDot tone={p.nocStatus === "APPROVED" ? "good" : p.nocStatus === "REJECTED" ? "bad" : p.nocStatus === "PENDING" ? "warn" : "neutral"}>NOC {p.nocStatus.toLowerCase()}</StatusDot>
        )}
        <StatusDot tone={p.accreditationStatus === "VALID" ? "good" : p.accreditationStatus === "EXPIRED" ? "bad" : p.accreditationStatus === "PENDING" ? "warn" : "neutral"}>
          Accreditation {p.accreditationStatus.toLowerCase()}
          {p.validUntil ? ` until ${p.validUntil}` : ""}
        </StatusDot>
        {p.intake ? <StatusDot tone="neutral">Intake {p.intake}</StatusDot> : null}
        {p.openCase ? <StatusTag status={p.openCase.status} /> : null}
      </div>
      {d !== null && d <= 180 && !p.openCase ? <div style={{ fontSize: 12.5, color: d <= 90 ? "#b4141f" : "#a15c00" }}>Renewal due: {d < 0 ? `expired ${-d} days ago` : `${d} days left`}</div> : null}
      <HistoryList rows={p.history} />
    </div>
  );
}
