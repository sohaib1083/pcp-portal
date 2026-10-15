// People as users (RFP 4.1.2): labels and stages shared by server and screens. Pure: safe in client components.

export const STUDENT_REQUEST_KINDS = ["CORRECTION", "ENROLMENT_LETTER", "ELIGIBILITY"] as const;
export type StudentRequestKind = (typeof STUDENT_REQUEST_KINDS)[number];

export const STUDENT_REQUEST_LABELS: Record<string, string> = {
  CORRECTION: "Correct my record",
  ENROLMENT_LETTER: "Enrolment verification letter",
  ELIGIBILITY: "Eligibility certificate for pharmacist registration",
};

/** Short names for narrow places (card titles on a phone). */
export const STUDENT_REQUEST_SHORT: Record<string, string> = { CORRECTION: "Correct my record", ENROLMENT_LETTER: "Enrolment letter", ELIGIBILITY: "Eligibility certificate" };

export const STUDENT_REQUEST_HELP: Record<string, string> = {
  CORRECTION: "A wrong name, father's name or session on your record. Attach evidence, for example your CNIC or B-Form or the admission letter.",
  ENROLMENT_LETTER: "A letter from PCP confirming that you are enrolled, for example for a scholarship, a visa or a bank.",
  ELIGIBILITY: "After you graduate and your degree is checked with the university and HEC. Your provincial pharmacy council asks for it when you apply for registration.",
};

/** The document each request produces. */
export const STUDENT_DOCUMENT: Record<string, string> = {
  ENROLMENT_LETTER: "Enrolment verification letter",
  ELIGIBILITY: "Eligibility certificate",
};

export const STUDENT_STATUS_LABELS: Record<string, string> = {
  WITH_INSTITUTION: "With your institution",
  WITH_PCP: "With PCP",
  ISSUED: "Issued",
  APPLIED: "Corrected",
  RETURNED: "Returned by the institution",
  REJECTED: "Not approved by PCP",
  WITHDRAWN: "Withdrawn",
};

export const STUDENT_FIELD_LABELS: Record<string, string> = { fullName: "Full name", fatherName: "Father's name", shift: "Session" };

/** Stage index for the request tracker: 0 sent, 1 institution, 2 PCP, 3 done. */
export function studentStage(status: string) {
  if (status === "WITH_INSTITUTION") return 1;
  if (status === "WITH_PCP") return 2;
  if (status === "RETURNED") return 1;
  return 3;
}

export const FACULTY_REQUEST_LABELS: Record<string, string> = {
  PROFILE: "Qualification or profile update",
  VERIFICATION: "Verification of my record",
  ATTACHMENT: "Institutional attachment",
};

export const FACULTY_FIELD_LABELS: Record<string, string> = {
  qualification: "Highest qualification",
  specialization: "Specialization",
  pcpRegNo: "Pharmacist registration no.",
  designation: "Designation",
};

export const FACULTY_STATUS_LABELS: Record<string, string> = {
  PENDING: "With PCP",
  APPROVED: "Approved",
  REJECTED: "Not approved",
  WITHDRAWN: "Withdrawn",
  FORWARDED: "Sent as a registry request",
};

export const PRACTICE_STATUS_LABELS: Record<string, string> = {
  WITH_COUNCIL: "With the provincial council",
  PENDING: "With PCP",
  VERIFIED: "Verified",
  REJECTED: "Not accepted",
  WITHDRAWN: "Replaced",
};

export const COUNCIL_FILE_STATUS: Record<string, string> = { WITH_PCP: "With PCP registration", LOADED: "Loaded into the register", RETURNED: "Returned by PCP" };

/** Student certificate numbers look like SC-2026-000123; the public check opens /verify/student/<no>. */
export const isStudentCertificateNo = (v: string) => /^SC-\d{4}-\d{6}$/.test(v);
