// Role model from PCP's working guide (PCP_Digitisation_updated.pdf, section 2).
// Institution: people inside one institutional account have jobs, not a shared password.
// PCP: separate duties; the Super Administrator manages users and rules, not cases.
// External: students and pharmacists see their own record; the public verifies.
//
// `inst_poc` is the Head of institution (the account each institution starts with).
// `pcp_officer` is a case officer who holds all four officer duties at once, so a small PCP team
// can run the whole workflow; the four separate officer roles exist for a fuller team.

export const ROLE_LABELS: Record<string, string> = {
  inst_poc: "Head of institution",
  inst_principal: "Principal or Dean",
  inst_dept_admin: "Department administrator",
  inst_data_entry: "Data-entry officer",
  inst_exam: "Examination officer",
  inst_finance: "Finance officer",
  inst_applicant: "Institution applicant",
  pcp_admin: "PCP Super administrator",
  pcp_secretary: "PCP Secretary (Council)",
  pcp_registration: "Registration officer",
  pcp_coordinator: "Inspection coordinator",
  pcp_inspector: "Inspection panel member",
  pcp_accounts: "Accounts officer",
  pcp_verification: "Verification officer",
  pcp_officer: "PCP Officer (all officer duties)",
  pcp_technical: "Technical officer",
  pcp_legal: "Legal officer",
  provincial_council: "Provincial council officer",
  faculty: "Faculty member",
  student: "Student",
  pharmacist: "Registered pharmacist",
};

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  inst_poc: "Submits applications, sees decisions, manages the institution's users",
  inst_principal: "Confirms programme data, responds to deficiencies, submits applications",
  inst_dept_admin: "Maintains campuses, laboratories and library",
  inst_data_entry: "Enters faculty and student drafts; cannot submit without a second check",
  inst_exam: "Files annual results and evidence; cannot change a locked year",
  inst_finance: "Pays fees and sees dues; cannot alter academic records",
  inst_applicant: "Completes institution onboarding; nothing else opens until PCP approves",
  pcp_admin: "Users, roles and reference rules. Takes no case decisions",
  pcp_secretary: "Council agenda, decisions and certificates",
  pcp_registration: "Institution onboarding, case scrutiny and the pharmacist register",
  pcp_coordinator: "Inspection teams, conflict checks, schedules, report receipt",
  pcp_inspector: "Checklist, photos and remarks for their own assigned visits only",
  pcp_accounts: "Fees, receipts, reconciliation and outstanding dues",
  pcp_verification: "Documents, faculty qualifications, duplicate checks, annual returns",
  pcp_officer: "Holds the registration, verification and coordination duties together",
  pcp_technical: "Technical (academic) review of cases against standards, postgraduate proformas and supervisor eligibility",
  pcp_legal: "Court cases and litigation: hearings, counsel, orders and their effect on decisions",
  provincial_council: "Oversees institutions and pharmacists in one province: validation routing and regional reports",
  faculty: "Keeps their own academic profile current, declares institutional attachments, requests verification",
  student: "Sees their own PCP ID, enrolment and result status",
  pharmacist: "Sees their registration and updates practice details, subject to verification",
};

export const INST_ROLES = ["inst_poc", "inst_principal", "inst_dept_admin", "inst_data_entry", "inst_exam", "inst_finance"] as const;
export const PCP_ROLES = ["pcp_admin", "pcp_secretary", "pcp_registration", "pcp_coordinator", "pcp_inspector", "pcp_accounts", "pcp_verification", "pcp_officer", "pcp_technical", "pcp_legal"] as const;

const INST = [...INST_ROLES] as string[];
const PCP_ALL = [...PCP_ROLES] as string[];
const HEAD = ["inst_poc"];
const SENIOR = ["inst_poc", "inst_principal"];
const PCP_DESK = ["pcp_admin", "pcp_secretary", "pcp_registration", "pcp_coordinator", "pcp_accounts", "pcp_verification", "pcp_officer", "pcp_technical", "pcp_legal"];

