// Module: NOC / accreditation / renewal case workflow. Owner: workflow work.
import { sql } from "drizzle-orm";
import { boolean, date, integer, jsonb, pgTable, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** What the institution declares about a postgraduate supervisor on a case; the technical officer checks it. */
export type SupervisorDetails = {
  publications?: number; // research publications in recognised journals
  hecApproved?: boolean; // HEC-approved PhD supervisor
  currentStudents?: number; // postgraduate students already under supervision
};

/** Faculty linked to a case by Faculty ID, per subject, so the rules can check "Pharmacology: 1 linked, 2 required". */
export const applicationFaculty = pgTable(
  "application_faculty",
  {
    id: serial("id").primaryKey(),
    applicationId: integer("application_id").notNull(),
    facultyId: integer("faculty_id").notNull(),
    subject: text("subject").notNull(), // Pharmaceutics | Pharmacology | Pharmaceutical Chemistry | Pharmacognosy | Pharmacy Practice | Supervisor (postgraduate)
    details: jsonb("details").$type<SupervisorDetails>(), // postgraduate supervisors only
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

/** The technical officer's check of one postgraduate supervisor against the `pg.rules` rule. */
export type SupervisorCheck = {
  facultyId: number;
  pcpId: string;
  name: string;
  result: "ELIGIBLE" | "NOT_ELIGIBLE";
  remarks: string;
};

/** Technical review: the academic check against PCP standards between scrutiny and inspection (guide section 4). */
export const technicalReviews = pgTable("technical_reviews", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  reviewer: text("reviewer").notNull(),
  items: jsonb("items").$type<TechnicalReviewItem[]>().notNull(),
  supervisors: jsonb("supervisors").$type<SupervisorCheck[]>(), // postgraduate cases: one check per linked supervisor
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

/**
 * The inspection score (RFP 4.1.2 "score entry panels"): the weighted total of the checklist scores, the
 * percentage and the pass threshold of the `inspection.scoring` rule version used at submission.
 */
export const inspectionScores = pgTable(
  "inspection_scores",
  {
    id: serial("id").primaryKey(),
    inspectionId: integer("inspection_id").notNull(),
    total: real("total").notNull(),
    max: real("max").notNull(),
    percent: real("percent").notNull(),
    passPercent: real("pass_percent").notNull(),
    passed: boolean("passed").notNull(),
    ruleVersion: integer("rule_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("inspection_scores_once").on(t.inspectionId)],
);

/**
 * Super administrator overrides (RFP 4.1.2 "global overrides"): reassign the case officer, extend the current
 * stage's time limit, reopen a returned or deferred case at a chosen stage, place or release an administrative
 * hold. Each one has a reason and a one-time code, an audit entry and a timeline event (`eventId`).
 * An override never records a council decision.
 */
export const caseOverrides = pgTable("case_overrides", {
  id: serial("id").primaryKey(),
  ref: text("ref").notNull().unique(), // OVR-2026-0001
  applicationId: integer("application_id").notNull(),
  kind: text("kind").notNull(), // REASSIGN_OFFICER | EXTEND_DEADLINE | REOPEN | HOLD | RELEASE_HOLD
  reason: text("reason").notNull(), // PCP-internal; never shown to the institution
  before: jsonb("before").$type<Record<string, unknown>>().notNull().default({}),
  after: jsonb("after").$type<Record<string, unknown>>().notNull().default({}),
  publicNote: text("public_note"), // what the institution sees on its timeline and in its notice
  eventId: integer("event_id"), // the application_events row on the case timeline
  actor: text("actor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** An administrative hold: no workflow step can be taken and the stage clock is paused until it is released. */
export const caseHolds = pgTable(
  "case_holds",
  {
    id: serial("id").primaryKey(),
    applicationId: integer("application_id").notNull(),
    status: text("status").notNull(), // the case status when the hold was placed
    reason: text("reason").notNull(),
    remainingSeconds: integer("remaining_seconds"), // time left on the stage clock when paused (negative if overdue); null without a clock
    placedBy: text("placed_by").notNull(),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
    releasedBy: text("released_by"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releaseReason: text("release_reason"),
  },
  (t) => [uniqueIndex("one_open_hold_per_case").on(t.applicationId).where(sql`released_at is null`)],
);
