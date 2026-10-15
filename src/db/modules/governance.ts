// Module: governance (RFP Oct 2026: 4.1.1 committee workflow and correspondence, section 6 week 3 court case ledger).
// Court cases with hearings and orders, the inward/outward correspondence register, and committee action points.
// Committee meetings themselves are council_meetings rows with a `committee` (see ./council.ts).
import { date, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/** A court case PCP is party to (litigation ledger). */
export const courtCases = pgTable("court_cases", {
  id: serial("id").primaryKey(),
  ref: text("ref").notNull().unique(), // LIT-2026-0001
  court: text("court").notNull(), // from the ref.courts rule
  caseNumber: text("case_number").notNull(), // e.g. WP 1234/2026
  title: text("title").notNull(), // e.g. Bolan Valley University v. Pharmacy Council of Pakistan
  petitioner: text("petitioner").notNull(),
  respondent: text("respondent").notNull(),
  nature: text("nature").notNull(), // WRIT | APPEAL | CONTEMPT | CIVIL_SUIT | SERVICE
  institutionId: integer("institution_id"), // linked institution, if any
  linkedRef: text("linked_ref"), // the PCP decision or case it is about: NOC-/ACC-/RNW-/APL- reference
  counsel: text("counsel").notNull(), // PCP's counsel
  counselEmail: text("counsel_email"), // reminders go here (simulated email)
  filedDate: date("filed_date").notNull(),
  status: text("status").notNull().default("PENDING"), // PENDING | INTERIM_ORDER | STAY_GRANTED | DISPOSED_FAVOUR | DISPOSED_AGAINST | WITHDRAWN
  summary: text("summary"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One hearing: the date, the bench, what happened and the next date. */
export const courtHearings = pgTable("court_hearings", {
  id: serial("id").primaryKey(),
  courtCaseId: integer("court_case_id").notNull(),
  hearingDate: date("hearing_date").notNull(),
  bench: text("bench"),
  purpose: text("purpose"), // what is fixed for this date (arguments, reply, order)
  outcome: text("outcome"), // what happened
  nextDate: date("next_date"),
  status: text("status").notNull().default("SCHEDULED"), // SCHEDULED | HELD
  recordedBy: text("recorded_by"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** An order of the court. A stay order blocks council decisions on the linked case until it is lifted. */
export const courtOrders = pgTable("court_orders", {
  id: serial("id").primaryKey(),
  courtCaseId: integer("court_case_id").notNull(),
  kind: text("kind").notNull(), // STAY | INTERIM | FINAL | OTHER
  orderDate: date("order_date").notNull(),
  summary: text("summary").notNull(),
  stayUntil: date("stay_until"), // a stay: "no further action until"
  liftedAt: timestamp("lifted_at", { withTimezone: true }),
  liftedBy: text("lifted_by"),
  liftNote: text("lift_note"),
  documentId: integer("document_id"), // the order as filed (versioned document)
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Inward (diary) and outward (dispatch) register of official letters. */
export const correspondence = pgTable("correspondence", {
  id: serial("id").primaryKey(),
  ref: text("ref").notNull().unique(), // IN-2026-00001 | OUT-2026-00001
  direction: text("direction").notNull(), // IN | OUT
  letterDate: date("letter_date").notNull(), // the date on the letter
  party: text("party").notNull(), // from (inward) or to (outward): an institution's name or free text
  partyEmail: text("party_email"),
  partyInstitutionId: integer("party_institution_id"), // set when the sender or addressee is an institution
  institutionId: integer("institution_id"), // linked institution (the party, or the one the letter is about)
  subject: text("subject").notNull(),
  body: text("body"), // outward: the text of the generated letter
  mode: text("mode").notNull(), // POST | COURIER | EMAIL | HAND
  linkedRef: text("linked_ref"), // case, appeal or court case reference
  inReplyTo: integer("in_reply_to"), // outward reply to an inward letter
  markedTo: text("marked_to"), // username of the officer who must act
  actionDue: date("action_due"),
  status: text("status").notNull().default("OPEN"), // OPEN | ACTIONED | CLOSED
  actionNote: text("action_note"),
  documentId: integer("document_id"), // latest scan (inward) or generated letter (outward)
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  dispatchedBy: text("dispatched_by"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** An action point recorded in a council or committee meeting: a tracked task with an owner and a due date. */
export const committeeActions = pgTable("committee_actions", {
  id: serial("id").primaryKey(),
  meetingId: integer("meeting_id").notNull(),
  itemId: integer("item_id"), // the agenda item it came from, if any
  title: text("title").notNull(),
  owner: text("owner").notNull(), // username
  dueDate: date("due_date").notNull(),
  status: text("status").notNull().default("OPEN"), // OPEN | IN_PROGRESS | DONE
  note: text("note"), // what was done
  doneAt: timestamp("done_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Reminders already sent (hearing in 7 days, hearing tomorrow, task due, task overdue): one row per key, so the scheduler is idempotent. */
export const governanceNotices = pgTable("governance_notices", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(), // e.g. hearing:12:7, task:4:due, letter:9:overdue
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});
