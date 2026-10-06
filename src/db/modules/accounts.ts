// Module: accounts reconciliation (guide section 14). Owner: accounts work.
// Payments and dues themselves are core tables (src/db/schema.ts) because the case workflow uses them too.
import { date, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

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
});
