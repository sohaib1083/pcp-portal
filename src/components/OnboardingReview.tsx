"use client";
// PCP's verification of a self-registered institution (guide section 3: "Verification" and "Approval").
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Col, Input, Row, Space, Table, Tag, Timeline, Typography } from "antd";
import {
  CheckCircleFilled,
  CheckOutlined,
  ClockCircleOutlined,
  CloseCircleFilled,
  CloseOutlined,
  DownloadOutlined,
  EnvironmentOutlined,
  FilePdfOutlined,
  RollbackOutlined,
  SafetyCertificateFilled,
  StopOutlined,
} from "@ant-design/icons";
import type { ActionResult } from "@/app/actions/faculty";
import { approveOnboarding, rejectOnboarding, returnOnboarding, setOnboardingDocumentStatus, verifyAllOnboardingDocuments } from "@/app/actions/onboarding";
import type { OnboardingCampus, OnboardingProfile, OnboardingProgramme } from "@/db/modules/onboarding";
import { ONBOARDING_STATUS_LABELS, ONBOARDING_STATUS_TONE, PROGRAMME_LABELS, latestDocs, type StepState } from "@/lib/onboarding-steps";
import { Avatar, KV, Pill, StatusDot, fmtDate } from "./common";
import { FillDemo } from "./demo-helpers";
import { MiniKV } from "./OnboardingChecklist";
import { useOtp } from "./OtpConfirm";

type Req = {
  ref: string;
  status: string;
  applicantUsername: string;
  applicantName: string;
  applicantDesignation: string | null;
  email: string;
  mobile: string;
  emailVerifiedAt: string | null;
  mobileVerifiedAt: string | null;
  profile: OnboardingProfile;
  campuses: OnboardingCampus[];
  programmes: OnboardingProgramme[];
  submittedAt: string | null;
  createdAt: string;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  institutionCode: string | null;
};
type Doc = { id: number; docType: string; fileName: string; version: number; verificationStatus: string; sha256: string; sizeBytes: number; uploadedAt: string; uploadedBy: string };
type Ev = { id: number; fromStatus: string | null; toStatus: string; actor: string; note: string | null; createdAt: string };

function ActionBlock({ title, sub, children, extra }: { title: string; sub?: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 600 }}>{title}</div>
          {sub ? <div className="muted" style={{ fontSize: 12.5 }}>{sub}</div> : null}
        </div>
        {extra}
      </div>
      {children}
    </div>
  );
}

const COURT: Record<string, { who: string; what: string; c: string; bg: string; bd: string }> = {
  DRAFT: { who: "Institution", what: "The applicant is still completing the checklist. Nothing to decide yet.", c: "#55625c", bg: "#f2f4f3", bd: "#e1e6e3" },
  SUBMITTED: { who: "PCP registration officer", what: "Open and verify each legal document, then approve, return with a reason, or reject with grounds.", c: "#1d5fb0", bg: "#eaf2fc", bd: "#c8dcf6" },
  RETURNED: { who: "Institution", what: "Returned for changes. The applicant fixes the points and resubmits.", c: "#a15c00", bg: "#fff7e6", bd: "#ffe1a8" },
  REJECTED: { who: "Closed", what: "Rejected. The grounds were emailed to the applicant.", c: "#b4141f", bg: "#fff1f0", bd: "#ffccc7" },
  APPROVED: { who: "Closed", what: "Approved. The Institution ID is issued and the applicant is now the Head of institution.", c: "#0d7a3d", bg: "#e9f7ef", bd: "#c9ecd8" },
};

