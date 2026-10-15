"use client";
// Attendance and quorum at a council or committee meeting, from the members register, and the recusal flag
// on an agenda item where a member has declared a conflict of interest (Annexure-III "Members Ledger").
import Link from "next/link";
import { Alert, Card, Radio, Tag, Tooltip } from "antd";
import { StopOutlined, TeamOutlined } from "@ant-design/icons";
import { markAttendance } from "@/app/actions/members";
import type { ActionResult } from "@/app/actions/faculty";
import type { MeetingRoll, Recusal } from "@/lib/members";
import { Avatar, StatusDot } from "./common";

const ROLE: Record<string, string> = { CHAIR: "Chair", VICE_CHAIR: "Vice chair", MEMBER: "Member", SECRETARY: "Secretary, non-voting" };

export function QuorumPill({ roll }: { roll: MeetingRoll }) {
  if (!roll.applicable) return null;
  const taken = roll.marked > 0;
  return (
    <span data-testid="quorum" data-met={taken ? String(roll.met) : "pending"}>
      <StatusDot tone={!taken ? "warn" : roll.met ? "good" : "bad"}>
        {taken ? `Quorum ${roll.met ? "met" : "not met"}: ${roll.presentVoting} of ${roll.voting} voting present, ${roll.needed} needed` : `Quorum: ${roll.needed} of ${roll.voting} voting members needed`}
      </StatusDot>
    </span>
  );
}

export default function MeetingAttendance({ meetingRef, roll, canManage, run, pending }: { meetingRef: string; roll: MeetingRoll; canManage: boolean; run: (fn: () => Promise<ActionResult>) => void; pending: boolean }) {
  const editable = canManage && roll.status !== "CLOSED";
  if (!roll.applicable)
    return (
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title={
          <span>
            No members of the {roll.committee} are in the members register, so attendance and quorum are not counted. <Link href="/pcp/council?tab=members">Add them under Members</Link>.
          </span>
        }
      />
    );
  return (
    <Card
      size="small"
      data-testid="attendance"
      style={{ marginBottom: 16 }}
      title={
        <span>
          <TeamOutlined style={{ color: "#5b3cc4", marginRight: 8 }} />
          Attendance and quorum
        </span>
      }
      extra={<QuorumPill roll={roll} />}
    >
      <div className="faint" style={{ fontSize: 12.5, marginBottom: 10 }}>
        From the members register. Quorum: {roll.rule.percent}% of the {roll.voting} voting members, at least {roll.rule.minimum} (rule committee.quorum{roll.rule.version ? ` v${roll.rule.version}` : ""}). A member with a declared conflict on an item is recused from it and does not count towards that item&apos;s quorum.
        {roll.status === "PLANNED" ? " Members not marked when the session starts are recorded as present." : ""}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: 8 }}>
        {roll.members.map((m) => (
          <div
            key={m.memberId}
            className="attendee"
            data-member={m.ref}
            data-present={m.present === null ? "" : String(m.present)}
            style={{ display: "flex", gap: 10, alignItems: "center", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 10px", background: m.present === false ? "#fafafa" : "#fff", opacity: m.present === false ? 0.75 : 1 }}
          >
            <Avatar name={m.name} size={30} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={m.name}>
                {m.name}
              </div>
              <div className="faint" style={{ fontSize: 11.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={m.nominatingBody}>
                {ROLE[m.role] ?? m.role} · {m.nominatingBody}
              </div>
              {m.conflicts.length ? (
                <div style={{ marginTop: 3 }}>
                  {m.conflicts.map((c) => (
                    <Tooltip key={c.institutionId} title={`Declared conflict with ${c.name}: ${c.reason}`}>
                      <Tag color="red" style={{ fontSize: 11, marginRight: 4 }}>
                        Conflict: {c.shortCode}
                      </Tag>
                    </Tooltip>
                  ))}
                </div>
              ) : null}
            </div>
            {editable ? (
              <Radio.Group
                size="small"
                buttonStyle="solid"
                className="attendance-mark"
                disabled={pending}
                value={m.present === null ? null : m.present ? "P" : "A"}
                onChange={(e) => run(() => markAttendance(meetingRef, m.memberId, e.target.value === "P"))}
                style={{ flex: "none" }}
              >
                <Radio.Button value="P">Present</Radio.Button>
                <Radio.Button value="A" style={m.present === false ? { background: "#b4141f", borderColor: "#b4141f", color: "#fff" } : undefined}>
                  Absent
                </Radio.Button>
              </Radio.Group>
            ) : (
              <StatusDot tone={m.present === null ? "neutral" : m.present ? "good" : "bad"}>{m.present === null ? "Not marked" : m.present ? "Present" : "Absent"}</StatusDot>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

/** On an agenda item: who is recused and why, and the quorum left for this item. */
export function RecusalFlag({ recusals, quorum, needed }: { recusals?: Recusal[]; quorum?: { voting: number; met: boolean }; needed: number }) {
  if (!recusals?.length) return null;
  return (
    <div data-testid="recusal" style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 12px", marginBottom: 12, borderRadius: 10, border: "1px solid #ffccc7", background: "#fff6f5", fontSize: 13 }}>
      <StopOutlined style={{ color: "#b4141f", marginTop: 3 }} />
      <div style={{ flex: 1 }}>
        {recusals.map((r) => (
          <div key={r.memberId}>
            <b>Recused: {r.name}</b> <span className="muted">· {r.reason}</span>
            {r.present === false ? <span className="faint"> (absent)</span> : null}
          </div>
        ))}
        {quorum ? (
          <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>
            Voting on this item: {quorum.voting} member{quorum.voting === 1 ? "" : "s"} present after the recusal; {needed} needed ({quorum.met ? "quorum met" : "no quorum on this item"}).
          </div>
        ) : null}
      </div>
    </div>
  );
}
