// Module: faculty registry changes and inspection teams. Owner: faculty work.
import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/** Once PCP has verified a faculty link, a later change opens a change request (guide section 2). */
export const facultyChangeRequests = pgTable("faculty_change_requests", {
  id: serial("id").primaryKey(),
  ref: text("ref").notNull().unique(), // FCR-2026-0001
  facultyId: integer("faculty_id").notNull(),
  linkId: integer("link_id"),
  institutionId: integer("institution_id").notNull(),
  kind: text("kind").notNull(), // END_LINK | CHANGE_PROGRAMME | CHANGE_DESIGNATION | CORRECT_DETAILS
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("PENDING"), // PENDING | APPROVED | REJECTED
  requestedBy: text("requested_by").notNull(),
  decidedBy: text("decided_by"),
  decisionNote: text("decision_note"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Inspection team members besides the lead (inspections.inspector). */
export const inspectionTeam = pgTable("inspection_team", {
  id: serial("id").primaryKey(),
  inspectionId: integer("inspection_id").notNull(),
  username: text("username").notNull(),
  role: text("role").notNull().default("MEMBER"), // LEAD | MEMBER
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Declared conflicts of interest, checked when assigning inspectors (in addition to the same-province rule). */
export const conflictDeclarations = pgTable("conflict_declarations", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  institutionId: integer("institution_id").notNull(),
  reason: text("reason").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
