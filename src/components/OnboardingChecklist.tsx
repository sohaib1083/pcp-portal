"use client";
// The applicant's onboarding checklist (guide section 3): a checklist, not a long form.
// Each step opens its own panel; drafts are saved as the applicant goes, and submit stays blocked until every step is done.
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Col, Drawer, Empty, Form, Input, InputNumber, Modal, Popconfirm, Progress, Row, Select, Space, Table, Tag, Timeline, Typography, Upload } from "antd";
import {
  CheckCircleFilled,
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  EnvironmentOutlined,
  FilePdfOutlined,
  LogoutOutlined,
  PlusOutlined,
  SafetyCertificateFilled,
  SendOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { logoutAction } from "@/app/actions/auth";
import type { ActionResult } from "@/app/actions/faculty";
import { removeCampus, removeProgramme, resendMyCodes, saveCampus, saveProfile, saveProgramme, submitOnboarding } from "@/app/actions/onboarding";
import type { OnboardingCampus, OnboardingProfile, OnboardingProgramme } from "@/db/modules/onboarding";
import { AFFILIATION_TYPES, ONBOARDING_STATUS_LABELS, ONBOARDING_STATUS_TONE, PROGRAMME_LABELS, latestDocs, type StepKey, type StepState } from "@/lib/onboarding-steps";
import { KV, PageTitle, Pill, StatusDot, fmtDate } from "./common";
import { DEMO, FillDemo } from "./demo-helpers";

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
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  institutionCode: string | null;
};
type Doc = { id: number; docType: string; fileName: string; version: number; verificationStatus: string; sha256: string; uploadedAt: string; uploadedBy: string };
type Ev = { id: number; fromStatus: string | null; toStatus: string; actor: string; note: string | null; createdAt: string };

const STEP_ACTION: Record<StepKey, [string, string]> = {
  account: ["Verify now", "View account"],
  profile: ["Fill in profile", "Edit profile"],
  campus: ["Add campus and programmes", "Edit campuses"],
  documents: ["Upload documents", "Edit documents"],
};

