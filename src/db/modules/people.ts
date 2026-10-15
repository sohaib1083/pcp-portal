// Module: people as users (RFP 4.1.2): provincial councils, faculty self-service and student requests.
// Owner: people work.
import { integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** A faculty login (Keycloak user with role `faculty`) linked to one PCP-FAC record. */
export const facultyAccounts = pgTable("faculty_accounts", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  facultyId: integer("faculty_id").notNull().unique(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FacultyRequestDetails = {
  changes?: Record<string, { from: string | null; to: string | null }>;
  awardingBody?: string;
  awardYear?: number;
  // attachment declarations
  action?: "JOINED" | "LEFT";
  institutionId?: number;
  institutionCode?: string;
  institutionName?: string;
  programType?: string;
  designation?: string;
  date?: string;
  linkId?: number;
  fcrRef?: string;
};

/**
 * What a teacher asks PCP for, from their own login (RFP 4.1.2: academic profile updates, institutional
 * attachment declarations, verification requests). Nothing on the faculty record changes until PCP approves.
 * kind: PROFILE (qualification or academic profile update, with evidence) | VERIFICATION | ATTACHMENT.
 * An ATTACHMENT becomes a link request or change request in the registry (faculty_change_requests, see fcrRef);
 * its decision is read from there.
 */
export const facultyRequests = pgTable("faculty_requests", {
  id: serial("id").primaryKey(),
  ref: text("ref").notNull().unique(), // FUR-2026-0001
  facultyId: integer("faculty_id").notNull(),
  kind: text("kind").notNull(),
  details: jsonb("details").$type<FacultyRequestDetails>().notNull().default({}),
  note: text("note"),
  evidenceDocumentId: integer("evidence_document_id"),
  status: text("status").notNull().default("PENDING"), // PENDING | APPROVED | REJECTED | WITHDRAWN | FORWARDED (attachment, decided in the registry)
  requestedBy: text("requested_by").notNull(),
  decidedBy: text("decided_by"),
  decisionNote: text("decision_note"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StudentRequestDetails = {
  changes?: Record<string, { from: string | null; to: string | null }>;
  purpose?: string; // what the letter is for, e.g. "Visa application"
  degreeRef?: string; // simulated university and HEC reference, set when the institution confirms the degree
};

/**
 * A student's own request (RFP 4.1.2: direct registration requests, lifecycle tracking, certificate printing).
 * Route: the institution's examination officer first, then PCP verification.
 * kind: CORRECTION | ENROLMENT_LETTER | ELIGIBILITY.
 * status: WITH_INSTITUTION -> WITH_PCP -> ISSUED (letter or certificate) | APPLIED (correction), or RETURNED | REJECTED | WITHDRAWN.
 */
export const studentRequests = pgTable("student_requests", {
  id: serial("id").primaryKey(),
  ref: text("ref").notNull().unique(), // SRQ-2026-0001
  studentId: integer("student_id").notNull(),
  institutionId: integer("institution_id").notNull(),
  kind: text("kind").notNull(),
  details: jsonb("details").$type<StudentRequestDetails>().notNull().default({}),
  reason: text("reason"),
  evidenceDocumentId: integer("evidence_document_id"),
  status: text("status").notNull().default("WITH_INSTITUTION"),
  requestedBy: text("requested_by").notNull(),
  institutionBy: text("institution_by"),
  institutionAt: timestamp("institution_at", { withTimezone: true }),
  institutionNote: text("institution_note"),
  pcpBy: text("pcp_by"),
  pcpAt: timestamp("pcp_at", { withTimezone: true }),
  pcpNote: text("pcp_note"),
  certificateNo: text("certificate_no").unique(), // SC-2026-000001, opens /verify/student/[no]
  certificateDocumentId: integer("certificate_document_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Validation routing (RFP 4.1.2): a provincial council validates its own registrations before PCP registration acts.
 * entity: PRACTICE_UPDATE (practice_updates.id). status: VALIDATED | RETURNED.
 */
export const provincialValidations = pgTable(
  "provincial_validations",
  {
    id: serial("id").primaryKey(),
    entity: text("entity").notNull(),
    entityId: integer("entity_id").notNull(),
    council: text("council").notNull(),
    status: text("status").notNull(),
    note: text("note"),
    decidedBy: text("decided_by").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("provincial_validation_once").on(t.entity, t.entityId)],
);

/**
 * A register file a provincial council validated and sent through the portal. PCP registration loads it into
 * the index (pharmacist_imports, see importRef) or returns it. The file text is kept so the load re-checks it.
 * status: WITH_PCP | LOADED | RETURNED.
 */
export const councilFiles = pgTable("council_files", {
  id: serial("id").primaryKey(),
  ref: text("ref").notNull().unique(), // PCF-2026-0001
  council: text("council").notNull(),
  fileName: text("file_name").notNull(),
  content: text("content").notNull(),
  totalRows: integer("total_rows").notNull(),
  readyRows: integer("ready_rows").notNull(),
  errorRows: integer("error_rows").notNull(),
  note: text("note"),
  status: text("status").notNull().default("WITH_PCP"),
  submittedBy: text("submitted_by").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  importRef: text("import_ref"),
});
