"use client";
// One letter in the register: the scan or generated PDF (with versions), who must act, dispatch, replies and history.
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Card, Col, DatePicker, Input, Modal, Popconfirm, Row, Select } from "antd";
import { CheckOutlined, ClockCircleOutlined, EditOutlined, FileAddOutlined, InboxOutlined, LockOutlined, MailOutlined, RollbackOutlined, SendOutlined, UserOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { closeLetter, dispatchOutward, markLetter, recordLetterAction, updateOutward } from "@/app/actions/correspondence";
import type { ActionResult } from "@/app/actions/faculty";
import type { LetterDetail } from "@/lib/governance-data";
import { MODE_LABELS } from "@/lib/governance-shared";
import { KV, fmtDate } from "./common";
import { DocLink, Quote } from "./CouncilParts";
import { FillDemo } from "./demo-helpers";
import { DocList, FilePick, History, LetterStatus, RefLink, uploadGov } from "./GovParts";
import ScreenGuide from "./ScreenGuide";

type Staff = { username: string; name: string; roleLabel: string }[];

function EditModal({ d, onClose, run }: { d: LetterDetail; onClose: () => void; run: (fn: () => Promise<ActionResult>) => Promise<boolean> }) {
  const [subject, setSubject] = useState(d.l.subject);
  const [body, setBody] = useState(d.l.body ?? "");
  const [mode, setMode] = useState(d.l.mode);
  return (
    <Modal open width={720} title="Edit the letter" okText="Regenerate the letter" onOk={async () => (await run(() => updateOutward(d.l.ref, { subject, body, mode }))) && onClose()} onCancel={onClose} destroyOnHidden>
      <div style={{ display: "grid", gap: 10 }}>
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        <Input.TextArea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
        <Select value={mode} onChange={setMode} options={Object.entries(MODE_LABELS).map(([value, label]) => ({ value, label }))} style={{ width: 200 }} />
        <div className="faint" style={{ fontSize: 12.5 }}>The PDF is generated again as a new version; the earlier version is kept.</div>
      </div>
    </Modal>
  );
}

function ScanModal({ d, onClose }: { d: LetterDetail; onClose: () => void }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [pending, start] = useTransition();
  const inward = d.l.direction === "IN";
  return (
    <Modal
      open
      title={<span><FileAddOutlined style={{ color: "var(--brand)", marginRight: 8 }} />{inward ? "File the scanned letter" : "File the signed copy"}</span>}
      okText="File it"
      okButtonProps={{ disabled: !file }}
      confirmLoading={pending}
      onOk={() =>
        start(async () => {
          const r = await uploadGov({ target: "letter", ref: d.l.ref, file: file! });
          message[r.ok ? "success" : "error"](r.message, r.ok ? 4 : 8);
          if (r.ok) {
            onClose();
            router.refresh();
          }
        })
      }
      onCancel={onClose}
      destroyOnHidden
    >
      <FilePick file={file} onFile={setFile} sample={inward ? "Scanned inward letter" : "Signed outward letter"} />
      <div className="faint" style={{ fontSize: 12.5, marginTop: 10 }}>A new file is a new version; earlier versions are kept.{d.l.partyInst ? ` It is filed in ${d.l.partyInst.shortCode}'s Correspondence folder.` : ""}</div>
    </Modal>
  );
}

export default function LetterView({ d, canManage, isMine, staff }: { d: LetterDetail; canManage: boolean; isMine: boolean; staff: Staff }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [markTo, setMarkTo] = useState<string | undefined>(d.l.markedTo ?? undefined);
  const [due, setDue] = useState<string | null>(d.l.actionDue);
  const [modal, setModal] = useState<null | "edit" | "scan">(null);
  const l = d.l;
  const inward = l.direction === "IN";
  const canAct = canManage || isMine;
  const draft = !inward && !l.dispatchedAt;

  const run = (fn: () => Promise<ActionResult>) =>
    new Promise<boolean>((resolve) =>
      start(async () => {
        const r = await fn();
        message[r.ok ? "success" : "error"](r.message, r.ok ? 5 : 8);
        if (r.ok) setNote("");
        router.refresh();
        resolve(r.ok);
      }),
    );

  const box = inward
    ? l.status === "OPEN"
      ? l.markedTo
        ? { who: `With: ${l.markedToName}`, what: l.actionDue ? `${l.overdue ? "Past its action date: " : "Action due by "}${fmtDate(l.actionDue)}.` : "No action date set.", c: l.overdue ? "#b4141f" : "#5b3cc4", bg: l.overdue ? "#fff1f0" : "#f2eefe", bd: l.overdue ? "#ffccc7" : "#ddd3fb" }
        : { who: "Not marked to anyone yet", what: canManage ? "Mark it to the officer who must act." : "A register keeper marks it to an officer.", c: "#a15c00", bg: "#fff7e6", bd: "#ffe1a8" }
      : { who: l.status === "ACTIONED" ? "Actioned" : "Closed", what: l.actionNote ?? "Filed.", c: "#0d7a3d", bg: "#e9f7ef", bd: "#c9ecd8" }
    : draft
      ? { who: "Draft: not sent yet", what: "Check the generated PDF, then dispatch it. An email copy goes to the addressee.", c: "#a15c00", bg: "#fff7e6", bd: "#ffe1a8" }
      : { who: `Dispatched ${fmtDate(l.dispatchedAt, true)}`, what: `By ${MODE_LABELS[l.mode].toLowerCase()}${l.dispatchedBy ? `, by ${l.dispatchedBy}` : ""}.${d.messages.length ? ` Email copy to ${d.messages.length} recipient${d.messages.length === 1 ? "" : "s"}.` : ""}`, c: "#0d7a3d", bg: "#e9f7ef", bd: "#c9ecd8" };

  const panels: React.ReactNode[] = [];
  if (inward && canManage && l.status !== "CLOSED")
    panels.push(
      <div key="mark" style={{ display: "grid", gap: 8 }}>
        <b>{l.markedTo ? "Mark to another officer" : "Mark to an officer"}</b>
        <Select id="mark-to" showSearch optionFilterProp="label" placeholder="Choose the officer" value={markTo} onChange={setMarkTo} options={staff.map((s) => ({ value: s.username, label: `${s.name} · ${s.roleLabel}` }))} />
        <DatePicker placeholder="Action due by" format="D MMM YYYY" value={due ? dayjs(due) : null} onChange={(v) => setDue(v ? v.format("YYYY-MM-DD") : null)} disabledDate={(x) => x.isBefore(dayjs(), "day")} />
        <Button icon={<UserOutlined />} loading={pending} disabled={!markTo || (markTo === l.markedTo && due === l.actionDue)} onClick={() => run(() => markLetter(l.ref, { markedTo: markTo!, actionDue: due }))}>
          Mark to officer
        </Button>
      </div>,
    );
  if (inward && canAct && l.status === "OPEN")
    panels.push(
      <div key="act" style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <b>Record the action taken</b>
          <FillDemo onClick={() => setNote("Checked against the case file; the institution was told by phone that the deadline stands. No extension granted.")} />
        </div>
        <Input.TextArea id="action-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done" />
        <Button type="primary" icon={<CheckOutlined />} loading={pending} disabled={note.trim().length < 5} onClick={() => run(() => recordLetterAction(l.ref, note))}>
          Record action
        </Button>
      </div>,
    );
  if (inward && canManage && l.status !== "CLOSED")
    panels.push(
      <Link key="reply" href={`/pcp/correspondence?tab=out&reply=${l.ref}`}>
        <Button block icon={<RollbackOutlined />}>
          Reply with an outward letter
        </Button>
      </Link>,
    );
  if (!inward && canManage && draft)
    panels.push(
      <div key="dispatch" style={{ display: "grid", gap: 8 }}>
        <Popconfirm
          title="Dispatch this letter?"
          description={l.partyInst ? `An email copy goes to every user of ${l.partyInst.shortCode}. The letter can no longer change.` : l.partyEmail ? `An email copy goes to ${l.partyEmail}.` : "There is no email address, so only the dispatch is recorded."}
          okText="Dispatch"
          onConfirm={() => run(() => dispatchOutward(l.ref))}
        >
          <Button type="primary" size="large" block icon={<SendOutlined />} loading={pending}>
            Dispatch
          </Button>
        </Popconfirm>
        <Button icon={<EditOutlined />} onClick={() => setModal("edit")}>
          Edit the text
        </Button>
      </div>,
    );
  if (canAct && l.status !== "CLOSED" && !draft)
    panels.push(
      <Popconfirm key="close" title="Close and file this letter?" okText="Close" onConfirm={() => run(() => closeLetter(l.ref))}>
        <Button block type="text" icon={<LockOutlined />}>
          Close and file
        </Button>
      </Popconfirm>,
    );

  const current = l.documentId;

  return (
    <>
      <Card style={{ marginBottom: 18 }} styles={{ body: { padding: "20px 22px" } }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div className="pcp-eyebrow">
              <Link href={`/pcp/correspondence${inward ? "" : "?tab=out"}`} style={{ color: "inherit" }}>
                Correspondence
              </Link>{" "}
              · {inward ? "Inward (diary)" : "Outward (dispatch)"}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h1 className="pcp-page-title mono" style={{ fontSize: 24, letterSpacing: "-0.01em" }}>
                {l.ref}
              </h1>
              <LetterStatus status={l.status} direction={l.direction} dispatchedAt={l.dispatchedAt} />
            </div>
            <div style={{ marginTop: 6, fontSize: 15, fontWeight: 500 }}>{l.subject}</div>
            <div className="muted" style={{ marginTop: 2, fontSize: 13.5 }}>
              {inward ? "From" : "To"} {l.party} · dated {fmtDate(l.date)} · {MODE_LABELS[l.mode]}
            </div>
          </div>
          <ScreenGuide
            title="A letter"
            steps={
              inward
                ? [
                    "The box under the title says who holds the letter and when action is due.",
                    "A register keeper marks it to an officer. It goes on their work list and they are notified.",
                    "The officer records the action taken, or a register keeper replies with an outward letter (the reply closes the loop when it is dispatched).",
                    "**File the scanned letter** adds the scan as a versioned document, in the institution's Correspondence folder when the sender is an institution.",
                  ]
                : [
                    "The letter was generated on the PCP letterhead with its dispatch number, QR code and signature block.",
                    "Check the PDF. **Edit the text** generates it again as a new version.",
                    "**Dispatch** records it and sends an email copy to the institution's users (or the addressee's email).",
                    "It is filed in the institution's Correspondence folder and shows on the case it is about.",
                  ]
            }
          />
        </div>
        <div className="pcp-court" style={{ marginTop: 18, background: box.bg, borderColor: box.bd }} data-testid="letter-state">
          <span style={{ width: 36, height: 36, borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center", color: box.c }}>{inward ? <InboxOutlined /> : draft ? <ClockCircleOutlined /> : <MailOutlined />}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="pcp-court-title" style={{ color: box.c }}>
              {box.who}
            </div>
            <div className="pcp-court-sub">{box.what}</div>
          </div>
        </div>
      </Card>

      <Row gutter={18}>
        <Col xs={24} lg={15}>
          <Card size="small" title="The letter" extra={canAct ? <Button size="small" icon={<FileAddOutlined />} onClick={() => setModal("scan")}>{inward ? "File the scanned letter" : "File the signed copy"}</Button> : null} style={{ marginBottom: 16 }}>
            {current ? (
              <div style={{ marginBottom: 12 }}>
                <DocLink id={current} label={inward ? "Scanned letter (current version)" : "Generated letter (current version)"} sub={l.partyInst ? `Filed in ${l.partyInst.shortCode}'s Correspondence folder` : "PCP-level paper"} />
              </div>
            ) : (
              <div className="faint" style={{ marginBottom: 12, fontSize: 13 }}>{inward ? "No scan filed yet." : "Not generated yet."}</div>
            )}
            {!inward && l.body ? (
              <div style={{ marginBottom: 12 }}>
                <Quote label="Text">{l.body}</Quote>
              </div>
            ) : null}
            <div className="pcp-section-title" style={{ marginBottom: 8 }}>All versions</div>
            <DocList docs={d.documents} />
          </Card>
          {d.original || d.replies.length ? (
            <Card size="small" title="Thread" style={{ marginBottom: 16 }}>
              <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
                {d.original ? (
                  <div>
                    In reply to <RefLink refNo={d.original.ref} />: {d.original.party}, &ldquo;{d.original.subject}&rdquo; of {fmtDate(d.original.date)}
                  </div>
                ) : null}
                {d.replies.map((r) => (
                  <div key={r.ref}>
                    Reply <RefLink refNo={r.ref} />: {r.subject} · {r.dispatchedAt ? `dispatched ${fmtDate(r.dispatchedAt)}` : "draft"}
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
          {d.messages.length ? (
            <Card size="small" title="Emails about this letter" style={{ marginBottom: 16 }}>
              <div style={{ display: "grid", gap: 6 }}>
                {d.messages.map((m) => (
                  <div key={m.id} style={{ fontSize: 12.5 }}>
                    <b style={{ fontWeight: 500 }}>{m.to}</b> <span className="faint">&lt;{m.address}&gt; · {fmtDate(m.at, true)}</span>
                    <div className="muted">{m.subject}</div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </Col>
        <Col xs={24} lg={9}>
          <Card
            size="small"
            title="Your next step"
            style={{ marginBottom: 16, borderColor: panels.length ? "#95d5b2" : undefined, boxShadow: panels.length ? "0 0 0 3px #e8f3ee" : undefined }}
            styles={{ body: { background: panels.length ? "#fbfdfc" : undefined } }}
          >
            {panels.length ? <div style={{ display: "grid", gap: 14 }}>{panels}</div> : <span className="faint" style={{ fontSize: 13 }}>{l.status === "CLOSED" ? "This letter is closed and filed." : "Nothing for your role on this letter."}</span>}
          </Card>
          <Card size="small" title="Details" style={{ marginBottom: 16 }}>
            <KV
              rows={[
                [inward ? "From" : "To", l.party],
                ["Institution", l.inst ? `${l.inst.name} (${l.inst.shortCode})` : "—"],
                ["Email", l.partyEmail ?? (l.partyInst ? "Institution users" : "—")],
                ["About", l.linkedRef ? <RefLink key="r" refNo={l.linkedRef} /> : "—"],
                ...(inward
                  ? ([
                      ["Marked to", l.markedToName ?? "Nobody yet"],
                      ["Action due", l.actionDue ? fmtDate(l.actionDue) : "—"],
                      ["Action taken", l.actionNote ?? "—"],
                    ] as [string, React.ReactNode][])
                  : []),
                ["Entered by", `${l.createdBy} · ${fmtDate(l.createdAt, true)}`],
              ]}
            />
          </Card>
          <Card size="small" title="History" style={{ marginBottom: 16 }}>
            <History rows={d.history} />
          </Card>
        </Col>
      </Row>
      {modal === "edit" ? <EditModal d={d} run={run} onClose={() => setModal(null)} /> : null}
      {modal === "scan" ? <ScanModal d={d} onClose={() => setModal(null)} /> : null}
    </>
  );
}
