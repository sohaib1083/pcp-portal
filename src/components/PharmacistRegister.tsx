"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Badge, Button, Card, Col, Empty, Input, Modal, Row, Select, Table, Tabs, Tooltip } from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  CloudUploadOutlined,
  FileSearchOutlined,
  GlobalOutlined,
  KeyOutlined,
  MedicineBoxOutlined,
  PauseCircleOutlined,
  SafetyCertificateOutlined,
  StopOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { reviewPracticeUpdate } from "@/app/actions/pharmacists";
import { COUNCIL_INFO, COUNCILS, CATEGORY_LABELS, STATUSES, STATUS_LABELS } from "@/lib/register";
import { useOtp } from "./OtpConfirm";
import { PageTitle, Pill, StatCard, fmtDate, timeAgo } from "./common";
import { CategoryText, RegStatus } from "./pharmacist-parts";
import PharmacistImport, { type ImportHistory } from "./PharmacistImport";

type Filters = { q: string; council: string; category: string; status: string; page: number; tab: string };
type ListRow = { id: number; regNo: string; fullName: string; council: string; category: string; status: string; validUntil: string | null; university: string; practiceConfirmed: boolean; practicePlace: string | null; designation: string | null; hasLogin: boolean };
type PendingRow = {
  id: number;
  practicePlace: string;
  designation: string;
  submittedAt: string;
  evidence: { id: number; fileName: string } | null;
  pharmacist: { id: number; regNo: string; fullName: string; council: string; status: string; current: string | null };
};
type RecentRow = { id: number; status: string; practicePlace: string; designation: string; reviewedBy: string | null; reviewedAt: string | null; reviewNote: string | null; pharmacist: { id: number; regNo: string; fullName: string } };

