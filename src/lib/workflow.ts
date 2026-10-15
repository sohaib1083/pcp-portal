// NOC / accreditation / renewal workflow as an explicit state machine (guide section 4 table).
// Each step is owned by a permission from src/lib/roles.ts, so a role with that duty can move it.
import { PERMISSIONS, can, type Permission } from "./roles";

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_SCRUTINY: "Under scrutiny",
  DEFICIENCY_RAISED: "Deficiency raised",
  RESPONDED: "Institution responded",
  TECHNICAL_REVIEW: "Technical review",
  INSPECTION_SCHEDULED: "Inspection scheduled",
  INSPECTION_SUBMITTED: "Inspection report submitted",
  COUNCIL_REVIEW: "Awaiting council decision",
  APPROVED: "Approved by council",
  DEFERRED: "Deferred by council",
  REJECTED: "Rejected by council",
  NOC_ISSUED: "Certificate issued",
};

/** Short stage names for the service-level clock ("Scrutiny · 4 days left"). */
export const STAGE_LABELS: Record<string, string> = {
  SUBMITTED: "Awaiting scrutiny",
  UNDER_SCRUTINY: "Scrutiny",
  DEFICIENCY_RAISED: "Deficiency response",
  RESPONDED: "Response review",
  TECHNICAL_REVIEW: "Technical review",
  INSPECTION_SCHEDULED: "Inspection report",
  INSPECTION_SUBMITTED: "Report review",
  COUNCIL_REVIEW: "Council",
  APPROVED: "Certificate issue",
  DEFERRED: "Deferral",
};

export const STATUS_COLORS: Record<string, string> = {
  DRAFT: "default",
  SUBMITTED: "blue",
  UNDER_SCRUTINY: "geekblue",
  DEFICIENCY_RAISED: "orange",
  RESPONDED: "gold",
  TECHNICAL_REVIEW: "geekblue",
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
  "TECHNICAL_REVIEW",
  "INSPECTION_SCHEDULED",
  "INSPECTION_SUBMITTED",
  "COUNCIL_REVIEW",
  "NOC_ISSUED",
] as const;

/** Labels for the case header track, one per STEPS entry. */
export const TRACK_LABELS = ["Draft", "Submitted", "Scrutiny", "Technical review", "Inspection", "Report", "Council", "Certificate"];

/** Where a status sits on the track. A deficiency sits on the stage it was raised from (`origin`). */
export function stepIndex(status: string, origin?: string | null): number {
  if (status === "DEFICIENCY_RAISED" || status === "RESPONDED") {
    const o = origin && (STEPS as readonly string[]).includes(origin) ? origin : "UNDER_SCRUTINY";
    return (STEPS as readonly string[]).indexOf(o);
  }
  if (status === "APPROVED" || status === "DEFERRED" || status === "REJECTED") return 6;
  const i = (STEPS as readonly string[]).indexOf(status);
  return i < 0 ? 0 : i;
}

type Transition = { from: string[]; to: string; perm: Permission; roles: readonly string[]; label: string };

const t = (from: string[], to: string, perm: Permission, label: string): Transition => ({ from, to, perm, roles: PERMISSIONS[perm], label });

/** Deficiencies can be raised from any PCP review stage; accepting the responses returns the case to that stage. */
export const DEFICIENCY_FROM = ["UNDER_SCRUTINY", "TECHNICAL_REVIEW", "INSPECTION_SUBMITTED", "DEFERRED", "RESPONDED"];

