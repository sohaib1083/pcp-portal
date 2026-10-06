"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Col, Drawer, Empty, Input, InputNumber, Row, Select, Space, Table, Tooltip, Upload } from "antd";
import { AuditOutlined, ClockCircleOutlined, FilePdfOutlined, FileSearchOutlined, InfoCircleOutlined, LockOutlined, PaperClipOutlined, ReloadOutlined, SendOutlined, UploadOutlined } from "@ant-design/icons";
import type { AnnualFigures } from "@/db/modules/students";
import { requestCorrection, saveAnnualReturn } from "@/app/actions/students";
import { FIGURE_HELP, FIGURE_KEYS, FIGURE_LABELS, applyCorrections, emptyFigures, figureProblems, type FigureChange, type FigureKey } from "@/lib/registry-shared";
import { PageTitle, StatCard, fmtDate, programLabel } from "./common";
import { SamplePdfButton } from "./demo-helpers";
import { FiguresTable, RegStatus, SectionLabel, uploadEvidence } from "./registry-ui";

type Doc = { id: number; fileName: string; version: number } | null;
export type ReturnRow = {
  id: number;
  ref: string;
  programType: string;
  year: number;
  status: string;
  figures: AnnualFigures | null;
  note: string | null;
  evidence: Doc;
  dueDate: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  lockedAt: string | null;
};
export type CorrectionRow = {
  id: number;
  ref: string;
  annualReturnId: number;
  changes: FigureChange[];
  reason: string;
  evidence: Doc;
  status: string;
  requestedBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
};

export function EvidenceLink({ doc }: { doc: Doc }) {
  if (!doc) return <span className="faint">No evidence</span>;
  return (
    <a href={`/api/documents/${doc.id}`} target="_blank" rel="noreferrer">
      <FilePdfOutlined /> {doc.fileName} <span className="faint">v{doc.version}</span>
    </a>
  );
}

export const approvedOf = (corrections: CorrectionRow[], id: number) =>
  corrections.filter((c) => c.annualReturnId === id && c.status === "APPROVED").sort((a, b) => ((a.decidedAt ?? "") < (b.decidedAt ?? "") ? -1 : 1));

