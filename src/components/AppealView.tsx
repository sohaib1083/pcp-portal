"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Col, Input, Popconfirm, Row, Typography } from "antd";
import { CheckOutlined, ClockCircleOutlined, FolderOpenOutlined, SafetyCertificateFilled, ScheduleOutlined, StopOutlined } from "@ant-design/icons";
import { placeAppealOnAgenda, reviewAppeal, withdrawAppeal } from "@/app/actions/appeals";
import type { ActionResult } from "@/app/actions/faculty";
import type { AppealDetail } from "@/lib/council-data";
import { fmtDate, timeAgo } from "./common";
import { DecisionPill, DocLink, ModuleStatus, Quote } from "./CouncilParts";
import { FillDemo } from "./demo-helpers";
import CaseGovernanceNote from "./CaseGovernanceNote";
import ScreenGuide from "./ScreenGuide";

const TRACK = ["Filed", "Officer review", "Council", "Decided"];

const ACTION_LABELS: Record<string, string> = {
  "appeal.filed": "Appeal filed with evidence",
  "appeal.reviewed": "Officer review note saved",
  "appeal.placed_on_agenda": "Placed on the council agenda",
  "appeal.upheld": "Upheld by the council",
  "appeal.dismissed": "Dismissed by the council",
  "appeal.withdrawn": "Withdrawn by the institution",
};

function stepOf(status: string) {
  return { FILED: 0, UNDER_REVIEW: 1, ON_AGENDA: 2, UPHELD: 4, DISMISSED: 4, WITHDRAWN: 4 }[status] ?? 0;
}

