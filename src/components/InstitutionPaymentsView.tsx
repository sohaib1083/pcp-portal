"use client";
// Institution: pay dues and challans (simulated bank), see receipts at once (guide sections 2, 4 and 14).
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import dayjs from "dayjs";
import { Alert, App, Button, Card, Col, Empty, Modal, Row, Segmented, Space, Table } from "antd";
import { BankOutlined, CheckCircleFilled, CreditCardOutlined, FilePdfOutlined, FileSearchOutlined, QrcodeOutlined, SafetyCertificateOutlined, StopOutlined, WalletOutlined } from "@ant-design/icons";
import { payChallan, startDuePayment, type ChallanInfo, type ReceiptInfo } from "@/app/actions/accounts";
import { formatPKR } from "@/lib/format";
import { useOtp } from "./OtpConfirm";
import { KV, PageTitle, StatCard, StatusDot, fmtDate } from "./common";

type Payment = {
  id: number;
  psid: string;
  receiptNo: string | null;
  purpose: string;
  category: string;
  caseRef: string | null;
  amount: number;
  status: string;
  method: string | null;
  paidAt: string | null;
  createdAt: string;
  reconciledAt: string | null;
  receiptDocumentId: number | null;
};
type Due = { id: number; ref: string; description: string; amount: number; dueDate: string; status: string; note: string | null; createdAt: string; psid: string | null; receiptNo: string | null; receiptDocumentId: number | null };

const METHODS = [
  { value: "RAAST_QR", label: "Raast QR" },
  { value: "INTERNET_BANKING", label: "Internet banking (PSID)" },
  { value: "BANK_BRANCH", label: "Bank branch (PSID)" },
];
const METHOD_LABEL: Record<string, string> = { RAAST_QR: "Raast QR", INTERNET_BANKING: "Internet banking", BANK_BRANCH: "Bank branch" };
const raast = (c: ChallanInfo) => `RAAST-P2M|DEMO|PAYEE:PHARMACY COUNCIL OF PAKISTAN|PSID:${c.psid}|AMOUNT:${c.amount}`;

function Qr({ text, size = 120 }: { text: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(text, { width: size * 2, margin: 1, color: { dark: "#0a3d2e" } }).then(setSrc);
  }, [text, size]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="Raast QR (demo)" width={size} height={size} style={{ flex: "none" }} /> : <div style={{ width: size, height: size, background: "#f2f4f3", borderRadius: 8 }} />;
}