export const PERMISSIONS = {
  // ---------- Institution side (always scoped to the user's own institution) ----------
  "inst.dashboard": INST,
  "inst.profile.edit": ["inst_poc", "inst_principal", "inst_dept_admin"], // campuses, labs, library
  "inst.faculty.view": INST,
  "inst.faculty.edit": ["inst_poc", "inst_principal", "inst_dept_admin", "inst_data_entry"],
  "inst.students.view": ["inst_poc", "inst_principal", "inst_data_entry", "inst_exam"],
  "inst.students.edit": ["inst_poc", "inst_data_entry", "inst_exam"],
  "inst.annual.file": ["inst_poc", "inst_exam"],
  "inst.app.view": INST,
  "inst.app.edit": ["inst_poc", "inst_principal", "inst_dept_admin", "inst_data_entry"],
  "inst.app.submit": SENIOR, // the second check: data entry cannot submit
  "inst.fee.pay": ["inst_poc", "inst_finance"],
  "inst.deficiency.respond": ["inst_poc", "inst_principal", "inst_dept_admin"],
  "inst.appeal.file": SENIOR,
  "inst.documents.view": INST,
  "inst.documents.upload": ["inst_poc", "inst_principal", "inst_dept_admin", "inst_data_entry", "inst_exam"],
  "inst.users.manage": HEAD,
  "inst.helpdesk": INST,

  // ---------- PCP side ----------
  "pcp.dashboard": PCP_DESK,
  "pcp.app.view": PCP_DESK,
  "pcp.app.scrutiny": ["pcp_registration", "pcp_officer"], // scrutiny, deficiencies, technical review, forward
  "pcp.inspection.schedule": ["pcp_coordinator", "pcp_officer"],
  "pcp.inspection.view": ["pcp_coordinator", "pcp_officer", "pcp_inspector", "pcp_secretary", "pcp_admin"],
  "pcp.inspection.submit": ["pcp_inspector"],
  "pcp.council.manage": ["pcp_secretary"],
  "pcp.council.decide": ["pcp_secretary"],
  "pcp.noc.issue": ["pcp_secretary"],
  "pcp.faculty.verify": ["pcp_verification", "pcp_officer"],
  "pcp.annual.review": ["pcp_verification", "pcp_officer"],
  "pcp.documents.view": PCP_DESK,
  "pcp.documents.verify": ["pcp_verification", "pcp_officer"],
  "pcp.onboarding.review": ["pcp_registration", "pcp_officer"],
  "pcp.pharmacists.manage": ["pcp_registration", "pcp_officer"],
  "pcp.accounts.manage": ["pcp_accounts"],
  "pcp.accounts.view": ["pcp_accounts", "pcp_admin", "pcp_secretary", "pcp_officer"],
  "pcp.appeals.review": ["pcp_registration", "pcp_officer", "pcp_secretary"],
  "pcp.helpdesk": ["pcp_admin", "pcp_registration", "pcp_officer", "pcp_secretary", "pcp_accounts", "pcp_verification", "pcp_coordinator"],
  "pcp.reports.view": PCP_DESK,
  "pcp.audit.view": ["pcp_admin", "pcp_secretary"],
  "pcp.users.manage": ["pcp_admin"],
  "pcp.rules.manage": ["pcp_admin"],
  // Added for the Oct 2026 RFP (4.1.1, 4.1.2, 4.1.10)
  "pcp.technical.review": ["pcp_technical", "pcp_registration", "pcp_officer"], // technical review stage, PG proformas, supervisors
  "pcp.litigation.view": ["pcp_legal", "pcp_secretary", "pcp_admin", "pcp_officer", "pcp_technical"],
  "pcp.litigation.manage": ["pcp_legal", "pcp_secretary"],
  "pcp.correspondence.view": PCP_DESK,
  "pcp.correspondence.manage": ["pcp_registration", "pcp_secretary", "pcp_officer", "pcp_legal"],

  // ---------- External ----------
  "student.self": ["student"],
  "pharmacist.self": ["pharmacist"],
  "applicant.self": ["inst_applicant"],
  "province.dashboard": ["provincial_council"],
  "faculty.self": ["faculty"],
} as const satisfies Record<string, string[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(roles: string[], permission: Permission): boolean {
  const allowed = PERMISSIONS[permission] as readonly string[];
  return roles.some((r) => allowed.includes(r));
}

export function isInstitutionUser(roles: string[]) {
  return roles.some((r) => INST.includes(r));
}

export function isPcpUser(roles: string[]) {
  return roles.some((r) => PCP_ALL.includes(r));
}

export type UserKind = "institution" | "pcp" | "province" | "faculty" | "student" | "pharmacist" | "applicant" | "unknown";

export function kindOf(roles: string[]): UserKind {
  if (isInstitutionUser(roles)) return "institution";
  if (isPcpUser(roles)) return "pcp";
  if (roles.includes("provincial_council")) return "province";
  if (roles.includes("faculty")) return "faculty";
  if (roles.includes("student")) return "student";
  if (roles.includes("pharmacist")) return "pharmacist";
  if (roles.includes("inst_applicant")) return "applicant";
  return "unknown";
}

/** The role shown on the user's chip: the first one with a label, in the order of ROLE_LABELS. */
export function primaryRole(roles: string[]) {
  return Object.keys(ROLE_LABELS).find((r) => roles.includes(r)) ?? "unknown";
}

/** Where each kind of user lands after sign-in. */
export const HOME_BY_KIND: Record<UserKind, string> = {
  institution: "/institution",
  pcp: "/pcp",
  province: "/province",
  faculty: "/faculty",
  student: "/student",
  pharmacist: "/pharmacist",
  applicant: "/onboarding",
  unknown: "/login",
};
