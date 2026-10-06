// Simplified role model (decided 4 Oct 2026):
// - one focal person (POC) account per institution does everything on the institution side
// - four PCP roles; only the Super Admin manages users and institutions (tenants)

export const ROLE_LABELS: Record<string, string> = {
  inst_poc: "Institution Focal Person (POC)",
  pcp_admin: "PCP Super Admin",
  pcp_officer: "PCP Officer",
  pcp_inspector: "PCP Inspector",
  pcp_secretary: "PCP Secretary (Council)",
};

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  inst_poc: "Runs the institution's account: faculty, students, applications, fees, deficiency responses",
  pcp_admin: "Creates and disables users, onboards institutions, reads the audit log. Takes no case decisions",
  pcp_officer: "Processes applications: scrutiny, deficiencies, data verification, inspection scheduling, forwarding to council",
  pcp_inspector: "Sees and fills only the inspections assigned to them (can be a third-party firm)",
  pcp_secretary: "Records council decisions and issues certificates",
};

const INST = ["inst_poc"];
const PCP_ALL = ["pcp_admin", "pcp_officer", "pcp_inspector", "pcp_secretary"];

export const PERMISSIONS = {
  // Institution side (always scoped to the user's own institution)
  "inst.dashboard": INST,
  "inst.faculty.view": INST,
  "inst.faculty.edit": INST,
  "inst.students.view": INST,
  "inst.students.edit": INST,
  "inst.app.view": INST,
  "inst.app.edit": INST,
  "inst.app.submit": INST,
  "inst.fee.pay": INST,
  "inst.deficiency.respond": INST,
  "inst.documents.view": INST,
  "inst.documents.upload": INST,

  // PCP side
  "pcp.dashboard": ["pcp_admin", "pcp_officer", "pcp_secretary"],
  "pcp.app.view": ["pcp_admin", "pcp_officer", "pcp_secretary"],
  "pcp.app.scrutiny": ["pcp_officer"],
  "pcp.inspection.schedule": ["pcp_officer"],
  "pcp.inspection.submit": ["pcp_inspector"],
  "pcp.council.decide": ["pcp_secretary"],
  "pcp.noc.issue": ["pcp_secretary"],
  "pcp.faculty.verify": ["pcp_officer"],
  "pcp.documents.view": ["pcp_admin", "pcp_officer", "pcp_secretary"],
  "pcp.documents.verify": ["pcp_officer"],
  "pcp.audit.view": ["pcp_admin", "pcp_secretary"],
  "pcp.users.manage": ["pcp_admin"],
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

export function primaryRole(roles: string[]) {
  return roles.find((r) => ROLE_LABELS[r]) ?? "unknown";
}