export const TRANSITIONS: Transition[] = [
  t(["DRAFT"], "SUBMITTED", "inst.app.submit", "Submit to PCP"),
  t(["SUBMITTED"], "UNDER_SCRUTINY", "pcp.app.scrutiny", "Start scrutiny"),
  t(DEFICIENCY_FROM, "DEFICIENCY_RAISED", "pcp.app.scrutiny", "Raise deficiency"),
  // The technical officer raises a deficiency for a standard not met, and accepts the answer, during the technical review.
  t(["TECHNICAL_REVIEW"], "DEFICIENCY_RAISED", "pcp.technical.review", "Raise deficiency"),
  t(["DEFICIENCY_RAISED"], "RESPONDED", "inst.deficiency.respond", "Respond"),
  t(["RESPONDED"], "UNDER_SCRUTINY", "pcp.app.scrutiny", "Accept responses"),
  t(["RESPONDED"], "TECHNICAL_REVIEW", "pcp.app.scrutiny", "Accept responses"),
  t(["RESPONDED"], "TECHNICAL_REVIEW", "pcp.technical.review", "Accept responses"),
  t(["RESPONDED"], "INSPECTION_SUBMITTED", "pcp.app.scrutiny", "Accept responses"),
  t(["RESPONDED"], "DEFERRED", "pcp.app.scrutiny", "Accept responses"),
  t(["UNDER_SCRUTINY"], "TECHNICAL_REVIEW", "pcp.app.scrutiny", "Pass scrutiny"),
  t(["TECHNICAL_REVIEW"], "INSPECTION_SCHEDULED", "pcp.inspection.schedule", "Schedule inspection"),
  t(["INSPECTION_SCHEDULED"], "INSPECTION_SUBMITTED", "pcp.inspection.submit", "Submit inspection report"),
  t(["INSPECTION_SUBMITTED"], "COUNCIL_REVIEW", "pcp.app.scrutiny", "Forward to council"),
  t(["DEFERRED"], "COUNCIL_REVIEW", "pcp.app.scrutiny", "Return to council"),
  t(["COUNCIL_REVIEW"], "APPROVED", "pcp.council.decide", "Record: approved"),
  t(["COUNCIL_REVIEW"], "DEFERRED", "pcp.council.decide", "Record: deferred"),
  t(["COUNCIL_REVIEW"], "REJECTED", "pcp.council.decide", "Record: rejected"),
  t(["APPROVED"], "NOC_ISSUED", "pcp.noc.issue", "Issue certificate"),
];

export function canTransition(from: string, to: string, roles: string[]) {
  return TRANSITIONS.some((x) => x.from.includes(from) && x.to === to && can(roles, x.perm));
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
  "TECHNICAL_REVIEW",
  "INSPECTION_SCHEDULED",
  "INSPECTION_SUBMITTED",
  "COUNCIL_REVIEW",
  "APPROVED",
  "DEFERRED",
];
export const CLOSED_STATUSES = ["NOC_ISSUED", "REJECTED"];

/** Context that decides who holds a case beyond its status. */
export type HolderCtx = { reviewDone?: boolean; deferUntil?: string | null; inspectionLead?: string | null };

/**
 * The permission whose holders must act next, or null when the institution holds the file.
 * INSPECTION_SCHEDULED is held by the assigned lead only (checked separately).
 */
export function pendingPermission(status: string, ctx: HolderCtx = {}): Permission | null {
  switch (status) {
    case "SUBMITTED":
    case "UNDER_SCRUTINY":
    case "RESPONDED":
    case "INSPECTION_SUBMITTED":
      return "pcp.app.scrutiny";
    case "TECHNICAL_REVIEW":
      // The academic check is the technical officer's (RFP 4.1.2); case officers hold the permission too.
      return ctx.reviewDone ? "pcp.inspection.schedule" : "pcp.technical.review";
    case "INSPECTION_SCHEDULED":
      return "pcp.inspection.submit";
    case "COUNCIL_REVIEW":
      return "pcp.council.decide";
    case "APPROVED":
      return "pcp.noc.issue";
    case "DEFERRED":
      // Deferred: the institution has until the return date; after it, the officer puts it back on the agenda.
      return ctx.deferUntil && ctx.deferUntil > new Date().toISOString().slice(0, 10) ? null : "pcp.app.scrutiny";
    default:
      return null;
  }
}

/** Does this PCP user have to act on the case now? */
export function needsAction(status: string, roles: string[], username: string, ctx: HolderCtx = {}) {
  const perm = pendingPermission(status, ctx);
  if (!perm) return false;
  if (status === "INSPECTION_SCHEDULED") return !!ctx.inspectionLead && ctx.inspectionLead === username;
  return can(roles, perm);
}

/** Who holds the file, in one word, for queues and pipelines. */
export function holderLabel(status: string, ctx: HolderCtx = {}) {
  switch (status) {
    case "DRAFT":
      return "Institution";
    case "SUBMITTED":
    case "UNDER_SCRUTINY":
    case "RESPONDED":
    case "INSPECTION_SUBMITTED":
      return "Officer";
    case "TECHNICAL_REVIEW":
      return ctx.reviewDone ? "Coordinator" : "Technical officer";
    case "DEFICIENCY_RAISED":
      return "Institution";
    case "INSPECTION_SCHEDULED":
      return "Inspection team";
    case "COUNCIL_REVIEW":
      return "Council";
    case "APPROVED":
      return "Secretary";
    case "DEFERRED":
      return pendingPermission(status, ctx) ? "Officer" : "Institution";
    default:
      return "Closed";
  }
}

