// NOC / accreditation workflow as an explicit state machine.
// The flow follows PCP's draft; who may move each step is the proposed permission matrix.

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_SCRUTINY: "Under scrutiny",
  DEFICIENCY_RAISED: "Deficiency raised",
  RESPONDED: "Institution responded",
  INSPECTION_SCHEDULED: "Inspection scheduled",
  INSPECTION_SUBMITTED: "Inspection report submitted",
  COUNCIL_REVIEW: "Awaiting council decision",
  APPROVED: "Approved by council",
  DEFERRED: "Deferred by council",
  REJECTED: "Rejected by council",
  NOC_ISSUED: "Certificate issued",
};

export const STATUS_COLORS: Record<string, string> = {
  DRAFT: "default",
  SUBMITTED: "blue",
  UNDER_SCRUTINY: "geekblue",
  DEFICIENCY_RAISED: "orange",
  RESPONDED: "gold",
  INSPECTION_SCHEDULED: "purple",
  INSPECTION_SUBMITTED: "purple",
  COUNCIL_REVIEW: "cyan",
  APPROVED: "green",
  DEFERRED: "volcano",
  REJECTED: "red",
  NOC_ISSUED: "green",
};

export const STEPS = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_SCRUTINY",
  "INSPECTION_SCHEDULED",
  "INSPECTION_SUBMITTED",
  "COUNCIL_REVIEW",
  "NOC_ISSUED",
] as const;

export function stepIndex(status: string): number {
  if (status === "DEFICIENCY_RAISED" || status === "RESPONDED") return 2;
  if (status === "APPROVED" || status === "DEFERRED" || status === "REJECTED") return 5;
  const i = (STEPS as readonly string[]).indexOf(status);
  return i < 0 ? 0 : i;
}

type Transition = { from: string[]; to: string; roles: string[]; label: string };

export const TRANSITIONS: Transition[] = [
  { from: ["DRAFT"], to: "SUBMITTED", roles: ["inst_poc"], label: "Submit to PCP" },
  { from: ["SUBMITTED"], to: "UNDER_SCRUTINY", roles: ["pcp_officer"], label: "Start scrutiny" },
  { from: ["UNDER_SCRUTINY", "DEFERRED", "RESPONDED"], to: "DEFICIENCY_RAISED", roles: ["pcp_officer"], label: "Raise deficiency" },
  { from: ["DEFICIENCY_RAISED"], to: "RESPONDED", roles: ["inst_poc"], label: "Respond" },
  { from: ["RESPONDED"], to: "UNDER_SCRUTINY", roles: ["pcp_officer"], label: "Accept responses" },
  { from: ["UNDER_SCRUTINY"], to: "INSPECTION_SCHEDULED", roles: ["pcp_officer"], label: "Schedule inspection" },
  { from: ["INSPECTION_SCHEDULED"], to: "INSPECTION_SUBMITTED", roles: ["pcp_inspector"], label: "Submit inspection report" },
  { from: ["INSPECTION_SUBMITTED"], to: "COUNCIL_REVIEW", roles: ["pcp_officer"], label: "Forward to council" },
  { from: ["COUNCIL_REVIEW"], to: "APPROVED", roles: ["pcp_secretary"], label: "Record: approved" },
  { from: ["COUNCIL_REVIEW"], to: "DEFERRED", roles: ["pcp_secretary"], label: "Record: deferred" },
  { from: ["COUNCIL_REVIEW"], to: "REJECTED", roles: ["pcp_secretary"], label: "Record: rejected" },
  { from: ["APPROVED"], to: "NOC_ISSUED", roles: ["pcp_secretary"], label: "Issue certificate" },
];

export function canTransition(from: string, to: string, roles: string[]) {
  return TRANSITIONS.some((t) => t.from.includes(from) && t.to === to && t.roles.some((r) => roles.includes(r)));
}

export function assertTransition(from: string, to: string, roles: string[]) {
  if (!canTransition(from, to, roles)) {
    throw new Error(`Not allowed: ${STATUS_LABELS[from] ?? from} → ${STATUS_LABELS[to] ?? to} for your role`);
  }
}

export const OPEN_STATUSES = [
  "SUBMITTED",
  "UNDER_SCRUTINY",
  "DEFICIENCY_RAISED",
  "RESPONDED",
  "INSPECTION_SCHEDULED",
  "INSPECTION_SUBMITTED",
  "COUNCIL_REVIEW",
  "APPROVED",
  "DEFERRED",
];

export const KIND_LABELS: Record<string, string> = {
  NOC: "NOC",
  ACCREDITATION: "Accreditation",
  RENEWAL: "Renewal",
};

export const PROGRAM_LABELS: Record<string, string> = {
  PHARMD: "PharmD",
  TECH: "Pharmacy Technician",
};
