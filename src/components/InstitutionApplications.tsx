"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Alert, App, Button, Card, Col, Dropdown, Empty, Modal, Radio, Row, Select, Space, Table } from "antd";
import { DownOutlined, PlusOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { createApplication, createPgApplication } from "@/app/actions/applications";
import type { ProgrammeCardData } from "@/lib/programmes";
import { slaClock } from "@/lib/sla-view";
import { PageTitle, Pill, StatusTag, fmtDate, kindLabel, programLabel, programmeLabel } from "./common";
import { ProgrammeCard } from "./ProgrammeCards";
import { formatPKR } from "@/lib/format";

type Row = { ref: string; kind: string; programType: string; field?: string; status: string; feeAmount: number; feePaid: boolean; submittedAt: string | null; updatedAt: string; certificateNo: string | null; stageDueAt: string | null };

/** New postgraduate programme (RFP 4.1.10): the programme type is asked first, then the field of study. */
function NewPgProgramme({ open, type, fields, programmes, onClose }: { open: boolean; type: "MPHIL" | "PHD"; fields: string[]; programmes: ProgrammeCardData[]; onClose: () => void }) {
  const { message } = App.useApp();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<"MPHIL" | "PHD">(type);
  const [field, setField] = useState<string>();
  const existing = field ? programmes.find((p) => p.type === kind && p.field === field) : undefined;
  return (
    <Modal
      open={open}
      title="New postgraduate programme"
      onCancel={onClose}
      okText="Start accreditation case"
      okButtonProps={{ disabled: !field, loading: pending, className: "pg-start" }}
      onOk={() =>
        start(async () => {
          const r = await createPgApplication(kind, field!);
          if (r && !r.ok) message.error(r.message, 6);
        })
      }
      destroyOnHidden
    >
      <Space orientation="vertical" style={{ width: "100%" }} size={14}>
        <div>
          <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>1. Programme type</div>
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="pg-type"
            options={[
              { value: "MPHIL", label: "MS/MPhil" },
              { value: "PHD", label: "PhD" },
            ]}
          />
        </div>
        <div>
          <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>2. Field of study</div>
          <Select className="pg-field" placeholder="Pick the field of study" value={field} onChange={setField} style={{ width: "100%" }} options={fields.map((f) => ({ value: f, label: f }))} />
        </div>
        {existing ? (
          <Alert type="info" showIcon title={`${programmeLabel(kind, field)} is already on your profile`} description={existing.openCase ? `Its case ${existing.openCase.ref} opens instead.` : existing.validUntil ? `Accredited until ${existing.validUntil}. Start its renewal from the programme card.` : "A new accreditation case starts for it."} />
        ) : null}
        <Alert
          type="info"
          showIcon
          title="What you will need"
          description="The HEC NOC for this PG programme (upload), the PG proforma (intake, duration, coursework credit hours, thesis, research laboratories and equipment, library and journal access), and the eligible supervisors linked by Faculty ID."
        />
      </Space>
    </Modal>
  );
}

export default function InstitutionApplications({ apps, canCreate, startable, pgFields, programmes }: { apps: Row[]; canCreate: boolean; startable: string[]; pgFields: string[]; programmes: ProgrammeCardData[] }) {
  const { message } = App.useApp();
  const [pending, start] = useTransition();
  const [pgOpen, setPgOpen] = useState<"MPHIL" | "PHD" | null>(null);
  const create = (t: string) =>
    start(async () => {
      const r = await createApplication(t as "PHARMD" | "TECH");
      if (r && !r.ok) message.error(r.message);
    });
  return (
    <>
      <PageTitle
        eyebrow="With PCP"
        title="Applications"
        sub="NOC, accreditation and renewal cases for your programmes. Each one shows its stage, who holds it and the time left."
        extra={
          canCreate ? (
            <Space wrap>
              {startable.length ? (
                <Dropdown menu={{ items: startable.map((t) => ({ key: t, label: `New ${programLabel(t)} NOC application`, onClick: () => create(t) })) }}>
                  <Button type="primary" icon={<PlusOutlined />} loading={pending}>
                    New NOC application <DownOutlined />
                  </Button>
                </Dropdown>
              ) : null}
              <Dropdown
                menu={{
                  items: [
                    { key: "MPHIL", label: "MS/MPhil programme", onClick: () => setPgOpen("MPHIL") },
                    { key: "PHD", label: "PhD programme", onClick: () => setPgOpen("PHD") },
                  ],
                }}
              >
                <Button icon={<PlusOutlined />} className="new-pg">
                  New postgraduate programme <DownOutlined />
                </Button>
              </Dropdown>
            </Space>
          ) : null
        }
      />
      {pgOpen ? <NewPgProgramme open type={pgOpen} fields={pgFields} programmes={programmes} onClose={() => setPgOpen(null)} /> : null}
      {programmes.length ? (
        <Card title="Programmes" extra={<span className="muted" style={{ fontSize: 12.5 }}>Accreditation and renewal start from the programme card</span>} style={{ marginBottom: 18 }} id="programmes">
          <Row gutter={[14, 14]}>
            {programmes.map((p) => (
              <Col key={`${p.type}:${p.field}`} xs={24} lg={12}>
                <ProgrammeCard p={p} canStart={canCreate} />
              </Col>
            ))}
          </Row>
        </Card>
      ) : null}
      <Card styles={{ body: { padding: 0 } }} title="Cases">
        <Table
          rowKey="ref"
          dataSource={apps}
          pagination={false}
          locale={{ emptyText: <Empty description="No applications yet. Start a NOC application for a new program." /> }}
          columns={[
            { title: "Reference", dataIndex: "ref", render: (v) => <Link href={`/institution/applications/${v}`} className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{v}</Link> },
            { title: "Type", render: (_, r) => `${kindLabel(r.kind)} · ${programmeLabel(r.programType, r.field)}` },
            { title: "Status", dataIndex: "status", render: (v) => <StatusTag status={v} /> },
            {
              title: "Time limit",
              render: (_, r) => {
                const c = slaClock(r.status, r.stageDueAt);
                return c ? <span style={{ color: c.overdue ? "#b4141f" : c.tone === "warn" ? "#a15c00" : "var(--ink-2)", fontSize: 13 }}>{c.stage} · {c.text}</span> : <span className="faint">—</span>;
              },
            },
            { title: "Fee", render: (_, r) => <span className="tnum">{formatPKR(r.feeAmount)} {r.feePaid ? <Pill value="APPROVED" label="Paid" /> : <Pill value="NONE" label="Unpaid" />}</span> },
            { title: "Submitted", dataIndex: "submittedAt", render: (v) => fmtDate(v) },
            {
              title: "Certificate",
              dataIndex: "certificateNo",
              render: (v) =>
                v ? (
                  <Link href={`/certificate/${v}`} className="mono" style={{ fontSize: 12.5 }}>
                    <SafetyCertificateOutlined /> {v}
                  </Link>
                ) : (
                  <span className="faint">—</span>
                ),
            },
          ]}
        />
      </Card>
    </>
  );
}
