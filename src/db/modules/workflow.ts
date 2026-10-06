// Module: NOC / accreditation / renewal case workflow. Owner: workflow work.
import { date, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** Faculty linked to a case by Faculty ID, per subject, so the rules can check "Pharmacology: 1 linked, 2 required". */
export const applicationFaculty = pgTable(
  "application_faculty",
  {
    id: serial("id").primaryKey(),
    applicationId: integer("application_id").notNull(),
    facultyId: integer("faculty_id").notNull(),
    subject: text("subject").notNull(), // Pharmaceutics | Pharmacology | Pharmaceutical Chemistry | Pharmacognosy | Pharmacy Practice
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("application_faculty_unique").on(t.applicationId, t.facultyId)],
);

export type TechnicalReviewItem = {
  criterion: string;
  result: "MEETS" | "PARTLY" | "DOES_NOT_MEET";
  remarks: string;
};

/** Technical review: the academic check against PCP standards between scrutiny and inspection (guide section 4). */
export const technicalReviews = pgTable("technical_reviews", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  reviewer: text("reviewer").notNull(),
  items: jsonb("items").$type<TechnicalReviewItem[]>().notNull(),
  summary: text("summary").notNull(),
  outcome: text("outcome").notNull(), // PROCEED (to inspection)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per renewal alert sent (180, 120, 90, 60, 30 days and 0 = expiry date), so each threshold fires once. */
export const renewalAlerts = pgTable(
  "renewal_alerts",
  {
    id: serial("id").primaryKey(),
    programId: integer("program_id").notNull(),
    validUntil: date("valid_until").notNull(),
    threshold: integer("threshold").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("renewal_alert_once").on(t.programId, t.validUntil, t.threshold)],
);

/** Service-level notices: a reminder to the assignee, then one escalation to the supervisor, per stage visit. */
export const slaNotices = pgTable(
  "sla_notices",
  {
    id: serial("id").primaryKey(),
    applicationId: integer("application_id").notNull(),
    status: text("status").notNull(),
    stageStartedAt: timestamp("stage_started_at", { withTimezone: true }).notNull(),
    kind: text("kind").notNull(), // REMINDER | ESCALATION
    audience: text("audience").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sla_notice_once").on(t.applicationId, t.status, t.stageStartedAt, t.kind)],
);
