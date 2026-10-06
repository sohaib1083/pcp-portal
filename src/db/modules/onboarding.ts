// Module: institution onboarding (guide section 3). Owner: onboarding work.
import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export type OnboardingProfile = {
  name?: string;
  shortCode?: string;
  sector?: "Public" | "Private";
  province?: string;
  city?: string;
  address?: string;
  website?: string;
  phone?: string;
  establishedYear?: number;
  affiliationType?: "University" | "Affiliated college" | "Constituent college";
  affiliatedUniversity?: string;
};
export type OnboardingCampus = { name: string; city: string; province: string; address?: string; isMain: boolean };
export type OnboardingProgramme = { type: "PHARMD" | "TECH"; campus: string; plannedIntake?: number; startYear?: number };

/** A self-registered institution before PCP approves it. Approval issues the PCP-UNI ID. */
export const onboardingRequests = pgTable("onboarding_requests", {
  id: serial("id").primaryKey(),
  ref: text("ref").notNull().unique(), // REG-2026-0001
  status: text("status").notNull().default("DRAFT"), // DRAFT | SUBMITTED | RETURNED | REJECTED | APPROVED
  applicantUsername: text("applicant_username").notNull().unique(),
  applicantName: text("applicant_name").notNull(),
  applicantDesignation: text("applicant_designation"),
  email: text("email").notNull(),
  mobile: text("mobile").notNull(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  mobileVerifiedAt: timestamp("mobile_verified_at", { withTimezone: true }),
  profile: jsonb("profile").$type<OnboardingProfile>().notNull().default({}),
  campuses: jsonb("campuses").$type<OnboardingCampus[]>().notNull().default([]),
  programmes: jsonb("programmes").$type<OnboardingProgramme[]>().notNull().default([]),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  reviewNote: text("review_note"), // reason when returned or rejected
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  institutionId: integer("institution_id"), // set on approval
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
