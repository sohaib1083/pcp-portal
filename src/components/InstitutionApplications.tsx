"use client";
import Link from "next/link";
import { useTransition } from "react";
import { App, Button, Card, Dropdown, Empty, Table } from "antd";
import { DownOutlined, PlusOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { createApplication } from "@/app/actions/applications";
import { PageTitle, Pill, StatusTag, fmtDate, kindLabel, programLabel } from "./common";
import { formatPKR } from "@/lib/format";

type Row = { ref: string; kind: string; programType: string; status: string; feeAmount: number; feePaid: boolean; submittedAt: string | null; updatedAt: string; certificateNo: string | null };

export default function InstitutionApplications({ apps, canCreate, startable }: { apps: Row[]; canCreate: boolean; startable: string[] }) {
  const { message } = App.useApp();
  const [pending, start] = useTransition();
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
        sub="NOC, accreditation and renewal applications for your programs. Each one shows its stage and who holds it."
        extra={
          canCreate && startable.length ? (
            <Dropdown menu={{ items: startable.map((t) => ({ key: t, label: `New ${programLabel(t)} NOC application`, onClick: () => create(t) })) }}>
              <Button type="primary" icon={<PlusOutlined />} loading={pending}>
                New NOC application <DownOutlined />
              </Button>
            </Dropdown>
          ) : null
        }
      />
      <Card styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="ref"
          dataSource={apps}
          pagination={false}
          locale={{ emptyText: <Empty description="No applications yet. Start a NOC application for a new program." /> }}
          columns={[
            { title: "Reference", dataIndex: "ref", render: (v) => <Link href={`/institution/applications/${v}`} className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{v}</Link> },
            { title: "Type", render: (_, r) => `${kindLabel(r.kind)} · ${programLabel(r.programType)}` },
            { title: "Status", dataIndex: "status", render: (v) => <StatusTag status={v} /> },
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
