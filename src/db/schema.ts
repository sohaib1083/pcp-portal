import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  bigserial,
  text,
  integer,
  real,
  timestamp,
  date,
  jsonb,
  uniqueIndex,
  index,
  boolean,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const institutions = pgTable("institutions", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // PCP-UNI-000101
  shortCode: text("short_code").notNull().unique(), // RUH
  name: text("name").notNull(),
  province: text("province").notNull(),
  city: text("city").notNull(),
  sector: text("sector").notNull(), // Public | Private
  status: text("status").notNull().default("ACTIVE"), // ACTIVE | PENDING | SUSPENDED
  affiliatedUniversity: text("affiliated_university"),
  establishedYear: integer("established_year"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  website: text("website"),
  onboardingId: integer("onboarding_id"), // the onboarding request that created it (self-registered institutions)
  createdAt: createdAt(),
});

/** A campus is a child of its institution, not a second account (guide section 3). */
export const campuses = pgTable("campuses", {
  id: serial("id").primaryKey(),
  institutionId: integer("institution_id").notNull().references(() => institutions.id),
  name: text("name").notNull(),
  city: text("city").notNull(),
  province: text("province").notNull(),
  address: text("address"),
  isMain: boolean("is_main").notNull().default(false),
  createdAt: createdAt(),
});

export const programs = pgTable(
  "programs",
  {
    id: serial("id").primaryKey(),
    institutionId: integer("institution_id").notNull().references(() => institutions.id),
    type: text("type").notNull(), // PHARMD | TECH | MPHIL | PHD
    field: text("field").notNull().default(""), // postgraduate field of study ("" for PharmD and Technician)
    nocStatus: text("noc_status").notNull().default("NONE"), // APPROVED | PENDING | NONE | REJECTED
    nocNumber: text("noc_number"),
    approvedIntake: integer("approved_intake").notNull().default(0),
    accreditationStatus: text("accreditation_status").notNull().default("NONE"), // VALID | EXPIRED | PENDING | NONE
    accreditationValidUntil: date("accreditation_valid_until"),
    createdAt: createdAt(),
  },
  // A postgraduate programme is one per field (PhD Pharmacology and PhD Pharmaceutics are two programmes).
  (t) => [uniqueIndex("programs_inst_type").on(t.institutionId, t.type, t.field)],
);

export const accreditationHistory = pgTable("accreditation_history", {
  id: serial("id").primaryKey(),
  programId: integer("program_id").notNull().references(() => programs.id),
  year: integer("year").notNull(),
  status: text("status").notNull(),
  validFrom: integer("valid_from").notNull(),
  validUntil: integer("valid_until").notNull(),
  intake: integer("intake").notNull(),
  decision: text("decision").notNull(),
  applicationRef: text("application_ref"), // the case behind this row; rows are never overwritten
});

export const faculty = pgTable(
  "faculty",
  {
    id: serial("id").primaryKey(),
    pcpId: text("pcp_id").notNull().unique(), // PCP-FAC-000458
    cnic: text("cnic").notNull().unique(),
    fullName: text("full_name").notNull(),
    fatherName: text("father_name").notNull(),
    nameNorm: text("name_norm").notNull(),
    qualification: text("qualification").notNull(), // PhD | MPhil | PharmD | M.Pharm
    specialization: text("specialization").notNull(),
    pcpRegNo: text("pcp_reg_no"),
    designation: text("designation").notNull(),
    verificationStatus: text("verification_status").notNull().default("PENDING"), // VERIFIED | PENDING | FLAGGED
    createdAt: createdAt(),
  },
  (t) => [index("faculty_name_trgm").using("gin", sql`${t.nameNorm} gin_trgm_ops`)],
);

// One faculty member can be ACTIVE at only one institution: enforced by the database.
export const facultyLinks = pgTable(
  "faculty_links",
  {
    id: serial("id").primaryKey(),
    facultyId: integer("faculty_id").notNull().references(() => faculty.id),
    institutionId: integer("institution_id").notNull().references(() => institutions.id),
    programType: text("program_type").notNull(),
    status: text("status").notNull().default("ACTIVE"), // ACTIVE | ENDED
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("one_active_institution_per_faculty").on(t.facultyId).where(sql`status = 'ACTIVE'`)],
);

export const students = pgTable("students", {
  id: serial("id").primaryKey(),
  pcpId: text("pcp_id").notNull().unique(), // PCP-RUH-2026-00000001
  institutionId: integer("institution_id").notNull().references(() => institutions.id),
  programType: text("program_type").notNull(),
  cnic: text("cnic").notNull().unique(),
  fullName: text("full_name").notNull(),
  fatherName: text("father_name").notNull(),
  mobile: text("mobile"),
  email: text("email"),
  shift: text("shift").notNull(), // Morning | Evening | Self-finance
  enrollmentYear: integer("enrollment_year").notNull(),
  currentYear: integer("current_year").notNull().default(1),
  status: text("status").notNull().default("ENROLLED"), // ENROLLED | PROMOTED | REPEAT | GRADUATED | WITHDRAWN
  result: text("result"), // PASS | FAIL | null (latest annual result)
  resultYear: integer("result_year"),
  degreeVerified: boolean("degree_verified").notNull().default(false), // university/HEC check (simulated)
  eligibleForRegistration: boolean("eligible_for_registration").notNull().default(false),
  username: text("username").unique(), // student login, if the student has one
  createdAt: createdAt(),
});

