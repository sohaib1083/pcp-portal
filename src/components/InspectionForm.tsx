"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Alert, App, Button, Card, Col, Input, InputNumber, Row, Segmented, Table, Tag, Upload } from "antd";
import { CameraOutlined, CloudSyncOutlined, PaperClipOutlined, SendOutlined, TeamOutlined, WifiOutlined } from "@ant-design/icons";
import { submitInspection } from "@/app/actions/pcp";
import type { ChecklistItem } from "@/db/schema";
import { bandFor, defaultScore, scoreTotals, weightFor, type ScoringRule } from "@/lib/inspection-scoring";
import { clearDraft, loadDraft, saveDraft } from "@/lib/offline-store";
import { ScoreBadge, checklistColumns } from "./AppParts";
import { PageTitle, StatusDot, fmtDate, programmeLabel } from "./common";
import { FillDemo } from "./demo-helpers";

type Result = "COMPLIANT" | "PARTIAL" | "NON_COMPLIANT" | "NA";
const RESULT_COLOR: Record<Result, string> = { COMPLIANT: "#12a150", PARTIAL: "#e8a20c", NON_COMPLIANT: "#d03b3b", NA: "#aab5b0" };

/** A photo or document on one line. `file` until it is sent; `id` (the filed document) after. */
type Evidence = { name: string; type: string; file?: Blob; id?: number };
/** `score` is the score entry (RFP 4.1.2): within the band of the result, null for not applicable. */
type Line = { criterion: string; result: Result; score: number | null; remarks: string; evidence: Evidence[] };
type ReportScore = { total: number; max: number; percent: number; passPercent: number; passed: boolean } | null;
type Draft = { criteria: string[]; items: Line[]; summary: string; savedAt: string; queued: boolean };

