// Module: council meetings, appeals and help desk (guide section 14). Owner: council work.
import { boolean, date, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const councilMeetings = pgTable("council_meetings", {
  id: serial("id").primaryKey(),
  ref: text("ref").notNull().unique(), // CM-2026-07
  title: text("title").notNull(),
  meetingDate: date("meeting_date").notNull(),
  status: text("status").notNull().default("PLANNED"), // PLANNED | IN_SESSION | CLOSED
  minutesDocumentId: integer("minutes_document_id"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** An agenda item: a case (or appeal) that is ready, with its recommendation and draft decision. */
export const councilItems = pgTable("council_items", {
  id: serial("id").primaryKey(),
  meetingId: integer("meeting_id").notNull(),
  applicationId: integer("application_id"),
  appealId: integer("appeal_id"),
  position: integer("position").notNull(),
  recommendation: text("recommendation"),
  draftDecision: text("draft_decision"), // APPROVED | DEFERRED | REJECTED | UPHELD | DISMISSED
  decision: text("decision"),
  decisionNote: text("decision_note"),
  deferUntil: date("defer_until"),
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
  decidedBy: text("decided_by"),
  decisionNote: text("decision_note"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
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
