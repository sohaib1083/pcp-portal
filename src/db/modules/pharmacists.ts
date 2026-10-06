// Module: pharmacist register and public check (guide section 9). Owner: pharmacists work.
// PCP does not license pharmacists; this register is an index of the provincial councils' registers.
import { boolean, date, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const pharmacists = pgTable("pharmacists", {
  id: serial("id").primaryKey(),
  regNo: text("reg_no").notNull().unique(),
  fullName: text("full_name").notNull(),
  fatherName: text("father_name").notNull(),
  cnic: text("cnic").notNull().unique(),
  gender: text("gender"),
  university: text("university").notNull(),
  graduationYear: integer("graduation_year").notNull(),
  category: text("category").notNull(), // A (Pharm-D) | B (Technician) | C
  council: text("council").notNull(), // Punjab | Sindh | Khyber Pakhtunkhwa | Balochistan | Gilgit-Baltistan
  issueDate: date("issue_date").notNull(),
  validUntil: date("valid_until"),
  status: text("status").notNull().default("ACTIVE"), // ACTIVE | DORMANT | CANCELLED | SUSPENDED
  practicePlace: text("practice_place"), // shown only when confirmed
  designation: text("designation"),
  practiceConfirmed: boolean("practice_confirmed").notNull().default(false),
  practiceConfirmedAt: timestamp("practice_confirmed_at", { withTimezone: true }),
  mobile: text("mobile"),
  email: text("email"),
  address: text("address"), // home address: held for the council, never shown publicly
  username: text("username").unique(), // pharmacist login, if any
  importId: integer("import_id"), // the provincial file this row came from
  cardDocumentId: integer("card_document_id"), // latest registration card PDF
  cardFingerprint: text("card_fingerprint"), // what the card shows; a change issues a new card version
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A pharmacist's own update to practice details, applied only after verification. */
export const practiceUpdates = pgTable("practice_updates", {
  id: serial("id").primaryKey(),
  pharmacistId: integer("pharmacist_id").notNull(),
  practicePlace: text("practice_place").notNull(),
  designation: text("designation").notNull(),
  evidenceDocumentId: integer("evidence_document_id"),
  status: text("status").notNull().default("PENDING"), // PENDING | VERIFIED | REJECTED | WITHDRAWN
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNote: text("review_note"),
});

/** What happened to a register entry: imports, status changes, practice decisions, logins. */
export const pharmacistEvents = pgTable("pharmacist_events", {
  id: serial("id").primaryKey(),
  pharmacistId: integer("pharmacist_id").notNull(),
  kind: text("kind").notNull(), // IMPORTED | STATUS | PRACTICE | LOGIN | CARD
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  note: text("note"),
  actor: text("actor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One file received from a provincial council, with its row-by-row result. */
export const pharmacistImports = pgTable("pharmacist_imports", {
  id: serial("id").primaryKey(),
  ref: text("ref").notNull().unique(), // IMP-2026-0001
  council: text("council").notNull(),
  fileName: text("file_name").notNull(),
  totalRows: integer("total_rows").notNull(),
  importedRows: integer("imported_rows").notNull(),
  errorRows: integer("error_rows").notNull(),
  errors: jsonb("errors").$type<{ row: number; regNo: string; errors: string[] }[]>().notNull().default([]),
  importedBy: text("imported_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
