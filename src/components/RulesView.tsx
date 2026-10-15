"use client";
// Reference rules (guide sections 2 and 14): versioned thresholds, fees and drop-down lists.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Col, Drawer, Empty, Form, Input, InputNumber, Row, Segmented, Select, Table, Tabs, Tag } from "antd";
import { EditOutlined, HistoryOutlined, SaveOutlined } from "@ant-design/icons";
import { saveRuleVersion } from "@/app/actions/rules";
import { formatPKR } from "@/lib/format";
import { PageTitle, fmtDate, programLabel } from "./common";

type Version = { version: number; value: unknown; description: string; effectiveFrom: string; savedBy: string; savedAt: string | null };
type Rule = { key: string; versions: Version[] };

const CATEGORY: [test: (k: string) => boolean, label: string, color: string][] = [
  [(k) => k.startsWith("noc."), "NOC thresholds", "blue"],
  [(k) => k.startsWith("pg."), "Postgraduate", "geekblue"],
  [(k) => k.startsWith("inspection."), "Inspection scoring", "magenta"],
  [(k) => k === "fees", "Fees", "gold"],
  [(k) => k.startsWith("ref."), "Reference list", "green"],
  [(k) => k.startsWith("onboarding."), "Onboarding", "purple"],
  [(k) => k.startsWith("retention."), "Retention", "volcano"],
  [(k) => k.startsWith("kpi.") || k.startsWith("annual."), "Measures and deadlines", "cyan"],
];

// Rules held as a few named numbers: edited as a form, not as JSON.
const NUMBER_FIELDS: Record<string, [string, string, string][]> = {
  "retention.policy": [
    ["draftApplicationDays", "Clear a draft application nobody changed for", "days"],
    ["onboardingDraftDays", "Clear an onboarding draft never submitted, after", "days"],
    ["expiredCodeDays", "Delete a one-time code this long after it expires", "days"],
    ["unpaidChallanDays", "Cancel (not delete) an unpaid challan after", "days"],
  ],
  "kpi.targets": [
    ["nocDecisionDays", "Decide an NOC within", "days"],
    ["accreditationDecisionDays", "Decide an accreditation or renewal within", "days"],
    ["deficiencySharePct", "Cases returned for deficiency: under", "%"],
    ["onTimeSharePct", "Institutions filing the annual return on time: at least", "%"],
  ],
};
const category = (k: string) => CATEGORY.find(([t]) => t(k)) ?? [() => true, "Other", "default"];

const NOC_FIELDS: [string, string, string][] = [
  ["maxIntake", "Maximum intake", "students per year"],
  ["studentsPerFaculty", "Students per faculty member", "one teacher per N students"],
  ["minPhdFaculty", "Minimum PhD faculty", "members"],
  ["minLabs", "Minimum laboratories", "labs"],
  ["minClassrooms", "Minimum classrooms", "rooms"],
  ["minLibraryBooks", "Minimum library books", "books"],
];

const FEE_KIND: Record<string, string> = { NOC: "NOC", RENEWAL: "Renewal", ACCREDITATION: "Accreditation" };
const feeLabel = (k: string) => {
  const [kind, prog] = k.split(":");
  return `${FEE_KIND[kind] ?? kind} · ${prog ? programLabel(prog) : ""}`;
};

const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

