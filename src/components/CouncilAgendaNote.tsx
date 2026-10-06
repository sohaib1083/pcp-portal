"use client";
// Read-only note on the PCP case screen: "On the agenda of CM-2026-07" (or the meeting that decided it).
import Link from "next/link";
import { useEffect, useState } from "react";
import { ScheduleOutlined } from "@ant-design/icons";
import { agendaForCase } from "@/app/actions/council";
import { fmtDate } from "./common";

type Agenda = Awaited<ReturnType<typeof agendaForCase>>;

export default function CouncilAgendaNote({ caseRef, status }: { caseRef: string; status?: string }) {
  const [a, setA] = useState<Agenda>(null);
  useEffect(() => {
    let live = true;
    agendaForCase(caseRef)
      .then((r) => live && setA(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [caseRef, status]);
  if (!a) return null;
  const scheduled = a.kind === "scheduled";
  return (
    <div
      className="council-agenda-note"
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: 16, borderRadius: 12, border: `1px solid ${scheduled ? "#bfe6e6" : "var(--line)"}`, background: scheduled ? "#e6f6f6" : "#fff", fontSize: 13.5 }}
    >
      <ScheduleOutlined style={{ color: "#0b6e6e", fontSize: 16 }} />
      {scheduled ? (
        <span>
          On the agenda of{" "}
          <Link href={`/pcp/council/${a.meetingRef}`} className="mono" style={{ fontWeight: 600 }}>
            {a.meetingRef}
          </Link>
          , item {a.position}, {fmtDate(a.date)}
          {a.status === "IN_SESSION" ? " (in session now)" : ""}.
        </span>
      ) : (
        <span>
          Decided at council meeting{" "}
          <Link href={`/pcp/council/${a.meetingRef}`} className="mono" style={{ fontWeight: 600 }}>
            {a.meetingRef}
          </Link>{" "}
          on {fmtDate(a.date)}: {a.decision.toLowerCase()}.
        </span>
      )}
    </div>
  );
}
