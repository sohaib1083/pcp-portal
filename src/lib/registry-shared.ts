// Faculty and student registry: constants and pure helpers shared by server actions and screens.
// No database imports here, so client components can use it.
import type { AnnualFigures } from "@/db/modules/students";

export const FIGURE_KEYS = ["enrolled", "promoted", "passed", "failed", "repeat", "graduated", "withdrawn"] as const;
export type FigureKey = (typeof FIGURE_KEYS)[number];

export const FIGURE_LABELS: Record<FigureKey, string> = {
  enrolled: "Enrolled",
  promoted: "Promoted",
  passed: "Passed",
  failed: "Failed",
  repeat: "Repeating",
  graduated: "Graduated",
  withdrawn: "Withdrawn",
};

export const FIGURE_HELP: Record<FigureKey, string> = {
  enrolled: "Students on roll during the year, including new entrants",
  promoted: "Passed and moved up to the next year of study",
  passed: "Passed the annual examination",
  failed: "Failed the annual examination",
  repeat: "Repeating the same year of study",
  graduated: "Completed the final year",
  withdrawn: "Left the programme during the year",
};

/** Programme length in years: PharmD is five years, Pharmacy Technician two. */
export const PROGRAMME_YEARS: Record<string, number> = { PHARMD: 5, TECH: 2 };

export const SHIFTS = ["Morning", "Evening", "Self-finance"] as const;

/** The annual student update is due on 31 October; the annual faculty update on 31 December. */
export const annualReturnDue = (year: number) => `${year}-10-31`;
export const facultyUpdateDue = (year: number) => `${year}-12-31`;

export const CHANGE_KIND_LABELS: Record<string, string> = {
  NEW_LINK: "Link request",
  END_LINK: "End appointment",
  CHANGE_PROGRAMME: "Change programme",
  CHANGE_DESIGNATION: "Change designation",
  CORRECT_DETAILS: "Correct details",
};

export const DETAIL_FIELD_LABELS: Record<string, string> = {
  fullName: "Full name",
  fatherName: "Father's name",
  qualification: "Qualification",
  specialization: "Specialization",
  pcpRegNo: "Registration no.",
  designation: "Designation",
  programType: "Programme",
  endDate: "End date",
};

export const QUALIFICATIONS = ["PhD", "MPhil", "PharmD", "M.Pharm"];
export const SPECIALIZATIONS = ["Pharmacology", "Pharmaceutics", "Pharmaceutical Chemistry", "Pharmacognosy", "Pharmacy Practice", "Clinical Pharmacy"];
export const DESIGNATIONS = ["Professor", "Associate Professor", "Assistant Professor", "Lecturer"];

export type FigureChange = { field: string; from: number; to: number };

/** Original figures with every approved correction applied in order. The original is never overwritten. */
export function applyCorrections(original: AnnualFigures | null, approved: { changes: FigureChange[] }[]): AnnualFigures | null {
  if (!original) return null;
  const out = { ...original };
  for (const c of approved) for (const ch of c.changes) if ((FIGURE_KEYS as readonly string[]).includes(ch.field)) out[ch.field as FigureKey] = ch.to;
  return out;
}

export const emptyFigures = (): AnnualFigures => ({ enrolled: 0, promoted: 0, passed: 0, failed: 0, repeat: 0, graduated: 0, withdrawn: 0 });

/** Sanity checks on a return's figures. Returns plain-English problems; an empty list means the figures add up. */
export function figureProblems(f: AnnualFigures): string[] {
  const p: string[] = [];
  for (const k of FIGURE_KEYS) if (!Number.isInteger(f[k]) || f[k] < 0) p.push(`${FIGURE_LABELS[k]} must be a whole number, 0 or more.`);
  if (p.length) return p;
  if (f.passed + f.failed > f.enrolled) p.push(`Passed (${f.passed}) plus failed (${f.failed}) is more than enrolled (${f.enrolled}).`);
  if (f.promoted + f.repeat + f.graduated + f.withdrawn > f.enrolled)
    p.push(`Promoted, repeating, graduated and withdrawn add up to ${f.promoted + f.repeat + f.graduated + f.withdrawn}, more than enrolled (${f.enrolled}).`);
  if (f.promoted + f.graduated > f.passed) p.push(`Promoted plus graduated (${f.promoted + f.graduated}) is more than passed (${f.passed}).`);
  return p;
}

// ---------- Bulk upload ----------

export const UPLOAD_COLUMNS = ["full_name", "father_name", "cnic", "mobile", "email", "programme", "session", "enrolment_year", "year_of_study"] as const;
export type UploadRow = Record<(typeof UPLOAD_COLUMNS)[number], string>;

export const UPLOAD_TEMPLATE_ROWS: UploadRow[] = [
  { full_name: "Ayesha Siddiqa", father_name: "Muhammad Siddiq", cnic: "17301-5550001-2", mobile: "0301-5550001", email: "ayesha.siddiqa@student.demo", programme: "PHARMD", session: "Morning", enrolment_year: "2026", year_of_study: "1" },
];

export function toCsv(rows: Record<string, string | number>[], columns: string[]) {
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}
