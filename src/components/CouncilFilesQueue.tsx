"use client";
// PCP registration: register files the provincial councils validated and sent through the portal
// (validation routing, RFP 4.1.2). Loading one runs the normal import; each row records the council's validation.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Input, Modal, Table, Tag } from "antd";
import { CheckOutlined, UndoOutlined } from "@ant-design/icons";
import { loadCouncilFile, returnCouncilFile } from "@/app/actions/people";
import { fmtDate } from "./common";
import { useOtp } from "./OtpConfirm";
import { RegStatus, useBusy } from "./registry-ui";

export type CouncilFileRow = { id: number; ref: string; council: string; councilName: string; fileName: string; totalRows: number; readyRows: number; errorRows: number; note: string | null; status: string; submittedBy: string; submittedAt: string; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; importRef: string | null };

export default function CouncilFilesQueue({ files, canManage }: { files: CouncilFileRow[]; canManage: boolean }) {
  const { message } = App.useApp();
  const router = useRouter();
  const { withOtp, otpModal } = useOtp();
  const [busy, run] = useBusy();
  const [returning, setReturning] = useState<CouncilFileRow | null>(null);
  const [note, setNote] = useState("");
  const waiting = files.filter((f) => f.status === "WITH_PCP");
  const load = (f: CouncilFileRow) =>
    withOtp(`decision:${f.ref}`, `Load ${f.ref} into the register`, (code) =>
      run(async () => {
        const r = await loadCouncilFile(f.id, code);
        message[r.ok ? (r.level === "warning" ? "warning" : "success") : "error"](r.message, 8);
        router.refresh();
      }),
    );
  const sendBack = () =>
    returning &&
    withOtp(`decision:${returning.ref}`, `Return ${returning.ref} to the council`, (code) =>
      run(async () => {
        const r = await returnCouncilFile(returning.id, note, code);
        message[r.ok ? "success" : "error"](r.message, 7);
        if (r.ok) setReturning(null);
        router.refresh();
      }),
    );
  if (!files.length)
    return (
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title="Councils with an officer on the portal validate their register files and send them here; you then load them. Use the import below for a file that reached PCP another way."
      />
    );
  return (
    <>
      {otpModal}
      <Card title={`Files validated by provincial councils (${waiting.length} waiting)`} styles={{ body: { padding: 0 } }} style={{ marginBottom: 16 }} data-testid="council-files-queue">
        <Table
          rowKey="id"
          size="small"
          dataSource={files}
          pagination={files.length > 6 ? { pageSize: 6, showSizeChanger: false } : false}
          scroll={{ x: true }}
          columns={[
            { title: "File", render: (_, f) => <span><span className="mono">{f.ref}</span><div className="faint" style={{ fontSize: 12 }}>{f.fileName}</div></span> },
            { title: "Council", render: (_, f) => <span><Tag color="purple" style={{ marginInlineEnd: 0 }}>Validated by the {f.councilName}</Tag><div className="faint" style={{ fontSize: 12 }}>{f.submittedBy} · {fmtDate(f.submittedAt)}</div></span> },
            { title: "Rows", render: (_, f) => <span className="tnum" style={{ fontSize: 12.5 }}>{f.readyRows} ready{f.errorRows ? ` · ${f.errorRows} with errors stay out` : ""}</span>, responsive: ["md"] },
            {
              title: "",
              align: "right",
              render: (_, f) =>
                f.status === "WITH_PCP" ? (
                  canManage ? (
                    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <Button type="primary" size="small" icon={<CheckOutlined />} disabled={busy} onClick={() => load(f)}>
                        Load into the register
                      </Button>
                      <Button size="small" danger icon={<UndoOutlined />} disabled={busy} onClick={() => { setNote(""); setReturning(f); }}>
                        Return
                      </Button>
                    </span>
                  ) : (
                    <RegStatus value="PENDING" label="Waiting" />
                  )
                ) : (
                  <span>
                    <RegStatus value={f.status === "LOADED" ? "ACCEPTED" : "RETURNED"} label={f.status === "LOADED" ? `Loaded as ${f.importRef}` : "Returned"} />
                    {f.decisionNote ? <div className="faint" style={{ fontSize: 12 }}>{f.decisionNote}</div> : null}
                  </span>
                ),
            },
          ]}
        />
      </Card>
      <Modal
        open={!!returning}
        title={`Return ${returning?.ref ?? ""} to the ${returning?.councilName ?? "council"}`}
        okText="Continue"
        okButtonProps={{ danger: true, disabled: note.trim().length < 10 }}
        onCancel={() => setReturning(null)}
        onOk={sendBack}
        destroyOnHidden
      >
        <p style={{ marginTop: 0 }}>Nothing is loaded. The council&apos;s officer sees your note.</p>
        <Input.TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (required), e.g. The file repeats last month's rows" aria-label="Reason" />
      </Modal>
    </>
  );
}