/** Label and value pairs for a narrow side card. */
export function MiniKV({ rows }: { rows: [React.ReactNode, React.ReactNode][] }) {
  return (
    <dl className="pcp-kv" style={{ margin: 0, gridTemplateColumns: "92px minmax(0, 1fr)", fontSize: 13 }}>
      {rows.map(([k, v], i) => (
        <div key={i} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd style={{ overflowWrap: "anywhere" }}>{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Demo only: a one-page PDF headed with the applicant institution's own name. */
async function orgSamplePdf(label: string, org: string): Promise<File> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({ x: 0, y: 782, width: 595, height: 60, color: rgb(0.04, 0.24, 0.18) });
  page.drawText(org.slice(0, 60), { x: 40, y: 806, size: 14, font: bold, color: rgb(1, 1, 1) });
  page.drawText(label, { x: 40, y: 720, size: 20, font: bold, color: rgb(0.06, 0.12, 0.1) });
  page.drawText("Sample document generated for the PCP Digital Portal demo. Fictional data.", { x: 40, y: 690, size: 11, font, color: rgb(0.35, 0.42, 0.39) });
  page.drawText(`Generated ${new Date().toLocaleString("en-GB")}`, { x: 40, y: 670, size: 11, font, color: rgb(0.35, 0.42, 0.39) });
  const bytes = await doc.save();
  const name = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + ".pdf";
  return new File([bytes as BlobPart], name, { type: "application/pdf" });
}

async function uploadOnboardingDoc(file: File, docType: string) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("docType", docType);
  const res = await fetch("/api/onboarding/documents", { method: "POST", body: fd });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? "Upload failed");
  return j as { version: number; sha256: string };
}

function StatusBanner({ req, doneCount }: { req: Req; doneCount: number }) {
  if (req.status === "APPROVED")
    return (
      <div className="pcp-court" style={{ background: "var(--good-50)", borderColor: "#c9ecd8", marginBottom: 18, padding: "18px 20px", alignItems: "flex-start", flexWrap: "wrap" }}>
        <span style={{ width: 44, height: 44, borderRadius: 12, background: "#fff", display: "grid", placeItems: "center", color: "var(--good)", fontSize: 22, flex: "none" }}>
          <SafetyCertificateFilled />
        </span>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="pcp-court-title" style={{ fontSize: 16 }}>Approved by PCP. Your Institution ID is issued.</div>
          <div className="mono" data-testid="institution-code" style={{ fontSize: 26, fontWeight: 700, color: "var(--forest)", margin: "6px 0 4px", letterSpacing: "0.02em" }}>
            {req.institutionCode}
          </div>
          <div className="pcp-court-sub">
            Every NOC, faculty link, student and inspection is attached to this ID. Your account is now the Head of institution. Sign in again so the portal loads your new role.
          </div>
        </div>
        <form action={logoutAction} style={{ alignSelf: "center" }}>
          <Button type="primary" size="large" htmlType="submit" icon={<LogoutOutlined />}>
            Sign out and sign in again to open your institution portal
          </Button>
        </form>
      </div>
    );
  if (req.status === "REJECTED")
    return (
      <Alert
        type="error"
        showIcon
        style={{ marginBottom: 18 }}
        title={`PCP rejected this registration${req.reviewedAt ? ` on ${fmtDate(req.reviewedAt)}` : ""}`}
        description={
          <>
            <div style={{ whiteSpace: "pre-wrap", margin: "4px 0 6px" }}>
              <b>Grounds:</b> {req.reviewNote}
            </div>
            <span className="muted">Decided by {req.reviewedBy}. The decision was emailed to {req.email}. Contact PCP if you want to appeal.</span>
          </>
        }
      />
    );
  if (req.status === "RETURNED")
    return (
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 18 }}
        title={`PCP returned your request for changes${req.reviewedAt ? ` on ${fmtDate(req.reviewedAt)}` : ""}`}
        description={
          <>
            <div style={{ whiteSpace: "pre-wrap", margin: "4px 0 6px", padding: "8px 12px", background: "#fff", borderRadius: 8, border: "1px solid #ffe1a8" }}>{req.reviewNote}</div>
            <span className="muted">From {req.reviewedBy}. Fix these points in the steps below, then press “Resubmit to PCP”.</span>
          </>
        }
      />
    );
  if (req.status === "SUBMITTED")
    return (
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 18 }}
        title={`Waiting for PCP · submitted ${fmtDate(req.submittedAt, true)}`}
        description="A registration officer is checking your profile, campuses and documents. You will get an email with the decision. The checklist is read-only until then."
      />
    );
  return (
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 18, background: "var(--brand-50)", borderColor: "var(--brand-100)" }}
      title={doneCount === 4 ? "Every step is complete. Submit to PCP when you are ready." : "Complete the four steps, then submit to PCP"}
      description="Your work is saved as you go, so you can stop and come back later. Nothing else opens until PCP approves the institution."
    />
  );
}

