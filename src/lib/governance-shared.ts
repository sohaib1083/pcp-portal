// Labels and small helpers for the governance module (court cases, correspondence, committees).
// No database imports: client components use this file too.

export const COURT_STATUS: Record<string, { label: string; tone: "info" | "warn" | "bad" | "good" | "neutral" | "violet" }> = {
  PENDING: { label: "Pending", tone: "info" },
  INTERIM_ORDER: { label: "Interim order", tone: "violet" },
  STAY_GRANTED: { label: "Stay granted", tone: "bad" },
  DISPOSED_FAVOUR: { label: "Disposed in favour", tone: "good" },
  DISPOSED_AGAINST: { label: "Disposed against", tone: "warn" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral" },
};
export const OPEN_COURT_STATUSES = ["PENDING", "INTERIM_ORDER", "STAY_GRANTED"];

export const NATURE_LABELS: Record<string, string> = {
  WRIT: "Writ petition",
  APPEAL: "Appeal",
  CONTEMPT: "Contempt petition",
  CIVIL_SUIT: "Civil suit",
  SERVICE: "Service matter",
};

export const ORDER_LABELS: Record<string, string> = {
  STAY: "Stay order",
  INTERIM: "Interim order",
  FINAL: "Final order or judgment",
  OTHER: "Other order",
};

export const MODE_LABELS: Record<string, string> = { POST: "Post", COURIER: "Courier", EMAIL: "Email", HAND: "By hand" };

export const LETTER_STATUS: Record<string, { label: string; tone: "info" | "good" | "neutral" | "warn" }> = {
  OPEN: { label: "Open", tone: "info" },
  ACTIONED: { label: "Actioned", tone: "good" },
  CLOSED: { label: "Closed", tone: "neutral" },
};

export const TASK_STATUS: Record<string, { label: string; tone: "info" | "violet" | "good" }> = {
  OPEN: { label: "Open", tone: "info" },
  IN_PROGRESS: { label: "In progress", tone: "violet" },
  DONE: { label: "Done", tone: "good" },
};

/** Courts PCP appears before (the ref.courts rule; this list is used if the rule is missing). */
export const DEFAULT_COURTS = [
  "Islamabad High Court",
  "Lahore High Court",
  "Sindh High Court",
  "Peshawar High Court",
  "Balochistan High Court",
  "Supreme Court of Pakistan",
  "Civil court",
  "Other",
];

/** The usual short form: Islamabad High Court is IHC, the Supreme Court is SC. */
export function courtShort(court: string) {
  if (/^supreme court/i.test(court)) return "SC";
  const hc = /^(\w+) High Court/i.exec(court);
  if (hc) return `${hc[1][0].toUpperCase()}HC`;
  return court;
}

export type Committee = { name: string; prefix: string; chair: string | null; members: string[]; remit: string; decides: boolean };

/** The committees PCP runs (the ref.committees rule; this list is used if the rule is missing). */
export const DEFAULT_COMMITTEES: Committee[] = [
  { name: "Council", prefix: "CM", chair: "pcp.secretary", members: ["pcp.secretary"], remit: "Decides NOC, accreditation and renewal cases and hears appeals.", decides: true },
  { name: "Accreditation Committee", prefix: "ACM", chair: "pcp.secretary", members: ["pcp.secretary", "pcp.technical", "pcp.officer", "pcp.verification"], remit: "Reviews accreditation and renewal cases and recommends to the Council.", decides: false },
  { name: "Inspection Committee", prefix: "ICM", chair: "pcp.coordinator", members: ["pcp.coordinator", "pcp.inspector", "pcp.inspector2", "pcp.officer"], remit: "Plans inspection programmes, reviews inspection reports and conflicts of interest.", decides: false },
  { name: "Appeals Committee", prefix: "APC", chair: "pcp.secretary", members: ["pcp.secretary", "pcp.legal", "pcp.registration"], remit: "Examines appeals and court matters and recommends to the Council.", decides: false },
  { name: "Finance Committee", prefix: "FCM", chair: "pcp.accounts", members: ["pcp.accounts", "pcp.secretary", "pcp.admin"], remit: "Fees, budget, reconciliation and outstanding dues.", decides: false },
];

/** What a reference points at, from its prefix. */
export function refKind(ref: string): "case" | "appeal" | "court" | "letter" | null {
  if (/^APL-\d{4}-\d{4}$/.test(ref)) return "appeal";
  if (/^LIT-\d{4}-\d{4}$/.test(ref)) return "court";
  if (/^(IN|OUT)-\d{4}-\d{5}$/.test(ref)) return "letter";
  if (/^[A-Z]{2,5}-\d{4}-\d{4}$/.test(ref)) return "case"; // NOC-, ACC-, RNW- and any other case prefix
  return null;
}

/** The PCP screen for a reference. */
export function refHref(ref: string) {
  const k = refKind(ref);
  return k === "case" ? `/pcp/applications/${ref}` : k === "appeal" ? `/pcp/appeals/${ref}` : k === "court" ? `/pcp/litigation/${ref}` : k === "letter" ? `/pcp/correspondence/${ref}` : null;
}

/** Today's date in Pakistan (UTC+5, no daylight saving): the date written on letters, orders and hearings. */
export const pkToday = (at = new Date()) => new Date(at.getTime() + 5 * 3600000).toISOString().slice(0, 10);

/** Days from today (in Pakistan) to a YYYY-MM-DD date: 0 today, 1 tomorrow, -1 yesterday. */
export const dayDiff = (ymd: string, from = new Date()) => {
  const [ty, tm, td] = pkToday(from).split("-").map(Number);
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
};
