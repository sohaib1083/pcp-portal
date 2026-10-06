// Module: annual student return and corrections (guide section 8). Owner: students work.
import { integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export type AnnualFigures = {
  enrolled: number;
  promoted: number;
  passed: number;
  failed: number;
  repeat: number;
  graduated: number;
  withdrawn: number;
};

/** One return per institution, programme and year. After PCP accepts it, the year locks. */
export const annualReturns = pgTable(
  "annual_returns",
  {
    id: serial("id").primaryKey(),
    ref: text("ref").notNull().unique(), // AR-2026-RUH-PHARMD
    institutionId: integer("institution_id").notNull(),
    programType: text("program_type").notNull(),
    year: integer("year").notNull(),
    status: text("status").notNull().default("DRAFT"), // DRAFT | SUBMITTED | ACCEPTED | RETURNED
    figures: jsonb("figures").$type<AnnualFigures>(),
    note: text("note"),
    evidenceDocumentId: integer("evidence_document_id"),
    dueDate: text("due_date"),
    submittedBy: text("submitted_by"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("annual_return_unique").on(t.institutionId, t.programType, t.year)],
);

/** A change to a locked year. The original figures stay visible. */
export const correctionRequests = pgTable("correction_requests", {
  id: serial("id").primaryKey(),
  ref: text("ref").notNull().unique(), // CR-2026-0001
  annualReturnId: integer("annual_return_id").notNull(),
  institutionId: integer("institution_id").notNull(),
  changes: jsonb("changes").$type<{ field: string; from: number; to: number }[]>().notNull().default([]),
  reason: text("reason").notNull(),
  evidenceDocumentId: integer("evidence_document_id"),
  status: text("status").notNull().default("PENDING"), // PENDING | APPROVED | REJECTED
  requestedBy: text("requested_by").notNull(),
  decidedBy: text("decided_by"),
  decisionNote: text("decision_note"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
