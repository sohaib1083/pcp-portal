// Report shapes shared by the server (builders, exports) and the client (tables, charts). Pure: no imports.

export type ReportId = "institutions" | "intake" | "graduates" | "ratio" | "validity" | "early-warning" | "measures" | "payments";
export const STANDARD_REPORTS: Exclude<ReportId, "payments">[] = ["institutions", "intake", "graduates", "ratio", "validity", "early-warning", "measures"];

export type ReportFilters = {
  province?: string;
  sector?: string;
  programme?: string; // PHARMD | TECH
  year?: number;
  // payments ledger only
  status?: string;
  from?: string;
  to?: string;
  institution?: string; // PCP-UNI code
  purpose?: string;
};
export type FilterKey = "province" | "sector" | "programme" | "year";

export type ColType = "text" | "int" | "pct" | "date" | "num" | "money" | "code";
export type ReportCol = { key: string; title: string; type?: ColType };
export type Cell = string | number | null;

export type DrillKind = "institutions" | "students" | "faculty" | "programmes" | "deficiencies" | "returns" | "faculty-moves" | "payments" | "cases" | "return-timeliness";
export type Drill = { kind: DrillKind; params: Record<string, string | number | null | undefined>; label: string };

export type ReportRow = {
  key: string;
  cells: Record<string, Cell>;
  drill?: Record<string, Drill>; // per column: which list the figure opens
  flag?: "bad" | "warn" | null; // highlighted rows (expiring soon, over intake, above ratio)
  total?: boolean;
};

export type ChartSeries = { name: string; data: number[]; color?: string; drills?: (Drill | null)[]; colors?: (string | null)[] };
export type ReportChart = {
  type: "hbar" | "vbar";
  stacked?: boolean;
  categories: string[];
  series: ChartSeries[];
  caption?: string;
  targets?: { value: number; label: string }[]; // dashed target lines (measures of success)
  valueSuffix?: string; // shown after each bar label, e.g. "%" or " d"
};

/** A headline figure with its target (measures of success). */
export type ReportKpi = { key: string; label: string; value: string; target: string; met: boolean | null; detail: string; drill?: Drill };
/** A report with several tables on screen; `Report.columns/rows` then hold the same figures as one table for export. */
export type ReportSection = { key: string; title: string; sub?: string; columns: ReportCol[]; rows: ReportRow[]; chart: ReportChart | null };

export type Report = {
  id: ReportId;
  title: string;
  sub: string;
  filters: FilterKey[]; // which filters apply
  columns: ReportCol[];
  rows: ReportRow[];
  chart: ReportChart | null;
  notes: string[];
  kpis?: ReportKpi[];
  sections?: ReportSection[];
};

export type DrillResult = { title: string; columns: ReportCol[]; rows: Record<string, Cell>[]; truncated?: boolean };

export const PROVINCES = ["Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan", "Gilgit-Baltistan", "Islamabad Capital Territory", "Azad Jammu and Kashmir"];
export const PROGRAMME_LABELS: Record<string, string> = { PHARMD: "PharmD", TECH: "Pharmacy Technician", MPHIL: "MS/MPhil", PHD: "PhD" };

/** Filters to and from a URL query string (the page, the export links and the server all use this). */
export function filtersToQuery(f: ReportFilters) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  return q.toString();
}

export function filtersFromQuery(q: URLSearchParams | Record<string, string | string[] | undefined>): ReportFilters {
  const get = (k: string) => {
    const v = q instanceof URLSearchParams ? q.get(k) : q[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.trim() ? s.trim().slice(0, 80) : undefined;
  };
  const year = Number(get("year"));
  const programme = get("programme");
  const sector = get("sector");
  return {
    province: get("province"),
    sector: sector === "Public" || sector === "Private" ? sector : undefined,
    programme: programme && programme in PROGRAMME_LABELS ? programme : undefined,
    year: Number.isInteger(year) && year > 1990 && year < 2100 ? year : undefined,
    status: get("status"),
    from: get("from"),
    to: get("to"),
    institution: get("institution"),
    purpose: get("purpose"),
  };
}

export function describeFilters(f: ReportFilters, applies: FilterKey[] = ["province", "sector", "programme", "year"]) {
  const parts: string[] = [];
  if (applies.includes("province")) parts.push(`Province: ${f.province ?? "all"}`);
  if (applies.includes("sector")) parts.push(`Sector: ${f.sector ?? "all"}`);
  if (applies.includes("programme")) parts.push(`Programme: ${f.programme ? PROGRAMME_LABELS[f.programme] : "all"}`);
  if (applies.includes("year")) parts.push(`Year: ${f.year ?? "all"}`);
  if (f.status) parts.push(`Status: ${f.status.toLowerCase()}`);
  if (f.from || f.to) parts.push(`Dates: ${f.from ?? "start"} to ${f.to ?? "today"}`);
  if (f.institution) parts.push(`Institution: ${f.institution}`);
  if (f.purpose) parts.push(`Purpose: ${f.purpose}`);
  return parts.join(" | ");
}

/** Display a cell the same way on screen, in the PDF and in the CSV. */
export function formatCell(v: Cell, type?: ColType) {
  if (v === null || v === undefined || v === "") return "-";
  if (typeof v === "number") {
    if (type === "code" || type === "text") return String(v);
    if (type === "pct") return `${Math.round(v * 100)}%`;
    if (type === "money") return `Rs ${v.toLocaleString("en-PK")}`;
    if (type === "num") return v.toLocaleString("en-PK", { maximumFractionDigits: 1 });
    return v.toLocaleString("en-PK");
  }
  if (type === "date" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(v.length === 10 ? `${v}T00:00:00Z` : v);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }
  return v;
}
