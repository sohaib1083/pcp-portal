"use client";
// On the PCP case and appeal screens: the red stay-order banner, and the court cases, letters and committee
// items linked to this case. Read-only; loads after the page like CouncilAgendaNote.
import Link from "next/link";
import { useEffect, useState } from "react";
import { ExceptionOutlined, InboxOutlined, SendOutlined, TeamOutlined } from "@ant-design/icons";
import { governanceForRef } from "@/app/actions/litigation";
import { COURT_STATUS } from "@/lib/governance-shared";
import { fmtDate } from "./common";
import { StayBanner } from "./GovParts";

type G = Awaited<ReturnType<typeof governanceForRef>>;

const until = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "further orders");

export default function CaseGovernanceNote({ refNo, status }: { refNo: string; status?: string }) {
  const [g, setG] = useState<G>(null);
  useEffect(() => {
    let live = true;
    governanceForRef(refNo)
      .then((r) => live && setG(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [refNo, status]);
  if (!g) return null;
  const any = g.courts.length || g.letters.length || g.committees.length;
  return (
    <>
      {g.stays.map((s) => (
        <StayBanner
          key={s.orderId}
          courtRef={s.courtRef}
          text={`Stay order by ${s.courtShort} in ${s.caseNumber}: no further action until ${until(s.until)}`}
          sub={`${s.summary.length > 160 ? `${s.summary.slice(0, 158)}…` : s.summary} Council decisions and certificates${s.linkedRef && s.linkedRef !== refNo ? ` (linked through ${s.linkedRef})` : ""} are blocked until the legal officer lifts the stay.`}
        />
      ))}
      {any ? (
        <div className="case-governance" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "10px 14px", marginBottom: 16, borderRadius: 12, border: "1px solid var(--line)", background: "#fff", fontSize: 13 }}>
          {g.courts.map((c) => (
            <Link key={c.ref} href={`/pcp/litigation/${c.ref}`} style={{ display: "inline-flex", gap: 6, alignItems: "center", padding: "3px 10px", borderRadius: 999, border: `1px solid ${c.status === "STAY_GRANTED" ? "#ffccc7" : "var(--line)"}`, background: c.status === "STAY_GRANTED" ? "#fff1f0" : "var(--bg)" }}>
              <ExceptionOutlined style={{ color: "#b4141f" }} />
              <span className="mono" style={{ fontWeight: 600 }}>{c.ref}</span>
              <span className="muted">
                {c.court} {c.caseNumber} · {COURT_STATUS[c.status]?.label.toLowerCase() ?? c.status}
                {c.nextHearing ? ` · hearing ${fmtDate(c.nextHearing)}` : ""}
              </span>
            </Link>
          ))}
          {g.letters.map((l) => (
            <Link key={l.ref} href={`/pcp/correspondence/${l.ref}`} title={l.subject} style={{ display: "inline-flex", gap: 6, alignItems: "center", padding: "3px 10px", borderRadius: 999, border: "1px solid var(--line)", background: "var(--bg)" }}>
              {l.direction === "IN" ? <InboxOutlined style={{ color: "#1d5fb0" }} /> : <SendOutlined style={{ color: "#0b6e4f" }} />}
              <span className="mono" style={{ fontWeight: 600 }}>{l.ref}</span>
              <span className="muted">
                {l.direction === "IN" ? "from" : "to"} {l.party.length > 28 ? `${l.party.slice(0, 26)}…` : l.party} · {fmtDate(l.date)}
              </span>
            </Link>
          ))}
          {g.committees.map((m) => (
            <Link key={m.ref} href={`/pcp/council/${m.ref}`} title={m.resolution ?? undefined} style={{ display: "inline-flex", gap: 6, alignItems: "center", padding: "3px 10px", borderRadius: 999, border: "1px solid var(--line)", background: "var(--bg)" }}>
              <TeamOutlined style={{ color: "#5b3cc4" }} />
              <span className="mono" style={{ fontWeight: 600 }}>{m.ref}</span>
              <span className="muted">
                {m.committee} · {m.resolution ? `recommended: ${m.resolution.length > 60 ? `${m.resolution.slice(0, 58)}…` : m.resolution}` : `on the agenda, ${fmtDate(m.date)}`}
              </span>
            </Link>
          ))}
        </div>
      ) : null}
    </>
  );
}
