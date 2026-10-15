// Module: council meetings, appeals and help desk (guide section 14). Owner: council work.
import { boolean, date, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const councilMeetings = pgTable("council_meetings", {
  id: serial("id").primaryKey(),
  ref: text("ref").notNull().unique(), // CM-2026-07 (council); committees use their own prefix, e.g. ACM-2026-01
  committee: text("committee").notNull().default("Council"), // Council | a committee from the ref.committees rule
  title: text("title").notNull(),
  meetingDate: date("meeting_date").notNull(),
  status: text("status").notNull().default("PLANNED"), // PLANNED | IN_SESSION | CLOSED
  minutesDocumentId: integer("minutes_document_id"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * An agenda item: a case (or appeal) that is ready, with its recommendation and draft decision.
 * Committee agendas (and council discussion items) can also carry a court case, a letter or another matter;
 * those get a recorded recommendation or outcome (`resolution`), never a decision.
 */
export const councilItems = pgTable("council_items", {
  id: serial("id").primaryKey(),
  meetingId: integer("meeting_id").notNull(),
  applicationId: integer("application_id"),
  appealId: integer("appeal_id"),
  courtCaseId: integer("court_case_id"),
  letterId: integer("letter_id"), // correspondence register entry
  subject: text("subject"), // another matter (free text), or a short title for the item
  resolution: text("resolution"), // committee recommendation, or the council's recorded outcome on a discussion item
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  position: integer("position").notNull(),
  recommendation: text("recommendation"),
  draftDecision: text("draft_decision"), // APPROVED | DEFERRED | REJECTED | UPHELD | DISMISSED
  decision: text("decision"),
  decisionNote: text("decision_note"),
  deferUntil: date("defer_until"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

/** Appeal against a decision, linked to the original case and its evidence. */
export const appeals = pgTable("appeals", {
  id: serial("id").primaryKey(),
  ref: text("ref").notNull().unique(), // APL-2026-0001
  applicationId: integer("application_id").notNull(),
  institutionId: integer("institution_id").notNull(),
  grounds: text("grounds").notNull(),
  evidenceDocumentId: integer("evidence_document_id"),
  status: text("status").notNull().default("FILED"), // FILED | UNDER_REVIEW | ON_AGENDA | UPHELD | DISMISSED | WITHDRAWN
  filedBy: text("filed_by").notNull(),
  reviewNote: text("review_note"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  decidedBy: text("decided_by"),
  decisionNote: text("decision_note"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  letterDocumentId: integer("letter_document_id"), // the appeal decision letter
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Help desk and complaints: tracked to an outcome, with a time limit. */
export const tickets = pgTable("tickets", {
  id: serial("id").primaryKey(),
  ref: text("ref").notNull().unique(), // TKT-2026-0001
  source: text("source").notNull(), // PUBLIC | INSTITUTION | STUDENT | PHARMACIST
  category: text("category").notNull(), // Complaint | Question | Technical issue | Data correction
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactMobile: text("contact_mobile"),
  institutionId: integer("institution_id"),
  username: text("username"),
  status: text("status").notNull().default("OPEN"), // OPEN | IN_PROGRESS | RESOLVED | CLOSED
  assignedTo: text("assigned_to"),
  slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ticketReplies = pgTable("ticket_replies", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  author: text("author").notNull(),
  body: text("body").notNull(),
  internal: boolean("internal").notNull().default(false), // PCP-only note
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
