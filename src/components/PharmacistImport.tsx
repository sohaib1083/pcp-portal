"use client";
// Import from a provincial council: choose the council, upload its CSV (or generate a sample), read the
// row-by-row report, then import only the rows without errors (guide section 14, bulk upload with an error report).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Empty, Segmented, Select, Table, Upload } from "antd";
import { CheckCircleFilled, CloseCircleFilled, CloudUploadOutlined, DownloadOutlined, ExclamationCircleFilled, ReloadOutlined, ThunderboltOutlined } from "@ant-design/icons";
import Papa from "papaparse";
import Link from "next/link";
import { checkImport, runImport, sampleImport, type PharmacistNadraRow } from "@/app/actions/pharmacists";
import type { ImportReport, ImportRow } from "@/lib/pharmacist-import";
import { COUNCIL_INFO, COUNCILS, type Council } from "@/lib/register";
import { StatusDot, fmtDate } from "./common";

export type ImportHistory = { id: number; ref: string; council: string; fileName: string; totalRows: number; importedRows: number; errorRows: number; errors: { row: number; regNo: string; errors: string[] }[]; importedBy: string; createdAt: string };

const TEMPLATE_COLUMNS = ["registration_no", "full_name", "father_name", "cnic", "gender", "category", "university", "graduation_year", "issue_date", "valid_until", "status", "mobile", "email", "address"];