export default function OnboardingReview({
  req,
  steps,
  docs,
  requiredDocs,
  events,
  shortCodeClash,
}: {
  req: Req;
  steps: StepState[];
  docs: Doc[];
  requiredDocs: string[];
  events: Ev[];
  shortCodeClash: string | null;
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const { withOtp, otpModal } = useOtp();
  const [returnNote, setReturnNote] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const p = req.profile;
  const waiting = req.status === "SUBMITTED";
  const latest = latestDocs(docs);
  const unverified = requiredDocs.filter((r) => latest.get(r)?.verificationStatus !== "VERIFIED");
  const allDone = steps.every((s) => s.done);
  const court = COURT[req.status] ?? COURT.DRAFT;

  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      message[r.ok ? "success" : "error"](r.message, r.ok ? 4 : 8);
      if (r.ok) after?.();
      router.refresh();
    });

  const panels: React.ReactNode[] = [];
  if (waiting) {
    panels.push(
      <ActionBlock
        key="approve"
        title="Approve and issue the Institution ID"
        sub="Creates the institution, its campuses and programmes, and makes the applicant its Head. Needs a one-time code."
      >
        {unverified.length ? (
          <Alert type="warning" showIcon style={{ marginBottom: 10 }} title={`Verify every legal document first (${unverified.length} not verified).`} />
        ) : null}
        {shortCodeClash ? <Alert type="error" showIcon style={{ marginBottom: 10 }} title={`Short code ${p.shortCode} already belongs to ${shortCodeClash}. Return the request and ask for another code.`} /> : null}
        <Button
          type="primary"
          block
          size="large"
          icon={<SafetyCertificateFilled />}
          loading={pending}
          disabled={!allDone || unverified.length > 0 || !!shortCodeClash}
          onClick={() => withOtp(`decision:${req.ref}`, `Approve ${p.name} and issue its Institution ID`, (code) => run(() => approveOnboarding(req.ref, code)))}
        >
          Approve and issue Institution ID
        </Button>
      </ActionBlock>,
      <ActionBlock
        key="return"
        title="Return for changes"
        sub="The applicant sees your reason word for word, fixes the points and resubmits."
        extra={<FillDemo onClick={() => setReturnNote("The building lease is not signed by the owner. Upload the signed lease on stamp paper and resubmit.")} />}
      >
        <Input.TextArea id="return-reason" rows={3} placeholder="Reason for returning (required)" value={returnNote} onChange={(e) => setReturnNote(e.target.value)} style={{ marginBottom: 10 }} />
        <Button block icon={<RollbackOutlined />} loading={pending} disabled={returnNote.trim().length < 10} onClick={() => run(() => returnOnboarding(req.ref, returnNote), () => setReturnNote(""))}>
          Return to applicant
        </Button>
      </ActionBlock>,
      <ActionBlock
        key="reject"
        title="Reject"
        sub="Closes the request. The grounds go into the decision email. Needs a one-time code."
        extra={<FillDemo onClick={() => setRejectNote("The institution has no valid affiliation with a degree-awarding university, which is required for a pharmacy programme.")} />}
      >
        <Input.TextArea id="reject-grounds" rows={3} placeholder="Grounds for rejection (required)" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} style={{ marginBottom: 10 }} />
        <Button
          block
          danger
          icon={<StopOutlined />}
          loading={pending}
          disabled={rejectNote.trim().length < 10}
          onClick={() => withOtp(`decision:${req.ref}`, `Reject the registration of ${p.name ?? req.ref}`, (code) => run(() => rejectOnboarding(req.ref, rejectNote, code), () => setRejectNote("")))}
        >
          Reject registration
        </Button>
      </ActionBlock>,
    );
  }

  return (
    <>
      {otpModal}
      <Card style={{ marginBottom: 18 }} styles={{ body: { padding: "20px 22px" } }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div className="pcp-eyebrow">
              <Link href="/pcp/onboarding">Institution onboarding</Link> · registration
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h1 className="pcp-page-title mono" style={{ fontSize: 24, letterSpacing: "-0.01em" }}>
                {req.ref}
              </h1>
              <StatusDot tone={ONBOARDING_STATUS_TONE[req.status] ?? "neutral"}>{ONBOARDING_STATUS_LABELS[req.status] ?? req.status}</StatusDot>
            </div>
            <div className="muted" style={{ marginTop: 6, fontSize: 13.5 }}>
              {p.name ?? "Profile not filled in yet"}
              {p.city ? ` · ${p.city}, ${p.province}` : ""}
              {p.sector ? ` · ${p.sector} sector` : ""}
              {req.submittedAt ? ` · submitted ${fmtDate(req.submittedAt, true)}` : ""}
            </div>
          </div>
          {req.institutionCode ? (
            <div style={{ padding: "8px 14px", border: "1px solid #c9ecd8", background: "var(--good-50)", borderRadius: 12, alignSelf: "flex-start" }}>
              <div className="faint" style={{ fontSize: 11.5 }}>Institution ID</div>
              <b className="mono" style={{ fontSize: 16 }}>{req.institutionCode}</b>
            </div>
          ) : null}
        </div>
        <div className="pcp-court" style={{ marginTop: 16, background: court.bg, borderColor: court.bd }}>
          <span style={{ width: 36, height: 36, borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center", color: court.c, flex: "none" }}>
            {req.status === "APPROVED" ? <SafetyCertificateFilled /> : req.status === "REJECTED" ? <StopOutlined /> : <ClockCircleOutlined />}
          </span>
          <div>
            <div className="pcp-court-title">With: {court.who}</div>
            <div className="pcp-court-sub">{court.what}</div>
          </div>
        </div>
        {req.reviewNote && (req.status === "RETURNED" || req.status === "REJECTED") ? (
          <Alert
            type={req.status === "REJECTED" ? "error" : "warning"}
            showIcon
            style={{ marginTop: 12 }}
            title={`${req.status === "REJECTED" ? "Grounds for rejection" : "Reason for return"} · ${req.reviewedBy ?? ""} · ${fmtDate(req.reviewedAt, true)}`}
            description={<span style={{ whiteSpace: "pre-wrap" }}>{req.reviewNote}</span>}
          />
        ) : null}
      </Card>

      <Row gutter={18}>
        <Col xs={24} lg={15}>
          <Card size="small" title="Profile and affiliation" style={{ marginBottom: 16 }}>
            <KV
              rows={[
                ["Institution name", p.name],
                ["Short code", p.shortCode ? <span key="s" className="mono" style={{ fontSize: 13 }}>{p.shortCode}</span> : null],
                ["Sector", p.sector],
                ["Province and city", p.city ? `${p.city}, ${p.province}` : null],
                ["Address", p.address],
                ["Phone", p.phone],
                ["Website", p.website],
                ["Year established", p.establishedYear],
                ["Affiliation", p.affiliationType === "University" ? "Degree-awarding university" : p.affiliationType ? `${p.affiliationType} of ${p.affiliatedUniversity ?? "—"}` : null],
              ]}
            />
          </Card>

          <Card size="small" title={`Campuses (${req.campuses.length}) and programmes (${req.programmes.length})`} style={{ marginBottom: 16 }} styles={{ body: { padding: 0 } }}>
            <Table
              size="small"
              rowKey="name"
              pagination={false}
              dataSource={req.campuses}
              locale={{ emptyText: "No campus yet" }}
              columns={[
                {
                  title: "Campus",
                  dataIndex: "name",
                  render: (v, r) => (
                    <span>
                      <EnvironmentOutlined style={{ color: "var(--brand)", marginRight: 6 }} />
                      <b style={{ fontWeight: 500 }}>{v}</b> {r.isMain ? <Tag color="green">Main</Tag> : <Tag>Child campus</Tag>}
                      <div className="faint" style={{ fontSize: 12 }}>
                        {r.address ? `${r.address} · ` : ""}
                        {r.city}, {r.province}
                      </div>
                    </span>
                  ),
                },
                {
                  title: "Programmes (planned intake)",
                  render: (_, r) => {
                    const list = req.programmes.filter((x) => x.campus === r.name);
                    return list.length ? (
                      <Space orientation="vertical" size={2}>
                        {list.map((x) => (
                          <span key={x.type}>
                            {PROGRAMME_LABELS[x.type]} · <span className="tnum">{x.plannedIntake ?? "—"}</span> per year{x.startYear ? ` from ${x.startYear}` : ""}
                          </span>
                        ))}
                      </Space>
                    ) : (
                      <span className="faint">None</span>
                    );
                  },
                },
              ]}
            />
          </Card>

          <Card
            size="small"
            title="Legal documents"
            extra={
              waiting && unverified.some((r) => latest.get(r)?.verificationStatus === "PENDING") ? (
                <Button size="small" icon={<CheckOutlined />} loading={pending} onClick={() => run(() => verifyAllOnboardingDocuments(req.ref))}>
                  Verify all pending
                </Button>
              ) : (
                <span className="muted" style={{ fontSize: 12.5 }}>
                  {requiredDocs.length - unverified.length} of {requiredDocs.length} verified
                </span>
              )
            }
            style={{ marginBottom: 16 }}
            styles={{ body: { padding: 0 } }}
          >
            {requiredDocs.map((r, i) => {
              const d = latest.get(r);
              const versions = docs.filter((x) => x.docType === r).length;
              return (
                <div key={r} data-doc={r} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderTop: i ? "1px solid var(--line-2)" : undefined, flexWrap: "wrap" }}>
                  {d?.verificationStatus === "VERIFIED" ? (
                    <CheckCircleFilled style={{ color: "var(--good)", fontSize: 16 }} />
                  ) : d?.verificationStatus === "REJECTED" || !d ? (
                    <CloseCircleFilled style={{ color: d ? "var(--bad)" : "#c9d1cd", fontSize: 16 }} />
                  ) : (
                    <ClockCircleOutlined style={{ color: "var(--warn)", fontSize: 16 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontWeight: 500 }}>{r}</div>
                    {d ? (
                      <>
                        <a href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <FilePdfOutlined style={{ color: "#b4141f" }} /> {d.fileName} <DownloadOutlined />
                        </a>
                        <div className="faint" style={{ fontSize: 11.5 }}>
                          v{d.version}
                          {versions > 1 ? ` of ${versions}` : ""} · {Math.max(1, Math.round(d.sizeBytes / 1024))} KB · {fmtDate(d.uploadedAt)} · <span className="mono" style={{ fontSize: 11 }}>SHA-256 {d.sha256.slice(0, 12)}…</span>
                        </div>
                      </>
                    ) : (
                      <span style={{ fontSize: 12.5, color: "var(--bad)" }}>Missing</span>
                    )}
                  </div>
                  {d ? <Pill value={d.verificationStatus} label={d.verificationStatus === "PENDING" ? "Not checked" : d.verificationStatus === "VERIFIED" ? "Verified" : "Not acceptable"} /> : null}
                  {waiting && d ? (
                    <Space size={4}>
                      {d.verificationStatus !== "VERIFIED" ? (
                        <Button size="small" type="primary" ghost icon={<CheckOutlined />} loading={pending} onClick={() => run(() => setOnboardingDocumentStatus(d.id, "VERIFIED"))}>
                          Verify
                        </Button>
                      ) : null}
                      {d.verificationStatus !== "REJECTED" ? (
                        <Button size="small" danger icon={<CloseOutlined />} loading={pending} onClick={() => run(() => setOnboardingDocumentStatus(d.id, "REJECTED"))}>
                          Not acceptable
                        </Button>
                      ) : null}
                    </Space>
                  ) : null}
                </div>
              );
            })}
          </Card>
        </Col>

        <Col xs={24} lg={9}>
          <Card
            size="small"
            title="Your next step"
            style={{ marginBottom: 16, borderColor: panels.length ? "#95d5b2" : undefined, boxShadow: panels.length ? "0 0 0 3px #e8f3ee" : undefined }}
            styles={{ body: { background: panels.length ? "#fbfdfc" : undefined } }}
          >
            {panels.length ? (
              <Space orientation="vertical" style={{ width: "100%" }} size={12}>
                {panels}
              </Space>
            ) : (
              <Typography.Text type="secondary">
                {req.status === "APPROVED" ? (
                  <>
                    Approved. See the institution under <Link href="/pcp/institutions">Institutions</Link>.
                  </>
                ) : (
                  "Nothing to decide at this stage. The banner above shows who holds the request."
                )}
              </Typography.Text>
            )}
          </Card>

          <Card size="small" title="Checklist" style={{ marginBottom: 16 }}>
            {steps.map((s) => (
              <div key={s.key} style={{ display: "flex", gap: 10, padding: "6px 0", alignItems: "flex-start" }}>
                {s.done ? <CheckCircleFilled style={{ color: "var(--good)", marginTop: 3 }} /> : <CloseCircleFilled style={{ color: "#d9a1a1", marginTop: 3 }} />}
                <div>
                  <div style={{ fontWeight: 500 }}>{s.title}</div>
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    {s.done ? s.summary : `Missing: ${s.missing.join(", ")}`}
                  </div>
                </div>
              </div>
            ))}
          </Card>

          <Card size="small" title="Applicant" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
              <Avatar name={req.applicantName} size={36} />
              <div>
                <div style={{ fontWeight: 600 }}>{req.applicantName}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {req.applicantDesignation} · <span className="mono">{req.applicantUsername}</span>
                </div>
              </div>
            </div>
            <MiniKV
              rows={[
                ["Email", <span key="e">{req.email} {req.emailVerifiedAt ? <Pill value="VERIFIED" label="Verified" /> : <Pill value="PENDING" label="Not verified" />}</span>],
                ["Mobile", <span key="m">{req.mobile} {req.mobileVerifiedAt ? <Pill value="VERIFIED" label="Verified" /> : <Pill value="PENDING" label="Not verified" />}</span>],
                ["Registered", fmtDate(req.createdAt, true)],
              ]}
            />
          </Card>

          <Card size="small" title="History">
            <Timeline
              style={{ marginTop: 8 }}
              items={[...events].reverse().map((e) => ({
                color: e.toStatus === "APPROVED" ? "green" : e.toStatus === "REJECTED" ? "red" : e.toStatus === "RETURNED" ? "orange" : "blue",
                content: (
                  <div style={{ fontSize: 13 }}>
                    <b>{ONBOARDING_STATUS_LABELS[e.toStatus] ?? e.toStatus}</b> · {e.actor}
                    <div className="faint" style={{ fontSize: 12 }}>
                      {fmtDate(e.createdAt, true)}
                    </div>
                    {e.note ? <div className="muted" style={{ whiteSpace: "pre-wrap", marginTop: 2 }}>{e.note}</div> : null}
                  </div>
                ),
              }))}
            />
          </Card>
        </Col>
      </Row>
    </>
  );
}
