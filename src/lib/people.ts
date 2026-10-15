// People as users (RFP 4.1.2): server helpers for faculty self-service, student requests and council files.
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { publicUrl, renderLetter } from "./letters";
import { PROGRAMME_YEARS } from "./registry-shared";
import { STUDENT_DOCUMENT } from "./people-shared";
import { PROGRAM_LABELS } from "./workflow";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | Tx;

const TABLES = { FUR: "faculty_requests", SRQ: "student_requests", PCF: "council_files" } as const;

/** Next reference PREFIX-YYYY-NNNN for one of this module's tables. */
export async function nextPeopleRef(exec: Executor, prefix: keyof typeof TABLES) {
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const res = await exec.execute(sql`select coalesce(max(split_part(ref, '-', 3)::int), 0) as n from ${sql.identifier(TABLES[prefix])} where ref like ${like}`);
  return `${prefix}-${year}-${String(Number((res.rows[0] as { n: number }).n) + 1).padStart(4, "0")}`;
}

/** Next student certificate number SC-YYYY-NNNNNN. */
export async function nextCertificateNo(exec: Executor) {
  const year = new Date().getFullYear();
  const res = await exec.execute(sql`select coalesce(max(split_part(certificate_no, '-', 3)::int), 0) as n from student_requests where certificate_no like ${`SC-${year}-%`}`);
  return `SC-${year}-${String(Number((res.rows[0] as { n: number }).n) + 1).padStart(6, "0")}`;
}

export const studentCheckUrl = (no: string) => publicUrl(`/verify/student/${encodeURIComponent(no)}`);

/** The faculty record linked to a faculty login, or null. */
export async function facultyForUser(username: string) {
  const acc = await db.query.facultyAccounts.findFirst({ where: eq(schema.facultyAccounts.username, username) });
  if (!acc) return null;
  return (await db.query.faculty.findFirst({ where: eq(schema.faculty.id, acc.facultyId) })) ?? null;
}

type Student = typeof schema.students.$inferSelect;
type Inst = typeof schema.institutions.$inferSelect;

const STATUS_WORDS: Record<string, string> = { ENROLLED: "enrolled", PROMOTED: "enrolled (promoted)", REPEAT: "enrolled (repeating the year)", GRADUATED: "graduated", WITHDRAWN: "withdrawn" };

/** The letter or certificate a student request produces: a PDF with a QR code that opens the public check. No CNIC. */
export async function studentCertificatePdf(o: { kind: string; no: string; student: Student; inst: Inst; purpose?: string; signedBy: { name: string; title: string }; issuedAt?: Date }) {
  const s = o.student;
  const programme = PROGRAM_LABELS[s.programType] ?? s.programType;
  const len = PROGRAMME_YEARS[s.programType] ?? 5;
  const eligibility = o.kind === "ELIGIBILITY";
  return renderLetter({
    kind: STUDENT_DOCUMENT[o.kind] ?? "Certificate",
    refNo: o.no,
    date: o.issuedAt,
    to: { name: s.fullName, lines: [`Student ID ${s.pcpId}`, `${o.inst.name}, ${o.inst.city}`] },
    subject: eligibility ? `Eligibility for registration as a pharmacist: ${s.fullName}` : `Enrolment verification: ${s.fullName}`,
    paragraphs: eligibility
      ? [
          `The Pharmacy Council of Pakistan certifies that ${s.fullName}, student ID ${s.pcpId}, completed the ${programme} programme at ${o.inst.name} in ${s.resultYear ?? "the year shown"}, and that the degree was confirmed with the university and the Higher Education Commission.`,
          `${s.fullName} is eligible to apply for registration as a pharmacist with a provincial pharmacy council. Registration itself is granted by the provincial council.`,
          "Anyone can check this certificate by scanning the QR code or opening the address under it. The check shows the name, student ID, institution, programme and status. It never shows the CNIC.",
        ]
      : [
          `The Pharmacy Council of Pakistan confirms that ${s.fullName}, student ID ${s.pcpId}, is ${STATUS_WORDS[s.status] ?? s.status.toLowerCase()} in the ${programme} programme at ${o.inst.name}, ${o.inst.city}, in year ${Math.min(s.currentYear, len)} of ${len} (${s.shift} session), enrolled in ${s.enrollmentYear}.`,
          o.purpose ? `This letter was requested for: ${o.purpose}.` : "This letter was requested by the student.",
          "Anyone can check this letter by scanning the QR code or opening the address under it. The check shows the name, student ID, institution, programme and status. It never shows the CNIC.",
        ],
    table: [
      ["Name", s.fullName],
      ["Student ID", s.pcpId],
      ["Institution", `${o.inst.name} (${o.inst.code})`],
      ["Programme", `${programme}, ${s.shift} session`],
      ["Status", eligibility ? "Graduated, degree verified, eligible for registration" : (STATUS_WORDS[s.status] ?? s.status)],
    ],
    signatory: { name: o.signedBy.name, title: o.signedBy.title, signedAt: o.issuedAt },
    qrUrl: studentCheckUrl(o.no),
    qrCaption: "Scan to check this certificate",
  });
}
