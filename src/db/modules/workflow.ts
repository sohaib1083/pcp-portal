// Module: NOC / accreditation / renewal case workflow. Owner: workflow work.
import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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