export default function AppealView({ d, side, canReview, canWithdraw }: { d: AppealDetail; side: "pcp" | "institution"; canReview?: boolean; canWithdraw?: boolean }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState(d.appeal.reviewNote ?? "");
  const a = d.appeal;
  const base = side === "pcp" ? "/pcp" : "/institution";
  const cur = stepOf(a.status);
  const closed = ["UPHELD", "DISMISSED", "WITHDRAWN"].includes(a.status);

  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      message[r.ok ? "success" : "error"](r.message, r.ok ? 4 : 8);
      router.refresh();
    });

  const court =
    a.status === "FILED"
      ? { who: "With: PCP officer", what: "Waiting for an officer to review the appeal and its evidence against the case file.", c: "#1d5fb0", bg: "#eaf2fc", bd: "#c8dcf6" }
      : a.status === "UNDER_REVIEW"
        ? { who: "With: PCP officer", what: "Under review. Next it is placed on the council agenda.", c: "#5b3cc4", bg: "#f2eefe", bd: "#ddd3fb" }
        : a.status === "ON_AGENDA"
          ? {
              who: "With: the council",
              what: d.meeting ? `On the agenda of ${d.meeting.ref}, ${fmtDate(d.meeting.date)}${d.meeting.status === "IN_SESSION" ? " (in session now)" : ""}.` : "Ready for council; it goes on the next agenda the Secretary builds.",
              c: "#0b6e6e",
              bg: "#e6f6f6",
              bd: "#bfe6e6",
            }
          : a.status === "UPHELD"
            ? { who: "Closed: upheld", what: `The council upheld the appeal. ${d.case?.ref} returns to the council for a fresh decision.`, c: "#0d7a3d", bg: "#e9f7ef", bd: "#c9ecd8" }
            : a.status === "DISMISSED"
              ? { who: "Closed: dismissed", what: `The council dismissed the appeal. The decision on ${d.case?.ref} stands.`, c: "#b4141f", bg: "#fff1f0", bd: "#ffccc7" }
              : { who: "Closed: withdrawn", what: "The institution withdrew the appeal. The original decision stands.", c: "#55625c", bg: "#f2f4f3", bd: "#e1e6e3" };

  const panels: React.ReactNode[] = [];
  if (side === "pcp" && canReview && ["FILED", "UNDER_REVIEW"].includes(a.status)) {
    panels.push(
      <div key="review" style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <b>1. Review the appeal</b>
          <FillDemo onClick={() => setNote("Evidence checked against the case file: the documents filed with the appeal are dated before the council's decision and answer the grounds it gave. Recommend the council uphold the appeal and decide the case afresh.")} />
        </div>
        <div className="muted" style={{ fontSize: 12.5 }}>Read the grounds and evidence against the case file. The council reads your note with the appeal; the institution does not see it.</div>
        <Input.TextArea id="review-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What the evidence shows and what you recommend" />
        <Button loading={pending} onClick={() => run(() => reviewAppeal(a.ref, note))} disabled={note.trim().length < 10 || note.trim() === (a.reviewNote ?? "")}>
          Save review note
        </Button>
        <div style={{ borderTop: "1px solid var(--line-2)", margin: "6px 0" }} />
        <b>2. Send it to the council</b>
        <Button type="primary" size="large" icon={<ScheduleOutlined />} loading={pending} disabled={!a.reviewNote} onClick={() => run(() => placeAppealOnAgenda(a.ref))}>
          Place on the next council agenda
        </Button>
        {!a.reviewNote ? <div className="faint" style={{ fontSize: 12 }}>Save a review note first.</div> : null}
      </div>,
    );
  }
  if (side === "institution" && canWithdraw && !closed && d.meeting?.status !== "IN_SESSION") {
    panels.push(
      <Popconfirm key="withdraw" title="Withdraw this appeal?" description="The original decision then stands. This cannot be undone." okText="Withdraw" okButtonProps={{ danger: true }} onConfirm={() => run(() => withdrawAppeal(a.ref))}>
        <Button danger block icon={<StopOutlined />} loading={pending}>
          Withdraw the appeal
        </Button>
      </Popconfirm>,
    );
  }

  return (
    <>
      <Card style={{ marginBottom: 18 }} styles={{ body: { padding: "20px 22px" } }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div className="pcp-eyebrow">
              <Link href={`${base}/appeals`} style={{ color: "inherit" }}>
                Appeals
              </Link>{" "}
              · against the decision on {d.case?.ref}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h1 className="pcp-page-title mono" style={{ fontSize: 24, letterSpacing: "-0.01em" }}>
                {a.ref}
              </h1>
              <ModuleStatus status={a.status} />
            </div>
            <div className="muted" style={{ marginTop: 6, fontSize: 13.5 }}>
              {d.inst?.name} <span className="mono">({d.inst?.code})</span> · filed by {a.filedBy} on {fmtDate(a.filedAt)}
            </div>
          </div>
          <ScreenGuide
            title="An appeal"
            steps={
              side === "pcp"
                ? [
                    "Compare the **grounds** and the **evidence** with the decision under appeal and the case file.",
                    "Write what you found in the review note and click **Save review note**. Only PCP and the council see it.",
                    "Click **Place on the next council agenda**. The institution and the Secretary are told.",
                    "The council decides in session. The decision letter then appears here and on the institution's side.",
                  ]
                : [
                    "The track shows where your appeal is: officer review, the council, or decided.",
                    "Your grounds and evidence are linked to the original case, so the council reads them together.",
                    "You are told by email and in Messages when it is reviewed, placed on an agenda and decided.",
                    "The decision letter appears under **Council decision**. You may withdraw the appeal until the council starts hearing it.",
                  ]
            }
          />
        </div>
        <div className="pcp-track" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          {TRACK.map((label, i) => {
            const done = i < cur || (closed && i <= 3);
            const cls = done ? "done" : i === cur ? "current" : "";
            const title = i === 3 && closed ? (a.status === "UPHELD" ? "Upheld" : a.status === "DISMISSED" ? "Dismissed" : "Withdrawn") : label;
            return (
              <div key={label} className={`pcp-track-step ${cls}`}>
                <span className="pcp-track-dot">{done ? <CheckOutlined /> : i + 1}</span>
                {title}
              </div>
            );
          })}
        </div>
        <div className="pcp-court" style={{ marginTop: 18, background: court.bg, borderColor: court.bd }}>
          <span style={{ width: 36, height: 36, borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center", color: court.c }}>{closed ? <SafetyCertificateFilled /> : <ClockCircleOutlined />}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="pcp-court-title" style={{ color: court.c }}>
              {court.who}
            </div>
            <div className="pcp-court-sub">{court.what}</div>
          </div>
          {d.meeting && side === "pcp" ? (
            <Link href={`/pcp/council/${d.meeting.ref}`}>
              <Button size="small">Open {d.meeting.ref}</Button>
            </Link>
          ) : null}
        </div>
      </Card>

      {side === "pcp" ? <CaseGovernanceNote refNo={a.ref} status={a.status} /> : null}
      <Row gutter={18}>
        <Col xs={24} lg={15}>
          {a.status === "UPHELD" || a.status === "DISMISSED" ? (
            <Card size="small" title="Council decision" style={{ marginBottom: 16, borderColor: a.status === "UPHELD" ? "#c9ecd8" : "#ffccc7" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                <DecisionPill decision={a.status} />
                <span className="faint" style={{ fontSize: 12.5 }}>
                  {a.decidedBy} · {fmtDate(a.decidedAt, true)}
                  {d.meeting ? ` · ${d.meeting.ref}` : ""}
                </span>
              </div>
              {a.decisionNote ? <div style={{ fontSize: 13.5, lineHeight: 1.55, marginBottom: 10 }}>{a.decisionNote}</div> : null}
              {a.status === "UPHELD" && d.case ? (
                <Alert
                  type="success"
                  showIcon
                  style={{ marginBottom: 10 }}
                  title={
                    <span>
                      <Link href={`${base}/applications/${d.case.ref}`} className="mono">
                        {d.case.ref}
                      </Link>{" "}
                      is back in council review for a fresh decision{d.case.status !== "COUNCIL_REVIEW" ? ` (now: ${d.case.status.toLowerCase().replace(/_/g, " ")})` : ""}.
                    </span>
                  }
                />
              ) : null}
              {a.letter ? <DocLink id={a.letter.id} label="Appeal decision letter (PDF)" sub={a.letter.fileName} /> : null}
            </Card>
          ) : null}
          <Card size="small" title="Decision under appeal" style={{ marginBottom: 16 }}>
            {d.case ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <Link href={`${base}/applications/${d.case.ref}`} className="mono" style={{ fontWeight: 600, fontSize: 14 }}>
                    <FolderOpenOutlined /> {d.case.ref}
                  </Link>
                  <span>{d.case.label}</span>
                  {d.underAppeal ? <DecisionPill decision={d.underAppeal.decision} /> : null}
                  {d.underAppeal ? <span className="faint" style={{ fontSize: 12.5 }}>{fmtDate(d.underAppeal.at)}</span> : null}
                </div>
                {d.underAppeal?.note ? (
                  <Quote label={d.underAppeal.decision === "REJECTED" ? "Grounds of the decision" : "Reason for the deferral"} tone="warn">
                    {d.underAppeal.note}
                  </Quote>
                ) : null}
                {d.case.letter ? <DocLink id={d.case.letter.id} label="Council decision letter" sub={d.case.letter.fileName} /> : null}
              </div>
            ) : (
              <span className="faint">The original case is missing.</span>
            )}
          </Card>
          <Card size="small" title="Grounds of appeal" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: 12 }}>{a.grounds}</div>
            {a.evidence ? (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid var(--line-2)", paddingTop: 10 }}>
                <DocLink id={a.evidence.id} label="Evidence" sub={a.evidence.fileName} />
                <Typography.Text className="mono faint" copyable={{ text: a.evidence.sha256 }}>
                  SHA-256 {a.evidence.sha256.slice(0, 12)}…
                </Typography.Text>
              </div>
            ) : null}
          </Card>
        </Col>
        <Col xs={24} lg={9}>
          <Card
            size="small"
            title={side === "pcp" ? "Your next step" : "What you can do"}
            style={{ marginBottom: 16, borderColor: panels.length ? "#95d5b2" : undefined, boxShadow: panels.length ? "0 0 0 3px #e8f3ee" : undefined }}
            styles={{ body: { background: panels.length ? "#fbfdfc" : undefined } }}
          >
            {panels.length ? (
              <div style={{ display: "grid", gap: 12 }}>{panels}</div>
            ) : (
              <Typography.Text type="secondary">
                {a.status === "ON_AGENDA"
                  ? side === "pcp"
                    ? "The appeal is with the council. The Secretary records the decision in session."
                    : "Your appeal is with the council. You will be told the outcome."
                  : closed
                    ? "This appeal is closed."
                    : side === "pcp"
                      ? "Nothing for your role at this stage."
                      : "PCP is reviewing your appeal. You will be told when it goes to the council."}
              </Typography.Text>
            )}
          </Card>
          {side === "pcp" && a.reviewNote ? (
            <div style={{ marginBottom: 16 }}>
              <Quote label={`Officer's review · ${a.reviewedBy ?? ""} · ${fmtDate(a.reviewedAt)}`} tone="brand">
                {a.reviewNote}
              </Quote>
            </div>
          ) : null}
          <Card size="small" title="History" extra={<span className="faint" style={{ fontSize: 12 }}>From the audit log</span>}>
            <div style={{ display: "grid", gap: 12 }}>
              {[...d.history].reverse().map((h) => (
                <div key={h.id} style={{ display: "flex", gap: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 8, background: "var(--brand)", marginTop: 7, flex: "none" }} />
                  <div style={{ fontSize: 13 }}>
                    <div style={{ fontWeight: 500 }}>{ACTION_LABELS[h.action] ?? h.action}</div>
                    <div className="faint" style={{ fontSize: 12 }}>
                      {h.actor} · {fmtDate(h.at, true)} · {timeAgo(h.at)}
                    </div>
                  </div>
                </div>
              ))}
              {d.history.length === 0 ? <span className="faint">No history yet.</span> : null}
            </div>
          </Card>
        </Col>
      </Row>
    </>
  );
}
