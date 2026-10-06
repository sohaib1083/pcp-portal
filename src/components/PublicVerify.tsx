"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Empty, Input, Tabs } from "antd";
import { BankOutlined, CheckCircleFilled, EnvironmentOutlined, QrcodeOutlined, UserOutlined } from "@ant-design/icons";
import { PublicFrame } from "./PublicHome";
import { Pill, fmtDate, programLabel } from "./common";

type Result = { code: string; name: string; city: string; province: string; status: string; programs: { type: string; noc: string; nocNumber: string | null; acc: string; until: string | null }[] };

export default function PublicVerify({ q, reg, results, searched }: { q: string; reg: string; results: Result[]; searched: boolean }) {
  const router = useRouter();
  const [cert, setCert] = useState("");
  return (
    <PublicFrame title="Public verification" sub="Check an institution's approved programs and accreditation, or confirm that a PCP certificate is genuine. Only the fields PCP's draft allows are shown.">
      <div style={{ background: "#fff", borderRadius: 20, border: "1px solid var(--line)", boxShadow: "var(--shadow-md)", padding: "8px 24px 24px" }}>
        <Tabs
          size="large"
          defaultActiveKey={reg ? "pharmacist" : "institution"}
          items={[
            {
              key: "institution",
              label: (
                <span>
                  <BankOutlined /> Institution
                </span>
              ),
              children: (
                <>
                  <Input.Search
                    size="large"
                    defaultValue={q}
                    placeholder="Institution name or PCP ID, e.g. Riverside or PCP-UNI-000101"
                    enterButton="Verify"
                    onSearch={(v) => router.push(`/verify?q=${encodeURIComponent(v)}`)}
                    style={{ maxWidth: 640, marginBottom: 20 }}
                  />
                  {searched && results.length === 0 ? <Empty description="No institution found. It may not be registered with PCP." /> : null}
                  <div style={{ display: "grid", gap: 14 }}>
                    {results.map((r) => (
                      <div key={r.code} style={{ border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "14px 18px", background: "#fafcfb", borderBottom: "1px solid var(--line)" }}>
                          <div>
                            <div style={{ fontWeight: 650, fontSize: 16 }}>{r.name}</div>
                            <div className="muted" style={{ fontSize: 13 }}>
                              <span className="mono">{r.code}</span> · <EnvironmentOutlined /> {r.city}, {r.province}
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                            Institution status <Pill value={r.status} />
                          </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 1, background: "var(--line)" }}>
                          {r.programs.map((p) => (
                            <div key={p.type} style={{ background: "#fff", padding: "14px 18px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, marginBottom: 8 }}>
                                {p.noc === "APPROVED" ? <CheckCircleFilled style={{ color: "var(--good)" }} /> : null}
                                {programLabel(p.type)}
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", rowGap: 6, fontSize: 13 }}>
                                <span className="muted">NOC</span>
                                <span>
                                  <Pill value={p.noc} /> {p.nocNumber ? <span className="mono">{p.nocNumber}</span> : null}
                                </span>
                                <span className="muted">Accreditation</span>
                                <span>
                                  <Pill value={p.acc} />
                                </span>
                                <span className="muted">Valid until</span>
                                <span>{fmtDate(p.until)}</span>
                              </div>
                            </div>
                          ))}
                          {r.programs.length === 0 ? <div style={{ background: "#fff", padding: 18 }} className="muted">No approved programs yet.</div> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ),
            },
            {
              key: "certificate",
              label: (
                <span>
                  <QrcodeOutlined /> Certificate
                </span>
              ),
              children: (
                <div style={{ maxWidth: 640 }}>
                  <p className="muted" style={{ marginTop: 0 }}>Scan the QR code on a PCP certificate, or type its number.</p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Input size="large" value={cert} onChange={(e) => setCert(e.target.value)} placeholder="e.g. NOC-PHARMD-2005-0011" />
                    <Button size="large" type="primary" disabled={!cert.trim()} onClick={() => router.push(`/verify/certificate/${encodeURIComponent(cert.trim())}`)}>
                      Check
                    </Button>
                  </div>
                </div>
              ),
            },
            {
              key: "pharmacist",
              label: (
                <span>
                  <UserOutlined /> Pharmacist
                </span>
              ),
              children: (
                <>
                  <Input.Search size="large" defaultValue={reg} placeholder="Registration number" enterButton="Verify" onSearch={(v) => router.push(`/verify?reg=${encodeURIComponent(v)}`)} style={{ maxWidth: 640, marginBottom: 16 }} />
                  <Alert
                    type="info"
                    showIcon
                    style={{ maxWidth: 760 }}
                    message="Pharmacist registration is held by the provincial pharmacy councils"
                    description="Under the Pharmacy Act 1967, provincial councils license pharmacists. This search goes live once their registers are linked through MoUs or APIs, and will show only name, registration number, category, status and validity."
                  />
                </>
              ),
            },
          ]}
        />
      </div>
    </PublicFrame>
  );
}
