"use client";
import { useMemo, useState } from "react";
import { Card, Drawer, Empty, Input, Segmented, Table, Typography } from "antd";
import { MailOutlined, MessageOutlined } from "@ant-design/icons";
import { PageTitle, StatusDot, fmtDate } from "./common";

export type MessageRow = { id: number; channel: string; toAddress: string; toName: string | null; subject: string; body: string; entityRef: string | null; createdAt: string };

/** The outbox: every email and SMS the system would send, stored on its case. Nothing leaves the demo. */
export default function MessagesView({ rows, scope }: { rows: MessageRow[]; scope: string }) {
  const [channel, setChannel] = useState("All");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<MessageRow | null>(null);
  const data = useMemo(() => {
    const s = q.toLowerCase();
    return rows.filter((r) => (channel === "All" || r.channel === channel) && (!s || `${r.toAddress} ${r.toName} ${r.subject} ${r.entityRef}`.toLowerCase().includes(s)));
  }, [rows, channel, q]);
  return (
    <>
      <PageTitle
        eyebrow="Messages"
        title="Emails and SMS"
        sub={`Every message the portal sends is stored here and on its case. In the demo nothing is actually sent. ${scope}`}
        extra={
          <>
            <Segmented value={channel} onChange={(v) => setChannel(String(v))} options={["All", "EMAIL", "SMS"]} />
            <Input.Search allowClear placeholder="Recipient, subject or case" onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
          </>
        }
      />
      <Card styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          dataSource={data}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No messages yet" /> }}
          onRow={(r) => ({ onClick: () => setOpen(r), style: { cursor: "pointer" } })}
          columns={[
            { title: "Sent", dataIndex: "createdAt", width: 150, render: (v) => <span style={{ whiteSpace: "nowrap" }}>{fmtDate(v, true)}</span> },
            { title: "Channel", dataIndex: "channel", width: 100, render: (v) => <StatusDot tone={v === "SMS" ? "violet" : "info"}>{v === "SMS" ? <><MessageOutlined /> SMS</> : <><MailOutlined /> Email</>}</StatusDot> },
            { title: "To", render: (_, r) => <span>{r.toName ?? "—"}<div className="faint mono" style={{ fontSize: 11.5 }}>{r.toAddress}</div></span> },
            { title: "Subject", dataIndex: "subject", ellipsis: true },
            { title: "Case", dataIndex: "entityRef", width: 160, render: (v) => (v ? <span className="mono">{v}</span> : <span className="faint">—</span>) },
          ]}
        />
      </Card>
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.subject} size="large">
        {open ? (
          <>
            <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
              {open.channel} to {open.toName ? `${open.toName} · ` : ""}
              <span className="mono">{open.toAddress}</span> · {fmtDate(open.createdAt, true)}
              {open.entityRef ? <> · case <span className="mono">{open.entityRef}</span></> : null}
            </div>
            <Typography.Paragraph style={{ whiteSpace: "pre-wrap", background: "var(--bg)", padding: 16, borderRadius: 12, fontSize: 14 }}>{open.body}</Typography.Paragraph>
          </>
        ) : null}
      </Drawer>
    </>
  );
}
