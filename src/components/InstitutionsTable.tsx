"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, Input, Segmented, Select, Table } from "antd";
import { FolderOpenOutlined, SearchOutlined } from "@ant-design/icons";
import { daysUntil } from "@/lib/format";
import { PROGRAM_LABELS, isPg } from "@/lib/workflow";
import { PageTitle, Pill, fmtDate, programmeLabel } from "./common";

type Row = { code: string; name: string; city: string; province: string; sector: string; status: string; students: number; faculty: number; programs: { type: string; field?: string; noc: string; acc: string; until: string | null }[] };

export default function InstitutionsTable({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState("");
  const [sector, setSector] = useState("All");
  const [prog, setProg] = useState<string>("ALL");
  const data = useMemo(() => {
    const s = q.toLowerCase();
    return rows.filter((r) => (sector === "All" || r.sector === sector) && (prog === "ALL" || r.programs.some((p) => p.type === prog)) && (!s || `${r.name} ${r.code} ${r.city} ${r.province}`.toLowerCase().includes(s)));
  }, [rows, q, sector, prog]);
  return (
    <>
      <PageTitle
        eyebrow="Registry"
        title="Institutions"
        sub="Every institution has one PCP ID. NOCs, accreditation, faculty and students all link to it."
        extra={
          <>
            <Segmented value={sector} onChange={(v) => setSector(String(v))} options={["All", "Public", "Private"]} />
            <Select aria-label="Programme" className="inst-programme-filter" value={prog} onChange={setProg} style={{ width: 170 }} options={[{ value: "ALL", label: "All programmes" }, ...Object.entries(PROGRAM_LABELS).map(([value, label]) => ({ value, label }))]} />
            <Input allowClear prefix={<SearchOutlined style={{ color: "var(--faint)" }} />} placeholder="Name, PCP ID, city" onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
          </>
        }
      />
      <Card styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="code"
          dataSource={data}
          pagination={false}
          columns={[
            { title: "Institution", dataIndex: "name", render: (v, r) => <span><span style={{ fontWeight: 500 }}>{v}</span><div className="faint" style={{ fontSize: 12 }}><span className="mono">{r.code}</span> · {r.city}, {r.province}</div></span> },
            { title: "Sector", dataIndex: "sector" },
            { title: "Status", dataIndex: "status", render: (v) => <Pill value={v} /> },
            {
              title: "Programs",
              render: (_, r) => (
                <div style={{ display: "grid", gap: 6 }}>
                  {r.programs.map((p) => {
                    const d = daysUntil(p.until);
                    return (
                      <div key={`${p.type}:${p.field ?? ""}`} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 12.5 }}>
                        <b style={{ minWidth: 128, fontWeight: 500 }}>{programmeLabel(p.type, p.field)}</b>
                        {isPg(p.type) ? null : <Pill value={p.noc} label={`NOC ${p.noc.toLowerCase()}`} />}
                        <Pill value={p.acc} label={`Accr. ${p.acc.toLowerCase()}`} />
                        {p.until ? (
                          <span className={d !== null && d <= 180 ? "" : "faint"} style={{ color: d !== null && d <= 90 ? "#b4141f" : d !== null && d <= 180 ? "#a15c00" : undefined }}>
                            until {fmtDate(p.until)}
                            {d !== null && d <= 180 ? ` · ${d} days` : ""}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                  {r.programs.length === 0 ? <span className="faint">No programs</span> : null}
                </div>
              ),
            },
            { title: "Students", dataIndex: "students", align: "right", sorter: (a, b) => a.students - b.students, render: (v) => <span className="tnum">{v}</span> },
            { title: "Faculty", dataIndex: "faculty", align: "right", sorter: (a, b) => a.faculty - b.faculty, render: (v) => <span className="tnum">{v}</span> },
            { title: "", align: "right", render: (_, r) => <Link href={`/pcp/documents?inst=${r.code}`}><FolderOpenOutlined /> Documents</Link> },
          ]}
        />
      </Card>
    </>
  );
}