export default function PharmacistRegister({
  canManage,
  filters,
  stats,
  list,
  pending,
  recent,
  imports,
}: {
  canManage: boolean;
  filters: Filters;
  stats: { total: number; active: number; dormant: number; suspended: number; cancelled: number; pending: number };
  list: { total: number; pageSize: number; rows: ListRow[] };
  pending: PendingRow[];
  recent: RecentRow[];
  imports: ImportHistory[];
}) {
  const router = useRouter();
  const go = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    const sp = new URLSearchParams();
    if (next.q) sp.set("q", next.q);
    if (next.council) sp.set("council", next.council);
    if (next.category) sp.set("category", next.category);
    if (next.status) sp.set("status", next.status);
    if (next.page > 1) sp.set("page", String(next.page));
    if (next.tab && next.tab !== "register") sp.set("tab", next.tab);
    router.push(`/pcp/pharmacists${sp.size ? `?${sp}` : ""}`);
  };
  const filterBy = (patch: Partial<Filters>) => go({ ...patch, page: 1, tab: "register" });
  const filtered = !!(filters.q || filters.council || filters.category || filters.status);

  return (
    <>
      <PageTitle
        eyebrow="Registry"
        title="Pharmacist register"
        sub="PCP's index of the provincial pharmacy councils' registers, loaded from their files under agreement. The councils license pharmacists; PCP keeps the index, verifies practice details and answers the public check."
        extra={
          <>
            <Link href="/verify?tab=pharmacist" target="_blank">
              <Button icon={<GlobalOutlined />}>Open the public check</Button>
            </Link>
            {canManage ? (
              <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => go({ tab: "imports" })}>
                Import from a provincial council
              </Button>
            ) : null}
          </>
        }
      />
      {!canManage ? <Alert type="info" showIcon style={{ marginBottom: 16 }} title="View only. The registration officer changes statuses, verifies practice details and imports council files. CNICs are masked." /> : null}

      <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
        <Col xs={12} md={8} xl={4}>
          <a onClick={() => filterBy({ status: "", council: "", category: "", q: "" })}>
            <StatCard compact clickable label="On the register" value={stats.total} icon={<TeamOutlined />} hint={`From ${COUNCILS.length} provincial councils`} />
          </a>
        </Col>
        <Col xs={12} md={8} xl={5}>
          <a onClick={() => filterBy({ status: "ACTIVE" })}>
            <StatCard compact clickable label="Active" value={stats.active} icon={<SafetyCertificateOutlined />} tone="brand" hint="May practise" />
          </a>
        </Col>
        <Col xs={12} md={8} xl={5}>
          <a onClick={() => filterBy({ status: "DORMANT" })}>
            <StatCard compact clickable label="Dormant" value={stats.dormant} icon={<PauseCircleOutlined />} tone="warn" hint="Not renewed" />
          </a>
        </Col>
        <Col xs={12} md={12} xl={5}>
          <StatCard compact label="Suspended or cancelled" value={stats.suspended + stats.cancelled} icon={<StopOutlined />} tone="bad" hint={`${stats.suspended} suspended · ${stats.cancelled} cancelled`} />
        </Col>
        <Col xs={24} md={12} xl={5}>
          <a onClick={() => go({ tab: "updates" })}>
            <StatCard compact clickable label="Practice updates waiting" value={stats.pending} icon={<FileSearchOutlined />} tone={stats.pending ? "violet" : "neutral"} hint="Verify with the evidence" />
          </a>
        </Col>
      </Row>

      <Tabs
        activeKey={filters.tab}
        onChange={(k) => go({ tab: k })}
        items={[
          {
            key: "register",
            label: `Register (${stats.total})`,
            children: (
              <Card styles={{ body: { padding: 0 } }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: 14, borderBottom: "1px solid var(--line-2)" }}>
                  <Input.Search
                    allowClear
                    defaultValue={filters.q}
                    placeholder={canManage ? "Name, number, CNIC or university" : "Name, number or university"}
                    onSearch={(v) => filterBy({ q: v.trim() })}
                    style={{ width: 340, maxWidth: "100%" }}
                    aria-label="Search the register"
                  />
                  <Select
                    value={filters.council || undefined}
                    placeholder="All councils"
                    allowClear
                    onChange={(v) => filterBy({ council: v ?? "" })}
                    options={COUNCILS.map((c) => ({ value: c, label: COUNCIL_INFO[c].name }))}
                    style={{ width: 250 }}
                    aria-label="Council"
                  />
                  <Select value={filters.category || undefined} placeholder="All categories" allowClear onChange={(v) => filterBy({ category: v ?? "" })} options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))} style={{ width: 230 }} aria-label="Category" />
                  <Select value={filters.status || undefined} placeholder="All statuses" allowClear onChange={(v) => filterBy({ status: v ?? "" })} options={STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))} style={{ width: 150 }} aria-label="Status" />
                  {filtered ? (
                    <Button type="link" onClick={() => filterBy({ q: "", council: "", category: "", status: "" })}>
                      Clear filters
                    </Button>
                  ) : null}
                  <span className="muted" style={{ marginInlineStart: "auto", alignSelf: "center", fontSize: 12.5 }}>
                    {list.total} {list.total === 1 ? "pharmacist" : "pharmacists"}
                    {filtered ? " match" : ""}
                  </span>
                </div>
                <Table
                  rowKey="id"
                  dataSource={list.rows}
                  locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No pharmacist matches these filters" /> }}
                  pagination={{ current: filters.page, pageSize: list.pageSize, total: list.total, showSizeChanger: false, hideOnSinglePage: true, onChange: (page) => go({ page }) }}
                  onRow={(r) => ({ onClick: () => router.push(`/pcp/pharmacists/${r.id}`), style: { cursor: "pointer" } })}
                  columns={[
                    {
                      title: "Pharmacist",
                      render: (_, r) => (
                        <span>
                          <Link href={`/pcp/pharmacists/${r.id}`} style={{ fontWeight: 500, color: "var(--ink)" }} onClick={(e) => e.stopPropagation()}>
                            {r.fullName}
                          </Link>
                          <div className="faint" style={{ fontSize: 12 }}>
                            <span className="mono">{r.regNo}</span>
                          </div>
                        </span>
                      ),
                    },
                    { title: "Council", dataIndex: "council", responsive: ["md"] },
                    { title: "Category", dataIndex: "category", render: (v) => <CategoryText category={v} /> },
                    { title: "Status", render: (_, r) => <RegStatus status={r.status} validUntil={r.validUntil} /> },
                    { title: "Valid until", dataIndex: "validUntil", render: (v) => <span className="tnum">{fmtDate(v)}</span>, responsive: ["lg"] },
                    {
                      title: "Practice",
                      responsive: ["lg"],
                      render: (_, r) =>
                        r.practiceConfirmed ? (
                          <span style={{ fontSize: 12.5 }}>
                            {r.designation}
                            <div className="faint">{r.practicePlace}</div>
                          </span>
                        ) : (
                          <span className="faint" style={{ fontSize: 12.5 }}>
                            Not confirmed
                          </span>
                        ),
                    },
                    {
                      title: "",
                      align: "right",
                      width: 40,
                      render: (_, r) =>
                        r.hasLogin ? (
                          <Tooltip title="Has a portal login">
                            <KeyOutlined style={{ color: "var(--brand)" }} />
                          </Tooltip>
                        ) : null,
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: "updates",
            label: (
              <span>
                Practice updates <Badge count={stats.pending} size="small" color="#5b3cc4" style={{ marginInlineStart: 4 }} />
              </span>
            ),
            children: <PracticeQueue canManage={canManage} pending={pending} recent={recent} />,
          },
          {
            key: "imports",
            label: "Imports from councils",
            children: <PharmacistImport canManage={canManage} history={imports} />,
          },
        ]}
      />
    </>
  );
}

