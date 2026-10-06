// Module: accounts reconciliation (guide section 14). Owner: accounts work.
// Payments and dues themselves are core tables (src/db/schema.ts) because the case workflow uses them too.
import { date, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/** One import of the bank's settlement statement (simulated): generated in the demo, or uploaded as CSV. */
export const bankStatements = pgTable("bank_statements", {
  id: serial("id").primaryKey(),
  ref: text("ref").notNull().unique(), // STMT-2026-0001
  statementDate: date("statement_date").notNull(),
  source: text("source").notNull(), // DEMO | CSV
  fileName: text("file_name"),
  lineCount: integer("line_count").notNull().default(0),
  matchedCount: integer("matched_count").notNull().default(0),
  importedBy: text("imported_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A line from the bank's settlement statement (simulated), matched to a payment by PSID. */
export const bankStatementLines = pgTable("bank_statement_lines", {
  id: serial("id").primaryKey(),
  statementDate: date("statement_date").notNull(),
  psid: text("psid"),
  amount: integer("amount").notNull(),
  bankRef: text("bank_ref").notNull(),
  channel: text("channel").notNull(), // RAAST | 1LINK | BRANCH
  status: text("status").notNull().default("UNMATCHED"), // MATCHED | UNMATCHED | IGNORED
  matchedPaymentId: integer("matched_payment_id"),
  importedBy: text("imported_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  statementId: integer("statement_id"), // the import this line came from
  narration: text("narration"), // the bank's description of the credit
  reason: text("reason"), // why auto-match failed, in plain words
  matchType: text("match_type"), // AUTO | MANUAL
  resolvedBy: text("resolved_by"), // who matched or ignored it by hand
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  note: text("note"),
});
