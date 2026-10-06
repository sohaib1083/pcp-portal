"use client";
// The institution's profile, campuses and programme cards (guide sections 1 and 3).
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Col, Drawer, Empty, Form, Input, Modal, Progress, Row, Select, Table, Tag } from "antd";
import { EditOutlined, EnvironmentOutlined, LockOutlined, PlusOutlined } from "@ant-design/icons";
import { saveInstitutionCampus, updateInstitutionContact } from "@/app/actions/institution";
import type { ActionResult } from "@/app/actions/faculty";
import { daysUntil } from "@/lib/format";
import { KV, PageTitle, Pill, fmtDate, programLabel } from "./common";
import { FillDemo } from "./demo-helpers";

type Inst = {
  code: string;
  shortCode: string;
  name: string;
  sector: string;
  status: string;
  province: string;
  city: string;
  affiliatedUniversity: string | null;
  establishedYear: number | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  website: string | null;
  registeredVia: string | null;
};
type Campus = { id: number; name: string; city: string; province: string; address: string | null; isMain: boolean; cases: number };
type Program = { type: string; nocStatus: string; nocNumber: string | null; approvedIntake: number; accreditationStatus: string; accreditationValidUntil: string | null };

const NOC_LABEL: Record<string, string> = { APPROVED: "NOC approved", PENDING: "NOC applied", NONE: "No NOC yet", REJECTED: "NOC refused" };
const ACC_LABEL: Record<string, string> = { VALID: "Accredited", EXPIRED: "Expired", PENDING: "Renewal pending", NONE: "Not accredited yet" };

function ProgrammeCard({ p }: { p: Program }) {
  const d = daysUntil(p.accreditationValidUntil);
  const left = d !== null ? Math.max(0, Math.min(100, Math.round((d / (5 * 365)) * 100))) : 0;
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 16, height: "100%", background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 650, fontSize: 15 }}>{programLabel(p.type)}</div>
          <div className="faint mono" style={{ marginTop: 2 }}>
            {p.nocNumber ?? "No NOC number yet"}
          </div>
        </div>
        <Pill value={p.nocStatus} label={NOC_LABEL[p.nocStatus]} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, margin: "14px 0" }}>
        <div style={{ background: "var(--bg)", borderRadius: 10, padding: "10px 12px" }}>
          <div className="faint" style={{ fontSize: 11.5 }}>Approved intake</div>
          <div className="tnum" style={{ fontSize: 20, fontWeight: 700 }}>{p.approvedIntake || "—"}</div>
        </div>
        <div style={{ background: "var(--bg)", borderRadius: 10, padding: "10px 12px" }}>
          <div className="faint" style={{ fontSize: 11.5 }}>Accreditation valid until</div>
          <div style={{ fontSize: 15, fontWeight: 650, marginTop: 4 }}>{p.accreditationValidUntil ? fmtDate(p.accreditationValidUntil) : "—"}</div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
        <span>
          Accreditation <Pill value={p.accreditationStatus} label={ACC_LABEL[p.accreditationStatus]} />
        </span>
        {d !== null ? <span className="muted">{d >= 0 ? `${d} days left` : `expired ${-d} days ago`}</span> : null}
      </div>
      {p.accreditationValidUntil ? <Progress percent={left} showInfo={false} size="small" strokeColor={d !== null && d <= 90 ? "#cf1322" : d !== null && d <= 180 ? "#d48806" : "#0b6e4f"} /> : null}
      {p.nocStatus === "NONE" ? (
        <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
          Apply for a NOC under <Link href="/institution/applications">Applications</Link> to start this programme.
        </div>
      ) : null}
    </div>
  );
}

