"use client";
import Link from "next/link";
import { Button } from "antd";
import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, LockOutlined, SearchOutlined } from "@ant-design/icons";
import { STUDENT_DOCUMENT } from "@/lib/people-shared";
import { PublicFrame } from "./PublicHome";
import { fmtDate, programLabel } from "./common";

type Found = { kind: string; issuedAt: string | null; name: string; studentId: string; institution: string; institutionCode: string; city: string; programType: string; status: string; eligible: boolean; degreeVerified: boolean };

const STATUS: Record<string, string> = { ENROLLED: "Enrolled", PROMOTED: "Enrolled (promoted)", REPEAT: "Enrolled (repeating the year)", GRADUATED: "Graduated", WITHDRAWN: "Withdrawn" };

/** Labels in English and Urdu (RFP 4.1.18.6: English and Urdu labels on public screens). */
function Label({ en, ur }: { en: string; ur: string }) {
  return (
    <span className="muted">
      {en}{" "}
      <span lang="ur" dir="rtl" style={{ fontSize: 12.5 }}>
        {ur}
      </span>
    </span>
  );
}

/** Public check of a student certificate or enrolment letter. Shows the record's status today, never the CNIC. */
export default function StudentCertificateVerify({ no, found }: { no: string; found: Found | null }) {
  const eligibility = found?.kind === "ELIGIBILITY";
  const good = found ? (eligibility ? found.eligible && found.degreeVerified : found.status !== "WITHDRAWN") : false;
  const tone = !found ? { c: "#b4141f", bg: "#fff1f0", bd: "#ffccc7", icon: <CloseCircleFilled /> } : good ? { c: "#0d7a3d", bg: "#e9f7ef", bd: "#c9ecd8", icon: <CheckCircleFilled /> } : { c: "#a15c00", bg: "#fff7e6", bd: "#ffe1a8", icon: <ExclamationCircleFilled /> };
  const title = !found
    ? "No certificate with this number"
    : good
      ? `Valid ${STUDENT_DOCUMENT[found.kind]?.toLowerCase() ?? "certificate"}`
      : eligibility
        ? "This certificate no longer matches the register"
        : "The student is no longer enrolled";
  const status = !found ? "" : eligibility && found.eligible ? "Graduated, degree verified, eligible for registration as a pharmacist" : (STATUS[found.status] ?? found.status);
  return (
    <PublicFrame title="Check a student certificate" sub="Certificates and letters PCP issues to students carry a QR code that opens this page. It shows the status in PCP's register today.">
      <div data-testid="student-verify" style={{ maxWidth: 760, margin: "0 auto", background: "#fff", borderRadius: 20, border: "1px solid var(--line)", boxShadow: "var(--shadow-md)", overflow: "hidden" }}>
        <div style={{ background: tone.bg, borderBottom: `1px solid ${tone.bd}`, padding: "28px 28px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 52, color: tone.c, lineHeight: 1 }}>{tone.icon}</div>
          <h2 data-testid="verify-result" style={{ margin: "12px 0 4px", fontSize: 24, letterSpacing: "-0.02em", color: tone.c }}>
            {title}
          </h2>
          <div className="mono" style={{ fontSize: 14, color: "var(--ink-2)", wordBreak: "break-all" }}>
            {no}
          </div>
        </div>
        {found ? (
          <div style={{ padding: "22px 28px 26px" }}>
            <div className="pub-kv" data-testid="student-verify-fields">
              <Label en="Name" ur="نام" />
              <span>
                <b>{found.name}</b>
              </span>
              <Label en="Student ID" ur="طالب علم شناختی نمبر" />
              <span className="mono">{found.studentId}</span>
              <Label en="Institution" ur="ادارہ" />
              <span>
                {found.institution}, {found.city} <span className="mono muted">{found.institutionCode}</span>
              </span>
              <Label en="Programme" ur="پروگرام" />
              <span>{programLabel(found.programType)}</span>
              <Label en="Status" ur="حیثیت" />
              <span>
                <b style={{ color: tone.c }}>{status}</b>
              </span>
              <Label en="Issued" ur="جاری کردہ" />
              <span>{fmtDate(found.issuedAt)}</span>
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: "18px 0 0" }}>
              <LockOutlined /> This check never shows a CNIC, phone number, email or address. Compare the name and student ID with the paper you were given.
            </p>
          </div>
        ) : (
          <div style={{ padding: "22px 28px 26px", textAlign: "center" }}>
            <p style={{ margin: "0 0 16px", color: "var(--ink-2)" }}>
              PCP has not issued a student certificate with the number <b>{no}</b>. A paper showing this number may be forged.
            </p>
            <Link href="/verify">
              <Button icon={<SearchOutlined />}>Search the public register instead</Button>
            </Link>
          </div>
        )}
      </div>
    </PublicFrame>
  );
}
