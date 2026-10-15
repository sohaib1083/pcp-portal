"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, AutoComplete, Button, Card, Col, Empty, Form, Input, Result, Row, Table, Upload } from "antd";
import { DownloadOutlined, FilePdfOutlined, GlobalOutlined, IdcardOutlined, LockOutlined, PaperClipOutlined, SendOutlined } from "@ant-design/icons";
import { CATEGORY_LABELS, COUNCIL_INFO, DESIGNATIONS, isCouncil, validityLapsed } from "@/lib/register";
import { FillDemo, SamplePdfButton } from "./demo-helpers";
import { KV, Logo, PageTitle, Pill, fmtDate, timeAgo } from "./common";
import { RegStatus, bannerTone, statusSentence } from "./pharmacist-parts";
import "./pharmacist.css";

type Me = {
  regNo: string;
  fullName: string;
  fatherName: string;
  cnic: string;
  university: string;
  graduationYear: number;
  category: string;
  council: string;
  issueDate: string;
  validUntil: string | null;
  status: string;
  practicePlace: string | null;
  designation: string | null;
  practiceConfirmedAt: string | null;
  mobile: string | null;
  email: string | null;
};
type Upd = { id: number; practicePlace: string; designation: string; status: string; submittedAt: string; reviewedAt: string | null; reviewNote: string | null; evidence: { id: number; fileName: string } | null };

const TECH = ["Pharmacy Technician", "Dispensing Technician", "Store Officer"];

export function NotLinked() {
  return (
    <Card>
      <Result status="info" title="Your login is not linked to a register entry" subTitle="Ask PCP's registration officer to link your account to your registration number. Until then there is nothing to show here." />
    </Card>
  );
}

