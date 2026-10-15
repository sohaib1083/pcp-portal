// Postgraduate programme accreditation (RFP 4.1.10): MS/MPhil and PhD, one programme per field of study.
// Pure helpers and the rule's shape, so the case screens and the server checks read the same rule.
// The values live in the versioned `pg.rules` reference rule; DEFAULT_PG_RULE is used only when it is missing.
import type { SupervisorDetails } from "@/db/schema";
import { PG_FIELDS, PROGRAM_LABELS } from "./workflow";

/** Requirements for one postgraduate programme type. */
export type PgTypeRule = {
  maxIntake: number;
  minDurationYears: number;
  minCourseworkCredits: number;
  thesisRequired: boolean;
  minResearchLabs: number;
  minJournals: number;
  /** HEC Digital Library access is required. */
  hecDigitalLibrary: boolean;
  /** A supervisor needs this qualification ... */
  supervisorQualification: string;
  /** ... and this many publications, */
  minPublications: number;
  /** ... or HEC-approved supervisor status instead of the publications. */
  hecApprovedCounts: boolean;
  /** Maximum postgraduate students per supervisor at a time; also sets the supervisors needed for an intake. */
  maxStudentsPerSupervisor: number;
  minSupervisors: number;
  /** Minimum PhD faculty in the programme's field among the linked faculty. */
  minPhdFacultyInField: number;
  requiredDocs: string[];
  accreditationYears: number;
};

export type PgRule = {
  fields: string[];
  /** Specialisations that count for a field; "*" means any pharmacy specialisation (broad fields). */
  fieldSpecialisations?: Record<string, string[]>;
  types: Record<string, PgTypeRule>;
};

export const HEC_NOC_DOC = "HEC NOC for the PG programme";

export const DEFAULT_PG_RULE: PgRule = {
  fields: PG_FIELDS,
  fieldSpecialisations: {
    "Pharmacy Practice/Clinical Pharmacy": ["Pharmacy Practice", "Clinical Pharmacy"],
    "Pharmaceutical Sciences": ["*"],
    Pharmacy: ["*"],
  },
  types: {
    MPHIL: {
      maxIntake: 20,
      minDurationYears: 2,
      minCourseworkCredits: 24,
      thesisRequired: true,
      minResearchLabs: 1,
      minJournals: 10,
      hecDigitalLibrary: true,
      supervisorQualification: "PhD",
      minPublications: 3,
      hecApprovedCounts: true,
      maxStudentsPerSupervisor: 5,
      minSupervisors: 1,
      minPhdFacultyInField: 2,
      requiredDocs: [HEC_NOC_DOC, "PG scheme of studies", "Research laboratory inventory"],
      accreditationYears: 3,
    },
    PHD: {
      maxIntake: 12,
      minDurationYears: 3,
      minCourseworkCredits: 18,
      thesisRequired: true,
      minResearchLabs: 2,
      minJournals: 20,
      hecDigitalLibrary: true,
      supervisorQualification: "PhD",
      minPublications: 5,
      hecApprovedCounts: true,
      maxStudentsPerSupervisor: 3,
      minSupervisors: 1,
      minPhdFacultyInField: 3,
      requiredDocs: [HEC_NOC_DOC, "PG scheme of studies", "Research laboratory inventory"],
      accreditationYears: 3,
    },
  },
};

/** Demo fees per postgraduate case, used when the `fees` rule has no line for them. */
export const DEFAULT_PG_FEES: Record<string, number> = {
  "ACCREDITATION:MPHIL": 250000,
  "ACCREDITATION:PHD": 350000,
  "RENEWAL:MPHIL": 150000,
  "RENEWAL:PHD": 200000,
};

export function pgTypeRule(rule: PgRule, type: string): PgTypeRule {
  return rule.types[type] ?? DEFAULT_PG_RULE.types[type] ?? DEFAULT_PG_RULE.types.PHD;
}

/** "a PhD supervisor", "an MS/MPhil supervisor". */
export const aType = (type: string) => `${type === "MPHIL" ? "an" : "a"} ${PROGRAM_LABELS[type] ?? type}`;

/** Does a teacher's specialisation count for a postgraduate field? */
export function inField(rule: PgRule, field: string, specialization: string) {
  const allowed = (rule.fieldSpecialisations ?? DEFAULT_PG_RULE.fieldSpecialisations)?.[field];
  if (allowed?.includes("*")) return true;
  if (allowed) return allowed.includes(specialization);
  return specialization === field;
}

/** Eligible supervisors needed for an intake: max(minimum, intake / students per supervisor, rounded up). */
export function supervisorsRequired(r: PgTypeRule, intake: number) {
  return Math.max(r.minSupervisors, intake > 0 ? Math.ceil(intake / r.maxStudentsPerSupervisor) : r.minSupervisors);
}

export type SupervisorLike = { fullName: string; pcpId: string; qualification: string; specialization: string; details?: SupervisorDetails | null };

/** One supervisor against the rule: eligible, and if not, each reason with the rule it breaks. */
export function supervisorEligibility(s: SupervisorLike, type: string, r: PgTypeRule) {
  const pubs = Number(s.details?.publications ?? 0);
  const hec = !!s.details?.hecApproved;
  const current = Number(s.details?.currentStudents ?? 0);
  const reasons: string[] = [];
  if (s.qualification !== r.supervisorQualification) reasons.push(`holds ${s.qualification}; ${aType(type)} supervisor needs a ${r.supervisorQualification}`);
  else if (pubs < r.minPublications && !(r.hecApprovedCounts && hec))
    reasons.push(`${pubs} publication${pubs === 1 ? "" : "s"}${r.hecApprovedCounts ? " and not HEC-approved" : ""}; ${aType(type)} supervisor needs ${r.minPublications} publications${r.hecApprovedCounts ? " or HEC-approved supervisor status" : ""}`);
  if (current >= r.maxStudentsPerSupervisor) reasons.push(`already supervises ${current} students; the maximum is ${r.maxStudentsPerSupervisor} per supervisor`);
  const basis = hec && r.hecApprovedCounts ? "HEC-approved" : `${pubs} publication${pubs === 1 ? "" : "s"}`;
  return {
    eligible: reasons.length === 0,
    reasons,
    summary: `${s.qualification} ${s.specialization} · ${basis} · ${current} of ${r.maxStudentsPerSupervisor} students`,
  };
}
