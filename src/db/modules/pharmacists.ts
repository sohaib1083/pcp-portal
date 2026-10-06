// Module: pharmacist register and public check (guide section 9). Owner: pharmacists work.
// PCP does not license pharmacists; this register is an index of the provincial councils' registers.
import { boolean, date, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

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
  mobile: text("mobile"),
  email: text("email"),
  username: text("username").unique(), // pharmacist login, if any
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A pharmacist's own update to practice details, applied only after verification. */
export const practiceUpdates = pgTable("practice_updates", {
  id: serial("id").primaryKey(),
  pharmacistId: integer("pharmacist_id").notNull(),
  practicePlace: text("practice_place").notNull(),
  designation: text("designation").notNull(),
  evidenceDocumentId: integer("evidence_document_id"),
  status: text("status").notNull().default("PENDING"), // PENDING | VERIFIED | REJECTED
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNote: text("review_note"),
});
