// Module: identity checks, access reviews and retention (guide section 14, "Identity and data quality" and
// "Security and continuity"). Owner: gaps work.
import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Every CNIC check against NADRA (SIMULATED in the demo, see src/lib/nadra.ts). The latest row for a record is
 * the badge on that record. A NAME_MISMATCH or NOT_FOUND result opens an item (reviewStatus OPEN) on PCP's
 * Data verification screen until an officer resolves it with a note.
 */
export const identityChecks = pgTable(
  "identity_checks",
  {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(), // faculty | student | pharmacist
    entityId: integer("entity_id").notNull(),
    cnic: text("cnic").notNull(),
    nameSent: text("name_sent").notNull(), // the name on PCP's record when the check ran
    status: text("status").notNull(), // MATCH | NAME_MISMATCH | NOT_FOUND
    nadraName: text("nadra_name"), // the name NADRA holds (null when not found)
    txnId: text("txn_id").notNull(), // NADRA transaction id (simulated)
    source: text("source").notNull().default("MANUAL"), // REGISTRATION | IMPORT | MANUAL | SEED
    checkedBy: text("checked_by").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    reviewStatus: text("review_status"), // OPEN | RESOLVED; null for a match
    reviewOutcome: text("review_outcome"), // NAME_UPDATED | KEPT | SETTLED_BY_RECHECK
    reviewNote: text("review_note"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [index("identity_checks_entity").on(t.entityType, t.entityId)],
);

/** The quarterly review of who holds which role (guide section 14). One row per recorded review. */
export const accessReviews = pgTable("access_reviews", {
  id: serial("id").primaryKey(),
  ref: text("ref").notNull().unique(), // UAR-2026-Q4 (a second review in the same quarter: UAR-2026-Q4-2)
  quarter: text("quarter").notNull(), // 2026-Q4
  total: integer("total").notNull(),
  kept: integer("kept").notNull(),
  removed: integer("removed").notNull(),
  note: text("note"),
  reviewedBy: text("reviewed_by").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Each account as it stood at the review, and what the reviewer decided. */
export const accessReviewItems = pgTable("access_review_items", {
  id: serial("id").primaryKey(),
  reviewId: integer("review_id").notNull(),
  username: text("username").notNull(),
  displayName: text("display_name"),
  email: text("email"),
  roles: jsonb("roles").$type<string[]>().notNull().default([]),
  institution: text("institution"), // PCP-UNI code of the account's institution group, if any
  enabledBefore: boolean("enabled_before").notNull(),
  lastActivity: timestamp("last_activity", { withTimezone: true }),
  decision: text("decision").notNull(), // KEEP | REMOVE
  enabledAfter: boolean("enabled_after").notNull(),
  outcome: text("outcome").notNull(), // plain words: "Kept", "Disabled", "Already disabled", "Could not disable: ..."
});

/** Each clean-up run of the retention policy (scheduled or by hand), with what it cleared. */
export const retentionRuns = pgTable("retention_runs", {
  id: serial("id").primaryKey(),
  dryRun: boolean("dry_run").notNull().default(false),
  trigger: text("trigger").notNull(), // SCHEDULED | MANUAL
  policyVersion: integer("policy_version"),
  counts: jsonb("counts").$type<Record<string, number>>().notNull().default({}),
  details: jsonb("details").$type<{ category: string; ref: string; what: string }[]>().notNull().default([]),
  runBy: text("run_by").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});