/** The server answered and said no: show the reason, do not keep retrying. */
class Refused extends Error {}

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export default function InspectionForm(props: {
  inspectionId: number;
  status: string;
  criteria: string[];
  canSubmit: boolean;
  team: { name: string; province: string; lead: boolean }[];
  report: { checklist: ChecklistItem[]; summary: string | null; score: ReportScore } | null;
  /** The `inspection.scoring` rule: maximum score, bands per result, weights and the pass mark. */
  scoring: ScoringRule;
  context: { ref: string; program: string; field?: string; inst: string; city: string; date: string; scope: string | null; declaredIntake: number; declaredLabs: number; declaredBooks: number; facultyOnRecord: number; postgraduate?: boolean };
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const c = props.context;
  const rule = props.scoring;
  // The rule as of the first render: the effects below must not re-run (and reload the draft) on every render.
  const ruleRef = useRef(rule);
  const key = `inspection:${props.inspectionId}:${c.ref}`;
  const [items, setItems] = useState<Line[]>(props.criteria.map((criterion) => ({ criterion, result: "COMPLIANT", score: defaultScore(rule, "COMPLIANT"), remarks: "", evidence: [] })));
  const [summary, setSummary] = useState("");
  const [online, setOnline] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const editable = props.canSubmit && props.status === "SCHEDULED";
  // A stable value for the effects below: the criteria array is a new object on every server render.
  const critKey = props.criteria.join("\n");

  // Restore what this tablet kept, then track the connection.
  useEffect(() => {
    if (!editable) return;
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    loadDraft<Draft>(key).then((d) => {
      if (d && d.criteria.join("\n") === critKey) {
        // A draft kept before score entry existed gets the result's default score.
        setItems(d.items.map((l) => ({ ...l, score: l.score === undefined ? defaultScore(ruleRef.current, l.result) : l.score })));
        setSummary(d.summary);
        setQueued(d.queued);
        setRestoredAt(d.savedAt);
      }
      setLoaded(true);
    });
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [editable, key, critKey]);

  // Keep every change on the tablet, so a lost connection or a closed tab loses nothing.
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      const at = new Date().toISOString();
      saveDraft<Draft>(key, { criteria: critKey.split("\n"), items, summary, savedAt: at, queued }).then((ok) => ok && setSavedAt(at));
    }, 300);
    return () => clearTimeout(t);
  }, [loaded, key, critKey, items, summary, queued]);

  const send = useCallback(async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      // 1. Photos and documents not sent yet, one by one; each id is kept as soon as it is filed.
      let lines = items;
      for (let i = 0; i < lines.length; i++) {
        for (let k = 0; k < lines[i].evidence.length; k++) {
          const e = lines[i].evidence[k];
          if (e.id || !e.file) continue;
          const fd = new FormData();
          fd.append("file", new File([e.file], e.name, { type: e.type }));
          fd.append("line", String(i + 1));
          const res = await fetch(`/api/inspections/${props.inspectionId}/evidence`, { method: "POST", body: fd });
          const j = (await res.json().catch(() => ({}))) as { id?: number; error?: string };
          if (!res.ok || !j.id) throw new Refused(j.error ?? `Could not send ${e.name} (${res.status})`);
          lines = lines.map((l, li) => (li === i ? { ...l, evidence: l.evidence.map((x, xk) => (xk === k ? { name: x.name, type: x.type, id: j.id } : x)) } : l));
          setItems(lines);
        }
      }
      // 2. The checklist itself.
      const r = await submitInspection(props.inspectionId, {
        items: lines.map((l) => ({ criterion: l.criterion, result: l.result, score: l.result === "NA" ? null : l.score, remarks: l.remarks, evidence: l.evidence.filter((e) => e.id).map((e) => ({ id: e.id!, name: e.name })) })),
        summary,
      });
      if (!r.ok) throw new Refused(r.message);
      setLoaded(false); // stop saving: the draft is cleared on purpose
      await clearDraft(key);
      message.success(r.message);
      router.push(`/pcp/applications/${c.ref}`);
    } catch (e) {
      if (e instanceof Refused) {
        setQueued(false);
        message.error(e.message);
      } else {
        // No connection (the request itself failed): keep it queued; it goes when the connection returns.
        setQueued(true);
        message.warning("No connection. The report is kept on this tablet and is sent when the connection returns.");
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [items, summary, key, props.inspectionId, c.ref, message, router]);

  // A queued report goes as soon as the connection is back.
  useEffect(() => {
    if (loaded && queued && online && !sendingRef.current) void send();
  }, [loaded, queued, online, send]);

  const submit = () => {
    if (summary.trim().length < 5) {
      message.error("Write the overall finding and recommendation before submitting.");
      return;
    }
    if (!navigator.onLine) {
      setQueued(true);
      message.info("Queued on this tablet. The report is sent when the connection returns.");
      return;
    }
    void send();
  };

  const fillDemo = () => {
    // Mostly compliant, one line partial: a realistic score that still passes.
    setItems(
      items.map((x, i) => {
        const result: Result = i === 2 ? "PARTIAL" : "COMPLIANT";
        return { ...x, result, score: i === 2 ? (rule.bands?.PARTIAL?.[1] ?? 3) : i % 3 === 1 ? (rule.bands?.COMPLIANT?.[0] ?? 4) : rule.maxScore, remarks: i === 2 ? "Some journal subscriptions lapsed; renewal in progress" : ["Verified on site", "Matches the declared inventory", "Seen and counted", "Records produced and checked"][i % 4] };
      }),
    );
    setSummary(`Adequate for an intake of ${c.declaredIntake || 60}; recommend approval.`);
  };
  const setLine = (i: number, patch: Partial<Line>) => setItems((cur) => cur.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const totals = scoreTotals(items, rule);

  const teamCard = (
    <Card size="small" style={{ marginBottom: 16 }} title={<span><TeamOutlined style={{ marginRight: 8, color: "#5b3cc4" }} />Team and scope</span>} data-testid="visit-team">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: c.scope ? 10 : 0 }}>
        {props.team.map((m) => (
          <StatusDot key={m.name} tone={m.lead ? "violet" : "neutral"}>
            {m.name} · {m.province} {m.lead ? "(lead)" : ""}
          </StatusDot>
        ))}
      </div>
      {c.scope ? <div style={{ fontSize: 13.5 }}><b>The institution was asked to prepare:</b> {c.scope}</div> : null}
    </Card>
  );
  const head = (
    <PageTitle
      eyebrow="On-site inspection"
      title={c.inst}
      sub={
        <span>
          {c.city} · {programmeLabel(c.program, c.field)} · <span className="mono">{c.ref}</span> · {fmtDate(c.date)}
        </span>
      }
      extra={editable ? <FillDemo onClick={fillDemo} /> : <Link href={`/pcp/applications/${c.ref}`}><Button>Open the case</Button></Link>}
    />
  );
  if (props.status !== "SCHEDULED")
    return (
      <>
        {head}
        <Alert type="success" showIcon style={{ marginBottom: 16 }} title="This inspection report has been submitted by the team lead." />
        {teamCard}
        {props.report ? (
          <Card size="small" title="Report" extra={props.report.score ? <ScoreBadge s={props.report.score} compact /> : null}>
            <Table
              size="small"
              rowKey="criterion"
              pagination={false}
              dataSource={props.report.checklist}
              scroll={{ x: true }}
              columns={[
                ...checklistColumns(rule.maxScore),
                {
                  title: "Photos and documents",
                  dataIndex: "evidence",
                  render: (ev: ChecklistItem["evidence"]) =>
                    ev?.length ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {ev.map((e) => (
                          <a key={e.id} href={`/api/documents/${e.id}`} target="_blank" rel="noreferrer">
                            <PaperClipOutlined /> {e.name}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <span className="muted">None</span>
                    ),
                },
              ]}
            />
            <div style={{ marginTop: 10 }}><b>Summary:</b> {props.report.summary}</div>
          </Card>
        ) : null}
      </>
    );
  if (!props.canSubmit)
    return (
      <>
        {head}
        <Alert type="info" showIcon style={{ marginBottom: 16 }} title="You are a member of this inspection team" description={`The lead, ${props.team.find((m) => m.lead)?.name ?? "the team lead"}, fills in and submits the checklist. Record your observations with the lead on site.`} />
        {teamCard}
      </>
    );
  const done = items.filter((x) => x.result !== "NA" || x.remarks).length;
  const files = items.reduce((n, l) => n + l.evidence.length, 0);

  return (
    <>
      {head}
      {teamCard}
      <Alert
        data-testid="offline-status"
        type={queued || !online ? "warning" : "info"}
        showIcon
        icon={online ? <CloudSyncOutlined /> : <WifiOutlined />}
        style={{ marginBottom: 16 }}
        title={
          queued
            ? online
              ? "Sending the report now"
              : "Report queued: it is sent when the connection returns"
            : online
              ? "Works without a connection"
              : "Offline: keep working, everything stays on this tablet"
        }
        description={
          <span>
            {queued
              ? "The checklist, photos and documents stay on this tablet until PCP has them. You can close this tab; open this visit again once you are connected."
              : online
                ? "Answers, photos and documents are kept on this tablet as you go. Open this visit before leaving for the site; a lost connection there loses nothing."
                : "Fill in the checklist and press Submit. The report waits on this tablet and goes to PCP when the connection returns."}
            {savedAt ? <span className="muted" data-testid="saved-at"> Saved on this tablet at {time(savedAt)}.</span> : null}
            {restoredAt && !savedAt ? <span className="muted"> Restored what you saved at {time(restoredAt)}.</span> : null}
          </span>
        }
        action={queued && online ? <Button size="small" loading={sending} onClick={() => void send()}>Send now</Button> : undefined}
      />
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {[
          ["Proposed intake", c.declaredIntake],
          [c.postgraduate ? "Research labs declared" : "Laboratories declared", c.declaredLabs],
          [c.postgraduate ? "Journals declared" : "Library books declared", c.declaredBooks],
          [c.postgraduate ? "Supervisors linked" : "Faculty on record", c.facultyOnRecord],
        ].map(([l, v]) => (
          <Col key={String(l)} xs={12} md={6}>
            <div className="pcp-stat" style={{ display: "block" }}>
              <div className="pcp-stat-label">{l}</div>
              <div className="pcp-stat-value tnum">{v}</div>
            </div>
          </Col>
        ))}
      </Row>
      {items.map((it, i) => {
        const band = bandFor(rule, it.result);
        const w = weightFor(rule, it.criterion);
        return (
        <Card key={it.criterion} size="small" style={{ marginBottom: 10, borderLeft: `4px solid ${RESULT_COLOR[it.result]}` }} className="inspection-line">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            <b>
              {i + 1}. {it.criterion}
              {w !== 1 ? <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}> · weight {w}</span> : null}
            </b>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Segmented
                value={it.result}
                // A new result starts at its default score; the inspector can move it within the band.
                onChange={(v) => setLine(i, { result: v as Result, score: defaultScore(rule, v as string) })}
                options={[
                  { value: "COMPLIANT", label: "Compliant" },
                  { value: "PARTIAL", label: "Partial" },
                  { value: "NON_COMPLIANT", label: "Non-compliant" },
                  { value: "NA", label: "N/A" },
                ]}
              />
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }} className="line-score" title={band ? `A ${it.result === "COMPLIANT" ? "compliant" : it.result === "PARTIAL" ? "partial" : "non-compliant"} line scores ${band[0]} to ${band[1]}` : "Not applicable: left out of the score"}>
                <span className="faint" style={{ fontSize: 12 }}>Score</span>
                <InputNumber
                  size="middle"
                  aria-label={`Score for line ${i + 1}`}
                  min={band?.[0] ?? 0}
                  max={band?.[1] ?? rule.maxScore}
                  precision={0}
                  disabled={!band}
                  value={band ? it.score : null}
                  onChange={(v) => setLine(i, { score: v === null || v === undefined ? (band?.[0] ?? 0) : Math.max(band?.[0] ?? 0, Math.min(band?.[1] ?? rule.maxScore, Number(v))) })}
                  style={{ width: 64 }}
                />
                <span className="faint tnum" style={{ fontSize: 12 }}>/ {rule.maxScore}</span>
              </span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Input placeholder="Remarks" value={it.remarks} onChange={(e) => setLine(i, { remarks: e.target.value })} />
            <Upload
              multiple
              accept="image/*,application/pdf"
              showUploadList={false}
              beforeUpload={(file) => {
                if (file.size > 10 * 1024 * 1024) {
                  message.error(`${file.name} is larger than 10 MB`);
                  return Upload.LIST_IGNORE;
                }
                setItems((cur) => cur.map((x, j) => (j === i ? { ...x, evidence: [...x.evidence, { name: file.name, type: file.type || "application/octet-stream", file }] } : x)));
                return false;
              }}
            >
              <Button icon={<CameraOutlined />}>Photo or document</Button>
            </Upload>
          </div>
          {it.evidence.length ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }} data-testid="line-evidence">
              {it.evidence.map((e, k) => (
                <Tag
                  key={`${e.name}-${k}`}
                  icon={<PaperClipOutlined />}
                  color={e.id ? "green" : "default"}
                  closable={!e.id}
                  onClose={(ev) => {
                    ev.preventDefault();
                    setLine(i, { evidence: it.evidence.filter((_, kk) => kk !== k) });
                  }}
                >
                  {e.name} {e.id ? "· sent" : "· on this tablet"}
                </Tag>
              ))}
            </div>
          ) : null}
        </Card>
        );
      })}
      <Card size="small" style={{ marginTop: 16, borderColor: totals.passed ? "#c9ecd8" : "#ffccc7", background: totals.passed ? "#f6fcf8" : "#fff8f7" }} data-testid="score-total">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 600 }}>Inspection score</div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              Weighted total of {totals.counted} scored line{totals.counted === 1 ? "" : "s"} (N/A lines are left out). Pass mark {rule.passPercent}%, from PCP&apos;s scoring rule.
            </div>
          </div>
          <ScoreBadge s={{ total: totals.total, max: totals.max, percent: totals.percent, passPercent: totals.passPercent, passed: totals.passed }} />
        </div>
      </Card>
      <Card title="Summary and recommendation" style={{ marginTop: 16 }}>
        <Input.TextArea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Overall finding and recommendation to PCP" />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {done} of {items.length} criteria recorded{files ? `, ${files} photo${files === 1 ? "" : "s"} or document${files === 1 ? "" : "s"}` : ""}. Submitting files the inspection report and its evidence in the institution&apos;s folder and notifies the officer.
          </span>
          <Button type="primary" size="large" icon={<SendOutlined />} loading={sending} disabled={queued && !online} onClick={submit}>
            {queued && !online ? "Queued on this tablet" : "Submit inspection report"}
          </Button>
        </div>
      </Card>
    </>
  );
}
