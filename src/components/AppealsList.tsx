"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Col, Empty, Form, Input, Modal, Row, Segmented, Select, Table, Upload } from "antd";
import { AuditOutlined, CheckCircleOutlined, ClockCircleOutlined, FilePdfOutlined, InboxOutlined, PlusOutlined, ScheduleOutlined } from "@ant-design/icons";
import type { AppealRow } from "@/lib/council-data";
import { PageTitle, StatCard, fmtDate } from "./common";
import { DecisionPill, ModuleStatus } from "./CouncilParts";
import { FillDemo, SamplePdfButton } from "./demo-helpers";
import ScreenGuide from "./ScreenGuide";

type Appealable = { ref: string; label: string; status: string; decidedAt: string | null; note: string | null; grounds: string | null; deferUntil: string | null };

const OPEN = ["FILED", "UNDER_REVIEW", "ON_AGENDA"];

function FileAppealModal({ cases, initial, onClose }: { cases: Appealable[]; initial?: string; onClose: () => void }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const caseRef = Form.useWatch("caseRef", form) ?? initial;
  const chosen = cases.find((c) => c.ref === caseRef);

  const submit = async () => {
    const v = await form.validateFields();
    if (!file) return message.error("Attach the evidence that supports your appeal.");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("caseRef", v.caseRef);
      fd.append("grounds", v.grounds);
      fd.append("file", file);
      const res = await fetch("/api/appeals", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "The appeal could not be filed.");
      message.success(`Appeal ${j.ref} filed. PCP is notified and you will hear at each step.`, 5);
      onClose();
      router.push(`/institution/appeals/${j.ref}`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "The appeal could not be filed.", 8);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open width={640} title="File an appeal against a council decision" okText="File appeal" onOk={submit} confirmLoading={busy} onCancel={onClose} destroyOnHidden>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <FillDemo
          onClick={() =>
            form.setFieldsValue({
              grounds:
                "The dispensing laboratory safety audit was completed on 25 September by the provincial safety inspectorate, before the deferral reached us. The audit certificate is attached. We ask the council to decide the accreditation now.",
            })
          }
        />
      </div>
      <Form form={form} layout="vertical" requiredMark={false} initialValues={{ caseRef: initial ?? cases[0]?.ref }}>
        <Form.Item name="caseRef" label="Decision you are appealing" rules={[{ required: true, message: "Choose the decision." }]}>
          <Select id="appeal-case" options={cases.map((c) => ({ value: c.ref, label: `${c.ref} · ${c.label} · ${c.status === "REJECTED" ? "rejected" : "deferred"} ${fmtDate(c.decidedAt)}` }))} />
        </Form.Item>
        {chosen ? (
          <Alert
            type={chosen.status === "REJECTED" ? "error" : "warning"}
            showIcon
            style={{ marginBottom: 16 }}
            title={chosen.status === "REJECTED" ? "Grounds of the rejection" : `Reason for the deferral${chosen.deferUntil ? ` (returns ${fmtDate(chosen.deferUntil)})` : ""}`}
            description={chosen.grounds ?? chosen.note ?? "See the decision letter on the case."}
          />
        ) : null}
        <Form.Item name="grounds" label="Your grounds of appeal" rules={[{ required: true, min: 20, message: "State your grounds in at least 20 characters: what the council did not consider, or what has changed." }]}>
          <Input.TextArea id="appeal-grounds" rows={5} placeholder="What the council did not have before it, or why the decision should change" />
        </Form.Item>
        <Form.Item label="Evidence" required extra="PDF or image, up to 10 MB. It is filed with the appeal and linked to the original case.">
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Upload
              accept=".pdf,.png,.jpg,.jpeg"
              maxCount={1}
              showUploadList={false}
              beforeUpload={(f) => {
                setFile(f);
                return false;
              }}
            >
              <Button icon={<InboxOutlined />}>{file ? "Replace file" : "Choose file"}</Button>
            </Upload>
            <SamplePdfButton docLabel="Appeal evidence" onFile={(f) => setFile(f)} />
            {file ? (
              <span id="appeal-file" style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                <FilePdfOutlined style={{ color: "#b4141f" }} /> {file.name} <span className="faint">({Math.ceil(file.size / 1024)} KB)</span>
              </span>
            ) : (
              <span className="faint" style={{ fontSize: 13 }}>No file chosen</span>
            )}
          </div>
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default function AppealsList({ side, rows, canFile, appealable = [] }: { side: "pcp" | "institution"; rows: AppealRow[]; canFile?: boolean; appealable?: Appealable[] }) {
  const [view, setView] = useState<string>("open");
  const [filing, setFiling] = useState<string | null>(null);
  const year = String(new Date().getFullYear());
  const data = view === "open" ? rows.filter((r) => OPEN.includes(r.status)) : view === "closed" ? rows.filter((r) => !OPEN.includes(r.status)) : rows;
  const base = side === "pcp" ? "/pcp" : "/institution";

  return (
    <>
      <PageTitle
        eyebrow={side === "pcp" ? "Casework" : "With PCP"}
        title="Appeals"
        sub={
          side === "pcp"
            ? "Appeals against council decisions, linked to the original case and its evidence. Review each one, then place it on the next council agenda."
            : "Appeal a council rejection or deferral with your grounds and evidence. The council hears it and decides: upheld reopens the case, dismissed leaves the decision standing."
        }
        extra={
          <>
            <ScreenGuide
              title="Appeals"
              steps={
                side === "pcp"
                  ? [
                      "An institution files an appeal against a rejection or deferral, with grounds and evidence. It arrives here as **Filed**.",
                      "Open it, read the grounds and evidence against the case file, and **Save review note** with what you found and recommend.",
                      "**Place on the next council agenda**. It goes on the next planned meeting, or waits as ready for council until the Secretary builds the next agenda.",
                      "The council decides: **upheld** sends the original case back to council review for a fresh decision; **dismissed** leaves the decision standing. A decision letter is generated either way.",
                    ]
                  : [
                      "Only a rejection or a deferral can be appealed, once per decision, by the head of institution or the principal.",
                      "Click **File an appeal**, choose the decision, state your grounds and attach the evidence.",
                      "A PCP officer reviews it, then it goes on the council agenda. You are told at each step by email and in Messages.",
                      "When the council decides, the decision letter appears on the appeal. If upheld, your case returns to the council for a fresh decision.",
                    ]
              }
            />
            {side === "institution" && canFile && appealable.length ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setFiling(appealable[0].ref)}>
                File an appeal
              </Button>
            ) : null}
          </>
        }
      />
      {side === "pcp" ? (
        <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
          <Col xs={12} lg={6}>
            <StatCard label="Waiting for review" icon={<ClockCircleOutlined />} tone={rows.some((r) => r.status === "FILED") ? "warn" : "brand"} value={rows.filter((r) => r.status === "FILED").length} hint="Filed, not yet reviewed" />
          </Col>
          <Col xs={12} lg={6}>
            <StatCard label="Under review" icon={<AuditOutlined />} tone="violet" value={rows.filter((r) => r.status === "UNDER_REVIEW").length} hint="Review note saved" />
          </Col>
          <Col xs={12} lg={6}>
            <StatCard label="Ready for council" icon={<ScheduleOutlined />} tone="info" value={rows.filter((r) => r.status === "ON_AGENDA").length} hint="On or waiting for an agenda" />
          </Col>
          <Col xs={12} lg={6}>
            <StatCard label="Decided this year" icon={<CheckCircleOutlined />} value={rows.filter((r) => r.decidedAt?.startsWith(year)).length} hint={`${rows.filter((r) => r.status === "UPHELD").length} upheld · ${rows.filter((r) => r.status === "DISMISSED").length} dismissed`} />
          </Col>
        </Row>
      ) : appealable.length && canFile ? (
        <Card size="small" title="Decisions you can appeal" style={{ marginBottom: 16 }}>
          <div style={{ display: "grid", gap: 8 }}>
            {appealable.map((c) => (
              <div key={c.ref} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px" }}>
                <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <Link href={`/institution/applications/${c.ref}`} className="mono" style={{ fontWeight: 600 }}>
                    {c.ref}
                  </Link>
                  <span>{c.label}</span>
                  <DecisionPill decision={c.status} />
                  <span className="faint" style={{ fontSize: 12.5 }}>
                    {fmtDate(c.decidedAt)}
                    {c.deferUntil ? ` · returns ${fmtDate(c.deferUntil)}` : ""}
                  </span>
                </span>
                <Button size="small" onClick={() => setFiling(c.ref)} data-appeal={c.ref}>
                  Appeal this decision
                </Button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card
        styles={{ body: { padding: 0 } }}
        title={side === "institution" ? "Your appeals" : undefined}
        extra={
          <Segmented
            size="small"
            value={view}
            onChange={(v) => setView(String(v))}
            options={[
              { value: "open", label: `Open (${rows.filter((r) => OPEN.includes(r.status)).length})` },
              { value: "closed", label: `Decided or withdrawn (${rows.filter((r) => !OPEN.includes(r.status)).length})` },
              { value: "all", label: `All (${rows.length})` },
            ]}
          />
        }
      >
        <Table
          rowKey="ref"
          dataSource={data}
          pagination={{ pageSize: 15, hideOnSinglePage: true }}
          locale={{ emptyText: <Empty description={side === "pcp" ? "No appeals in this view." : "No appeals. You can appeal a rejection or deferral from here."} /> }}
          columns={[
            {
              title: "Appeal",
              dataIndex: "ref",
              render: (v) => (
                <Link href={`${base}/appeals/${v}`} className="mono" style={{ fontWeight: 600, fontSize: 13 }}>
                  {v}
                </Link>
              ),
            },
            ...(side === "pcp" ? [{ title: "Institution", render: (_: unknown, r: AppealRow) => <span>{r.inst?.name}<div className="faint" style={{ fontSize: 12 }}>{r.inst?.code} · {r.inst?.province}</div></span> }] : []),
            {
              title: "Against",
              render: (_, r) => (
                <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
                  <span>
                    <Link href={`${base}/applications/${r.caseRef}`} className="mono" style={{ fontSize: 12.5 }}>
                      {r.caseRef}
                    </Link>{" "}
                    {r.underAppeal ? <DecisionPill decision={r.underAppeal.decision} /> : null}
                  </span>
                  <span className="faint" style={{ fontSize: 12 }}>{r.caseLabel}</span>
                </span>
              ),
            },
            { title: "Filed", dataIndex: "filedAt", render: (v, r) => <span>{fmtDate(v)}<div className="faint" style={{ fontSize: 12 }}>{r.filedBy}</div></span>, sorter: (a, b) => a.filedAt.localeCompare(b.filedAt) },
            { title: "Status", dataIndex: "status", render: (v) => <ModuleStatus status={v} /> },
            {
              title: "Council",
              render: (_, r) =>
                r.meeting ? (
                  side === "pcp" ? (
                    <Link href={`/pcp/council/${r.meeting.ref}`} className="mono" style={{ fontSize: 12.5 }}>
                      {r.meeting.ref}
                      <div className="faint" style={{ fontFamily: "inherit" }}>{fmtDate(r.meeting.date)}</div>
                    </Link>
                  ) : (
                    <span>
                      {fmtDate(r.meeting.date)}
                      <div className="faint mono">{r.meeting.ref}</div>
                    </span>
                  )
                ) : (
                  <span className="faint">{r.status === "ON_AGENDA" ? "Next agenda" : "—"}</span>
                ),
            },
          ]}
        />
      </Card>
      {filing ? <FileAppealModal cases={appealable} initial={filing} onClose={() => setFiling(null)} /> : null}
    </>
  );
}
