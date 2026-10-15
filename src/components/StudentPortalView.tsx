"use client";
import Link from "next/link";
import { Alert, Card, Col, Empty, Row, Steps } from "antd";
import { BookOutlined, CalendarOutlined, SafetyCertificateOutlined, TrophyOutlined } from "@ant-design/icons";
import { PROGRAMME_YEARS } from "@/lib/registry-shared";
import { KV, PageTitle, StatCard, programLabel } from "./common";
import { RegStatus } from "./registry-ui";

type StudentRecord = {
  pcpId: string;
  fullName: string;
  fatherName: string;
  cnic: string;
  institution: string;
  institutionCode: string;
  city: string;
  programType: string;
  shift: string;
  enrollmentYear: number;
  currentYear: number;
  status: string;
  result: string | null;
  resultYear: number | null;
  degreeVerified: boolean;
  eligible: boolean;
};

const STATUS_TEXT: Record<string, string> = {
  ENROLLED: "Enrolled",
  PROMOTED: "Promoted",
  REPEAT: "Repeating the year",
  GRADUATED: "Graduated",
  WITHDRAWN: "Withdrawn",
};

export default function StudentPortalView({ name, record: r }: { name: string; record: StudentRecord | null }) {
  if (!r)
    return (
      <>
        <PageTitle eyebrow="Student" title="My PCP record" />
        <Card>
          <Empty description={`No student record is linked to your login yet, ${name}. Ask your institution's examination office to link your PCP student ID to your account.`} />
        </Card>
      </>
    );
  const len = PROGRAMME_YEARS[r.programType] ?? 5;
  const stage = r.eligible ? 4 : r.status === "GRADUATED" ? 3 : 1;
  const next = r.eligible
    ? "You are eligible to apply for registration as a pharmacist. Apply to your provincial pharmacy council and quote your PCP student ID."
    : r.status === "GRADUATED"
      ? "Your institution asks the university and HEC to confirm your degree. Once it is confirmed, you become eligible for registration. To get your eligibility certificate, request it below: your institution confirms the degree when it forwards the request."
      : r.status === "WITHDRAWN"
        ? "Your record shows that you withdrew from the programme. If this is wrong, contact your institution's examination office."
        : `Your institution records your result after each annual examination. You graduate after passing year ${len}.`;

  return (
    <>
      <PageTitle eyebrow="Student" title="My PCP record" sub="Your record in the PCP student registry. It is read-only: your institution keeps it and PCP checks it." />
      <div
        data-testid="student-card"
        style={{ borderRadius: 18, overflow: "hidden", border: "1px solid var(--line)", boxShadow: "var(--shadow-md)", background: "#fff", marginBottom: 18 }}
      >
        <div style={{ background: "linear-gradient(120deg, var(--forest) 0%, var(--brand) 100%)", color: "#fff", padding: "18px 22px", display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.7 }}>PCP student ID</div>
            <div className="mono" style={{ fontSize: 24, fontWeight: 700, letterSpacing: "0.02em", marginTop: 4, color: "#fff" }}>
              {r.pcpId}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 18, fontWeight: 650 }}>{r.fullName}</div>
            <div style={{ fontSize: 12.5, opacity: 0.8 }}>Father: {r.fatherName}</div>
          </div>
        </div>
        <div style={{ padding: "16px 22px" }}>
          <KV
            rows={[
              ["Institution", <span key="i">{r.institution}, {r.city} <span className="mono faint">{r.institutionCode}</span></span>],
              ["Programme", programLabel(r.programType)],
              ["Session", r.shift],
              ["Enrolled", r.enrollmentYear],
              ["CNIC / B-Form", <span key="c" className="mono">{r.cnic}</span>],
            ]}
          />
        </div>
      </div>

      <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
        <Col xs={12} md={6}>
          <StatCard label="Year of study" value={r.status === "GRADUATED" ? "Completed" : `Year ${r.currentYear} of ${len}`} icon={<CalendarOutlined />} />
        </Col>
        <Col xs={12} md={6}>
          <StatCard label="Status" value={<RegStatus value={r.status} label={STATUS_TEXT[r.status]} />} icon={<BookOutlined />} tone="info" />
        </Col>
        <Col xs={12} md={6}>
          <StatCard label="Latest result" value={r.result ? <span><RegStatus value={r.result} /> <span style={{ fontSize: 14, fontWeight: 500 }}>{r.resultYear}</span></span> : "No result yet"} icon={<TrophyOutlined />} tone="gold" />
        </Col>
        <Col xs={12} md={6}>
          <StatCard
            label="Degree check"
            value={r.status !== "GRADUATED" ? "After graduation" : r.degreeVerified ? <RegStatus value="VERIFIED" label="Verified" /> : <RegStatus value="PENDING" label="In progress" />}
            icon={<SafetyCertificateOutlined />}
            tone="violet"
          />
        </Col>
      </Row>

      <Card title="Your progress" style={{ marginBottom: 18 }}>
        <Steps
          current={stage}
          status={r.status === "WITHDRAWN" ? "error" : r.eligible ? "finish" : "process"}
          items={[
            { title: "Enrolled, ID issued", content: String(r.enrollmentYear) },
            { title: "Results", content: r.result ? `${r.result === "PASS" ? "Pass" : "Fail"} ${r.resultYear}` : "Each year" },
            { title: "Graduated", content: r.status === "GRADUATED" ? `${r.resultYear}` : `After year ${len}` },
            { title: "Degree check", content: r.degreeVerified ? "University and HEC" : "Not yet" },
            { title: "Eligible for registration", content: r.eligible ? "Yes" : "Not yet" },
          ]}
        />
        <Alert style={{ marginTop: 18 }} type={r.eligible ? "success" : "info"} showIcon title={r.eligible ? "Eligible for registration" : "What happens next"} description={next} />
      </Card>
      <div className="muted" style={{ fontSize: 13 }}>
        Something wrong? Raise a correction request below, or write to PCP through the <Link href="/student/help">help desk</Link>.
      </div>
    </>
  );
}