export default function OnboardingChecklist({
  req,
  steps,
  docs,
  requiredDocs,
  provinces,
  universities,
  events,
}: {
  req: Req;
  steps: StepState[];
  docs: Doc[];
  requiredDocs: string[];
  provinces: string[];
  universities: string[];
  events: Ev[];
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<StepKey | null>(null);
  const editable = req.status === "DRAFT" || req.status === "RETURNED";
  const doneCount = steps.filter((s) => s.done).length;

  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      message[r.ok ? "success" : "error"](r.message, r.ok ? 3 : 7);
      if (r.ok) after?.();
      router.refresh();
    });

  return (
    <>
      <PageTitle
        eyebrow={`Registration ${req.ref}`}
        title={req.profile.name ?? "Register your institution"}
        sub={
          req.profile.city ? (
            <span>
              {req.profile.city}, {req.profile.province} · applicant {req.applicantName}
              {req.applicantDesignation ? `, ${req.applicantDesignation}` : ""}
            </span>
          ) : (
            "Four steps, then PCP verifies. Approval issues your Institution ID."
          )
        }
        extra={<StatusDot tone={ONBOARDING_STATUS_TONE[req.status] ?? "neutral"}>{ONBOARDING_STATUS_LABELS[req.status] ?? req.status}</StatusDot>}
      />
      <StatusBanner req={req} doneCount={doneCount} />
      <Row gutter={[18, 18]}>
        <Col xs={24} xl={16}>
          <Card
            title="Onboarding checklist"
            extra={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 180 }}>
                <span className="muted" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>
                  {doneCount} of {steps.length} complete
                </span>
                <Progress percent={Math.round((doneCount / steps.length) * 100)} showInfo={false} size="small" style={{ width: 90, margin: 0 }} />
              </span>
            }
            styles={{ body: { padding: 0 } }}
          >
            {steps.map((s, i) => (
              <div key={s.key} data-step={s.key} style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 20px", borderTop: i ? "1px solid var(--line-2)" : undefined, flexWrap: "wrap" }}>
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    display: "grid",
                    placeItems: "center",
                    flex: "none",
                    fontWeight: 700,
                    background: s.done ? "var(--brand)" : "#fff",
                    color: s.done ? "#fff" : "var(--muted)",
                    border: s.done ? "none" : "2px solid var(--line)",
                  }}
                >
                  {s.done ? <CheckOutlined /> : i + 1}
                </span>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontWeight: 600, fontSize: 14.5 }}>{s.title}</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {s.summary}
                  </div>
                  {!s.done && s.missing.length ? (
                    <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {s.missing.slice(0, 6).map((m) => (
                        <Tag key={m} color="orange" style={{ marginInlineEnd: 0 }}>
                          Missing: {m}
                        </Tag>
                      ))}
                      {s.missing.length > 6 ? <Tag>+{s.missing.length - 6} more</Tag> : null}
                    </div>
                  ) : null}
                </div>
                <Button type={!s.done && editable ? "primary" : "default"} onClick={() => setOpen(s.key)}>
                  {editable ? STEP_ACTION[s.key][s.done ? 1 : 0] : "View"}
                </Button>
              </div>
            ))}
            <div style={{ padding: "16px 20px", borderTop: "1px solid var(--line)", background: "#fbfdfc", borderRadius: "0 0 14px 14px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontWeight: 600 }}>Submit to PCP</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {!editable
                    ? req.status === "SUBMITTED"
                      ? "Submitted. PCP will reply by email."
                      : "This request is closed."
                    : doneCount === steps.length
                      ? "Everything is ready. PCP's registration officer checks it next."
                      : `Blocked until every step is complete: ${steps
                          .filter((s) => !s.done)
                          .map((s) => s.title)
                          .join(", ")}.`}
                </div>
              </div>
              {editable ? (
                <Popconfirm
                  title={req.status === "RETURNED" ? "Resubmit to PCP?" : "Submit to PCP?"}
                  description="The checklist becomes read-only until PCP decides."
                  okText={req.status === "RETURNED" ? "Resubmit" : "Submit"}
                  onConfirm={() => run(submitOnboarding)}
                  disabled={doneCount !== steps.length}
                >
                  <Button type="primary" size="large" icon={<SendOutlined />} disabled={doneCount !== steps.length} loading={pending}>
                    {req.status === "RETURNED" ? "Resubmit to PCP" : "Submit to PCP"}
                  </Button>
                </Popconfirm>
              ) : null}
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="Applicant" size="small" style={{ marginBottom: 18 }}>
            <MiniKV
              rows={[
                ["Name", req.applicantName],
                ["Designation", req.applicantDesignation],
                ["Username", <span key="u" className="mono">{req.applicantUsername}</span>],
                ["Email", req.email],
                ["Mobile", req.mobile],
              ]}
            />
          </Card>
          <Card title="History" size="small">
            {events.length ? (
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
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No history yet" />
            )}
          </Card>
        </Col>
      </Row>

      <Drawer title="Step 1 · Account" open={open === "account"} onClose={() => setOpen(null)} size="large">
        <AccountStep req={req} run={run} pending={pending} />
      </Drawer>
      <Drawer title="Step 2 · Profile and affiliation" open={open === "profile"} onClose={() => setOpen(null)} size="large" destroyOnHidden>
        <ProfileStep req={req} editable={editable} provinces={provinces} universities={universities} run={run} pending={pending} onDone={() => setOpen(null)} />
      </Drawer>
      <Drawer title="Step 3 · Campus and programmes" open={open === "campus"} onClose={() => setOpen(null)} size="large">
        <CampusStep req={req} editable={editable} provinces={provinces} run={run} pending={pending} />
      </Drawer>
      <Drawer title="Step 4 · Legal documents" open={open === "documents"} onClose={() => setOpen(null)} size="large">
        <DocumentsStep docs={docs} requiredDocs={requiredDocs} editable={editable} org={req.profile.name ?? "Institution applicant"} />
      </Drawer>
    </>
  );
}

