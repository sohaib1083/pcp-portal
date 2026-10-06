"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Alert, App, Button, Card, Col, Form, Input, InputNumber, Row, Tag, Typography, Upload } from "antd";
import { BankOutlined, CheckCircleFilled, CreditCardOutlined, ScheduleOutlined, SendOutlined, UploadOutlined, WarningFilled } from "@ant-design/icons";
import { generateChallan, payFeeDemo, recheck, respondDeficiency, saveApplication, submitApplication } from "@/app/actions/applications";
import type { AppDetail } from "@/lib/appdetail";
import { formatPKR } from "@/lib/format";
import { AppHeader, CertificateCard, ChecksCard, DataDescriptions, DocumentsCard, TimelineCard, uploadDocument } from "./AppParts";
import { Pill, fmtDate } from "./common";
import { FillDemo, SamplePdfButton } from "./demo-helpers";
import type { ActionResult } from "@/app/actions/faculty";

type Perms = { canEdit: boolean; canUpload: boolean; canPay: boolean; canSubmit: boolean; canRespond: boolean };

const DEMO_FORM = {
  campus: "Hayatabad campus, Peshawar",
  proposedIntake: 60,
  classrooms: 4,
  labs: 3,
  libraryBooks: 800,
  libraryJournals: 6,
  labList: "Pharmaceutics, Pharmacology, Pharmaceutical Chemistry",
  buildingAreaSqft: 14000,
};