/** The corrections on one return: every request, with its changes, reason, evidence and PCP's decision. */
export function CorrectionList({ list }: { list: CorrectionRow[] }) {
  if (!list.length) return <div className="faint" style={{ fontSize: 13 }}>No correction requests.</div>;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {list.map((c) => (
        <div key={c.id} data-testid="correction" style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span className="mono">{c.ref}</span>
            <RegStatus value={c.status} />
          </div>
          <div style={{ fontSize: 13 }}>
            {c.changes.map((ch) => (
              <span key={ch.field} style={{ marginRight: 14, whiteSpace: "nowrap" }}>
                {FIGURE_LABELS[ch.field as FigureKey]}: <span style={{ textDecoration: "line-through", color: "var(--faint)" }}>{ch.from}</span> → <b>{ch.to}</b>
              </span>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>Reason: {c.reason}</div>
          <div style={{ fontSize: 12.5, marginTop: 4 }}>
            <EvidenceLink doc={c.evidence} />
          </div>
          <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
            Requested by {c.requestedBy} on {fmtDate(c.createdAt)}
            {c.decidedAt ? ` · ${c.status.toLowerCase()} by ${c.decidedBy} on ${fmtDate(c.decidedAt)}${c.decisionNote ? `: ${c.decisionNote}` : ""}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

function FigureInputs({ value, onChange, hints }: { value: AnnualFigures; onChange: (v: AnnualFigures) => void; hints?: Partial<Record<FigureKey, number>> }) {
  return (
    <Row gutter={[12, 12]}>
      {FIGURE_KEYS.map((k) => (
        <Col key={k} xs={12} md={6}>
          <label style={{ display: "block", fontSize: 12.5, color: "var(--muted)", marginBottom: 4 }}>
            {FIGURE_LABELS[k]}{" "}
            <Tooltip title={FIGURE_HELP[k]}>
              <InfoCircleOutlined style={{ color: "#8a9892" }} />
            </Tooltip>
          </label>
          <InputNumber aria-label={FIGURE_LABELS[k]} min={0} precision={0} value={value[k]} onChange={(v) => onChange({ ...value, [k]: Number(v ?? 0) })} style={{ width: "100%" }} />
          {hints && hints[k] !== undefined && hints[k] !== value[k] ? <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>Records: {hints[k]}</div> : null}
        </Col>
      ))}
    </Row>
  );
}

function EvidencePicker({ refNo, kind, value, onChange, label }: { refNo: string; kind: "annual-return" | "correction"; value: Doc; onChange: (d: Doc) => void; label: string }) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const send = async (file: File) => {
    setBusy(true);
    try {
      const d = await uploadEvidence(file, refNo, kind);
      onChange({ id: d.id, fileName: d.fileName, version: d.version });
      message.success(`Uploaded ${d.fileName} (v${d.version})`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: 12, border: "1px dashed var(--line)", borderRadius: 12 }}>
      <PaperClipOutlined style={{ color: "var(--brand)", fontSize: 18 }} />
      <div style={{ flex: 1, minWidth: 200, fontSize: 13 }}>{value ? <EvidenceLink doc={value} /> : <span className="muted">{label}</span>}</div>
      <Upload
        accept=".pdf,.png,.jpg,.jpeg"
        showUploadList={false}
        beforeUpload={(f) => {
          send(f);
          return false;
        }}
      >
        <Button icon={<UploadOutlined />} loading={busy}>
          {value ? "Replace file" : "Upload evidence"}
        </Button>
      </Upload>
      <SamplePdfButton docLabel={kind === "correction" ? "Supplementary result notification" : "Annual result notification"} onFile={send} />
    </div>
  );
}

export default function AnnualReturnsView({
  shortCode,
  canFile,
  programmes,
  years,
  dueDate,
  fromRecords,
  returns,
  corrections,
}: {
  shortCode: string;
  canFile: boolean;
  programmes: string[];
  years: number[];
  dueDate: string;
  fromRecords: Record<string, { figures: Record<string, number>; records: number }>;
  returns: ReturnRow[];
  corrections: CorrectionRow[];
}) {
  const router = useRouter();
  const [programme, setProgramme] = useState(programmes[0] ?? "PHARMD");
  const [year, setYear] = useState(years[0]);
  const [correcting, setCorrecting] = useState(false);
  const current = returns.find((r) => r.programType === programme && r.year === year) ?? null;
  const thisYear = years[0];
  const dueNow = programmes.filter((p) => !returns.some((r) => r.programType === p && r.year === thisYear && ["SUBMITTED", "ACCEPTED"].includes(r.status)));
  const records = fromRecords[`${programme}:${year}`];
  const refNo = `AR-${year}-${shortCode}-${programme}`;
  const list = corrections.filter((c) => current && c.annualReturnId === current.id);
  const effective = current ? applyCorrections(current.figures, approvedOf(corrections, current.id)) : null;

  const statusOf = (p: string, y: number) => {
    const r = returns.find((x) => x.programType === p && x.year === y);
    if (r) return r.lockedAt ? "ACCEPTED" : r.status;
    return y === thisYear ? "DUE" : "NOT_FILED";
  };

  return (
    <>
      <PageTitle
        eyebrow="Registry"
        title="Annual returns"
        sub="Annual student update: each year, file enrolment, progression, results, graduates and withdrawals with the result evidence. Once PCP accepts a return, that year locks; a later change is a correction request, and the original figures stay visible."
      />
      <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
        <Col xs={12} md={6}>
          <StatCard label={`Due for ${thisYear}`} value={dueNow.length} icon={<ClockCircleOutlined />} tone={dueNow.length ? "warn" : "brand"} hint={dueNow.length ? `By ${fmtDate(dueDate)}: ${dueNow.map(programLabel).join(", ")}` : "All filed"} />
        </Col>
        <Col xs={12} md={6}><StatCard label="With PCP" value={returns.filter((r) => r.status === "SUBMITTED").length} icon={<SendOutlined />} tone="info" /></Col>
        <Col xs={12} md={6}><StatCard label="Accepted and locked" value={returns.filter((r) => r.lockedAt).length} icon={<LockOutlined />} tone="violet" /></Col>
        <Col xs={12} md={6}><StatCard label="Corrections with PCP" value={corrections.filter((c) => c.status === "PENDING").length} icon={<FileSearchOutlined />} tone="gold" /></Col>
      </Row>

      <Card
        title={<span><AuditOutlined style={{ marginRight: 8, color: "var(--brand)" }} />Annual student update</span>}
        style={{ marginBottom: 18 }}
        extra={
          <Space wrap>
            <Select aria-label="Programme" value={programme} onChange={setProgramme} style={{ width: 200 }} options={programmes.map((p) => ({ value: p, label: programLabel(p) }))} />
            <Select
              aria-label="Year"
              value={year}
              onChange={setYear}
              style={{ width: 170 }}
              options={years.map((y) => ({ value: y, label: `${y} · ${statusOf(programme, y) === "DUE" ? "due" : statusOf(programme, y) === "NOT_FILED" ? "not filed" : statusOf(programme, y).toLowerCase()}` }))}
            />
          </Space>
        }
      >
        {!programmes.length ? (
          <Empty description="Your institution has no programme with an approved NOC yet, so there is no annual return to file." />
        ) : (
          <>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
              <span style={{ fontWeight: 650, fontSize: 16 }}>
                {programLabel(programme)} {year}
              </span>
              <span className="mono">{current?.ref ?? refNo}</span>
              <RegStatus value={statusOf(programme, year)} label={statusOf(programme, year) === "DUE" ? `Due ${fmtDate(dueDate)}` : statusOf(programme, year) === "ACCEPTED" ? "Accepted · locked" : undefined} />
              {current?.submittedAt ? <span className="faint" style={{ fontSize: 12.5 }}>Submitted by {current.submittedBy} on {fmtDate(current.submittedAt)}</span> : null}
            </div>

            {current?.lockedAt ? (
              <>
                <Alert
                  type="info"
                  showIcon
                  icon={<LockOutlined />}
                  style={{ marginBottom: 14 }}
                  title={`PCP accepted this return on ${fmtDate(current.lockedAt)}${current.reviewedBy ? ` (${current.reviewedBy})` : ""}. The year is locked: student records for ${year} cannot change, and corrections go to PCP with a reason and evidence.`}
                />
                <Row gutter={[18, 18]}>
                  <Col xs={24} lg={12}>
                    <FiguresTable
                      compareTo={0}
                      columns={[
                        { title: "Original (accepted)", figures: current.figures },
                        ...(list.some((c) => c.status === "APPROVED") ? [{ title: "Corrected", figures: effective }] : []),
                      ]}
                    />
                    <div style={{ marginTop: 10, fontSize: 13 }}>
                      Evidence: <EvidenceLink doc={current.evidence} />
                    </div>
                  </Col>
                  <Col xs={24} lg={12}>
                    <SectionLabel
                      extra={
                        canFile ? (
                          <Button size="small" type="primary" disabled={list.some((c) => c.status === "PENDING")} onClick={() => setCorrecting(true)}>
                            Request a correction
                          </Button>
                        ) : null
                      }
                    >
                      Correction requests
                    </SectionLabel>
                    <CorrectionList list={list} />
                  </Col>
                </Row>
              </>
            ) : current?.status === "SUBMITTED" ? (
              <>
                <Alert type="info" showIcon style={{ marginBottom: 14 }} title="With PCP for review. You can change it only if PCP returns it." />
                <Row gutter={[18, 18]}>
                  <Col xs={24} lg={12}>
                    <FiguresTable columns={[{ title: "Submitted", figures: current.figures }]} />
                  </Col>
                  <Col xs={24} lg={12}>
                    <div style={{ fontSize: 13 }}>
                      Evidence: <EvidenceLink doc={current.evidence} />
                    </div>
                    {current.note ? <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>Note: {current.note}</div> : null}
                  </Col>
                </Row>
              </>
            ) : canFile ? (
              <FilingForm key={`${programme}:${year}:${current?.status ?? "new"}`} refNo={refNo} programme={programme} year={year} existing={current} records={records} onDone={() => router.refresh()} />
            ) : (
              <Alert type="info" showIcon title="The examination officer or the Head of institution files this return." />
            )}
          </>
        )}
      </Card>

      <Card title="All annual returns" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          dataSource={returns}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          locale={{ emptyText: "No annual return filed yet" }}
          onRow={(r) => ({
            onClick: () => {
              setProgramme(r.programType);
              setYear(r.year);
              window.scrollTo({ top: 0, behavior: "smooth" });
            },
            style: { cursor: "pointer" },
          })}
          columns={[
            { title: "Ref", dataIndex: "ref", render: (v) => <span className="mono">{v}</span> },
            { title: "Programme", dataIndex: "programType", render: programLabel },
            { title: "Year", dataIndex: "year" },
            { title: "Status", render: (_, r) => <RegStatus value={r.lockedAt ? "ACCEPTED" : r.status} label={r.lockedAt ? "Accepted · locked" : undefined} /> },
            { title: "Submitted", render: (_, r) => (r.submittedAt ? <span style={{ fontSize: 12.5 }}>{r.submittedBy}<div className="faint">{fmtDate(r.submittedAt)}</div></span> : "—") },
            { title: "PCP review", render: (_, r) => (r.reviewedAt ? <span style={{ fontSize: 12.5 }}>{r.reviewedBy}<div className="faint">{fmtDate(r.reviewedAt)}</div></span> : "—") },
            {
              title: "Corrections",
              render: (_, r) => {
                const cs = corrections.filter((c) => c.annualReturnId === r.id);
                if (!cs.length) return <span className="faint">—</span>;
                return (
                  <span style={{ fontSize: 12.5 }}>
                    {cs.filter((c) => c.status === "APPROVED").length} approved
                    {cs.some((c) => c.status === "PENDING") ? <div style={{ color: "#a15c00" }}>1 with PCP</div> : null}
                  </span>
                );
              },
            },
          ]}
        />
      </Card>

      {current && effective ? (
        <CorrectionDrawer open={correcting} onClose={() => setCorrecting(false)} r={current} current={effective} onDone={() => router.refresh()} />
      ) : null}
    </>
  );
}

function FilingForm({ refNo, programme, year, existing, records, onDone }: { refNo: string; programme: string; year: number; existing: ReturnRow | null; records?: { figures: Record<string, number>; records: number }; onDone: () => void }) {
  const { message } = App.useApp();
  const fromRecords = (records?.figures ?? emptyFigures()) as AnnualFigures;
  const [figures, setFigures] = useState<AnnualFigures>(existing?.figures ?? fromRecords);
  const [note, setNote] = useState(existing?.note ?? "");
  const [evidence, setEvidence] = useState<Doc>(existing?.evidence ?? null);
  const [busy, start] = useTransition();
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const problems = useMemo(() => figureProblems(figures), [figures]);

  const save = (submit: boolean) =>
    start(async () => {
      const r = await saveAnnualReturn({ programType: programme, year, figures, note, evidenceDocumentId: evidence?.id ?? null, submit });
      setOutcome(r);
      message[r.ok ? "success" : "error"](r.message);
      if (r.ok) onDone();
    });

  return (
    <div data-testid="annual-return-form">
      {existing?.status === "RETURNED" ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 14 }}
          title={`PCP returned this return on ${fmtDate(existing.reviewedAt)}: ${existing.reviewNote ?? "see the note"}`}
          description="Correct the figures or the evidence, then submit again."
        />
      ) : null}
      {outcome ? <Alert type={outcome.ok ? "success" : "error"} showIcon style={{ marginBottom: 14 }} title={outcome.message} /> : null}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <span className="muted" style={{ fontSize: 13 }}>
          {existing?.figures ? "Figures from your saved draft." : `Prefilled from ${records?.records ?? 0} student records on roll in ${year}. Check them against the result notification before you submit.`}
        </span>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => setFigures(fromRecords)}>
          Use the figures from student records
        </Button>
      </div>
      <FigureInputs value={figures} onChange={setFigures} hints={fromRecords} />
      {problems.length ? (
        <Alert type="warning" showIcon style={{ marginTop: 14 }} title="The figures do not add up" description={<ul style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>} />
      ) : null}
      <SectionLabel>Result evidence</SectionLabel>
      <EvidencePicker refNo={refNo} kind="annual-return" value={evidence} onChange={setEvidence} label="Upload the result gazette or notification signed by the Controller of Examinations (PDF or image, up to 10 MB)." />
      <SectionLabel>Note to PCP (optional)</SectionLabel>
      <Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything PCP should know about these figures" />
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
        <Button type="primary" icon={<SendOutlined />} loading={busy} disabled={!!problems.length || !evidence} onClick={() => save(true)}>
          Submit to PCP
        </Button>
        <Button loading={busy} onClick={() => save(false)}>
          Save draft
        </Button>
        {!evidence ? <span className="faint" style={{ fontSize: 12.5 }}>Upload the result evidence to submit.</span> : null}
      </div>
    </div>
  );
}

function CorrectionDrawer({ open, onClose, r, current, onDone }: { open: boolean; onClose: () => void; r: ReturnRow; current: AnnualFigures; onDone: () => void }) {
  const { message } = App.useApp();
  const [figures, setFigures] = useState<AnnualFigures>(current);
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState<Doc>(null);
  const [busy, start] = useTransition();
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const changes = FIGURE_KEYS.filter((k) => figures[k] !== current[k]);
  const problems = figureProblems(figures);

  const send = () =>
    start(async () => {
      const res = await requestCorrection({ annualReturnId: r.id, figures, reason, evidenceDocumentId: evidence?.id ?? null });
      setOutcome(res);
      message[res.ok ? "success" : "error"](res.message);
      if (res.ok) {
        onDone();
        onClose();
        setReason("");
        setEvidence(null);
      }
    });

  return (
    <Drawer open={open} onClose={onClose} size="large" title={`Request a correction to ${r.ref}`} destroyOnHidden>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14 }}
        title="The accepted figures stay as they are until PCP approves the correction. PCP sees the original and corrected figures side by side, and so do you."
      />
      {outcome && !outcome.ok ? <Alert type="error" showIcon style={{ marginBottom: 14 }} title={outcome.message} /> : null}
      <SectionLabel>Corrected figures</SectionLabel>
      <FigureInputs value={figures} onChange={setFigures} hints={current} />
      <div style={{ marginTop: 12, fontSize: 13 }}>
        {changes.length ? (
          <span>
            Changing:{" "}
            {changes.map((k) => (
              <span key={k} style={{ marginRight: 12, whiteSpace: "nowrap" }}>
                {FIGURE_LABELS[k]} {current[k]} → <b>{figures[k]}</b>
              </span>
            ))}
          </span>
        ) : (
          <span className="faint">Edit the figures that need correcting.</span>
        )}
      </div>
      {problems.length ? <Alert type="warning" showIcon style={{ marginTop: 12 }} title="The figures do not add up" description={<ul style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>} /> : null}
      <SectionLabel>Reason</SectionLabel>
      <Input.TextArea aria-label="Reason for the correction" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Two students passed the supplementary examination; the original return counted them as failed" />
      <SectionLabel>Evidence</SectionLabel>
      <EvidencePicker refNo={r.ref} kind="correction" value={evidence} onChange={setEvidence} label="Upload the evidence for the correction (PDF or image, up to 10 MB)." />
      <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Button type="primary" loading={busy} disabled={!changes.length || reason.trim().length < 10 || !evidence || !!problems.length} onClick={send}>
          Send correction request to PCP
        </Button>
        <span className="faint" style={{ fontSize: 12.5 }}>Needs at least one changed figure, a reason of 10 characters or more, and evidence.</span>
      </div>
    </Drawer>
  );
}