type Run = (fn: () => Promise<ActionResult>, after?: () => void) => void;

function AccountStep({ req, run, pending }: { req: Req; run: Run; pending: boolean }) {
  const verified = !!req.emailVerifiedAt && !!req.mobileVerifiedAt;
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        The account belongs to the person who runs the institution&apos;s registration. Both the official email and the mobile number are verified with a 6-digit code.
      </p>
      <KV
        rows={[
          ["Applicant", `${req.applicantName}${req.applicantDesignation ? `, ${req.applicantDesignation}` : ""}`],
          ["Username", <span key="u" className="mono">{req.applicantUsername}</span>],
          ["Official email", <span key="e">{req.email} {req.emailVerifiedAt ? <Pill value="VERIFIED" label={`Verified ${fmtDate(req.emailVerifiedAt)}`} /> : <Pill value="PENDING" label="Not verified" />}</span>],
          ["Mobile", <span key="m">{req.mobile} {req.mobileVerifiedAt ? <Pill value="VERIFIED" label={`Verified ${fmtDate(req.mobileVerifiedAt)}`} /> : <Pill value="PENDING" label="Not verified" />}</span>],
        ]}
      />
      {!verified ? (
        <Space style={{ marginTop: 20 }}>
          <Link href={`/register/verify?ref=${req.ref}`}>
            <Button type="primary">Enter the codes</Button>
          </Link>
          <Button loading={pending} onClick={() => run(resendMyCodes)}>
            Send new codes
          </Button>
        </Space>
      ) : (
        <Alert type="success" showIcon style={{ marginTop: 20 }} title="This step is complete." />
      )}
    </>
  );
}