export default function InstitutionPaymentsView({ institution, canPay, payments, dues }: { institution: { name: string; code: string; shortCode: string }; canPay: boolean; payments: Payment[]; dues: Due[] }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const { withOtp, otpModal } = useOtp();
  const [paying, setPaying] = useState<ChallanInfo | null>(null);
  const [method, setMethod] = useState("RAAST_QR");
  const [receipt, setReceipt] = useState<ReceiptInfo | null>(null);

  const outstanding = dues.filter((d) => d.status === "OUTSTANDING");
  const open = payments.filter((p) => p.status === "PENDING");
  const receipts = payments.filter((p) => p.receiptNo);
  const year = String(new Date().getFullYear());
  const paidThisYear = receipts.filter((p) => (p.paidAt ?? "").startsWith(year));
  const owed = outstanding.reduce((a, d) => a + d.amount, 0);
  const settled = dues.filter((d) => d.status !== "OUTSTANDING");

  const payDue = (d: Due) =>
    start(async () => {
      const r = await startDuePayment(d.id);
      if (!r.ok || !r.challan) return void message.error(r.message);
      setMethod("RAAST_QR");
      setPaying(r.challan);
      router.refresh();
    });

  const confirm = (c: ChallanInfo) =>
    withOtp(`payment:${c.psid}`, `Pay ${formatPKR(c.amount)} to PCP`, async (code) => {
      const r = await payChallan(c.psid, method, code);
      if (!r.ok || !r.receipt) {
        message.error(r.message, 6);
        return;
      }
      message.success(r.message);
      setPaying(null);
      setReceipt(r.receipt);
      router.refresh();
    });

  return (
    <>
      {otpModal}
      <PageTitle eyebrow="With PCP" title="Payments & dues" sub="Pay PCP fees and dues by Raast QR or PSID challan. The bank confirms the payment and your receipt is issued at once." />

      {outstanding.length ? (
        <Alert
          type="error"
          showIcon
          icon={<StopOutlined />}
          style={{ marginBottom: 16 }}
          data-testid="dues-block"
          title={`Outstanding dues of ${formatPKR(owed)} block new submissions`}
          description={`Until ${outstanding.length === 1 ? "this due is" : "these dues are"} paid or waived, PCP cannot accept a new application from ${institution.name}. ${canPay ? "Pay below." : "Your Finance officer or Head of institution can pay."} If you dispute a due, raise it with Accounts, PCP through the Help desk.`}
        />
      ) : null}

      <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
        <Col xs={12} lg={6}>
          <StatCard compact label="Outstanding dues" value={formatPKR(owed)} tone={owed ? "bad" : "neutral"} icon={<StopOutlined />} hint={owed ? `${outstanding.length} due${outstanding.length === 1 ? "" : "s"}, blocks submissions` : "Nothing owed"} />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard compact label="Unpaid challans" value={open.length} tone={open.length ? "warn" : "neutral"} icon={<QrcodeOutlined />} hint={open.length ? formatPKR(open.reduce((a, p) => a + p.amount, 0)) : "None waiting"} />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard compact label={`Paid in ${year}`} value={formatPKR(paidThisYear.reduce((a, p) => a + p.amount, 0))} icon={<WalletOutlined />} hint={`${paidThisYear.length} payment${paidThisYear.length === 1 ? "" : "s"}`} />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard compact label="Receipts" value={receipts.length} tone="info" icon={<FilePdfOutlined />} hint={`${receipts.filter((p) => p.status === "RECONCILED").length} reconciled by PCP`} />
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            title={
              <span>
                <StopOutlined style={{ color: outstanding.length ? "#b4141f" : "var(--brand)", marginRight: 8 }} />
                Outstanding dues
              </span>
            }
            style={{ height: "100%" }}
            data-testid="outstanding-dues"
          >
            {outstanding.length ? (
              <div style={{ display: "grid", gap: 10 }}>
                {outstanding.map((d) => {
                  const overdue = dayjs(d.dueDate).isBefore(dayjs(), "day");
                  return (
                    <div key={d.id} data-testid={`due-${d.ref}`} style={{ border: `1px solid ${overdue ? "#ffccc7" : "var(--line)"}`, borderRadius: 12, padding: 14, background: overdue ? "#fffafa" : "#fff" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                        <div style={{ minWidth: 0 }}>
                          <div className="mono faint" style={{ fontSize: 11.5 }}>{d.ref}</div>
                          <div style={{ fontWeight: 500, marginTop: 2 }}>{d.description}</div>
                          <div style={{ fontSize: 12.5, marginTop: 4, color: overdue ? "#b4141f" : "var(--muted)" }}>
                            Due {fmtDate(d.dueDate)}
                            {overdue ? " · overdue" : ""}
                            {d.psid ? <span className="muted"> · challan issued</span> : null}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flex: "none" }}>
                          <div className="tnum" style={{ fontSize: 20, fontWeight: 700 }}>{formatPKR(d.amount)}</div>
                          {canPay ? (
                            <Button type="primary" size="small" style={{ marginTop: 6 }} icon={<CreditCardOutlined />} loading={pending} onClick={() => payDue(d)}>
                              Pay this due
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!canPay ? <div className="faint" style={{ fontSize: 12.5 }}>Your role can see dues but not pay them. The Finance officer or Head of institution pays.</div> : null}
              </div>
            ) : (
              <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 14px", borderRadius: 12, background: "var(--good-50)", color: "#0d7a3d" }}>
                <CheckCircleFilled style={{ fontSize: 20 }} />
                <span>No outstanding dues. Nothing blocks your submissions.</span>
              </div>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title={
              <span>
                <QrcodeOutlined style={{ color: "var(--brand)", marginRight: 8 }} />
                Unpaid challans
              </span>
            }
            style={{ height: "100%" }}
            data-testid="pending-challans"
          >
            {open.length ? (
              <div style={{ display: "grid", gap: 10 }}>
                {open.map((p) => (
                  <div key={p.id} style={{ display: "flex", gap: 14, alignItems: "center", padding: 12, border: "1px dashed var(--line)", borderRadius: 12 }}>
                    <Qr text={raast({ psid: p.psid, amount: p.amount, purpose: p.purpose })} size={96} />
                    <div style={{ minWidth: 0, flex: 1, fontSize: 13 }}>
                      <div style={{ fontWeight: 500 }}>{p.purpose}</div>
                      <div className="muted" style={{ marginTop: 4 }}>PSID (1Link)</div>
                      <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{p.psid}</div>
                      <div className="tnum" style={{ fontWeight: 700, fontSize: 16, marginTop: 4 }}>{formatPKR(p.amount)}</div>
                    </div>
                    {canPay ? (
                      <Button
                        type="primary"
                        onClick={() => {
                          setMethod("RAAST_QR");
                          setPaying({ psid: p.psid, amount: p.amount, purpose: p.purpose });
                        }}
                      >
                        Pay now
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No unpaid challans. A case fee challan is generated from the case; a due's challan from Pay this due." />
            )}
          </Card>
        </Col>
      </Row>

      <Card
        style={{ marginTop: 16 }}
        title={
          <span>
            <FilePdfOutlined style={{ color: "var(--brand)", marginRight: 8 }} />
            Receipts
          </span>
        }
        extra={<span className="faint" style={{ fontSize: 12.5 }}>Each receipt carries a QR code anyone can scan to confirm it</span>}
        styles={{ body: { padding: 0 } }}
      >
        <Table
          rowKey="id"
          dataSource={receipts}
          pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }}
          data-testid="receipts-table"
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No receipts yet" /> }}
          columns={[
            { title: "Receipt", dataIndex: "receiptNo", render: (v, r) => <span><span className="mono" style={{ fontWeight: 600, fontSize: 12.5 }}>{v}</span><div className="faint mono" style={{ fontSize: 11 }}>PSID {r.psid}</div></span> },
            {
              title: "Purpose",
              dataIndex: "purpose",
              render: (v: string, r) => (
                <span>
                  {r.category}
                  <div className="faint" style={{ fontSize: 12 }}>
                    {r.caseRef ? <Link href={`/institution/applications/${r.caseRef}`}>{r.caseRef}</Link> : v.split(" · ").slice(1).join(" · ")}
                  </div>
                </span>
              ),
            },
            { title: "Amount", dataIndex: "amount", align: "right", render: (v) => <b className="tnum" style={{ whiteSpace: "nowrap" }}>{formatPKR(v)}</b> },
            { title: "Paid", dataIndex: "paidAt", render: (v, r) => <span style={{ whiteSpace: "nowrap" }}>{fmtDate(v, true)}<div className="faint" style={{ fontSize: 12 }}>{METHOD_LABEL[r.method ?? ""] ?? r.method}</div></span> },
            { title: "Status", dataIndex: "status", render: (v, r) => (v === "RECONCILED" ? <StatusDot tone="good">{`Reconciled by PCP ${fmtDate(r.reconciledAt)}`}</StatusDot> : <StatusDot tone="info">Paid</StatusDot>) },
            {
              title: "",
              key: "a",
              align: "right",
              render: (_, r) => (
                <Space size={14} style={{ whiteSpace: "nowrap" }}>
                  {r.receiptDocumentId ? (
                    <a href={`/api/documents/${r.receiptDocumentId}`} target="_blank" rel="noreferrer">
                      <FilePdfOutlined /> Download
                    </a>
                  ) : null}
                  <a href={`/verify/receipt/${r.receiptNo}`} target="_blank" rel="noreferrer">
                    <SafetyCertificateOutlined /> Check
                  </a>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      {settled.length ? (
        <Card style={{ marginTop: 16 }} title="Settled dues" styles={{ body: { padding: 0 } }}>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={settled}
            columns={[
              { title: "Due", dataIndex: "ref", render: (v) => <span className="mono">{v}</span> },
              { title: "Description", dataIndex: "description" },
              { title: "Amount", dataIndex: "amount", align: "right", render: (v) => <span className="tnum">{formatPKR(v)}</span> },
              { title: "Outcome", dataIndex: "status", render: (v, d) => (v === "PAID" ? <StatusDot tone="good">{`Paid · ${d.receiptNo ?? ""}`}</StatusDot> : <span><StatusDot tone="neutral">Waived by PCP</StatusDot><div className="faint" style={{ fontSize: 12, marginTop: 2 }}>{d.note}</div></span>) },
            ]}
          />
        </Card>
      ) : null}

      {/* Pay: challan with PSID and Raast QR, then the simulated bank confirmation */}
      <Modal
        open={!!paying}
        width={600}
        title={
          <span>
            <BankOutlined style={{ color: "var(--brand)", marginRight: 8 }} />
            Pay {paying ? formatPKR(paying.amount) : ""} to PCP
          </span>
        }
        onCancel={() => setPaying(null)}
        footer={[
          <Button key="c" onClick={() => setPaying(null)}>
            Pay later
          </Button>,
          <Button key="p" type="primary" icon={<CreditCardOutlined />} onClick={() => paying && confirm(paying)} data-testid="pay-now">
            Pay {paying ? formatPKR(paying.amount) : ""} now (simulated bank)
          </Button>,
        ]}
        destroyOnHidden
      >
        {paying ? (
          <>
            <div style={{ marginBottom: 12, fontWeight: 500 }}>{paying.purpose}</div>
            <div style={{ display: "flex", gap: 16, alignItems: "center", padding: 14, border: "1px dashed var(--line)", borderRadius: 12 }}>
              <Qr text={raast(paying)} size={132} />
              <div style={{ fontSize: 13 }}>
                <div className="muted">PSID (1Link)</div>
                <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }} data-testid="pay-psid">{paying.psid}</div>
                <div className="tnum" style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{formatPKR(paying.amount)}</div>
                <div className="muted" style={{ marginTop: 6 }}>Scan with any banking app that supports Raast, or quote the PSID in internet banking or at a branch.</div>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <div className="pcp-section-title" style={{ marginBottom: 6 }}>How you are paying</div>
              <Segmented value={method} onChange={(v) => setMethod(String(v))} options={METHODS} />
            </div>
            <Alert style={{ marginTop: 14 }} type="info" showIcon title="Demo: no money moves. Pressing Pay stands in for the bank's confirmation, which arrives seconds after a real Raast payment. A one-time code confirms it." />
          </>
        ) : null}
      </Modal>

      {/* Receipt, shown immediately after the bank confirms */}
      <Modal
        open={!!receipt}
        width={620}
        onCancel={() => setReceipt(null)}
        footer={[
          <Button key="d" type="primary" href={receipt?.documentId ? `/api/documents/${receipt.documentId}` : undefined} target="_blank" icon={<FilePdfOutlined />} disabled={!receipt?.documentId} data-testid="receipt-download">
            Download receipt (PDF)
          </Button>,
          <Button key="v" href={receipt ? `/verify/receipt/${receipt.receiptNo}` : undefined} target="_blank" icon={<FileSearchOutlined />}>
            Check it on the public page
          </Button>,
          <Button key="c" onClick={() => setReceipt(null)}>
            Done
          </Button>,
        ]}
        destroyOnHidden
      >
        {receipt ? (
          <div data-testid="receipt-modal">
            <div style={{ textAlign: "center", padding: "6px 0 16px" }}>
              <CheckCircleFilled style={{ fontSize: 46, color: "#12a150" }} />
              <h3 style={{ margin: "10px 0 2px", fontSize: 20 }}>Payment confirmed</h3>
              <div className="muted">The receipt is issued and filed in your documents.</div>
            </div>
            <KV
              rows={[
                ["Receipt no.", <span key="r" className="mono" style={{ fontWeight: 600 }} data-testid="receipt-no">{receipt.receiptNo}</span>],
                ["Amount", <b key="a">{formatPKR(receipt.amount)}</b>],
                ["Purpose", receipt.purpose],
                ["PSID", <span key="p" className="mono">{receipt.psid}</span>],
                ["Method", receipt.method],
                ["Bank reference", <span key="b" className="mono">{receipt.bankRef}</span>],
                ["Paid at", fmtDate(receipt.paidAt, true)],
              ]}
            />
          </div>
        ) : null}
      </Modal>
    </>
  );
}