export const applications = pgTable("applications", {
  id: serial("id").primaryKey(),
  ref: text("ref").notNull().unique(), // NOC-2026-0001
  institutionId: integer("institution_id").notNull().references(() => institutions.id),
  kind: text("kind").notNull(), // NOC | ACCREDITATION | RENEWAL
  programType: text("program_type").notNull(), // PHARMD | TECH | MPHIL | PHD
  field: text("field").notNull().default(""), // postgraduate field of study ("" for PharmD and Technician)
  status: text("status").notNull().default("DRAFT"),
  data: jsonb("data").$type<ApplicationData>().notNull().default({}),
  checks: jsonb("checks").$type<CheckResult[]>(),
  feeAmount: integer("fee_amount").notNull().default(0),
  feePsid: text("fee_psid"),
  feePaidAt: timestamp("fee_paid_at", { withTimezone: true }),
  feePaidBy: text("fee_paid_by"),
  feeMethod: text("fee_method"),
  assignedOfficer: text("assigned_officer"),
  submittedBy: text("submitted_by"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  decision: text("decision"),
  decisionNote: text("decision_note"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  certificateNo: text("certificate_no").unique(),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  validUntil: date("valid_until"),
  campusId: integer("campus_id"), // the campus the case is for
  stageStartedAt: timestamp("stage_started_at", { withTimezone: true }), // SLA clock for the current stage
  stageDueAt: timestamp("stage_due_at", { withTimezone: true }),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  deferUntil: date("defer_until"), // a deferral is not a silent hold: it has a reason and a date
  decisionGrounds: text("decision_grounds"),
  selfAssessment: jsonb("self_assessment").$type<SelfAssessmentItem[]>(), // accreditation and renewal
  renewalOf: text("renewal_of"), // certificate or case this renewal continues
  letterDocumentId: integer("letter_document_id"), // the generated decision letter
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const applicationEvents = pgTable("application_events", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => applications.id),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  actor: text("actor").notNull(),
  actorRole: text("actor_role").notNull(),
  note: text("note"),
  createdAt: createdAt(),
});

export const deficiencies = pgTable("deficiencies", {
  id: serial("id").primaryKey(),
  ref: text("ref").notNull().unique(), // DF-2026-00452
  applicationId: integer("application_id").notNull().references(() => applications.id),
  institutionId: integer("institution_id").notNull().references(() => institutions.id),
  criterion: text("criterion").notNull(),
  requiredAction: text("required_action").notNull(),
  evidenceRequired: text("evidence_required").notNull(),
  dueDate: date("due_date").notNull(),
  status: text("status").notNull().default("OUTSTANDING"), // OUTSTANDING | RESPONDED | ACCEPTED | REJECTED
  responseNote: text("response_note"),
  respondedBy: text("responded_by"),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  reviewedBy: text("reviewed_by"),
  reviewNote: text("review_note"),
  raisedBy: text("raised_by").notNull(),
  createdAt: createdAt(),
});

export const inspections = pgTable("inspections", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => applications.id),
  institutionId: integer("institution_id").notNull().references(() => institutions.id),
  inspector: text("inspector").notNull(), // team lead; other members are in inspection_team
  scheduledFor: date("scheduled_for").notNull(),
  scope: text("scope"), // what the institution should prepare
  status: text("status").notNull().default("SCHEDULED"), // SCHEDULED | SUBMITTED
  checklist: jsonb("checklist").$type<ChecklistItem[]>(),
  summary: text("summary"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
});

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  institutionId: integer("institution_id").references(() => institutions.id), // null while an onboarding request is pending
  onboardingId: integer("onboarding_id"),
  pharmacistId: integer("pharmacist_id"),
  folder: text("folder").notNull(), // e.g. noc-applications/NOC-2026-0001
  docType: text("doc_type").notNull(),
  fileName: text("file_name").notNull(),
  storageKey: text("storage_key").notNull(),
  version: integer("version").notNull().default(1),
  sizeBytes: integer("size_bytes").notNull(),
  mimeType: text("mime_type").notNull(),
  sha256: text("sha256").notNull(),
  verificationStatus: text("verification_status").notNull().default("PENDING"),
  expiryDate: date("expiry_date"),
  applicationId: integer("application_id").references(() => applications.id),
  deficiencyId: integer("deficiency_id").references(() => deficiencies.id),
  uploadedBy: text("uploaded_by").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  audience: text("audience").notNull(), // inst:PCP-UNI-000101 | role:pcp_secretary | user:pcp.inspector
  title: text("title").notNull(),
  body: text("body").notNull(),
  link: text("link"),
  channel: text("channel").notNull().default("in-app+email"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// App-side user directory, kept in step with Keycloak by the Super Admin screens.
export const staff = pgTable("staff", {
  username: text("username").primaryKey(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  role: text("role").notNull(),
  province: text("province"), // inspectors: used for the conflict-of-interest rule
  institutionId: integer("institution_id").references(() => institutions.id),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const duplicateFlags = pgTable("duplicate_flags", {
  id: serial("id").primaryKey(),
  entity: text("entity").notNull(), // faculty
  recordId: integer("record_id").notNull(),
  matchRecordId: integer("match_record_id").notNull(),
  score: real("score").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("OPEN"), // OPEN | SAME_PERSON | DIFFERENT
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/**
 * Outbox: every email and SMS the system would send, stored against its case (guide section 12).
 * In the demo nothing leaves the server; the Messages screens show what was "sent".
 */
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  channel: text("channel").notNull(), // EMAIL | SMS
  toAddress: text("to_address").notNull(),
  toName: text("to_name"),
  audience: text("audience"), // same form as notifications: inst:CODE | role:x | user:x
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  entity: text("entity"), // application | deficiency | onboarding | payment | annual_return | appeal | ticket | pharmacist | otp
  entityRef: text("entity_ref"),
  link: text("link"),
  institutionId: integer("institution_id"),
  createdAt: createdAt(),
});

/** One-time codes for officers and for anyone submitting a decision or a payment (guide section 12). */
export const otpChallenges = pgTable("otp_challenges", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  purpose: text("purpose").notNull(), // e.g. decision:NOC-2026-0006, payment:2026000...
  codeHash: text("code_hash").notNull(),
  sentTo: text("sent_to").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Fee payments: PSID challan, Raast QR or branch, with an automatic receipt (simulated bank). */
export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  psid: text("psid").notNull().unique(),
  receiptNo: text("receipt_no").unique(), // RCPT-2026-000123, set when paid
  institutionId: integer("institution_id"),
  onboardingId: integer("onboarding_id"),
  applicationId: integer("application_id"),
  purpose: text("purpose").notNull(), // e.g. "NOC fee · Pharmacy Technician"
  amount: integer("amount").notNull(),
  status: text("status").notNull().default("PENDING"), // PENDING | PAID | RECONCILED | CANCELLED
  method: text("method"), // RAAST_QR | BANK_BRANCH | INTERNET_BANKING
  payerName: text("payer_name"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  bankRef: text("bank_ref"),
  receiptDocumentId: integer("receipt_document_id"),
  reconciledBy: text("reconciled_by"),
  reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
});

/** Outstanding dues block a new submission until paid or waived (guide section 4). */
export const dues = pgTable("dues", {
  id: serial("id").primaryKey(),
  institutionId: integer("institution_id").notNull().references(() => institutions.id),
  description: text("description").notNull(),
  amount: integer("amount").notNull(),
  dueDate: date("due_date").notNull(),
  status: text("status").notNull().default("OUTSTANDING"), // OUTSTANDING | PAID | WAIVED
  paymentId: integer("payment_id"),
  waivedBy: text("waived_by"),
  note: text("note"),
  createdAt: createdAt(),
});

export const rules = pgTable("rules", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  version: integer("version").notNull(),
  value: jsonb("value").notNull(),
  description: text("description").notNull(),
  effectiveFrom: date("effective_from").notNull(),
});

// Tamper-evident audit log: each row stores the hash of the previous row.
export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id").notNull(),
  details: jsonb("details").notNull().default({}),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
});

export type ApplicationData = {
  campus?: string;
  proposedIntake?: number;
  classrooms?: number;
  labs?: number;
  labList?: string;
  libraryBooks?: number;
  libraryJournals?: number;
  buildingAreaSqft?: number;
  notes?: string;
  complianceConfirmed?: boolean; // renewal: the institution confirms annual compliance for the current term
  // Postgraduate proforma (MS/MPhil and PhD, RFP 4.1.10)
  durationYears?: number;
  courseworkCredits?: number;
  thesisRequired?: boolean;
  researchLabs?: number;
  researchLabList?: string;
  equipment?: string;
  hecDigitalLibrary?: boolean;
  hecNocNumber?: string;
  hecNocDate?: string;
};

export type CheckResult = { key: string; label: string; ok: boolean; detail: string };

export type SelfAssessmentItem = {
  criterion: string;
  rating: "MET" | "PARTLY" | "NOT_MET";
  comment: string;
};

export type ChecklistItem = {
  criterion: string;
  result: "COMPLIANT" | "PARTIAL" | "NON_COMPLIANT" | "NA";
  remarks: string;
  /** Score entry (RFP 4.1.2): 0 to the rule's maximum, within the band of the result; null for not applicable. */
  score?: number | null;
  /** The line's weight from the `inspection.scoring` rule at submission. */
  weight?: number;
  /** Photos and documents for this line, filed under the case's inspection folder. */
  evidence?: { id: number; name: string }[];
};

// Module tables, one file per module (see src/db/modules/).
export * from "./modules/onboarding";
export * from "./modules/workflow";
export * from "./modules/faculty";
export * from "./modules/students";
export * from "./modules/pharmacists";
export * from "./modules/council";
export * from "./modules/accounts";
export * from "./modules/identity";
export * from "./modules/governance";
export * from "./modules/people";