export const KIND_LABELS: Record<string, string> = {
  NOC: "NOC",
  ACCREDITATION: "Accreditation",
  RENEWAL: "Renewal",
};

export const PROGRAM_LABELS: Record<string, string> = {
  PHARMD: "PharmD",
  TECH: "Pharmacy Technician",
  MPHIL: "MS/MPhil",
  PHD: "PhD",
};

/** Undergraduate programmes: the student ledger, annual returns and faculty appointments are for these. */
export const UG_TYPES = ["PHARMD", "TECH"] as const;
/** Postgraduate programmes (RFP 4.1.10): accredited per field of study, with the HEC NOC and eligible supervisors. */
export const PG_TYPES = ["MPHIL", "PHD"] as const;
export type PgType = (typeof PG_TYPES)[number];
export const isPg = (type: string | null | undefined): type is PgType => type === "MPHIL" || type === "PHD";

/** The programme a case or card is about: "PharmD", or "PhD Pharmacology" for a postgraduate field. */
export function programmeName(type: string, field?: string | null) {
  const label = PROGRAM_LABELS[type] ?? type;
  return field ? `${label} ${field}` : label;
}

/** Fields of study for postgraduate programmes (RFP 4.1.10). The `pg.rules` rule holds the list PCP uses. */
export const PG_FIELDS = [
  "Pharmaceutics",
  "Pharmaceutical Chemistry",
  "Pharmacognosy",
  "Pharmacology",
  "Pharmacy Practice/Clinical Pharmacy",
  "Pharmaceutical Sciences",
  "Pharmacy",
];

/** The subject linked supervisors are recorded under on a postgraduate case. */
export const SUPERVISOR_SUBJECT = "Supervisor";

/** Case reference prefixes: postgraduate cases have their own series, so the undergraduate numbering is unchanged. */
export function refPrefix(kind: string, programType: string) {
  if (isPg(programType)) return kind === "RENEWAL" ? "PGR" : "PGA";
  return kind === "RENEWAL" ? "RNW" : kind === "ACCREDITATION" ? "ACC" : "NOC";
}

/** Self-assessment criteria for accreditation and renewal (guide section 5). */
export const SELF_ASSESSMENT_CRITERIA = [
  "Governance and administration",
  "Faculty strength and qualifications",
  "Curriculum and scheme of studies",
  "Laboratories and equipment",
  "Library and learning resources",
  "Admissions and student records",
  "Examinations and results",
  "Hospital and pharmacy practice linkage",
  "Finance and sustainability",
];

/** Technical review criteria: the academic check against PCP standards. */
export const TECHNICAL_REVIEW_CRITERIA = [
  "Scheme of studies follows the PCP curriculum",
  "Faculty qualifications match the subjects they are linked to",
  "Laboratories cover the practical courses",
  "Library and learning resources are adequate",
  "Requested intake fits classrooms, labs and faculty",
];

/** Technical review of a postgraduate case: the PG proforma against PCP's postgraduate standards. */
export const PG_TECHNICAL_REVIEW_CRITERIA = [
  "HEC NOC for the PG programme is genuine and current",
  "Scheme of studies: coursework credit hours and duration",
  "Thesis and research requirement",
  "Research laboratories and equipment",
  "Library, journals and HEC Digital Library access",
  "Requested intake fits the eligible supervisors",
];

/** The on-site checklist (guide section 4) for PharmD and Technician programmes. */
export const INSPECTION_CRITERIA = [
  "Faculty: qualified, full-time, as per submitted list",
  "Laboratories: equipment, chemicals and safety",
  "Library: books, journals and digital access",
  "Classrooms and building",
  "Student records and attendance",
  "Hospital / pharmacy practice linkage",
  "Governance and finances",
];

/** The on-site checklist for MS/MPhil and PhD programmes. */
export const PG_INSPECTION_CRITERIA = [
  "Supervisors: in post, qualified and within the student limit",
  "Research laboratories: equipment, consumables and safety",
  "Library: journals and HEC Digital Library access",
  "Coursework: timetable, teachers and assessment records",
  "Research governance: ethics and biosafety committees",
  "Thesis records: synopsis approvals and progress reports",
  "Governance and finances",
];

export const inspectionCriteriaFor = (programType: string) => (isPg(programType) ? PG_INSPECTION_CRITERIA : INSPECTION_CRITERIA);