export default function InstitutionProfileView({ inst, campuses, programs, canEdit, provinces }: { inst: Inst; campuses: Campus[]; programs: Program[]; canEdit: boolean; provinces: string[] }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [contactOpen, setContactOpen] = useState(false);
  const [campusEdit, setCampusEdit] = useState<{ id: number | null; init: Record<string, unknown> } | null>(null);

  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      message[r.ok ? "success" : "error"](r.message, r.ok ? 3 : 7);
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });

  const openCampus = (c: Campus | null) =>
    setCampusEdit({ id: c?.id ?? null, init: c ? { name: c.name, city: c.city, province: c.province, address: c.address ?? undefined, isMain: c.isMain } : { province: inst.province, isMain: false } });

  return (
    <>
      <PageTitle
        eyebrow="Institution record"
        title="Profile & campuses"
        sub="One institution, one Institution ID. Campuses are child records of this account; programmes carry their own NOC and accreditation."
        extra={
          canEdit ? (
            <Button
              icon={<EditOutlined />}
              onClick={() => setContactOpen(true)}
            >
              Edit contact details
            </Button>
          ) : null
        }
      />
      <Row gutter={[18, 18]}>
        <Col xs={24} xl={14}>
          <Card title={inst.name} extra={<Pill value={inst.status} />} style={{ marginBottom: 18 }}>
            <KV
              rows={[
                ["Institution ID", <span key="c" className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{inst.code}</span>],
                ["Short code", <span key="s" className="mono" style={{ fontSize: 13 }}>{inst.shortCode}</span>],
                ["Sector", inst.sector],
                ["Province and city", `${inst.city}, ${inst.province}`],
                ["Affiliated university", inst.affiliatedUniversity ?? "Degree-awarding university"],
                ["Year established", inst.establishedYear],
                ["Registered", inst.registeredVia ? <span key="r">Self-registration <span className="mono">{inst.registeredVia}</span>, approved by PCP</span> : "Registered by PCP"],
              ]}
            />
            <div style={{ borderTop: "1px solid var(--line-2)", margin: "16px 0 12px" }} />
            <div className="pcp-section-title" style={{ marginBottom: 10 }}>
              Contact details
            </div>
            <KV
              rows={[
                ["Official email", inst.email],
                ["Phone", inst.phone],
                ["Address", inst.address],
                ["Website", inst.website],
              ]}
            />
            <div className="faint" style={{ fontSize: 12.5, marginTop: 14 }}>
              <LockOutlined style={{ marginRight: 6 }} />
              The legal name, sector and affiliation change only through PCP. Raise a request with the <Link href="/institution/help">Help desk</Link>.
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card
            title={`Campuses (${campuses.length})`}
            extra={
              canEdit ? (
                <Button size="small" icon={<PlusOutlined />} onClick={() => openCampus(null)}>
                  Add campus
                </Button>
              ) : null
            }
            styles={{ body: { padding: 0 } }}
            style={{ marginBottom: 18 }}
          >
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={campuses}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No campus recorded" /> }}
              columns={[
                {
                  title: "Campus",
                  dataIndex: "name",
                  render: (v, c) => (
                    <span>
                      <EnvironmentOutlined style={{ color: "var(--brand)", marginRight: 6 }} />
                      <b style={{ fontWeight: 500 }}>{v}</b> {c.isMain ? <Tag color="green">Main</Tag> : null}
                      <div className="faint" style={{ fontSize: 12 }}>
                        {c.address ? `${c.address} · ` : ""}
                        {c.city}, {c.province}
                        {c.cases ? ` · ${c.cases} case${c.cases === 1 ? "" : "s"}` : ""}
                      </div>
                    </span>
                  ),
                },
                ...(canEdit
                  ? [
                      {
                        title: "",
                        align: "right" as const,
                        render: (_: unknown, c: Campus) => (
                          <Button size="small" icon={<EditOutlined />} onClick={() => openCampus(c)}>
                            Edit
                          </Button>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Card title="Programmes" extra={<span className="muted" style={{ fontSize: 12.5 }}>NOC, accreditation and approved intake</span>}>
        {programs.length ? (
          <Row gutter={[14, 14]}>
            {programs.map((p) => (
              <Col key={p.type} xs={24} md={12}>
                <ProgrammeCard p={p} />
              </Col>
            ))}
          </Row>
        ) : (
          <Empty description={<span>No programme yet. <Link href="/institution/applications">Apply for a NOC</Link> for PharmD or Pharmacy Technician.</span>} />
        )}
      </Card>

      <Drawer title="Edit contact details" open={contactOpen} onClose={() => setContactOpen(false)} size="large" destroyOnHidden>
        <Form
          layout="vertical"
          requiredMark="optional"
          initialValues={{ email: inst.email, phone: inst.phone, address: inst.address, website: inst.website }}
          onFinish={(v) => run(() => updateInstitutionContact(v), () => setContactOpen(false))}
        >
          <Form.Item name="email" label="Official email" rules={[{ required: true, type: "email", message: "Enter a valid email address" }]}>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="phone" label="Phone" rules={[{ required: true, pattern: /^0\d{2,4}-\d{6,8}$/, message: "Enter it as 0xx-xxxxxxx" }]}>
                <Input placeholder="091-9216000" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="website" label="Website">
                <Input placeholder="www.example.edu.pk" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="address" label="Address" rules={[{ required: true, min: 5, message: "Enter the full postal address" }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Alert type="info" showIcon style={{ marginBottom: 16 }} title="Every change is recorded in the audit log with the old and new values." />
          <Button type="primary" htmlType="submit" loading={pending}>
            Save contact details
          </Button>
        </Form>
      </Drawer>

      {campusEdit ? (
        <CampusModal
          edit={campusEdit}
          inst={inst}
          provinces={provinces}
          pending={pending}
          onCancel={() => setCampusEdit(null)}
          onSave={(v) => run(() => saveInstitutionCampus(campusEdit.id, v), () => setCampusEdit(null))}
        />
      ) : null}
    </>
  );
}

/** Mounted only while open, so each opening starts from the campus being edited. */
function CampusModal({
  edit,
  inst,
  provinces,
  pending,
  onCancel,
  onSave,
}: {
  edit: { id: number | null; init: Record<string, unknown> };
  inst: Inst;
  provinces: string[];
  pending: boolean;
  onCancel: () => void;
  onSave: (v: Record<string, unknown>) => void;
}) {
  const [campusForm] = Form.useForm();
  return (
    <>
      <Modal open title={edit.id ? "Edit campus" : "Add a campus"} okText="Save campus" confirmLoading={pending} onCancel={onCancel} onOk={() => campusForm.submit()}>
        <Form form={campusForm} layout="vertical" requiredMark="optional" initialValues={edit.init} onFinish={onSave}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
            <span className="muted" style={{ fontSize: 12.5 }}>A campus is part of this institution, not a separate account.</span>
            <FillDemo onClick={() => campusForm.setFieldsValue({ name: `City campus, ${inst.city}`, city: inst.city, province: inst.province, address: "Block C, University Road", isMain: false })} />
          </div>
          <Form.Item name="name" label="Campus name" rules={[{ required: true, min: 3, message: "Enter the campus name" }]}>
            <Input />
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
          <Form.Item name="isMain" label="Main campus">
            <Select
              options={[
                { value: true, label: "Yes, this is the main campus" },
                { value: false, label: "No, a child campus" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