function summary(key: string, v: unknown): string {
  if (isStringList(v)) return `${v.length} entr${v.length === 1 ? "y" : "ies"}: ${v.slice(0, 3).join(", ")}${v.length > 3 ? ", …" : ""}`;
  if (key === "fees" && v && typeof v === "object") return Object.entries(v as Record<string, number>).slice(0, 2).map(([k, x]) => `${feeLabel(k)} ${formatPKR(x)}`).join(" · ") + (Object.keys(v).length > 2 ? " · …" : "");
  if (key === "retention.policy" && v && typeof v === "object") {
    const r = v as Record<string, number>;
    return `Drafts ${r.draftApplicationDays} days · onboarding drafts ${r.onboardingDraftDays} days · codes ${r.expiredCodeDays} day after expiry · unpaid challans ${r.unpaidChallanDays} days`;
  }
  if (key === "kpi.targets" && v && typeof v === "object") {
    const r = v as Record<string, number>;
    return `NOC within ${r.nocDecisionDays} days · accreditation within ${r.accreditationDecisionDays} days · deficiency under ${r.deficiencySharePct}% · on time at least ${r.onTimeSharePct}%`;
  }
  if (typeof v === "string") return v;
  if (key === "pg.rules" && v && typeof v === "object") {
    const r = v as { fields?: string[]; types?: Record<string, { maxStudentsPerSupervisor?: number; minPublications?: number; minPhdFacultyInField?: number }> };
    const t = (k: string) => r.types?.[k];
    return `${r.fields?.length ?? 0} fields · PhD: ${t("PHD")?.minPublications ?? "-"} publications or HEC-approved, ${t("PHD")?.maxStudentsPerSupervisor ?? "-"} students per supervisor, ${t("PHD")?.minPhdFacultyInField ?? "-"} PhD faculty in the field · MS/MPhil: ${t("MPHIL")?.maxStudentsPerSupervisor ?? "-"} per supervisor`;
  }
  if (key === "inspection.scoring" && v && typeof v === "object") {
    const r = v as { maxScore?: number; passPercent?: number; weights?: Record<string, number> };
    return `Score 0 to ${r.maxScore ?? 5} per line · pass mark ${r.passPercent ?? "-"}% · ${Object.keys(r.weights ?? {}).length} weighted lines`;
  }
  if (key.startsWith("noc.") && v && typeof v === "object") {
    const r = v as Record<string, number>;
    return `Intake ≤ ${r.maxIntake} · 1 faculty per ${r.studentsPerFaculty} · ${r.minLabs} labs · ${r.minLibraryBooks} books`;
  }
  const s = JSON.stringify(v);
  return s.length > 90 ? s.slice(0, 90) + "…" : s;
}

/** What changed from one version to the next, in words. */
function changes(prev: unknown, cur: unknown): string[] {
  if (isStringList(prev) && isStringList(cur)) {
    const added = cur.filter((x) => !prev.includes(x));
    const removed = prev.filter((x) => !cur.includes(x));
    return [...added.map((x) => `Added “${x}”`), ...removed.map((x) => `Removed “${x}”`), ...(added.length || removed.length ? [] : ["Order changed"])];
  }
  if (prev && cur && typeof prev === "object" && typeof cur === "object" && !Array.isArray(prev) && !Array.isArray(cur)) {
    const p = prev as Record<string, unknown>;
    const c = cur as Record<string, unknown>;
    return [...new Set([...Object.keys(p), ...Object.keys(c)])]
      .filter((k) => JSON.stringify(p[k]) !== JSON.stringify(c[k]))
      .map((k) => (Array.isArray(c[k]) ? `${k}: list changed` : `${k}: ${JSON.stringify(p[k] ?? "—")} → ${JSON.stringify(c[k] ?? "—")}`));
  }
  return ["Value changed"];
}