function download(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PharmacistImport({ canManage, history }: { canManage: boolean; history: ImportHistory[] }) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [council, setCouncil] = useState<Council | undefined>();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [view, setView] = useState<"all" | "errors" | "ready">("all");
  const [done, setDone] = useState<{ ok: boolean; message: string; nadra?: PharmacistNadraRow[] } | null>(null);
  const [busy, start] = useTransition();

  const check = (c: Council, f: { name: string; text: string }) =>
    start(async () => {
      setDone(null);
      setProblem(null);
      setReport(null);
      setFile(f);
      const r = await checkImport(c, f.name, f.text);
      if (!r.ok) {
        setProblem(r.message ?? "The file could not be read.");
        return;
      }
      setReport(r as ImportReport);
      setView((r as ImportReport).withErrors ? "errors" : "all");
    });

  const generate = () =>
    council &&
    start(async () => {
      const r = await sampleImport(council);
      if (!r.ok || !r.csv || !r.fileName) return void message.error(r.message ?? "Could not make a sample file.");
      check(council, { name: r.fileName, text: r.csv });
    });

  const doImport = () => {
    if (!council || !file || !report) return;
    modal.confirm({
      title: `Import ${report.ready} ready ${report.ready === 1 ? "row" : "rows"} from the ${COUNCIL_INFO[council].name}?`,
      content: report.withErrors
        ? `${report.withErrors} ${report.withErrors === 1 ? "row has" : "rows have"} errors and will be left out. The council's registrar gets the error report by email to correct and send again.`
        : "Every row passed the checks.",
      okText: `Import ${report.ready} ${report.ready === 1 ? "row" : "rows"}`,
      onOk: () =>
        new Promise<void>((resolve) =>
          start(async () => {
            const r = await runImport(council, file.name, file.text);
            setDone({ ok: r.ok, message: r.message, nadra: r.nadra });
            if (r.ok) {
              setReport(null);
              setFile(null);
            } else message.error(r.message);
            router.refresh();
            resolve();
          }),
        ),
    });
  };

  const errorReport = () => {
    if (!report) return;
    const rows = report.rows.filter((r) => r.errors.length).map((r) => [r.row, r.regNo, r.name, r.errors.join("; ")]);
    download(file?.name.replace(/\.csv$/i, "") + "-errors.csv", Papa.unparse({ fields: ["row", "registration_no", "name", "errors"], data: rows }));
  };

  const template = () => {
    const c = council ?? "Punjab";
    const example = [COUNCIL_INFO[c].example.replace(/\d{3}$/, "999"), "Full Name", "Father Name", `${COUNCIL_INFO[c].cnicPrefix}-1234567-1`, "F", "A", "Ravi Bank University", "2022", "2023-02-14", "2028-12-31", "Active", "0300-1234567", "name@example.pk", "House 1, Street 2, City"];
    download(`pcp-pharmacist-import-template-${COUNCIL_INFO[c].code.toLowerCase()}.csv`, Papa.unparse({ fields: TEMPLATE_COLUMNS, data: [example] }));
  };

  const shown = report ? report.rows.filter((r) => (view === "errors" ? r.errors.length : view === "ready" ? !r.errors.length : true)) : [];

  return (
    <>
      {canManage ? (
        <Card
          data-testid="import-card"
          title={
            <span>
              <CloudUploadOutlined style={{ color: "var(--brand)", marginInlineEnd: 8 }} />
              Import from a provincial council
            </span>
          }
          extra={
            <Button size="small" icon={<DownloadOutlined />} onClick={template}>
              Download the template
            </Button>
          }
          style={{ marginBottom: 16 }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 900 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <b style={{ fontWeight: 600 }}>1. Which council sent the file?</b>
              <Select
                id="import-council"
                value={council}
                placeholder="Choose the council"
                onChange={(v) => {
                  setCouncil(v);
                  setReport(null);
                  setProblem(null);
                  setDone(null);
                }}
                options={COUNCILS.map((c) => ({ value: c, label: COUNCIL_INFO[c].name }))}
                style={{ width: 300, maxWidth: "100%" }}
              />
              {council ? (
                <span className="muted" style={{ fontSize: 12.5 }}>
                  Numbers look like <span className="mono">{COUNCIL_INFO[council].pattern}</span>
                </span>
              ) : null}
            </div>
            <div>
              <b style={{ fontWeight: 600, display: "block", marginBottom: 8 }}>2. Upload its CSV file</b>
              <Upload.Dragger
                accept=".csv,text/csv"
                disabled={!council || busy}
                showUploadList={false}
                multiple={false}
                beforeUpload={(f) => {
                  if (council) f.text().then((text) => check(council, { name: f.name, text }));
                  return false;
                }}
              >
                <p style={{ margin: 0, fontSize: 26, color: "var(--brand)" }}>
                  <CloudUploadOutlined />
                </p>
                <p style={{ margin: "4px 0 0", fontWeight: 500 }}>{council ? "Drop the council's CSV file here, or click to choose it" : "Choose the council first"}</p>
                <p className="muted" style={{ margin: "2px 0 0", fontSize: 12.5 }}>
                  One row per pharmacist, up to 1,000 rows. Every row is checked before anything is saved.
                </p>
              </Upload.Dragger>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
                <Button icon={<ThunderboltOutlined />} disabled={!council} loading={busy && !report} onClick={generate} style={{ borderColor: "#e3c97f", color: "#8a6a1c", background: "#fffbf0" }}>
                  Generate sample file
                </Button>
                <span className="muted" style={{ fontSize: 12.5 }}>
                  Demo: makes a file in the council&apos;s format with new numbers and a few deliberate mistakes.
                </span>
              </div>
            </div>
            {problem ? <Alert type="error" showIcon title="The file could not be checked" description={problem} /> : null}
            {done ? <Alert type={done.ok ? "success" : "error"} showIcon title={done.message} data-testid="import-done" /> : null}
            {done?.nadra?.length ? (
              <div data-testid="import-nadra" style={{ marginTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                  <b style={{ fontWeight: 600 }}>NADRA check of the rows added</b>
                  <span className="faint" style={{ fontSize: 12 }}>Simulated NADRA check · differences go to PCP&apos;s verification desk</span>
                </div>
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={done.nadra}
                  columns={[
                    { title: "Row", dataIndex: "row", width: 56 },
                    { title: "Pharmacist", render: (_, n) => <Link href={`/pcp/pharmacists/${n.id}`}>{n.name}<div className="faint mono" style={{ fontSize: 11.5 }}>{n.regNo}</div></Link> },
                    {
                      title: "NADRA result",
                      render: (_, n) =>
                        n.status === "MATCH" ? (
                          <StatusDot tone="good">NADRA verified</StatusDot>
                        ) : n.status === "NAME_MISMATCH" ? (
                          <StatusDot tone="warn">{`Name differs at NADRA: ${n.nadraName}`}</StatusDot>
                        ) : (
                          <StatusDot tone="bad">Not found at NADRA</StatusDot>
                        ),
                    },
                  ]}
                />
              </div>
            ) : null}
          </div>

          {report ? (
            <div style={{ marginTop: 18 }} data-testid="import-report">
              <b style={{ fontWeight: 600, display: "block", marginBottom: 8 }}>3. Check the report, then import the ready rows</b>
              <Alert
                type={report.withErrors ? "warning" : "success"}
                showIcon
                style={{ marginBottom: 12 }}
                title={
                  <span>
                    <span className="mono">{report.fileName}</span>: {report.total} rows. <b>{report.ready} ready</b>
                    {report.withWarnings ? ` (${report.withWarnings} with a warning)` : ""}, <b>{report.withErrors} with errors</b>.
                  </span>
                }
                description={report.withErrors ? "Rows with errors are not imported. Download the error report, or let the import email it to the council." : "Every row passed. Nothing is saved until you import."}
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                <Segmented
                  value={view}
                  onChange={(v) => setView(v as typeof view)}
                  options={[
                    { value: "all", label: `All (${report.total})` },
                    { value: "errors", label: `Errors (${report.withErrors})` },
                    { value: "ready", label: `Ready (${report.ready})` },
                  ]}
                />
                <span style={{ marginInlineStart: "auto", display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
                  <Button icon={<ReloadOutlined />} onClick={() => (setReport(null), setFile(null))}>
                    Choose another file
                  </Button>
                  {report.withErrors ? (
                    <Button icon={<DownloadOutlined />} onClick={errorReport}>
                      Download error report
                    </Button>
                  ) : null}
                  <Button type="primary" icon={<CloudUploadOutlined />} disabled={!report.ready} loading={busy} onClick={doImport}>
                    Import {report.ready} ready {report.ready === 1 ? "row" : "rows"}
                  </Button>
                </span>
              </div>
              <Table<ImportRow>
                rowKey="row"
                size="small"
                bordered={false}
                dataSource={shown}
                pagination={{ pageSize: 50, hideOnSinglePage: true }}
                style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}
                columns={[
                  { title: "Row", dataIndex: "row", width: 60, render: (v) => <span className="tnum">{v}</span> },
                  { title: "Registration no.", dataIndex: "regNo", render: (v) => <span className="mono">{v}</span> },
                  { title: "Name", dataIndex: "name" },
                  {
                    title: "Check",
                    render: (_, r) =>
                      r.errors.length ? (
                        <div style={{ display: "grid", gap: 2 }}>
                          {r.errors.map((e) => (
                            <span key={e} style={{ color: "#b4141f", fontSize: 12.5 }}>
                              <CloseCircleFilled /> {e}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div style={{ display: "grid", gap: 2 }}>
                          <span style={{ color: "#0d7a3d", fontSize: 12.5 }}>
                            <CheckCircleFilled /> Ready
                          </span>
                          {r.warnings.map((w) => (
                            <span key={w} style={{ color: "#a15c00", fontSize: 12.5 }}>
                              <ExclamationCircleFilled /> {w}
                            </span>
                          ))}
                        </div>
                      ),
                  },
                ]}
              />
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card title={`Files received (${history.length})`} styles={{ body: { padding: 0 } }}>
        <Table<ImportHistory>
          rowKey="id"
          dataSource={history}
          pagination={false}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No council file imported yet" /> }}
          expandable={{
            rowExpandable: (r) => r.errors.length > 0,
            expandedRowRender: (r) => (
              <div style={{ display: "grid", gap: 4, fontSize: 12.5 }}>
                {r.errors.map((e) => (
                  <div key={`${e.row}-${e.regNo}`}>
                    <span className="faint">Row {e.row}</span> <span className="mono">{e.regNo}</span>: <span style={{ color: "#b4141f" }}>{e.errors.join("; ")}</span>
                  </div>
                ))}
              </div>
            ),
          }}
          columns={[
            { title: "Reference", dataIndex: "ref", render: (v) => <span className="mono">{v}</span> },
            { title: "Council", dataIndex: "council" },
            { title: "File", dataIndex: "fileName", render: (v) => <span className="mono" style={{ fontSize: 11.5 }}>{v}</span>, responsive: ["lg"] },
            { title: "Rows", dataIndex: "totalRows", align: "right", render: (v) => <span className="tnum">{v}</span> },
            { title: "Added", dataIndex: "importedRows", align: "right", render: (v) => <span className="tnum" style={{ color: "#0d7a3d" }}>{v}</span> },
            { title: "Returned", dataIndex: "errorRows", align: "right", render: (v) => <span className="tnum" style={{ color: v ? "#b4141f" : undefined }}>{v}</span> },
            { title: "By", dataIndex: "importedBy", responsive: ["md"] },
            { title: "Date", dataIndex: "createdAt", render: (v) => fmtDate(v) },
          ]}
        />
      </Card>
    </>
  );
}