export default function PharmacistPortal({ p, updates, card }: { p: Me; updates: Upd[]; card: { qr: string; url: string; version: number | null; issuedAt: string | null } }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm();
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const council = isCouncil(p.council) ? COUNCIL_INFO[p.council].name : p.council;
  const tone = bannerTone(p.status, p.validUntil);
  // An update waits for the provincial council first (validation routing), then for PCP.
  const pending = updates.find((u) => u.status === "PENDING" || u.status === "WITH_COUNCIL");
  const lastRejected = updates.find((u) => u.status !== "WITHDRAWN");
  const canUpdate = p.status === "ACTIVE";
  const designations = DESIGNATIONS.filter((d) => (p.category === "B" ? TECH.includes(d) : !TECH.includes(d) || d === "Store Officer"));

  const send = async (v: { practicePlace: string; designation: string }) => {
    if (!file) return void message.error("Attach evidence: an appointment letter, or the drug sale licence that names you.");
    setSending(true);
    try {
      const fd = new FormData();
      fd.set("practicePlace", v.practicePlace);
      fd.set("designation", v.designation);
      fd.set("evidence", file);
      const res = await fetch("/api/pharmacist/practice", { method: "POST", body: fd });
      const r = (await res.json().catch(() => ({ ok: false, message: "The server did not answer. Try again." }))) as { ok: boolean; message: string };
      if (r.ok) {
        message.success(r.message);
        form.resetFields();
        setFile(null);
        router.refresh();
      } else message.error(r.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <PageTitle
        eyebrow="Registered pharmacist"
        title="My registration"
        sub={`Your entry in PCP's index of the ${council} register. The council issues and renews your registration; PCP keeps the index and answers the public check.`}
        extra={
          <a href="/api/pharmacist/card?download=1" data-testid="card-download">
            <Button type="primary" icon={<DownloadOutlined />}>
              Download registration card
            </Button>
          </a>
        }
      />

      <div className="pcp-court" style={{ background: tone.bg, borderColor: tone.bd, marginBottom: 16, alignItems: "flex-start" }}>
        <RegStatus status={p.status} validUntil={p.validUntil} />
        <div style={{ minWidth: 0 }}>
          <div className="pcp-court-title" style={{ color: tone.fg }}>
            {statusSentence(p)}
          </div>
          <div className="pcp-court-sub">
            This is what anyone sees when they check <span className="mono">{p.regNo}</span>.{" "}
            <Link href={`/verify?reg=${encodeURIComponent(p.regNo)}`} target="_blank">
              Open the public check
            </Link>
          </div>
        </div>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card title="Registration" style={{ marginBottom: 16 }}>
            <KV
              rows={[
                ["Name", <b key="n" style={{ fontWeight: 600 }}>{p.fullName}</b>],
                ["Father's name", p.fatherName],
                ["Registration number", <span key="r" className="mono" style={{ fontSize: 13 }}>{p.regNo}</span>],
                ["Category", CATEGORY_LABELS[p.category] ?? p.category],
                ["Issuing council", council],
                ["Issued", fmtDate(p.issueDate)],
                ["Valid until", p.validUntil ? `${fmtDate(p.validUntil)}${validityLapsed(p.validUntil) ? " · ended: renew with the council" : ""}` : "No end date in the council's file"],
                ["University", `${p.university}, ${p.graduationYear}`],
                ["CNIC", <span key="c" className="mono">{p.cnic}</span>],
                ["Contact", [p.mobile, p.email].filter(Boolean).join(" · ") || "—"],
              ]}
            />
            <p className="muted" style={{ fontSize: 12.5, margin: "14px 0 0" }}>
              Name, number, dates or category wrong? These come from the {council}. Ask the council to correct its register; PCP&apos;s index follows the council&apos;s next file.
            </p>
          </Card>

          <Card
            title="Practice place and designation"
            extra={
              <span className="muted" style={{ fontSize: 12.5 }}>
                <LockOutlined /> Not shown on the public check
              </span>
            }
            style={{ marginBottom: 16 }}
          >
            {p.practicePlace ? (
              <KV
                rows={[
                  ["Practice place", <b key="pp" style={{ fontWeight: 600 }}>{p.practicePlace}</b>],
                  ["Designation", p.designation],
                  ["Confirmed", <span key="c"><Pill value="VERIFIED" label="Verified by PCP" /> {fmtDate(p.practiceConfirmedAt)}</span>],
                ]}
              />
            ) : (
              <span className="muted">Not confirmed yet. Tell PCP where you practise, with evidence; it appears on your record and card once PCP verifies it.</span>
            )}

            {pending ? (
              <Alert
                data-testid="pending-update"
                style={{ marginTop: 14 }}
                type="info"
                showIcon
                title={`${pending.status === "WITH_COUNCIL" ? `Waiting for the ${council} to validate` : "Waiting for PCP"}: ${pending.designation}, ${pending.practicePlace}`}
                description={
                  <span>
                    Sent {timeAgo(pending.submittedAt)}
                    {pending.evidence ? (
                      <>
                        {" "}
                        with{" "}
                        <a href={`/api/documents/${pending.evidence.id}`} target="_blank" rel="noreferrer">
                          {pending.evidence.fileName}
                        </a>
                      </>
                    ) : null}
                    . Sending a new update replaces this one.
                  </span>
                }
              />
            ) : lastRejected?.status === "REJECTED" ? (
              <Alert style={{ marginTop: 14 }} type="warning" showIcon title={`Your last update was not accepted: ${lastRejected.practicePlace}`} description={lastRejected.reviewNote} />
            ) : null}

            {canUpdate ? (
              <div className="ph-update-form">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                  <b style={{ fontWeight: 600 }}>{p.practicePlace || pending ? "Report a change" : "Add your practice place"}</b>
                  <FillDemo onClick={() => form.setFieldsValue({ practicePlace: "Clifton Community Pharmacy, Karachi", designation: p.category === "B" ? "Dispensing Technician" : "Community Pharmacist" })} />
                </div>
                <Form form={form} layout="vertical" onFinish={send} requiredMark={false}>
                  <Form.Item name="practicePlace" label="Practice place, with city" rules={[{ required: true, min: 5, message: "Write the practice place with its city, e.g. Clifton Community Pharmacy, Karachi" }]}>
                    <Input id="practice-place" placeholder="e.g. Clifton Community Pharmacy, Karachi" maxLength={160} />
                  </Form.Item>
                  <Form.Item name="designation" label="Designation" rules={[{ required: true, min: 3, message: "Choose or type your designation" }]}>
                    <AutoComplete
                      id="designation"
                      options={designations.map((d) => ({ value: d }))}
                      placeholder="Choose or type, e.g. Hospital Pharmacist"
                      filterOption={(input, o) => String(o?.value ?? "").toLowerCase().includes(input.toLowerCase())}
                    />
                  </Form.Item>
                  <Form.Item label="Evidence" required extra="An appointment letter, or the drug sale licence that names you. PDF, JPG or PNG, up to 5 MB.">
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <Upload
                        accept=".pdf,.jpg,.jpeg,.png"
                        maxCount={1}
                        showUploadList={false}
                        beforeUpload={(f) => {
                          setFile(f);
                          return false;
                        }}
                      >
                        <Button icon={<PaperClipOutlined />}>Choose file</Button>
                      </Upload>
                      <SamplePdfButton docLabel="Appointment letter" onFile={(f) => setFile(f)} />
                      {file ? (
                        <span data-testid="evidence-name" style={{ fontSize: 13 }}>
                          <FilePdfOutlined /> {file.name}
                        </span>
                      ) : null}
                    </div>
                  </Form.Item>
                  <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={sending}>
                    Send for verification
                  </Button>
                </Form>
              </div>
            ) : (
              <Alert style={{ marginTop: 14 }} type="warning" showIcon title="You cannot report a practice place while your registration is not active." description={`Contact the ${council} to renew or restore it first.`} />
            )}
          </Card>

          <Card title="My updates" styles={{ body: { padding: 0 } }}>
            <Table
              rowKey="id"
              size="small"
              dataSource={updates}
              pagination={false}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No updates sent yet" /> }}
              columns={[
                { title: "Sent", dataIndex: "submittedAt", render: (v) => fmtDate(v) },
                { title: "Practice details", render: (_, u) => `${u.designation}, ${u.practicePlace}` },
                { title: "Result", dataIndex: "status", render: (v) => <Pill value={v === "WITH_COUNCIL" ? "PENDING" : v} label={v === "WITHDRAWN" ? "Replaced" : v === "WITH_COUNCIL" ? "With the council" : v === "PENDING" ? "With PCP" : undefined} /> },
                { title: "PCP note", dataIndex: "reviewNote", render: (v) => <span className="muted" style={{ fontSize: 12.5 }}>{v ?? "—"}</span> },
              ]}
            />
          </Card>
        </Col>

        <Col xs={24} xl={10}>
          <Card
            title={
              <span>
                <IdcardOutlined style={{ color: "var(--brand)", marginInlineEnd: 8 }} />
                Registration card
              </span>
            }
            style={{ marginBottom: 16 }}
          >
            <div className="reg-card" data-testid="card-preview" aria-label="Registration card preview">
              <div className="reg-card-head">
                <Logo size={26} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="reg-card-org">PHARMACY COUNCIL OF PAKISTAN</div>
                  <div className="reg-card-kind">Pharmacist register · registration card</div>
                </div>
                <div className="reg-card-cat">CATEGORY {p.category}</div>
              </div>
              <div className="reg-card-body">
                <div style={{ minWidth: 0 }}>
                  <div className="reg-card-name">{p.fullName}</div>
                  <div className="reg-card-father">Father: {p.fatherName}</div>
                  <div className="reg-card-k">Registration no.</div>
                  <div className="reg-card-v mono">{p.regNo}</div>
                  <div className="reg-card-k">Issuing council</div>
                  <div className="reg-card-v">{council}</div>
                  <div className="reg-card-k">Issued · valid until</div>
                  <div className="reg-card-v">
                    {fmtDate(p.issueDate)} · {fmtDate(p.validUntil)}
                  </div>
                </div>
                <div className="reg-card-qr">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={card.qr} alt={`QR code that opens the live status of ${p.regNo}`} />
                  <span>Scan for live status</span>
                </div>
              </div>
              <div className="reg-card-foot">DEMO · fictional data, not an official card</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              <a href="/api/pharmacist/card" target="_blank" rel="noreferrer">
                <Button icon={<FilePdfOutlined />}>Open the card (PDF)</Button>
              </a>
              <a href="/api/pharmacist/card?download=1">
                <Button icon={<DownloadOutlined />}>Download</Button>
              </a>
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: "12px 0 0" }}>
              Card size, front and back. The QR code opens <span className="mono" style={{ wordBreak: "break-all" }}>{card.url}</span>, so anyone who scans it sees today&apos;s status, not the status on the day it was printed.
              {card.version ? ` Current card: version ${card.version}, issued ${fmtDate(card.issuedAt)}.` : ""} A new version is issued when your details change.
            </p>
          </Card>

          <Card
            title={
              <span>
                <GlobalOutlined style={{ color: "var(--brand)", marginInlineEnd: 8 }} />
                What the public sees
              </span>
            }
          >
            <KV
              rows={[
                ["Name", p.fullName],
                ["Registration number", <span key="r" className="mono">{p.regNo}</span>],
                ["Category", CATEGORY_LABELS[p.category] ?? p.category],
                ["Status", <RegStatus key="s" status={p.status} validUntil={p.validUntil} />],
                ["Valid until", fmtDate(p.validUntil)],
              ]}
            />
            <p className="muted" style={{ fontSize: 12.5, margin: "12px 0 0" }}>
              <LockOutlined /> Your CNIC, phone, email, address and practice place are never shown publicly.
            </p>
          </Card>
        </Col>
      </Row>
    </>
  );
}
