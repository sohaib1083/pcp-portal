"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Badge, Button, Card, Col, Empty, Input, Modal, Row, Table, Tabs } from "antd";
import { CheckCircleOutlined, CheckOutlined, ClockCircleOutlined, CloseOutlined, FileSearchOutlined, LockOutlined, RollbackOutlined, WarningOutlined } from "@ant-design/icons";
import { decideCorrection, reviewAnnualReturn } from "@/app/actions/students";
import { applyCorrections, figureProblems } from "@/lib/registry-shared";
import { CorrectionList, EvidenceLink, approvedOf, type CorrectionRow, type ReturnRow } from "./AnnualReturnsView";
import { PageTitle, StatCard, fmtDate, programLabel, timeAgo } from "./common";
import { useOtp } from "./OtpConfirm";
import { FiguresTable, RegStatus } from "./registry-ui";

type PcpReturn = ReturnRow & { institutionId: number; inst: string; instCode: string };
type Decision = { kind: "return"; r: PcpReturn; accept: boolean } | { kind: "correction"; c: CorrectionRow; approve: boolean };

export default function PcpAnnualReturnsView({ returns, corrections, canReview, tab, year, notFiled }: { returns: PcpReturn[]; corrections: CorrectionRow[]; canReview: boolean; tab: string | null; year: number; notFiled: string[] }) {
  const { message } = App.useApp();
  const router = useRouter();
  const { withOtp, otpModal } = useOtp();
  const [active, setActive] = useState(tab && ["review", "corrections", "all"].includes(tab) ? tab : "review");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState("");

  const submitted = returns.filter((r) => r.status === "SUBMITTED");
  const pendingCorrections = corrections.filter((c) => c.status === "PENDING");
  const returnOf = (id: number) => returns.find((r) => r.id === id);
  const previous = (r: PcpReturn) => {
    const p = returns.find((x) => x.institutionId === r.institutionId && x.programType === r.programType && x.year === r.year - 1 && x.lockedAt);
    return p ? { r: p, figures: applyCorrections(p.figures, approvedOf(corrections, p.id)) } : null;
  };

  const open = (d: Decision) => {
    setNote("");
    setDecision(d);
  };
  const confirm = () => {
    if (!decision) return;
    const positive = decision.kind === "return" ? decision.accept : decision.approve;
    if (!positive && note.trim().length < 5) return message.error("Give the reason, so the institution knows what to fix.");
    const ref = decision.kind === "return" ? decision.r.ref : decision.c.ref;
    const d = decision;
    setDecision(null);
    withOtp(`decision:${ref}`, `${d.kind === "return" ? (d.accept ? "Accept" : "Return") : d.approve ? "Approve" : "Reject"} ${ref}`, async (code) => {
      const res = d.kind === "return" ? await reviewAnnualReturn(d.r.id, d.accept, note, code) : await decideCorrection(d.c.id, d.approve, note, code);
      message[res.ok ? "success" : "error"](res.message);
      router.refresh();
    });
  };

  const label = (text: string, n: number) => (
    <span>
      {text} {n ? <Badge count={n} size="small" style={{ marginLeft: 4, background: "#d48806" }} /> : null}
    </span>
  );

  return (
    <>
      {otpModal}
      <PageTitle
        eyebrow="Casework"
        title="Annual returns"
        sub="Annual student updates filed by institutions. Accepting a return locks that year; a later change arrives as a correction request with reason and evidence, and the original figures stay visible."
      />
      {!canReview ? <Alert type="info" showIcon style={{ marginBottom: 16 }} title="View only: decisions belong to the verification officer." /> : null}
      <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
        <Col xs={12} md={6}><StatCard label="Awaiting review" value={submitted.length} icon={<ClockCircleOutlined />} tone="info" /></Col>
        <Col xs={12} md={6}><StatCard label="Correction requests" value={pendingCorrections.length} icon={<FileSearchOutlined />} tone="gold" /></Col>
        <Col xs={12} md={6}><StatCard label="Accepted and locked" value={returns.filter((r) => r.lockedAt).length} icon={<LockOutlined />} tone="violet" /></Col>
        <Col xs={12} md={6}>
          <StatCard label={`Not yet filed for ${year}`} value={notFiled.length} icon={<WarningOutlined />} tone={notFiled.length ? "warn" : "brand"} help={notFiled.join(", ")} hint={`Due 31 Oct ${year}`} />
        </Col>
      </Row>
      <Tabs
        activeKey={active}
        onChange={setActive}
        items={[
          {
            key: "review",
            label: label("Awaiting review", submitted.length),
            children: submitted.length ? (
              submitted.map((r) => {
                const prev = previous(r);
                const problems = r.figures ? figureProblems(r.figures) : ["No figures"];
                return (
                  <Card
                    key={r.id}
                    data-testid={`return-${r.ref}`}
                    style={{ marginBottom: 14 }}
                    title={
                      <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <span className="mono" style={{ fontSize: 13 }}>{r.ref}</span>
                        <span>{r.inst}</span>
                        <span className="muted" style={{ fontWeight: 400 }}>· {programLabel(r.programType)} {r.year}</span>
                      </span>
                    }
                    extra={<span className="muted" style={{ fontSize: 12.5 }}>{r.submittedBy} · {timeAgo(r.submittedAt)}</span>}
                  >
                    <Row gutter={[18, 18]}>
                      <Col xs={24} lg={13}>
                        <FiguresTable
                          columns={[{ title: `${r.year} (filed)`, figures: r.figures }, ...(prev ? [{ title: `${r.year - 1} (accepted)`, figures: prev.figures }] : [])]}
                        />
                      </Col>
                      <Col xs={24} lg={11}>
                        <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
                          <div>
                            <div className="faint" style={{ fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Evidence</div>
                            <EvidenceLink doc={r.evidence} />
                          </div>
                          <div>
                            <div className="faint" style={{ fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Checks</div>
                            {problems.length ? (
                              <span style={{ color: "#b4141f" }}>{problems.join(" ")}</span>
                            ) : (
                              <span style={{ color: "#0d7a3d" }}>
                                <CheckCircleOutlined /> The figures add up (passed and failed within enrolled; promoted and graduated within passed).
                              </span>
                            )}
                          </div>
                          {r.note ? <div className="muted">Institution&apos;s note: {r.note}</div> : null}
                          {r.reviewNote ? <div className="muted">Earlier return note: {r.reviewNote}</div> : null}
                        </div>
                        {canReview ? (
                          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                            <Button type="primary" icon={<LockOutlined />} onClick={() => open({ kind: "return", r, accept: true })}>
                              Accept and lock {r.year}
                            </Button>
                            <Button danger icon={<RollbackOutlined />} onClick={() => open({ kind: "return", r, accept: false })}>
                              Return with reason
                            </Button>
                          </div>
                        ) : null}
                      </Col>
                    </Row>
                  </Card>
                );
              })
            ) : (
              <Card><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No annual return is waiting for review" /></Card>
            ),
          },
          {
            key: "corrections",
            label: label("Correction requests", pendingCorrections.length),
            children: pendingCorrections.length ? (
              pendingCorrections.map((c) => {
                const r = returnOf(c.annualReturnId) as PcpReturn | undefined;
                if (!r) return null;
                const now = applyCorrections(r.figures, approvedOf(corrections, r.id));
                const requested = now ? { ...now, ...Object.fromEntries(c.changes.map((ch) => [ch.field, ch.to])) } : null;
                return (
                  <Card
                    key={c.id}
                    data-testid={`correction-${c.ref}`}
                    style={{ marginBottom: 14 }}
                    title={
                      <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <span className="mono" style={{ fontSize: 13 }}>{c.ref}</span>
                        <span>Correction to {r.ref}</span>
                        <span className="muted" style={{ fontWeight: 400 }}>· {r.inst}</span>
                      </span>
                    }
                    extra={<span className="muted" style={{ fontSize: 12.5 }}>{c.requestedBy} · {timeAgo(c.createdAt)}</span>}
                  >
                    <Row gutter={[18, 18]}>
                      <Col xs={24} lg={13}>
                        <FiguresTable
                          compareTo={1}
                          columns={[
                            { title: "Original (accepted)", figures: r.figures },
                            { title: "Current", figures: now },
                            { title: "Requested", figures: requested },
                          ]}
                        />
                      </Col>
                      <Col xs={24} lg={11}>
                        <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
                          <div>
                            <div className="faint" style={{ fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Reason</div>
                            {c.reason}
                          </div>
                          <div>
                            <div className="faint" style={{ fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Evidence</div>
                            <EvidenceLink doc={c.evidence} />
                          </div>
                          <div className="muted">Locked since {fmtDate(r.lockedAt)}. Approving shows the corrected figures next to the original; nothing is overwritten.</div>
                        </div>
                        {canReview ? (
                          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                            <Button type="primary" icon={<CheckOutlined />} onClick={() => open({ kind: "correction", c, approve: true })}>
                              Approve correction
                            </Button>
                            <Button danger icon={<CloseOutlined />} onClick={() => open({ kind: "correction", c, approve: false })}>
                              Reject, keep accepted figures
                            </Button>
                          </div>
                        ) : null}
                      </Col>
                    </Row>
                  </Card>
                );
              })
            ) : (
              <Card><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No correction request is waiting" /></Card>
            ),
          },
          {
            key: "all",
            label: "All returns",
            children: (
              <Card styles={{ body: { padding: 0 } }}>
                <Table
                  rowKey="id"
                  dataSource={returns}
                  pagination={{ pageSize: 12, hideOnSinglePage: true }}
                  expandable={{
                    expandedRowRender: (r) => {
                      const approved = approvedOf(corrections, r.id);
                      return (
                        <Row gutter={[18, 18]} style={{ padding: "4px 8px" }}>
                          <Col xs={24} lg={12}>
                            <FiguresTable compareTo={0} columns={[{ title: "Original", figures: r.figures }, ...(approved.length ? [{ title: "Corrected", figures: applyCorrections(r.figures, approved) }] : [])]} />
                          </Col>
                          <Col xs={24} lg={12}>
                            <CorrectionList list={corrections.filter((c) => c.annualReturnId === r.id)} />
                            <div style={{ marginTop: 8, fontSize: 13 }}>
                              Evidence: <EvidenceLink doc={r.evidence} />
                            </div>
                            {r.reviewNote ? <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>PCP note: {r.reviewNote}</div> : null}
                          </Col>
                        </Row>
                      );
                    },
                  }}
                  columns={[
                    { title: "Ref", dataIndex: "ref", render: (v) => <span className="mono">{v}</span> },
                    { title: "Institution", dataIndex: "inst", render: (v, r) => <span>{v}<div className="faint" style={{ fontSize: 12 }}>{r.instCode}</div></span> },
                    { title: "Programme", dataIndex: "programType", render: programLabel },
                    { title: "Year", dataIndex: "year", filters: [...new Set(returns.map((r) => r.year))].map((y) => ({ text: String(y), value: y })), onFilter: (v, r) => r.year === v },
                    { title: "Enrolled", render: (_, r) => <span className="tnum">{applyCorrections(r.figures, approvedOf(corrections, r.id))?.enrolled ?? "—"}</span> },
                    { title: "Graduated", render: (_, r) => <span className="tnum">{applyCorrections(r.figures, approvedOf(corrections, r.id))?.graduated ?? "—"}</span> },
                    { title: "Status", render: (_, r) => <RegStatus value={r.lockedAt ? "ACCEPTED" : r.status} label={r.lockedAt ? "Accepted · locked" : undefined} /> },
                    { title: "Corrections", render: (_, r) => { const n = corrections.filter((c) => c.annualReturnId === r.id); return n.length ? `${n.filter((c) => c.status === "APPROVED").length} approved${n.some((c) => c.status === "PENDING") ? ", 1 pending" : ""}` : "—"; } },
                  ]}
                />
              </Card>
            ),
          },
        ]}
      />
      <Modal
        open={!!decision}
        title={
          decision
            ? decision.kind === "return"
              ? `${decision.accept ? "Accept and lock" : "Return"} ${decision.r.ref}`
              : `${decision.approve ? "Approve" : "Reject"} ${decision.c.ref}`
            : ""
        }
        okText="Continue"
        okButtonProps={{ danger: decision ? !(decision.kind === "return" ? decision.accept : decision.approve) : false }}
        onCancel={() => setDecision(null)}
        onOk={confirm}
        destroyOnHidden
      >
        <p style={{ marginTop: 0 }}>
          {decision?.kind === "return"
            ? decision.accept
              ? `The ${decision.r.year} figures are accepted and the year locks. Any later change needs a correction request.`
              : "The institution can correct the return and submit it again. Tell them exactly what to fix."
            : decision?.approve
              ? "The corrected figures show next to the original ones. The original stays on record."
              : "The accepted figures stand. The institution sees your reason."}
        </p>
        <Input.TextArea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label="Decision note"
          placeholder={(decision?.kind === "return" ? decision.accept : decision?.approve) ? "Note (optional), e.g. Figures match the result notification" : "Reason (required)"}
        />
      </Modal>
    </>
  );
}
