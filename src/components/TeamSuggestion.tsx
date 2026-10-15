"use client";
// The automated inspection team suggestion on the scheduling card (RFP 4.1.1): who is proposed and why,
// who was left out and why, and the proposed visit date. The coordinator accepts it, swaps a member, or ignores it.
import { useState } from "react";
import { Alert, Button, Select, Space, Tag } from "antd";
import { BulbOutlined, CalendarOutlined, CheckOutlined, StopOutlined, SwapOutlined } from "@ant-design/icons";
import type { TeamSuggestion as Suggestion } from "@/lib/inspection-team";
import { Avatar } from "./common";

const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default function TeamSuggestion({ s, onUse, onDismiss }: { s: Suggestion; onUse: (lead: string, members: string[], date: string | null) => void; onDismiss: () => void }) {
  const [team, setTeam] = useState(s.team);
  const [showExcluded, setShowExcluded] = useState(true);
  const chosen = new Set(team.map((t) => t.username));
  const swap = (username: string, to: string) => {
    const alt = s.alternates.find((a) => a.username === to);
    if (!alt) return;
    setTeam((prev) => prev.map((t) => (t.username === username ? { ...alt, role: t.role, why: alt.why } : t)));
  };
  const changed = team.some((t, i) => t.username !== s.team[i]?.username);
  return (
    <div data-testid="team-suggestion" style={{ border: "1px solid #ddd3fb", background: "#faf8ff", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <b style={{ fontSize: 13.5 }}>
          <BulbOutlined style={{ color: "#5b3cc4", marginRight: 6 }} />
          Suggested team
        </b>
        <Tag color="purple" style={{ margin: 0 }} title="Change it under Rules">
          inspection.team v{s.ruleVersion} · lead + {s.rule.members} member{s.rule.members === 1 ? "" : "s"}
        </Tag>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {team.map((t) => {
          const options = s.alternates.filter((a) => !chosen.has(a.username)).map((a) => ({ value: a.username, disabled: !a.freeOnDate, label: `${a.name} · ${a.why}${a.freeOnDate ? "" : " · busy that day"}` }));
          return (
            <div key={t.username} className="suggested-member" data-username={t.username} data-role={t.role} style={{ display: "flex", gap: 10, alignItems: "center", background: "#fff", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 10px" }}>
              <Avatar name={t.name} size={30} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {t.name}{" "}
                  <Tag color={t.role === "LEAD" ? "purple" : "default"} style={{ marginLeft: 4 }}>
                    {t.role === "LEAD" ? "Lead" : "Member"}
                  </Tag>
                </div>
                <div className="faint suggested-why" style={{ fontSize: 12 }}>
                  {t.why}
                </div>
              </div>
              {options.length ? (
                <Select
                  size="small"
                  className="swap-member"
                  style={{ width: 92 }}
                  popupMatchSelectWidth={360}
                  placeholder={
                    <span>
                      <SwapOutlined /> Swap
                    </span>
                  }
                  options={options}
                  onChange={(v: string) => swap(t.username, v)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }} data-testid="suggested-date">
        <CalendarOutlined style={{ color: "#5b3cc4", marginTop: 3 }} />
        <div>
          <b>{s.date ? `Proposed visit: ${fmt(s.date)}` : "No date proposed"}</b>
          <div className="faint" style={{ fontSize: 12 }}>
            {s.dateWhy}
          </div>
        </div>
      </div>
      {s.warnings.map((w) => (
        <Alert key={w} type="warning" showIcon title={w} style={{ padding: "4px 10px" }} />
      ))}
      {s.excluded.length ? (
        <div data-testid="suggestion-excluded" style={{ fontSize: 12.5 }}>
          <button type="button" onClick={() => setShowExcluded((v) => !v)} style={{ border: 0, background: "none", padding: 0, cursor: "pointer", color: "var(--ink-2)", fontWeight: 600, font: "inherit" }}>
            Not suggested ({s.excluded.length}) {showExcluded ? "▾" : "▸"}
          </button>
          {showExcluded ? (
            <ul style={{ margin: "4px 0 0", paddingLeft: 0, listStyle: "none", display: "grid", gap: 3 }}>
              {s.excluded.map((e) => (
                <li key={e.username} className="excluded-member" data-username={e.username}>
                  <StopOutlined style={{ color: "#b4141f", marginRight: 6 }} />
                  <b style={{ fontWeight: 500 }}>{e.name}</b> <span className="faint">· {e.province}:</span> {e.why}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <Space wrap>
        <Button type="primary" icon={<CheckOutlined />} disabled={!team.length} onClick={() => onUse(team.find((t) => t.role === "LEAD")?.username ?? team[0].username, team.filter((t) => t.role !== "LEAD").map((t) => t.username), s.date)}>
          {changed ? "Use this team (with your swap)" : "Use this team"}
        </Button>
        <Button onClick={onDismiss}>Dismiss</Button>
      </Space>
    </div>
  );
}
