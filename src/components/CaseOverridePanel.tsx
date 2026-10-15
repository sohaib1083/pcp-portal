"use client";
// Super administrator overrides on a case (RFP 4.1.2 "global overrides"). Shown to the Super Administrator only.
// Each override needs a reason and a one-time code; it is audited, put on the case timeline and the institution
// is told. It never records a council decision.
import { useState } from "react";
import { Alert, Button, Card, DatePicker, Input, Radio, Select, Space } from "antd";
import { LockOutlined, ToolOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { applyOverride } from "@/app/actions/overrides";
import type { ActionResult } from "@/app/actions/faculty";
import type { AppDetail } from "@/lib/appdetail";
import { OVERRIDE_LABELS, REOPEN_FROM, REOPEN_TO } from "@/lib/overrides-shared";
import { OPEN_STATUSES, STAGE_LABELS, STATUS_LABELS } from "@/lib/workflow";
import { fmtDate } from "./common";
import { FillDemo } from "./demo-helpers";
import type { useOtp } from "./OtpConfirm";

export type OverrideData = { officers: { username: string; name: string; role: string }[]; hasReport: boolean };
type Kind = "REASSIGN_OFFICER" | "EXTEND_DEADLINE" | "REOPEN" | "HOLD" | "RELEASE_HOLD";

const DEMO_REASON: Record<Kind, string> = {
  REASSIGN_OFFICER: "The assigned officer is on extended leave; the case moves so the time limit is not missed.",
  EXTEND_DEADLINE: "The institution's area was hit by flooding; the Secretary approved extra time in writing (letter on file).",
  REOPEN: "The council asked for a fresh scrutiny after new documents were received through the Secretary.",
  HOLD: "A complaint about forged faculty documents is under inquiry; no step until the inquiry report is received.",
  RELEASE_HOLD: "The inquiry report cleared the institution; the case continues from where it stopped.",
};

const stage = (s: string) => STAGE_LABELS[s] ?? STATUS_LABELS[s] ?? s;

export default function CaseOverridePanel({ d, data, run, pending, withOtp }: { d: AppDetail; data: OverrideData; run: (fn: () => Promise<ActionResult>) => void; pending: boolean; withOtp: ReturnType<typeof useOtp>["withOtp"] }) {
  const s = d.app.status;
  const open = OPEN_STATUSES.includes(s);
  const held = !!d.hold;
  const canExtend = open && !held && !!d.app.stageDueAt && s !== "DEFERRED";
  const canReopen = open && !held && REOPEN_FROM.includes(s);
  const options: { value: Kind; label: string; disabled?: boolean; title?: string }[] = held
    ? [
        { value: "RELEASE_HOLD", label: "Release hold" },
        { value: "REASSIGN_OFFICER", label: "Reassign officer" },
      ]
    : [
        { value: "REASSIGN_OFFICER", label: "Reassign officer", disabled: !open },
        { value: "EXTEND_DEADLINE", label: "Extend deadline", disabled: !canExtend, title: s === "DEFERRED" ? "A deferral's return date is the council's decision" : !d.app.stageDueAt ? "This stage has no time limit" : undefined },
        { value: "REOPEN", label: "Reopen", disabled: !canReopen, title: canReopen ? undefined : "Only a case returned for a deficiency or deferred can be reopened" },
        { value: "HOLD", label: "Place on hold", disabled: !open },
      ];
  const [kind, setKind] = useState<Kind>(options.find((o) => !o.disabled)?.value ?? "REASSIGN_OFFICER");
  const [officer, setOfficer] = useState<string>();
  const due = d.app.stageDueAt ? dayjs(d.app.stageDueAt) : null;
  const [until, setUntil] = useState<string>((due ?? dayjs()).add(14, "day").format("YYYY-MM-DD"));
  const [target, setTarget] = useState<string>("UNDER_SCRUTINY");
  const [reason, setReason] = useState("");
  const current = options.some((o) => o.value === kind && !o.disabled) ? kind : (options.find((o) => !o.disabled)?.value ?? kind);

  const label = OVERRIDE_LABELS[current] ?? current;
  const ready = reason.trim().length >= 10 && (current !== "REASSIGN_OFFICER" || !!officer);
  const submit = () =>
    withOtp(`override:${d.app.ref}`, `Override on ${d.app.ref}: ${label.toLowerCase()}`, (code) =>
      run(() =>
        applyOverride(d.app.ref, {
          kind: current,
          reason,
          otp: code,
          ...(current === "REASSIGN_OFFICER" ? { officer } : current === "EXTEND_DEADLINE" ? { until } : current === "REOPEN" ? { stage: target } : {}),
        }),
      ),
    );

  return (
    <Card
      size="small"
      data-testid="override-panel"
      style={{ marginBottom: 16, borderColor: "#ffccc7" }}
      styles={{ header: { background: "#fff6f5" } }}
      title={
        <span style={{ color: "#b4141f" }}>
          <ToolOutlined style={{ marginRight: 8 }} />
          Super administrator override
        </span>
      }
      extra={<FillDemo onClick={() => setReason(DEMO_REASON[current])} />}
    >
      <div className="faint" style={{ fontSize: 12.5, marginBottom: 10 }}>
        For exceptions only. Each override needs a reason and a one-time code, is written to the audit log and the case timeline, and the institution is told. It never records a council decision.
      </div>
      {!open ? (
        <Alert type="info" showIcon title={`${STATUS_LABELS[s] ?? s}: overrides apply to open cases only.`} />
      ) : (
        <Space orientation="vertical" style={{ width: "100%" }} size={10}>
          <div className="override-kind" role="radiogroup" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {options.map((o) => (
              <Button key={o.value} size="small" role="radio" aria-checked={current === o.value} type={current === o.value ? "primary" : "default"} disabled={o.disabled} title={o.title} onClick={() => setKind(o.value)}>
                {o.label}
              </Button>
            ))}
          </div>
          {current === "REASSIGN_OFFICER" ? (
            <div>
              <div className="faint" style={{ fontSize: 12, marginBottom: 4 }}>
                Now: <b style={{ color: "var(--ink)" }}>{d.app.assignedOfficerName ?? "Unassigned"}</b>
              </div>
              <Select
                className="override-officer"
                style={{ width: "100%" }}
                placeholder="New case officer"
                value={officer}
                onChange={setOfficer}
                options={data.officers.filter((o) => o.username !== d.app.assignedOfficer).map((o) => ({ value: o.username, label: `${o.name} · ${o.role}` }))}
              />
            </div>
          ) : current === "EXTEND_DEADLINE" ? (
            <div>
              <div className="faint" style={{ fontSize: 12, marginBottom: 4 }}>
                {stage(s)} is due <b style={{ color: "var(--ink)" }}>{fmtDate(d.app.stageDueAt)}</b>. New deadline:
              </div>
              <DatePicker
                className="override-until"
                style={{ width: "100%" }}
                format="D MMM YYYY"
                value={dayjs(until)}
                allowClear={false}
                disabledDate={(v) => (due ? !v.isAfter(due, "day") : v.isBefore(dayjs(), "day")) || v.isAfter(dayjs().add(180, "day"))}
                onChange={(v) => v && setUntil(v.format("YYYY-MM-DD"))}
              />
              {s === "DEFICIENCY_RAISED" ? <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>The institution's deficiency deadline moves with it.</div> : null}
            </div>
          ) : current === "REOPEN" ? (
            <div>
              <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>
                Now: <b style={{ color: "var(--ink)" }}>{STATUS_LABELS[s] ?? s}</b>. Reopen it at:
              </div>
              <Radio.Group
                className="override-stage"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                options={REOPEN_TO.map((t) => ({ value: t, label: stage(t), disabled: t === "COUNCIL_REVIEW" && !data.hasReport }))}
              />
              {d.deficiencies.some((x) => ["OUTSTANDING", "RESPONDED", "REJECTED"].includes(x.status)) ? <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>Open deficiencies are withdrawn, with this override as the reason.</div> : null}
            </div>
          ) : current === "HOLD" ? (
            <Alert type="warning" showIcon title="Nobody can take a step on the case until the hold is released. The stage clock is paused and restarts with the time that was left." />
          ) : (
            <Alert type="error" showIcon title={`On hold since ${fmtDate(d.hold?.placedAt)} by ${d.hold?.placedBy}`} description={d.hold?.reason} />
          )}
          <Input.TextArea id="override-reason" rows={3} placeholder="Reason for the override (kept in the audit log; not shown to the institution)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button danger type="primary" block icon={<LockOutlined />} loading={pending} disabled={!ready} onClick={submit} className="apply-override">
            Apply override with a one-time code
          </Button>
        </Space>
      )}
      {d.overrides.length ? (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--line-2)", paddingTop: 8 }} data-testid="override-history">
          <div className="faint" style={{ fontSize: 12, marginBottom: 4 }}>Overrides on this case</div>
          {d.overrides.map((o) => (
            <div key={o.ref} style={{ fontSize: 12.5, padding: "3px 0" }}>
              <span className="mono">{o.ref}</span> · {OVERRIDE_LABELS[o.kind] ?? o.kind} · {o.actor} · {fmtDate(o.createdAt, true)}
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
