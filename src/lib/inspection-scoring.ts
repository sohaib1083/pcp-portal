// Inspection score entry (RFP 4.1.2 "score entry panels", 4.1.14): a score per checklist line next to the
// Compliant / Partial / Non-compliant result, a weighted total, a percentage and a pass threshold.
// The values live in the versioned `inspection.scoring` rule; DEFAULT_SCORING is used only when it is missing.
// Pure functions: the tablet computes the total as the inspector types, the server recomputes it on submit.

export type ScoredResult = "COMPLIANT" | "PARTIAL" | "NON_COMPLIANT";

export type ScoringRule = {
  maxScore: number;
  passPercent: number;
  /** The scores each result allows, so a line marked Compliant cannot score 0. */
  bands: Record<ScoredResult, [number, number]>;
  /** The score a line starts with when its result is chosen. */
  defaults: Record<ScoredResult, number>;
  /** Weight per checklist line (criterion text); lines not listed weigh 1. */
  weights: Record<string, number>;
};

export const DEFAULT_SCORING: ScoringRule = {
  maxScore: 5,
  passPercent: 60,
  bands: { COMPLIANT: [4, 5], PARTIAL: [2, 3], NON_COMPLIANT: [0, 1] },
  defaults: { COMPLIANT: 5, PARTIAL: 3, NON_COMPLIANT: 1 },
  weights: {
    "Faculty: qualified, full-time, as per submitted list": 3,
    "Laboratories: equipment, chemicals and safety": 2,
    "Library: books, journals and digital access": 1,
    "Classrooms and building": 1,
    "Student records and attendance": 1,
    "Hospital / pharmacy practice linkage": 1,
    "Governance and finances": 1,
    "Supervisors: in post, qualified and within the student limit": 3,
    "Research laboratories: equipment, consumables and safety": 2,
    "Library: journals and HEC Digital Library access": 1,
    "Coursework: timetable, teachers and assessment records": 1,
    "Research governance: ethics and biosafety committees": 1,
    "Thesis records: synopsis approvals and progress reports": 1,
  },
};

export const weightFor = (rule: ScoringRule, criterion: string) => rule.weights?.[criterion] ?? 1;

/** The scores allowed for a result, or null for not applicable (the line is left out of the total). */
export function bandFor(rule: ScoringRule, result: string): [number, number] | null {
  if (result === "NA") return null;
  return rule.bands?.[result as ScoredResult] ?? [0, rule.maxScore];
}

export const defaultScore = (rule: ScoringRule, result: string) => (result === "NA" ? null : (rule.defaults?.[result as ScoredResult] ?? rule.maxScore));

export type ScoreLine = { criterion: string; result: string; score?: number | null; weight?: number };

/** Weighted total, maximum, percentage and pass or fail for a checklist. */
export function scoreTotals(lines: ScoreLine[], rule: ScoringRule) {
  let total = 0;
  let max = 0;
  let counted = 0;
  for (const l of lines) {
    if (l.result === "NA") continue;
    const w = l.weight ?? weightFor(rule, l.criterion);
    const s = l.score ?? defaultScore(rule, l.result) ?? 0;
    total += s * w;
    max += rule.maxScore * w;
    counted++;
  }
  const percent = max ? Math.round((total / max) * 1000) / 10 : 0;
  return { total, max, percent, passPercent: rule.passPercent, passed: counted > 0 && percent >= rule.passPercent, counted };
}

/** A line's score problem in words, or null when it fits its result's band. */
export function scoreProblem(rule: ScoringRule, l: ScoreLine): string | null {
  const band = bandFor(rule, l.result);
  if (!band) return null;
  if (l.score === null || l.score === undefined || Number.isNaN(l.score)) return `${l.criterion.split(":")[0]}: enter a score from ${band[0]} to ${band[1]}`;
  if (l.score < band[0] || l.score > band[1]) return `${l.criterion.split(":")[0]}: a ${l.result === "COMPLIANT" ? "compliant" : l.result === "PARTIAL" ? "partially compliant" : "non-compliant"} line scores ${band[0]} to ${band[1]}, not ${l.score}`;
  return null;
}