function ProfileStep({ req, editable, provinces, universities, run, pending, onDone }: { req: Req; editable: boolean; provinces: string[]; universities: string[]; run: Run; pending: boolean; onDone: () => void }) {
  const [form] = Form.useForm();
  const affiliation = Form.useWatch("affiliationType", form);
  const fill = () => {
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const code = "MC" + letters[Math.floor(Math.random() * letters.length)] + letters[Math.floor(Math.random() * letters.length)];
    form.setFieldsValue({
      name: "Mehran College of Pharmacy",
      shortCode: code,
      sector: "Private",
      province: provinces.includes("Sindh") ? "Sindh" : provinces[0],
      city: "Hyderabad",
      address: "Plot 14, Auto Bhan Road, Latifabad Unit 7, Hyderabad",
      phone: "022-3881234",
      website: "www.mehran-pharmacy.demo",
      establishedYear: 2023,
      affiliationType: "Affiliated college",
      affiliatedUniversity: universities.find((u) => u.startsWith("Liaquat University")) ?? universities[0],
    });
  };
  return (
    <Form form={form} layout="vertical" requiredMark="optional" disabled={!editable} initialValues={req.profile} onFinish={(v) => run(() => saveProfile(v, true), onDone)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span className="muted" style={{ fontSize: 13 }}>
          Use the institution&apos;s legal name as on its charter. Press “Save draft” to stop and continue later.
        </span>
        {editable ? <FillDemo onClick={fill} /> : null}
      </div>
      <Form.Item name="name" label="Institution name" rules={[{ required: true, min: 4, message: "Enter the legal name (at least 4 characters)" }]}>
        <Input placeholder="e.g. Indus Valley College of Pharmacy" />
      </Form.Item>
      <Row gutter={12}>
        <Col xs={24} md={8}>
          <Form.Item name="shortCode" label="Short code" normalize={(v: string) => v?.toUpperCase()} rules={[{ required: true, pattern: /^[A-Z]{2,6}$/, message: "2 to 6 capital letters" }]} extra="Used in student IDs">
            <Input placeholder="IVC" maxLength={6} />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="sector" label="Sector" rules={[{ required: true, message: "Choose the sector" }]}>
            <Select placeholder="Choose" options={["Public", "Private"].map((v) => ({ value: v }))} />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="establishedYear" label="Year established" rules={[{ required: true, message: "Enter the year" }]}>
            <InputNumber min={1900} max={new Date().getFullYear()} style={{ width: "100%" }} placeholder="2024" />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item name="province" label="Province or region" rules={[{ required: true, message: "Choose the province" }]}>
            <Select placeholder="Choose" options={provinces.map((v) => ({ value: v }))} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="city" label="City" rules={[{ required: true, message: "Enter the city" }]}>
            <Input />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name="address" label="Address" rules={[{ required: true, min: 5, message: "Enter the full postal address" }]}>
        <Input.TextArea rows={2} />
      </Form.Item>
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item name="phone" label="Phone" rules={[{ required: true, pattern: /^0\d{2,4}-\d{6,8}$/, message: "Enter it as 0xx-xxxxxxx" }]}>
            <Input placeholder="071-5630000" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="website" label="Website (optional)">
            <Input placeholder="www.example.edu.pk" />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col xs={24} md={10}>
          <Form.Item name="affiliationType" label="Affiliation type" rules={[{ required: true, message: "Choose the affiliation type" }]}>
            <Select placeholder="Choose" options={AFFILIATION_TYPES.map((v) => ({ value: v, label: v === "University" ? "University (degree-awarding)" : v }))} />
          </Form.Item>
        </Col>
        <Col xs={24} md={14}>
          {affiliation && affiliation !== "University" ? (
            <Form.Item name="affiliatedUniversity" label="Affiliated university" rules={[{ required: true, message: "Choose the university" }]} extra="From PCP's reference list">
              <Select showSearch placeholder="Search the list" optionFilterProp="label" options={universities.map((v) => ({ value: v, label: v }))} />
            </Form.Item>
          ) : null}
        </Col>
      </Row>
      {editable ? (
        <Space>
          <Button loading={pending} onClick={() => run(() => saveProfile(form.getFieldsValue(), false))}>
            Save draft
          </Button>
          <Button type="primary" htmlType="submit" loading={pending}>
            Save profile
          </Button>
        </Space>
      ) : null}
    </Form>
  );
}

function CampusStep({ req, editable, provinces, run, pending }: { req: Req; editable: boolean; provinces: string[]; run: Run; pending: boolean }) {
  const [campusEdit, setCampusEdit] = useState<{ index: number | null } | null>(null);
  const [progEdit, setProgEdit] = useState<{ index: number | null } | null>(null);
  const [cForm] = Form.useForm();
  const [pForm] = Form.useForm();
  const main = req.campuses.find((c) => c.isMain);

  const openCampus = (index: number | null) => {
    cForm.resetFields();
    cForm.setFieldsValue(index === null ? { province: req.profile.province, city: req.campuses.length ? undefined : req.profile.city, isMain: req.campuses.length === 0 } : req.campuses[index]);
    setCampusEdit({ index });
  };
  const openProg = (index: number | null) => {
    pForm.resetFields();
    pForm.setFieldsValue(index === null ? { campus: main?.name, type: "PHARMD", startYear: new Date().getFullYear() + 1 } : req.programmes[index]);
    setProgEdit({ index });
  };

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        Add the main campus first. A second campus is a child record of the same institution, not a second account. Then list the programmes each campus will run.
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "6px 0 10px" }}>
        <b>Campuses</b>
        {editable ? (
          <Button icon={<PlusOutlined />} onClick={() => openCampus(null)} type={req.campuses.length ? "default" : "primary"}>
            {req.campuses.length ? "Add another campus" : "Add main campus"}
          </Button>
        ) : null}
      </div>
      <Card size="small" styles={{ body: { padding: 0 } }} style={{ marginBottom: 20 }}>
        <Table
          size="small"
          rowKey="name"
          pagination={false}
          dataSource={req.campuses}
          locale={{ emptyText: "No campus yet. Add the main campus first." }}
          columns={[
            {
              title: "Campus",
              dataIndex: "name",
              render: (v, r) => (
                <span>
                  <EnvironmentOutlined style={{ color: "var(--brand)", marginRight: 6 }} />
                  <b style={{ fontWeight: 500 }}>{v}</b> {r.isMain ? <Tag color="green">Main</Tag> : null}
                  <div className="faint" style={{ fontSize: 12 }}>{r.address}</div>
                </span>
              ),
            },
            { title: "City", render: (_, r) => `${r.city}, ${r.province}` },
            {
              title: "",
              align: "right",
              render: (_, r, i) =>
                editable ? (
                  <Space size={4}>
                    <Button size="small" icon={<EditOutlined />} onClick={() => openCampus(i)}>
                      Edit
                    </Button>
                    <Popconfirm title={`Remove ${r.name}?`} onConfirm={() => run(() => removeCampus(i))}>
                      <Button size="small" danger icon={<DeleteOutlined />} aria-label={`Remove ${r.name}`} />
                    </Popconfirm>
                  </Space>
                ) : null,
            },
          ]}
        />
      </Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "6px 0 10px" }}>
        <b>Programmes</b>
        {editable ? (
          <Button icon={<PlusOutlined />} onClick={() => openProg(null)} disabled={!main} type={main && !req.programmes.length ? "primary" : "default"}>
            Add programme
          </Button>
        ) : null}
      </div>
      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table
          size="small"
          rowKey={(r) => `${r.type}@${r.campus}`}
          pagination={false}
          dataSource={req.programmes}
          locale={{ emptyText: main ? "No programme yet. Add PharmD, Pharmacy Technician or both." : "Add the main campus first." }}
          columns={[
            { title: "Programme", dataIndex: "type", render: (v) => <b style={{ fontWeight: 500 }}>{PROGRAMME_LABELS[v] ?? v}</b> },
            { title: "Campus", dataIndex: "campus" },
            { title: "Planned intake", dataIndex: "plannedIntake", align: "right", render: (v) => <span className="tnum">{v ?? "—"}</span> },
            { title: "First intake", dataIndex: "startYear", render: (v) => v ?? "—" },
            {
              title: "",
              align: "right",
              render: (_, r, i) =>
                editable ? (
                  <Space size={4}>
                    <Button size="small" icon={<EditOutlined />} onClick={() => openProg(i)}>
                      Edit
                    </Button>
                    <Popconfirm title="Remove this programme?" onConfirm={() => run(() => removeProgramme(i))}>
                      <Button size="small" danger icon={<DeleteOutlined />} aria-label="Remove programme" />
                    </Popconfirm>
                  </Space>
                ) : null,
            },
          ]}
        />
      </Card>
      <div className="faint" style={{ fontSize: 12.5, marginTop: 10 }}>
        Planned intake is your plan only. PCP sets the approved intake when it issues a NOC.
      </div>

      <Modal
        open={!!campusEdit}
        title={campusEdit?.index === null ? (req.campuses.length ? "Add another campus" : "Add the main campus") : "Edit campus"}
        okText="Save campus"
        confirmLoading={pending}
        onCancel={() => setCampusEdit(null)}
        onOk={() => cForm.submit()}
        destroyOnHidden
      >
        <Form form={cForm} layout="vertical" requiredMark="optional" onFinish={(v) => run(() => saveCampus(campusEdit?.index ?? null, v), () => setCampusEdit(null))}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <FillDemo
              onClick={() =>
                cForm.setFieldsValue(
                  req.campuses.length === 0 || (campusEdit?.index !== null && req.campuses[campusEdit?.index ?? 0]?.isMain)
                    ? { name: `Main campus, ${req.profile.city ?? "Hyderabad"}`, city: req.profile.city ?? "Hyderabad", province: req.profile.province ?? "Sindh", address: req.profile.address ?? "Plot 14, Auto Bhan Road, Latifabad, Hyderabad", isMain: true }
                    : { name: "Jamshoro campus", city: "Jamshoro", province: "Sindh", address: "Indus Highway, near the university gate, Jamshoro", isMain: false },
                )
              }
            />
          </div>
          <Form.Item name="name" label="Campus name" rules={[{ required: true, min: 3, message: "Enter the campus name" }]}>
            <Input placeholder="e.g. Main campus, Sukkur" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="city" label="City" rules={[{ required: true, message: "Enter the city" }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="province" label="Province or region" rules={[{ required: true, message: "Choose the province" }]}>
                <Select options={provinces.map((v) => ({ value: v }))} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="address" label="Address">
            <Input.TextArea rows={2} />
          </Form.Item>
          {req.campuses.length > (campusEdit?.index === null ? 0 : 1) ? (
            <Form.Item name="isMain" label="Main campus">
              <Select
                options={[
                  { value: true, label: "Yes, this is the main campus" },
                  { value: false, label: "No, a child campus" },
                ]}
              />
            </Form.Item>
          ) : (
            <Alert type="info" showIcon title="This is the main campus. Further campuses are added as child records." />
          )}
        </Form>
      </Modal>

      <Modal open={!!progEdit} title={progEdit?.index === null ? "Add programme" : "Edit programme"} okText="Save programme" confirmLoading={pending} onCancel={() => setProgEdit(null)} onOk={() => pForm.submit()} destroyOnHidden>
        <Form form={pForm} layout="vertical" requiredMark="optional" onFinish={(v) => run(() => saveProgramme(progEdit?.index ?? null, v), () => setProgEdit(null))}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <FillDemo onClick={() => pForm.setFieldsValue({ type: "PHARMD", campus: main?.name, plannedIntake: 50, startYear: new Date().getFullYear() + 1 })} />
          </div>
          <Form.Item name="type" label="Programme" rules={[{ required: true, message: "Choose the programme" }]}>
            <Select options={Object.entries(PROGRAMME_LABELS).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item name="campus" label="Campus" rules={[{ required: true, message: "Choose the campus" }]}>
            <Select options={req.campuses.map((c) => ({ value: c.name, label: `${c.name}${c.isMain ? " (main)" : ""}` }))} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="plannedIntake" label="Planned intake (students per year)" rules={[{ required: true, message: "Enter the planned intake" }]}>
                <InputNumber min={10} max={500} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="startYear" label="First intake (year)">
                <InputNumber min={new Date().getFullYear()} max={new Date().getFullYear() + 5} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </>
  );
}

function DocumentsStep({ docs, requiredDocs, editable, org }: { docs: Doc[]; requiredDocs: string[]; editable: boolean; org: string }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const latest = latestDocs(docs);
  const missing = requiredDocs.filter((r) => !latest.has(r) || latest.get(r)!.verificationStatus === "REJECTED");

  const send = async (file: File, docType: string) => {
    try {
      const j = await uploadOnboardingDoc(file, docType);
      message.success(`${docType}: uploaded v${j.version}`);
      router.refresh();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Upload failed");
      throw e;
    }
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
        <span className="muted" style={{ fontSize: 13 }}>
          PDF, JPG or PNG, up to 10 MB each. Uploading again adds a new version; earlier versions are kept. {missing.length ? `${missing.length} still missing.` : "All required documents are attached."}
        </span>
        {editable && missing.length ? (
          <FillDemo
            label="Attach sample PDFs"
            onClick={async () => {
              setBusy(true);
              try {
                for (const r of missing) await send(await orgSamplePdf(r, org), r);
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : null}
      </div>
      {busy ? <Alert type="info" showIcon style={{ marginBottom: 10 }} title="Attaching sample PDFs…" /> : null}
      <Card size="small" styles={{ body: { padding: 0 } }}>
        {requiredDocs.map((r, i) => {
          const d = latest.get(r);
          const bad = d?.verificationStatus === "REJECTED";
          return (
            <div key={r} data-doc={r} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderTop: i ? "1px solid var(--line-2)" : undefined, flexWrap: "wrap" }}>
              {d && !bad ? <CheckCircleFilled style={{ color: "var(--good)", fontSize: 16 }} /> : <span style={{ width: 16, height: 16, borderRadius: 8, border: `2px solid ${bad ? "var(--bad)" : "#c9d1cd"}`, display: "inline-block" }} />}
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 500 }}>{r}</div>
                {d ? (
                  <a href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>
                    <FilePdfOutlined /> {d.fileName} · v{d.version} · {fmtDate(d.uploadedAt)}
                  </a>
                ) : (
                  <span style={{ fontSize: 12.5, color: "#a15c00" }}>Missing</span>
                )}
                {bad ? <div style={{ fontSize: 12.5, color: "var(--bad)" }}>PCP marked this version as not acceptable. Upload a corrected one.</div> : null}
              </div>
              {d ? <Pill value={d.verificationStatus} label={d.verificationStatus === "PENDING" ? "Awaiting PCP check" : d.verificationStatus === "VERIFIED" ? "Verified by PCP" : "Not acceptable"} /> : null}
              {editable ? (
                <Space size={4}>
                  {DEMO && (!d || bad) ? (
                    <Button size="small" icon={<FilePdfOutlined />} onClick={async () => send(await orgSamplePdf(r, org), r).catch(() => undefined)}>
                      Sample PDF
                    </Button>
                  ) : null}
                  <Upload
                    accept=".pdf,.jpg,.jpeg,.png"
                    showUploadList={false}
                    customRequest={async ({ file, onSuccess, onError }) => {
                      try {
                        await send(file as File, r);
                        onSuccess?.({});
                      } catch (e) {
                        onError?.(e as Error);
                      }
                    }}
                  >
                    <Button size="small" icon={<UploadOutlined />}>
                      {d ? "New version" : "Upload"}
                    </Button>
                  </Upload>
                </Space>
              ) : null}
            </div>
          );
        })}
      </Card>
      {docs.length > requiredDocs.filter((r) => latest.has(r)).length ? (
        <>
          <Typography.Title level={5} style={{ marginTop: 20 }}>
            All versions
          </Typography.Title>
          <Card size="small" styles={{ body: { padding: 0 } }}>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={[...docs].reverse()}
              columns={[
                { title: "Document", render: (_, d) => <a href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer">{d.docType} · v{d.version}</a> },
                { title: "File", dataIndex: "fileName" },
                { title: "Status", dataIndex: "verificationStatus", render: (v) => <Pill value={v} /> },
                { title: "Uploaded", dataIndex: "uploadedAt", render: (v) => fmtDate(v, true) },
              ]}
            />
          </Card>
        </>
      ) : null}
    </>
  );
}