function PracticeQueue({ canManage, pending, recent }: { canManage: boolean; pending: PendingRow[]; recent: RecentRow[] }) {
  const { message } = App.useApp();
  const router = useRouter();
  const { withOtp, otpModal } = useOtp();
  const [busy, start] = useTransition();
  const [rejecting, setRejecting] = useState<PendingRow | null>(null);
  const [note, setNote] = useState("");
  const decide = (row: PendingRow, decision: "VERIFIED" | "REJECTED", why: string) =>
    withOtp(`practice-update:${row.id}`, decision === "VERIFIED" ? `Verify ${row.pharmacist.fullName}'s practice place` : `Reject ${row.pharmacist.fullName}'s practice update`, (code) =>
      new Promise<void>((resolve) =>
        start(async () => {
          const r = await reviewPracticeUpdate(row.id, decision, why, code);
          message[r.ok ? "success" : r.level === "warning" ? "warning" : "error"](r.message);
          if (r.ok) {
            setRejecting(null);
            setNote("");
          }
          router.refresh();
          resolve();
        }),
      ),
    );

  return (
    <>
      {otpModal}
      <Card
        title={
          <span>
            <MedicineBoxOutlined style={{ color: "var(--brand)", marginInlineEnd: 8 }} />
            Waiting for verification ({pending.length})
          </span>
        }
        extra={<span className="muted" style={{ fontSize: 12.5 }}>Check the evidence names the pharmacist and the place. A verified place shows on the record and the card, never on the public check.</span>}
        styles={{ body: { padding: 0 } }}
        style={{ marginBottom: 16 }}
      >
        <Table
          rowKey="id"
          dataSource={pending}
          pagination={false}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No practice update is waiting" /> }}
          columns={[
            {
              title: "Pharmacist",
              render: (_, r) => (
                <span>
                  <Link href={`/pcp/pharmacists/${r.pharmacist.id}`} style={{ fontWeight: 500, color: "var(--ink)" }}>
                    {r.pharmacist.fullName}
                  </Link>
                  <div className="faint" style={{ fontSize: 12 }}>
                    <span className="mono">{r.pharmacist.regNo}</span> · {r.pharmacist.council}
                  </div>
                </span>
              ),
            },
            {
              title: "New practice details",
              render: (_, r) => (
                <span>
                  <b style={{ fontWeight: 500 }}>{r.designation}</b>
                  <div>{r.practicePlace}</div>
                  <div className="faint" style={{ fontSize: 12 }}>Now: {r.pharmacist.current ?? "not confirmed"}</div>
                </span>
              ),
            },
            {
              title: "Evidence",
              render: (_, r) =>
                r.evidence ? (
                  <a href={`/api/documents/${r.evidence.id}`} target="_blank" rel="noreferrer">
                    <FileSearchOutlined /> {r.evidence.fileName}
                  </a>
                ) : (
                  <span className="faint">None</span>
                ),
            },
            { title: "Sent", dataIndex: "submittedAt", render: (v) => <span className="tnum">{timeAgo(v)}</span> },
            ...(canManage
              ? [
                  {
                    title: "",
                    align: "right" as const,
                    render: (_: unknown, r: PendingRow) => (
                      <span style={{ display: "inline-flex", gap: 6 }}>
                        <Button size="small" type="primary" icon={<CheckOutlined />} loading={busy} onClick={() => decide(r, "VERIFIED", "")}>
                          Verify
                        </Button>
                        <Button size="small" danger icon={<CloseOutlined />} disabled={busy} onClick={() => setRejecting(r)}>
                          Reject
                        </Button>
                      </span>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>
      <Card title="Recently decided" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          size="small"
          dataSource={recent}
          pagination={false}
          locale={{ emptyText: "Nothing decided yet" }}
          columns={[
            { title: "Pharmacist", render: (_, r) => <Link href={`/pcp/pharmacists/${r.pharmacist.id}`}>{r.pharmacist.fullName}</Link> },
            { title: "Practice details", render: (_, r) => `${r.designation}, ${r.practicePlace}` },
            { title: "Decision", dataIndex: "status", render: (v) => <Pill value={v} /> },
            { title: "Note", dataIndex: "reviewNote", render: (v) => <span className="muted">{v ?? "—"}</span>, responsive: ["lg"] },
            { title: "By", dataIndex: "reviewedBy", render: (v, r) => <span className="faint">{v} · {timeAgo(r.reviewedAt)}</span> },
          ]}
        />
      </Card>
      <Modal
        open={!!rejecting}
        title={`Reject the update from ${rejecting?.pharmacist.fullName ?? ""}`}
        okText="Reject and tell the pharmacist"
        okButtonProps={{ danger: true, disabled: note.trim().length < 10, loading: busy }}
        onCancel={() => setRejecting(null)}
        onOk={() => rejecting && decide(rejecting, "REJECTED", note)}
        destroyOnHidden
      >
        <p style={{ marginTop: 0 }}>
          {rejecting?.designation}, {rejecting?.practicePlace}
        </p>
        <Input.TextArea
          id="reject-reason"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What is wrong and what to send instead, e.g. The letter is not signed. Upload a signed appointment letter."
          maxLength={400}
          showCount
        />
      </Modal>
    </>
  );
}
