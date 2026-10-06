"use client";
import { Card, Input, Table, Typography } from "antd";
import { CloseCircleFilled, LinkOutlined, SafetyCertificateFilled } from "@ant-design/icons";
import { useMemo, useState } from "react";
import { PageTitle, StatusDot, fmtDate } from "./common";

type Row = { id: number; ts: string; actor: string; action: string; entity: string; entityId: string; details: string; hash: string; prevHash: string };

export default function AuditView({ rows, chain }: { rows: Row[]; chain: { ok: boolean; total: number; brokenAt: number | null } }) {
  const [q, setQ] = useState("");
  const data = useMemo(() => {
    const s = q.toLowerCase();
    return s ? rows.filter((r) => `${r.actor} ${r.action} ${r.entity} ${r.entityId} ${r.details}`.toLowerCase().includes(s)) : rows;
  }, [q, rows]);
  const tone = chain.ok ? { c: "#0d7a3d", bg: "linear-gradient(135deg,#e9f7ef,#f6fcf8)", bd: "#c9ecd8" } : { c: "#b4141f", bg: "#fff1f0", bd: "#ffccc7" };
  return (
    <>
      <PageTitle eyebrow="Administration" title="Audit log" sub="Append-only and hash-chained: each entry stores the hash of the one before it, so history cannot be quietly rewritten." />
      <div style={{ display: "flex", gap: 16, alignItems: "center", padding: "18px 20px", borderRadius: 16, border: `1px solid ${tone.bd}`, background: tone.bg, marginBottom: 18 }}>
        <span style={{ fontSize: 34, color: tone.c, lineHeight: 1 }}>{chain.ok ? <SafetyCertificateFilled /> : <CloseCircleFilled />}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: tone.c, letterSpacing: "-0.01em" }}>
            {chain.ok ? `Chain intact: all ${chain.total} entries verified` : `Tampering detected at entry #${chain.brokenAt}`}
          </div>
          <div style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 2 }}>
            {chain.ok
              ? "Editing or deleting any past entry, even directly in the database, breaks the chain from that point and this check fails."
              : `${chain.total} entries checked. Entries from #${chain.brokenAt} onward cannot be trusted.`}
          </div>
        </div>
        <div className="mono faint" style={{ fontSize: 11.5, textAlign: "right" }}>
          npm run audit:verify
          <br />
          verifies the same chain offline
        </div>
      </div>
      <Card
        title={`Latest ${rows.length} entries`}
        extra={<Input.Search allowClear placeholder="Filter by actor, action, record…" onChange={(e) => setQ(e.target.value)} style={{ width: 300 }} />}
        styles={{ body: { padding: 0 } }}
      >
        <Table
          rowKey="id"
          dataSource={data}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          tableLayout="fixed"
          columns={[
            { title: "#", dataIndex: "id", width: 64, render: (v) => <span className="tnum faint">{v}</span> },
            { title: "Time", dataIndex: "ts", width: 170, render: (v) => <span style={{ whiteSpace: "nowrap" }}>{fmtDate(v, true)}</span> },
            { title: "Actor", dataIndex: "actor", width: 130, render: (v) => <span className="mono">{v}</span> },
            { title: "Action", dataIndex: "action", width: 210, render: (v: string) => <StatusDot tone={/blocked|denied|disable|reject/i.test(v) ? "bad" : /flag|deficiency/i.test(v) ? "warn" : "info"}>{v}</StatusDot> },
            { title: "Record", width: 230, ellipsis: true, render: (_, r) => <span className="mono">{r.entity}:{r.entityId}</span> },
            { title: "Details", dataIndex: "details", ellipsis: { showTitle: true }, render: (v: string) => <span className="mono faint" style={{ fontSize: 11.5 }}>{v === "{}" ? "" : v}</span> },
            {
              title: "Hash",
              dataIndex: "hash",
              width: 175,
              render: (v: string, r) => (
                <span title={`previous: ${r.prevHash}`} style={{ whiteSpace: "nowrap" }}>
                  <LinkOutlined style={{ color: "var(--faint)", marginRight: 4 }} />
                  <Typography.Text className="mono" copyable={{ text: v }}>
                    {v.slice(0, 10)}…
                  </Typography.Text>
                </span>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}