function Editor({ rule, onSaved }: { rule: Rule; onSaved: () => void }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const current = rule.versions[0];
  const v = current.value;
  const mode = rule.key.startsWith("noc.") ? "noc" : rule.key === "fees" ? "fees" : NUMBER_FIELDS[rule.key] ? "numbers" : typeof v === "string" ? "text" : isStringList(v) ? "list" : "json";
  const [text, setText] = useState(typeof v === "string" ? v : "");
  const [note, setNote] = useState("");
  const [listText, setListText] = useState(isStringList(v) ? v.join("\n") : "");
  const [json, setJson] = useState(JSON.stringify(v, null, 2));
  const [form] = Form.useForm();

  const jsonError = useMemo(() => {
    if (mode !== "json") return null;
    try {
      JSON.parse(json);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Not valid JSON";
    }
  }, [json, mode]);

  const save = (value: unknown) =>
    start(async () => {
      const r = await saveRuleVersion(rule.key, value, note);
      message[r.ok ? "success" : "error"](r.message, r.ok ? 4 : 8);
      if (r.ok) {
        setNote("");
        onSaved();
        router.refresh();
      }
    });

  const submit = async () => {
    if (mode === "noc" || mode === "fees" || mode === "numbers") {
      const values = await form.validateFields();
      save(mode === "noc" ? { ...values, requiredDocs: (values.requiredDocs as string[]).map((x) => x.trim()).filter(Boolean) } : values);
    } else if (mode === "text") save(text.trim());
    else if (mode === "list") save(listText.split("\n").map((x) => x.trim()).filter(Boolean));
    else if (!jsonError) save(JSON.parse(json));
  };

  const lines = listText.split("\n").map((x) => x.trim()).filter(Boolean);
  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title={`Saving creates version ${current.version + 1}, effective today. Version ${current.version} stays in the history and is never overwritten.`}
      />
      {mode === "noc" ? (
        <Form form={form} layout="vertical" initialValues={v as object} requiredMark="optional">
          <Row gutter={12}>
            {NOC_FIELDS.map(([name, label, unit]) => (
              <Col key={name} xs={24} md={12}>
                <Form.Item name={name} label={label} rules={[{ required: true, message: `Enter the ${label.toLowerCase()}` }]}>
                  <InputNumber min={0} style={{ width: "100%" }} suffix={<span className="faint" style={{ fontSize: 12 }}>{unit}</span>} />
                </Form.Item>
              </Col>
            ))}
          </Row>
          <Form.Item name="requiredDocs" label="Required documents" rules={[{ required: true, type: "array", min: 1, message: "List at least one document" }]} extra="Type a document name and press Enter to add it.">
            <Select mode="tags" tokenSeparators={["\n"]} open={false} suffixIcon={null} />
          </Form.Item>
        </Form>
      ) : mode === "fees" ? (
        <Form form={form} layout="vertical" initialValues={v as object} requiredMark="optional">
          <Row gutter={12}>
            {Object.keys(v as object).map((k) => (
              <Col key={k} xs={24} md={12}>
                <Form.Item name={k} label={feeLabel(k)} rules={[{ required: true, message: "Enter the fee" }]}>
                  <InputNumber<number> min={0} step={10000} style={{ width: "100%" }} prefix="PKR" formatter={(x) => `${x}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")} parser={(x) => Number(String(x ?? "").replace(/[^\d]/g, ""))} />
                </Form.Item>
              </Col>
            ))}
          </Row>
        </Form>
      ) : mode === "numbers" ? (
        <Form form={form} layout="vertical" initialValues={v as object} requiredMark="optional">
          {NUMBER_FIELDS[rule.key].map(([name, label, unit]) => (
            <Form.Item key={name} name={name} label={label} rules={[{ required: true, message: "Enter a number" }]}>
              <InputNumber min={0} style={{ width: "100%" }} suffix={<span className="faint" style={{ fontSize: 12 }}>{unit}</span>} />
            </Form.Item>
          ))}
        </Form>
      ) : mode === "text" ? (
        <div style={{ marginBottom: 16 }}>
          <b style={{ display: "block", marginBottom: 6 }}>Value</b>
          <Input id="rule-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. 31 October" />
        </div>
      ) : mode === "list" ? (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <b>One entry per line</b>
            <span className="muted tnum">{lines.length} entries</span>
          </div>
          <Input.TextArea id="rule-list" value={listText} onChange={(e) => setListText(e.target.value)} autoSize={{ minRows: 8, maxRows: 22 }} />
        </div>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <b style={{ display: "block", marginBottom: 6 }}>Value (JSON)</b>
          <Input.TextArea id="rule-json" value={json} onChange={(e) => setJson(e.target.value)} autoSize={{ minRows: 8, maxRows: 24 }} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5 }} status={jsonError ? "error" : undefined} />
          {jsonError ? <div style={{ color: "var(--bad)", fontSize: 12.5, marginTop: 4 }}>Not valid JSON: {jsonError}</div> : <div style={{ color: "var(--good)", fontSize: 12.5, marginTop: 4 }}>Valid JSON</div>}
        </div>
      )}
      <Form layout="vertical">
        <Form.Item label="What changed and why" required extra="Shown in the version history and recorded in the audit log.">
          <Input id="rule-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Council meeting 14/2026 raised the PharmD intake limit" />
        </Form.Item>
      </Form>
      <Button type="primary" icon={<SaveOutlined />} loading={pending} disabled={note.trim().length < 5 || !!jsonError} onClick={submit}>
        Save as version {current.version + 1}
      </Button>
    </>
  );
}

function History({ rule }: { rule: Rule }) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {rule.versions.map((v, i) => {
        const prev = rule.versions[i + 1];
        const diff = prev ? changes(prev.value, v.value) : [];
        return (
          <div key={v.version} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14, background: i === 0 ? "#fbfdfc" : "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <span>
                <b>Version {v.version}</b> {i === 0 ? <Tag color="green">Current</Tag> : <Tag>Superseded</Tag>}
              </span>
              <span className="muted" style={{ fontSize: 12.5 }}>
                Effective {fmtDate(v.effectiveFrom)} · {v.savedBy}
                {v.savedAt ? ` · saved ${fmtDate(v.savedAt, true)}` : ""}
              </span>
            </div>
            <div style={{ marginTop: 4 }}>{v.description}</div>
            {diff.length ? (
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5 }} className="muted">
                {diff.slice(0, 8).map((d) => (
                  <li key={d}>{d}</li>
                ))}
                {diff.length > 8 ? <li>and {diff.length - 8} more</li> : null}
              </ul>
            ) : null}
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", fontSize: 12.5, color: "var(--brand)" }}>Show the full value</summary>
              <pre style={{ margin: "8px 0 0", padding: 10, background: "var(--bg)", borderRadius: 8, fontSize: 12, maxHeight: 260, overflow: "auto", whiteSpace: "pre-wrap" }}>{JSON.stringify(v.value, null, 2)}</pre>
            </details>
          </div>
        );
      })}
    </div>
  );
}

export default function RulesView({ rules }: { rules: Rule[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [tab, setTab] = useState("edit");
  const [filter, setFilter] = useState("All");
  const open = rules.find((r) => r.key === openKey) ?? null;
  const cats = ["All", ...new Set(rules.map((r) => category(r.key)[1]))];
  const data = filter === "All" ? rules : rules.filter((r) => category(r.key)[1] === filter);

  return (
    <>
      <PageTitle
        eyebrow="Administration"
        title="Reference rules"
        sub="The thresholds, fees, document lists and drop-down lists the system checks against. Every change is a new version with a reason; earlier versions are kept."
      />
      <Card
        title={`Rules (${rules.length})`}
        extra={<Segmented value={filter} onChange={(v) => setFilter(String(v))} options={cats} />}
        styles={{ body: { padding: 0 } }}
      >
        <Table
          rowKey="key"
          pagination={false}
          dataSource={data}
          locale={{ emptyText: <Empty description="No rules" /> }}
          onRow={(r) => ({ onClick: () => { setOpenKey(r.key); setTab("edit"); }, style: { cursor: "pointer" } })}
          columns={[
            {
              title: "Rule",
              dataIndex: "key",
              render: (k, r) => (
                <span>
                  <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{k}</span> <Tag color={category(k)[2]}>{category(k)[1]}</Tag>
                  <div className="muted" style={{ fontSize: 12.5 }}>{r.versions[0].description}</div>
                </span>
              ),
            },
            { title: "Current value", render: (_, r) => <span style={{ fontSize: 12.5 }}>{summary(r.key, r.versions[0].value)}</span> },
            { title: "Version", align: "right", render: (_, r) => <span className="tnum">v{r.versions[0].version}</span> },
            { title: "Effective", render: (_, r) => <span style={{ whiteSpace: "nowrap" }}>{fmtDate(r.versions[0].effectiveFrom)}</span> },
            {
              title: "",
              align: "right",
              render: (_, r) => (
                <span style={{ whiteSpace: "nowrap" }}>
                  <Button size="small" icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); setOpenKey(r.key); setTab("edit"); }}>
                    Edit
                  </Button>{" "}
                  <Button size="small" icon={<HistoryOutlined />} onClick={(e) => { e.stopPropagation(); setOpenKey(r.key); setTab("history"); }}>
                    History ({r.versions.length})
                  </Button>
                </span>
              ),
            },
          ]}
        />
      </Card>
      <div className="faint" style={{ fontSize: 12.5, marginTop: 10 }}>
        Reference lists (provinces, universities) feed the drop-downs on the institution forms, so data is not typed freehand. Saving a new version takes effect at once.
      </div>

      <Drawer
        title={open ? <span className="mono">{open.key}</span> : null}
        open={!!open}
        onClose={() => setOpenKey(null)}
        size="large"
        destroyOnHidden
      >
        {open ? (
          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
              { key: "edit", label: "Edit as a new version", children: <Editor key={`${open.key}@${open.versions[0].version}`} rule={open} onSaved={() => setTab("history")} /> },
              { key: "history", label: `Version history (${open.versions.length})`, children: <History rule={open} /> },
            ]}
          />
        ) : null}
      </Drawer>
    </>
  );
}