/** The four things an institution needs before it can submit, shown as one checklist. */
function Readiness({ d }: { d: AppDetail }) {
  const have = new Set(d.documents.filter((x) => !x.deficiencyId).map((x) => x.docType));
  const docs = d.requiredDocs.filter((r) => have.has(r)).length;
  const failing = d.app.checks.filter((c) => !c.ok).length;
  const items = [
    { label: "Application form", ok: !!d.app.data.campus && !!d.app.data.proposedIntake, detail: d.app.data.campus ? "Saved" : "Not filled yet" },
    { label: "Required documents", ok: d.requiredDocs.length > 0 && docs === d.requiredDocs.length, detail: `${docs} of ${d.requiredDocs.length} attached` },
    { label: "Automatic checks", ok: d.app.checks.length > 0 && failing === 0, detail: d.app.checks.length ? (failing ? `${failing} failing` : "All passing") : "Not run yet" },
    { label: "Fee", ok: !!d.app.feePaidAt, detail: d.app.feePaidAt ? "Paid" : d.app.feePsid ? "Challan generated" : "Not paid" },
  ];
  const done = items.filter((i) => i.ok).length;
  return (
    <Card size="small" style={{ marginBottom: 16 }} title={`Ready to submit? ${done} of ${items.length} done`}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {items.map((i, n) => (
          <div key={i.label} style={{ padding: "12px 14px", borderRadius: 12, border: `1px solid ${i.ok ? "#c9ecd8" : "var(--line)"}`, background: i.ok ? "#f3fbf6" : "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 13 }}>
              {i.ok ? <CheckCircleFilled style={{ color: "#12a150" }} /> : <span className="dg-n" style={{ width: 18, height: 18, fontSize: 10 }}>{n + 1}</span>}
              {i.label}
            </div>
            <div style={{ fontSize: 12.5, color: i.ok ? "#0d7a3d" : "var(--muted)", marginTop: 4 }}>{i.detail}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function InstitutionApplicationView({ d, perms }: { d: AppDetail; perms: Perms }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [qr, setQr] = useState<string | null>(null);
  const [form] = Form.useForm();
  const draft = d.app.status === "DRAFT";
  const failing = d.app.checks.filter((c) => !c.ok).length;

  useEffect(() => {
    if (d.app.feePsid && !d.app.feePaidAt)
      QRCode.toDataURL(`RAAST-P2M|DEMO|PAYEE:PHARMACY COUNCIL OF PAKISTAN|PSID:${d.app.feePsid}|AMOUNT:${d.app.feeAmount}|REF:${d.app.ref}`, { width: 180, margin: 1, color: { dark: "#0a3d2e" } }).then(setQr);
  }, [d.app.feePsid, d.app.feePaidAt, d.app.feeAmount, d.app.ref]);

  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      try {
        const r = await fn();
        message[r.ok ? (r.level === "warning" ? "warning" : "success") : "error"](r.message);
        router.refresh();
      } catch (e) {
        message.error(e instanceof Error ? e.message : "Something went wrong");
      }
    });

  const submitBlockers = [
    !perms.canSubmit && "Your account cannot submit applications",
    failing > 0 && `${failing} automatic check(s) failing`,
    d.app.checks.length === 0 && "Checks have not run yet",
    !d.app.feePaidAt && "Fee not paid",
  ].filter(Boolean) as string[];

  const inspection = d.inspections[0];

  return (
    <>
      <AppHeader d={d} />
      <Row gutter={18}>
        <Col xs={24} lg={15}>
          {draft ? <Readiness d={d} /> : null}

          {d.deficiencies.length ? (
            <Card
              size="small"
              title={
                <span>
                  <WarningFilled style={{ color: "#d48806", marginRight: 8 }} />
                  Deficiencies raised by PCP
                </span>
              }
              style={{ marginBottom: 16, borderColor: "#ffd591" }}
            >
              {d.deficiencies.map((def) => (
                <div key={def.id} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14, marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                      <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{def.ref}</span>
                      <Pill value={def.status} />
                      <Tag>{def.criterion}</Tag>
                    </span>
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      Raised by {def.raisedBy} · due <b style={{ color: "var(--ink)" }}>{fmtDate(def.dueDate)}</b>
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "6px 12px", fontSize: 13.5, marginBottom: 10 }}>
                    <span className="muted">Required action</span>
                    <span>{def.requiredAction}</span>
                    <span className="muted">Evidence required</span>
                    <span>{def.evidenceRequired}</span>
                  </div>
                  {def.reviewNote ? <Alert type={def.status === "REJECTED" ? "error" : "success"} showIcon style={{ marginBottom: 8 }} message={`PCP review: ${def.reviewNote}`} /> : null}
                  {def.responseNote ? <Alert type="info" showIcon style={{ marginBottom: 8 }} message={`Your response (${def.respondedBy}, ${fmtDate(def.respondedAt)}): ${def.responseNote}`} /> : null}
                  {d.documents.filter((x) => x.deficiencyId === def.id).map((x) => (
                    <div key={x.id} style={{ fontSize: 13 }}>
                      Evidence: <a href={`/api/documents/${x.id}`} target="_blank" rel="noreferrer">{x.fileName}</a> <Tag>v{x.version}</Tag>
                    </div>
                  ))}
                  {perms.canRespond && (def.status === "OUTSTANDING" || def.status === "REJECTED") ? <DeficiencyResponse d={d} defId={def.id} onDone={() => router.refresh()} /> : null}
                </div>
              ))}
            </Card>
          ) : null}

          {inspection ? (
            <Card size="small" style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span style={{ width: 38, height: 38, borderRadius: 10, background: "#f2eefe", color: "#5b3cc4", display: "grid", placeItems: "center", fontSize: 17 }}>
                  <ScheduleOutlined />
                </span>
                {inspection.status === "SCHEDULED" ? (
                  <span>
                    PCP inspection scheduled for <b>{fmtDate(inspection.scheduledFor)}</b>. The inspection team will contact you.
                  </span>
                ) : (
                  <span>Inspection completed on {fmtDate(inspection.scheduledFor)}. PCP reviews the findings; any deficiency will appear above.</span>
                )}
              </div>
            </Card>
          ) : null}

          <Card
            size="small"
            title="Program, infrastructure, laboratories, library"
            style={{ marginBottom: 16 }}
            extra={draft && perms.canEdit ? <FillDemo onClick={() => form.setFieldsValue(DEMO_FORM)} /> : null}
          >
            {draft && perms.canEdit ? (
              <Form form={form} layout="vertical" initialValues={d.app.data} onFinish={(v) => run(() => saveApplication(d.app.ref, v))}>
                <Row gutter={12}>
                  <Col xs={24} md={14}>
                    <Form.Item name="campus" label="Campus" rules={[{ required: true }]}>
                      <Input placeholder="e.g. Hayatabad campus, Peshawar" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={10}>
                    <Form.Item name="proposedIntake" label="Proposed intake (students per year)" rules={[{ required: true }]}>
                      <InputNumber min={1} style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={12}>
                  <Col xs={12} md={6}><Form.Item name="classrooms" label="Classrooms"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
                  <Col xs={12} md={6}><Form.Item name="labs" label="Laboratories"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
                  <Col xs={12} md={6}><Form.Item name="libraryBooks" label="Library books"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
                  <Col xs={12} md={6}><Form.Item name="libraryJournals" label="Journals"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
                </Row>
                <Row gutter={12}>
                  <Col xs={24} md={16}><Form.Item name="labList" label="Laboratories (list)"><Input placeholder="Pharmaceutics, Pharmacology, ..." /></Form.Item></Col>
                  <Col xs={24} md={8}><Form.Item name="buildingAreaSqft" label="Building area (sq ft)"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
                </Row>
                <Form.Item name="notes" label="Notes"><Input.TextArea rows={2} /></Form.Item>
                <Button type="primary" htmlType="submit" loading={pending}>Save and run checks</Button>
              </Form>
            ) : (
              <>
                {draft ? <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Your role can view this draft but not edit it." /> : null}
                <DataDescriptions data={d.app.data} />
              </>
            )}
          </Card>

          <DocumentsCard d={d} uploadable={draft && perms.canUpload} title="Application documents" />
        </Col>

        <Col xs={24} lg={9}>
          <CertificateCard d={d} />

          {draft ? (
            <Card size="small" style={{ marginBottom: 16, borderColor: submitBlockers.length ? undefined : "#95d5b2" }} title="Submit to PCP">
              {submitBlockers.length ? (
                <Alert type="warning" showIcon style={{ marginBottom: 10 }} message="Not ready to submit" description={<ul style={{ margin: 0, paddingLeft: 18 }}>{submitBlockers.map((b) => <li key={b}>{b}</li>)}</ul>} />
              ) : (
                <Alert type="success" showIcon style={{ marginBottom: 10 }} message="All checks pass and the fee is paid" />
              )}
              <Button type="primary" size="large" block icon={<SendOutlined />} disabled={submitBlockers.length > 0} loading={pending} onClick={() => run(() => submitApplication(d.app.ref))}>
                Submit application
              </Button>
            </Card>
          ) : null}

          <Card
            size="small"
            style={{ marginBottom: 16 }}
            title={
              <span>
                <CreditCardOutlined style={{ marginRight: 8, color: "var(--brand)" }} />
                Fee
              </span>
            }
            extra={d.app.feePaidAt ? <Pill value="APPROVED" label="Paid" /> : <Pill value="PENDING" label="Unpaid" />}
          >
            <div className="tnum" style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" }}>{formatPKR(d.app.feeAmount)}</div>
            <div className="muted" style={{ marginBottom: 12, fontSize: 12.5 }}>NOC fee per the PCP fee schedule</div>
            {d.app.feePaidAt ? (
              <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--good-50)", fontSize: 13 }}>
                <b style={{ color: "#0d7a3d" }}>Paid {fmtDate(d.app.feePaidAt, true)}</b> · {d.app.feeMethod}
                <div className="mono" style={{ marginTop: 2 }}>PSID {d.app.feePsid}</div>
              </div>
            ) : d.app.feePsid ? (
              <>
                <div style={{ display: "flex", gap: 14, alignItems: "center", padding: 12, border: "1px dashed var(--line)", borderRadius: 12 }}>
                  {qr ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qr} alt="Raast QR (demo)" width={120} height={120} />
                  ) : null}
                  <div style={{ fontSize: 12.5 }}>
                    <div className="muted">PSID (1Link)</div>
                    <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{d.app.feePsid}</div>
                    <div className="muted" style={{ marginTop: 8 }}>Pay in any banking app with Raast, or at any branch with the PSID.</div>
                  </div>
                </div>
                {perms.canPay ? (
                  <Button block type="primary" style={{ marginTop: 10 }} icon={<BankOutlined />} loading={pending} onClick={() => run(() => payFeeDemo(d.app.ref))}>
                    Simulate bank confirmation (demo)
                  </Button>
                ) : (
                  <Typography.Text type="secondary">Awaiting payment.</Typography.Text>
                )}
              </>
            ) : perms.canPay ? (
              <Button block loading={pending} onClick={() => run(() => generateChallan(d.app.ref))}>
                Generate challan (PSID + Raast QR)
              </Button>
            ) : (
              <Typography.Text type="secondary">The institution POC generates the challan and pays.</Typography.Text>
            )}
          </Card>

          <div style={{ marginBottom: 16 }}>
            <ChecksCard checks={d.app.checks} onRecheck={draft ? () => run(() => recheck(d.app.ref)) : undefined} recheckLoading={pending} />
          </div>

          <TimelineCard d={d} />
        </Col>
      </Row>
    </>
  );
}

function DeficiencyResponse({ d, defId, onDone }: { d: AppDetail; defId: number; onDone: () => void }) {
  const { message } = App.useApp();
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const sendEvidence = async (file: File) => {
    try {
      await uploadDocument(file, { docType: "Deficiency evidence", applicationRef: d.app.ref, deficiencyId: String(defId) });
      message.success("Evidence uploaded");
      onDone();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Upload failed");
    }
  };
  return (
    <div style={{ background: "var(--bg)", padding: 12, borderRadius: 10, marginTop: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <b style={{ fontSize: 13 }}>Your response</b>
        <FillDemo onClick={() => setNote("Safety certificate obtained from the district fire officer; attached.")} />
      </div>
      <Input.TextArea rows={2} placeholder="What did you do to fix it?" value={note} onChange={(e) => setNote(e.target.value)} style={{ marginBottom: 8, background: "#fff" }} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Upload
          showUploadList={false}
          customRequest={async ({ file, onSuccess }) => {
            await sendEvidence(file as File);
            onSuccess?.({});
          }}
        >
          <Button icon={<UploadOutlined />}>Upload evidence</Button>
        </Upload>
        <SamplePdfButton docLabel="Lab safety certificate" onFile={sendEvidence} />
        <Button
          type="primary"
          loading={pending}
          style={{ marginLeft: "auto" }}
          onClick={() =>
            start(async () => {
              const r = await respondDeficiency(defId, note);
              message[r.ok ? "success" : "error"](r.message);
              if (r.ok) onDone();
            })
          }
        >
          Submit response
        </Button>
      </div>
    </div>
  );
}
