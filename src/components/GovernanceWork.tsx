"use client";
// Dashboard work list additions: letters marked to you, your action points, and (for legal) hearings this
// week and stay orders in force.
import Link from "next/link";
import { Card, Col, Empty, Row } from "antd";
import { CalendarOutlined, CheckSquareOutlined, InboxOutlined, StopOutlined } from "@ant-design/icons";
import type { GovernanceWork as Work } from "@/lib/governance-data";
import { StatCard, fmtDate } from "./common";
import { TaskStatus, relDays } from "./GovParts";

const row = { display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", borderRadius: 10 } as const;

export default function GovernanceWork({ data }: { data: Work }) {
  const empty = (t: string) => <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t} style={{ margin: "12px 0" }} />;
  const legal = data.legal;
  if (!legal && !data.letters.length && !data.tasks.length) return null;
  return (
    <div style={{ marginBottom: 18 }} data-testid="governance-work">
      <Row gutter={[14, 14]}>
        {legal ? (
          <Col xs={24} lg={8}>
            <div style={{ display: "grid", gap: 10, height: "100%" }}>
              <Link href="/pcp/litigation">
                <StatCard compact clickable label="Hearings this week" value={legal.hearingsWeek} icon={<CalendarOutlined />} tone="violet" hint={legal.hearings[0] ? `Next: ${legal.hearings[0].court} ${legal.hearings[0].caseNumber}, ${relDays(legal.hearings[0].days)}` : "None in the next 7 days"} />
              </Link>
              <Link href="/pcp/litigation">
                <StatCard compact clickable label="Cases with stay orders" value={legal.stays} icon={<StopOutlined />} tone={legal.stays ? "bad" : "neutral"} hint={legal.stayRefs.length ? `Blocking ${legal.stayRefs.map((s) => s.linkedRef ?? s.ref).join(", ")}` : "No stay in force"} />
              </Link>
            </div>
          </Col>
        ) : null}
        <Col xs={24} lg={legal ? 8 : 12}>
          <Card
            size="small"
            title={<span><InboxOutlined style={{ color: "#1d5fb0", marginRight: 8 }} />Letters marked to you</span>}
            extra={<Link href="/pcp/correspondence?tab=mine" style={{ fontSize: 12.5 }}>{data.letters.length} open</Link>}
            style={{ height: "100%" }}
            styles={{ body: { padding: 6 } }}
            data-testid="work-letters"
          >
            {data.letters.length
              ? data.letters.slice(0, 5).map((l) => (
                  <Link key={l.ref} href={`/pcp/correspondence/${l.ref}`}>
                    <div className="pcp-action-row" style={row}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span className="mono" style={{ fontWeight: 600, fontSize: 13, color: "var(--ink)" }}>{l.ref}</span> <span className="faint" style={{ fontSize: 12 }}>{l.party}</span>
                        <div style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.subject}</div>
                      </div>
                      {l.actionDue ? (
                        <b className="tnum" style={{ fontSize: 12.5, whiteSpace: "nowrap", color: l.overdue ? "#b4141f" : "var(--ink-2)" }}>
                          {l.overdue ? "Overdue" : `Due ${fmtDate(l.actionDue)}`}
                        </b>
                      ) : null}
                    </div>
                  </Link>
                ))
              : empty("No letters waiting for you")}
          </Card>
        </Col>
        <Col xs={24} lg={legal ? 8 : 12}>
          <Card
            size="small"
            title={<span><CheckSquareOutlined style={{ color: "var(--brand)", marginRight: 8 }} />Your action points</span>}
            extra={<Link href="/pcp/council" style={{ fontSize: 12.5 }}>{data.tasks.length} open</Link>}
            style={{ height: "100%" }}
            styles={{ body: { padding: 6 } }}
            data-testid="work-tasks"
          >
            {data.tasks.length
              ? data.tasks.slice(0, 5).map((t) => (
                  <Link key={t.id} href={`/pcp/council/${t.meetingRef}#actions`}>
                    <div className="pcp-action-row" style={row}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</div>
                        <div className="faint" style={{ fontSize: 12 }}>
                          {t.committee} · <span className="mono">{t.meetingRef}</span> · due {fmtDate(t.dueDate)}
                        </div>
                      </div>
                      <TaskStatus status={t.status} overdue={t.days < 0} />
                    </div>
                  </Link>
                ))
              : empty("No action points for you")}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
