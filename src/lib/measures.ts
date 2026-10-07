// Measures of success (guide section 14, "Moving from paper to the system"): days to decide an NOC, share of
// cases returned for deficiency, and share of institutions filing the annual return on time. Each figure has its
// target from the `kpi.targets` reference rule; the annual return deadline comes from `annual.returnDeadline`.
// Used by the Reports page (7th report), its Excel/PDF/CSV export and the drill-down lists.
import { eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { getRule } from "./rules";
import { PROGRAMME_LABELS, PROVINCES, type Cell, type Drill, type DrillResult, type Report, type ReportCol, type ReportFilters, type ReportKpi, type ReportRow, type ReportSection } from "./report-types";

export type KpiTargets = { nocDecisionDays: number; accreditationDecisionDays: number; deficiencySharePct: number; onTimeSharePct: number };
export const KPI_RULE = "kpi.targets";
export const DEADLINE_RULE = "annual.returnDeadline";
export const DEFAULT_TARGETS: KpiTargets = { nocDecisionDays: 60, accreditationDecisionDays: 90, deficiencySharePct: 30, onTimeSharePct: 90 };

const DAY = 86400000;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const COLORS = { noc: "#0f8a63", acc: "#2a78d6", warn: "#e8a20c", bad: "#d03b3b", good: "#12a150" };
const prog = (t: string) => PROGRAMME_LABELS[t] ?? t;
const dateOnly = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const fmtDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "31 October" -> { day: 31, month: 9 }. Null when it is not a day and a month name. */
export function parseDeadline(v: unknown): { day: number; month: number; label: string } | null {
  const m = /^\s*(\d{1,2})\s+([A-Za-z]+)\s*$/.exec(String(v ?? ""));
  if (!m) return null;
  const month = MONTHS.findIndex((x) => x.startsWith(m[2].toLowerCase()) && m[2].length >= 3);
  const day = Number(m[1]);
  if (month < 0 || day < 1 || day > new Date(Date.UTC(2001, month + 1, 0)).getUTCDate()) return null;
  return { day, month, label: `${day} ${MONTHS[month][0].toUpperCase()}${MONTHS[month].slice(1)}` };
}

export async function kpiTargets(): Promise<{ value: KpiTargets; version: number | null }> {
  try {
    const r = await getRule<Partial<KpiTargets>>(KPI_RULE);
    return { value: { ...DEFAULT_TARGETS, ...r.value }, version: r.version };
  } catch {
    return { value: DEFAULT_TARGETS, version: null };
  }
}

export async function returnDeadline(): Promise<{ day: number; month: number; label: string; version: number | null }> {
  try {
    const r = await getRule<string>(DEADLINE_RULE);
    const d = parseDeadline(r.value);
    if (d) return { ...d, version: r.version };
  } catch {
    /* fall back to the guide's date */
  }
  return { day: 31, month: 9, label: "31 October", version: null };
}

const deadlineFor = (year: number, d: { day: number; month: number }) => `${year}-${String(d.month + 1).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

function quarterKey(d: Date) {
  return `${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}
const quarterSort = (a: string, b: string) => a.localeCompare(b);

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
}
const average = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

/** Institutions in scope of the province and sector filters. */
async function scopeInstitutions(f: { province?: string; sector?: string }) {
  const insts = await db.select().from(schema.institutions).orderBy(schema.institutions.name);
  const inScope = insts.filter((i) => (!f.province || i.province === f.province) && (!f.sector || i.sector === f.sector));
  return { insts, inScope, ids: new Set(inScope.map((i) => i.id)), byId: new Map(insts.map((i) => [i.id, i])) };
}

type Case = {
  id: number;
  ref: string;
  kind: string;
  group: "NOC" | "ACC";
  programType: string;
  status: string;
  decision: string | null;
  submittedAt: Date;
  decidedAt: Date | null;
  days: number | null;
  inst: string;
  instCode: string;
  deficiencies: number;
  returned: boolean;
};

/** Every submitted case in scope, with its days to decision and whether it was returned for deficiency. */
async function cases(f: ReportFilters): Promise<Case[]> {
  const { ids, byId } = await scopeInstitutions(f);
  const apps = (await db.select().from(schema.applications).where(isNotNull(schema.applications.submittedAt))).filter(
    (a) => ids.has(a.institutionId) && a.status !== "DRAFT" && (!f.programme || a.programType === f.programme),
  );
  const appIds = apps.map((a) => a.id);
  const defs = appIds.length ? await db.select({ applicationId: schema.deficiencies.applicationId }).from(schema.deficiencies).where(inArray(schema.deficiencies.applicationId, appIds)) : [];
  const evs = appIds.length
    ? await db.select({ applicationId: schema.applicationEvents.applicationId, to: schema.applicationEvents.toStatus }).from(schema.applicationEvents).where(inArray(schema.applicationEvents.applicationId, appIds))
    : [];
  return apps.map((a) => {
    const decided = (a.decision === "APPROVED" || a.decision === "REJECTED") && a.decidedAt ? a.decidedAt : null;
    const n = defs.filter((d) => d.applicationId === a.id).length;
    return {
      id: a.id,
      ref: a.ref,
      kind: a.kind,
      group: a.kind === "NOC" ? "NOC" : "ACC",
      programType: a.programType,
      status: a.status,
      decision: decided ? a.decision : null,
      submittedAt: a.submittedAt!,
      decidedAt: decided,
      days: decided ? Math.max(0, Math.round((decided.getTime() - a.submittedAt!.getTime()) / DAY)) : null,
      inst: byId.get(a.institutionId)?.name ?? "",
      instCode: byId.get(a.institutionId)?.code ?? "",
      deficiencies: n,
      returned: n > 0 || evs.some((e) => e.applicationId === a.id && e.to === "DEFICIENCY_RAISED"),
    };
  });
}

type InstReturn = { code: string; name: string; province: string; expected: string[]; filed: { ref: string; programme: string; submitted: string | null; status: string }[]; onTime: boolean; allFiled: boolean };

/** For each year with annual returns: every institution expected to file, and whether it filed every programme by the deadline. */
async function returnTimeliness(f: ReportFilters, dl: { day: number; month: number }) {
  const { inScope } = await scopeInstitutions(f);
  const progs = (await db.select().from(schema.programs).where(eq(schema.programs.nocStatus, "APPROVED"))).filter((p) => !f.programme || p.type === f.programme);
  const returns = (await db.select().from(schema.annualReturns)).filter((r) => !f.programme || r.programType === f.programme);
  const years = [...new Set(returns.map((r) => r.year))].sort((a, b) => a - b);
  const today = new Date().toISOString().slice(0, 10);
  return years.map((year) => {
    const deadline = deadlineFor(year, dl);
    const open = today <= deadline;
    const list: InstReturn[] = [];
    for (const i of inScope) {
      // A programme is expected to file for a year once its NOC was granted (the year is in the NOC number).
      const expected = progs.filter((p) => p.institutionId === i.id && Number(/-(\d{4})-/.exec(p.nocNumber ?? "")?.[1] ?? 0) <= year);
      const mine = returns.filter((r) => r.institutionId === i.id && r.year === year);
      const types = [...new Set([...expected.map((p) => p.type), ...mine.map((r) => r.programType)])];
      if (!types.length) continue;
      const filed = mine.map((r) => ({ ref: r.ref, programme: r.programType, submitted: dateOnly(r.submittedAt), status: r.status }));
      const allFiled = types.every((t) => filed.some((x) => x.programme === t && x.submitted));
      const onTime = allFiled && filed.every((x) => !x.submitted || x.submitted <= deadline);
      list.push({ code: i.code, name: i.name, province: i.province, expected: types, filed, onTime, allFiled });
    }
    return { year, deadline, open, list };
  });
}

const pct = (n: number, d: number) => (d ? n / d : null);
const scopeParams = (f: ReportFilters) => ({ province: f.province, sector: f.sector, programme: f.programme });

export async function measuresReport(f: ReportFilters): Promise<Report> {
  const [{ value: t, version: tv }, dl, all] = await Promise.all([kpiTargets(), returnDeadline(), cases(f)]);
  const now = new Date();
  const since = new Date(now.getTime() - 365 * DAY);
  const inPeriod = (d: Date) => (f.year ? d.getUTCFullYear() === f.year : d >= since);
  const periodLabel = f.year ? String(f.year) : "Last 12 months";
  const sinceIso = since.toISOString().slice(0, 10);
  const periodParams = f.year ? { year: f.year } : { since: sinceIso };

  // ---------- A. Days from submission to decision ----------
  const decided = all.filter((c) => c.decidedAt && (!f.year || c.decidedAt.getUTCFullYear() === f.year));
  const quarters = [...new Set(decided.map((c) => quarterKey(c.decidedAt!)))].sort(quarterSort);
  const dDrill = (group: "NOC" | "ACC", label: string, extra: Record<string, string | number | undefined>): Drill => ({ kind: "cases", label, params: { ...scopeParams(f), mode: "decided", group, ...extra } });
  const verdict = (m: number | null, target: number) => (m === null ? "No decisions" : m <= target ? "Within target" : `Above the ${target}-day target`);
  const decisionRows: ReportRow[] = quarters.map((q) => {
    const noc = decided.filter((c) => c.group === "NOC" && quarterKey(c.decidedAt!) === q).map((c) => c.days!);
    const acc = decided.filter((c) => c.group === "ACC" && quarterKey(c.decidedAt!) === q).map((c) => c.days!);
    const m = median(noc);
    return {
      key: q,
      flag: m !== null && m > t.nocDecisionDays ? "warn" : null,
      cells: { quarter: q, noc: noc.length, nocMedian: m, nocAverage: average(noc), acc: acc.length, accMedian: median(acc), accAverage: average(acc), status: verdict(m, t.nocDecisionDays) },
      drill: {
        noc: dDrill("NOC", `NOCs decided in ${q}`, { quarter: q }),
        nocMedian: dDrill("NOC", `NOCs decided in ${q}`, { quarter: q }),
        acc: dDrill("ACC", `Accreditations and renewals decided in ${q}`, { quarter: q }),
        accMedian: dDrill("ACC", `Accreditations and renewals decided in ${q}`, { quarter: q }),
      },
    };
  });
  const sectionDecisions: ReportSection = {
    key: "decisions",
    title: "Days from submission to decision",
    sub: `Median and average days from the day a case was submitted (fee paid) to the council's decision, by quarter of decision. Targets: NOC within ${t.nocDecisionDays} days, accreditation or renewal within ${t.accreditationDecisionDays} days. A deferral is not a decision; the clock runs on.`,
    columns: [
      { key: "quarter", title: "Quarter decided" },
      { key: "noc", title: "NOCs decided", type: "int" },
      { key: "nocMedian", title: "NOC median days", type: "num" },
      { key: "nocAverage", title: "NOC average days", type: "num" },
      { key: "acc", title: "Accreditations decided", type: "int" },
      { key: "accMedian", title: "Accreditation median days", type: "num" },
      { key: "accAverage", title: "Accreditation average days", type: "num" },
      { key: "status", title: "NOC against target" },
    ],
    rows: decisionRows,
    chart: quarters.length
      ? {
          type: "vbar",
          categories: quarters,
          valueSuffix: " d",
          targets: [{ value: t.nocDecisionDays, label: `NOC target ${t.nocDecisionDays} days` }],
          series: [
            { name: "NOC median days", color: COLORS.noc, data: decisionRows.map((r) => Number(r.cells.nocMedian ?? 0)), drills: decisionRows.map((r) => r.drill!.noc) },
            { name: "Accreditation median days", color: COLORS.acc, data: decisionRows.map((r) => Number(r.cells.accMedian ?? 0)), drills: decisionRows.map((r) => r.drill!.acc) },
          ],
        }
      : null,
  };

  // ---------- B. Share of cases returned for deficiency ----------
  const submitted = all.filter((c) => !f.year || c.submittedAt.getUTCFullYear() === f.year);
  const sq = [...new Set(submitted.map((c) => quarterKey(c.submittedAt)))].sort(quarterSort);
  const sDrill = (mode: "submitted" | "returned", label: string, extra: Record<string, string | number | undefined>): Drill => ({ kind: "cases", label, params: { ...scopeParams(f), mode, ...extra } });
  const defRows: ReportRow[] = sq.map((q) => {
    const list = submitted.filter((c) => quarterKey(c.submittedAt) === q);
    const ret = list.filter((c) => c.returned).length;
    const share = pct(ret, list.length);
    return {
      key: q,
      flag: share !== null && share * 100 > t.deficiencySharePct ? "warn" : null,
      cells: { quarter: q, submitted: list.length, returned: ret, share, target: `Under ${t.deficiencySharePct}%`, status: share === null ? "-" : share * 100 <= t.deficiencySharePct ? "Within target" : "Above target" },
      drill: { submitted: sDrill("submitted", `Cases submitted in ${q}`, { squarter: q }), returned: sDrill("returned", `Cases submitted in ${q} and returned for deficiency`, { squarter: q }), share: sDrill("returned", `Cases submitted in ${q} and returned for deficiency`, { squarter: q }) },
    };
  });
  const sectionDeficiency: ReportSection = {
    key: "deficiency",
    title: "Cases returned for deficiency",
    sub: `Share of submitted cases (NOC, accreditation and renewal) that received at least one deficiency, by quarter of submission. Target: under ${t.deficiencySharePct}%. Recent quarters can still rise while their cases are open.`,
    columns: [
      { key: "quarter", title: "Quarter submitted" },
      { key: "submitted", title: "Cases submitted", type: "int" },
      { key: "returned", title: "Returned for deficiency", type: "int" },
      { key: "share", title: "Share returned", type: "pct" },
      { key: "target", title: "Target" },
      { key: "status", title: "Against target" },
    ],
    rows: defRows,
    chart: sq.length
      ? {
          type: "vbar",
          categories: sq,
          valueSuffix: "%",
          targets: [{ value: t.deficiencySharePct, label: `Target under ${t.deficiencySharePct}%` }],
          series: [
            {
              name: "Share returned for deficiency",
              color: COLORS.noc,
              data: defRows.map((r) => Math.round(Number(r.cells.share ?? 0) * 100)),
              colors: defRows.map((r) => (r.flag ? COLORS.warn : null)),
              drills: defRows.map((r) => r.drill!.returned),
            },
          ],
        }
      : null,
  };

  // ---------- C. Annual return filed on time ----------
  const years = (await returnTimeliness(f, dl)).filter((y) => !f.year || y.year === f.year);
  const rDrill = (year: number, which: "all" | "ontime" | "late", label: string): Drill => ({ kind: "return-timeliness", label, params: { ...scopeParams(f), year, which } });
  const returnRows: ReportRow[] = years.map((y) => {
    const ok = y.list.filter((x) => x.onTime).length;
    const share = pct(ok, y.list.length);
    const notYet = y.list.filter((x) => !x.allFiled).length;
    return {
      key: String(y.year),
      flag: !y.open && share !== null && share * 100 < t.onTimeSharePct ? "warn" : null,
      cells: {
        year: y.year,
        deadline: y.deadline,
        expected: y.list.length,
        onTime: ok,
        late: y.list.length - ok,
        share: y.open ? null : share,
        status: y.open ? `Open until ${fmtDay(y.deadline)}: ${y.list.length - notYet} of ${y.list.length} filed so far` : share === null ? "-" : share * 100 >= t.onTimeSharePct ? "Within target" : "Below target",
      },
      drill: {
        expected: rDrill(y.year, "all", `Annual returns for ${y.year}: every institution expected to file`),
        onTime: rDrill(y.year, "ontime", `Annual returns for ${y.year} filed on time`),
        late: rDrill(y.year, "late", y.open ? `Annual returns for ${y.year} not filed yet` : `Annual returns for ${y.year} filed late or not filed`),
      },
    };
  });
  const closedYears = returnRows.filter((r) => r.cells.share !== null);
  const sectionReturns: ReportSection = {
    key: "returns",
    title: "Annual return filed on time",
    sub: `Share of institutions that filed every programme's annual student return by the deadline (${dl.label}, from the annual.returnDeadline rule). Target: at least ${t.onTimeSharePct}%. A year is judged once its deadline has passed.`,
    columns: [
      { key: "year", title: "Return year", type: "code" },
      { key: "deadline", title: "Deadline", type: "date" },
      { key: "expected", title: "Institutions expected", type: "int" },
      { key: "onTime", title: "Filed on time", type: "int" },
      { key: "late", title: "Late or not filed", type: "int" },
      { key: "share", title: "Share on time", type: "pct" },
      { key: "status", title: "Against target" },
    ],
    rows: returnRows,
    chart: closedYears.length
      ? {
          type: "vbar",
          categories: closedYears.map((r) => String(r.cells.year)),
          valueSuffix: "%",
          targets: [{ value: t.onTimeSharePct, label: `Target ${t.onTimeSharePct}%` }],
          series: [
            {
              name: "Institutions on time",
              color: COLORS.noc,
              data: closedYears.map((r) => Math.round(Number(r.cells.share) * 100)),
              colors: closedYears.map((r) => (r.flag ? COLORS.warn : null)),
              drills: closedYears.map((r) => r.drill!.onTime),
            },
          ],
        }
      : null,
  };

  // ---------- Headline figures ----------
  const nocPeriod = all.filter((c) => c.group === "NOC" && c.decidedAt && inPeriod(c.decidedAt)).map((c) => c.days!);
  const accPeriod = all.filter((c) => c.group === "ACC" && c.decidedAt && inPeriod(c.decidedAt)).map((c) => c.days!);
  const subPeriod = all.filter((c) => inPeriod(c.submittedAt));
  const retPeriod = subPeriod.filter((c) => c.returned).length;
  const lastClosed = [...years].reverse().find((y) => !y.open);
  const lastClosedOk = lastClosed ? lastClosed.list.filter((x) => x.onTime).length : 0;
  const days = (n: number | null) => (n === null ? "No decisions" : `${Math.round(n)} days`);
  const share = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "No cases");
  const nocM = median(nocPeriod);
  const accM = median(accPeriod);
  const kpis: ReportKpi[] = [
    {
      key: "noc",
      label: "Days to decide an NOC",
      value: days(nocM),
      target: `Target: within ${t.nocDecisionDays} days`,
      met: nocM === null ? null : nocM <= t.nocDecisionDays,
      detail: nocPeriod.length ? `Median of ${nocPeriod.length} NOC${nocPeriod.length === 1 ? "" : "s"} decided (${periodLabel.toLowerCase()}); average ${average(nocPeriod)} days` : `No NOC decided (${periodLabel.toLowerCase()})`,
      drill: dDrill("NOC", `NOCs decided (${periodLabel.toLowerCase()})`, periodParams),
    },
    {
      key: "acc",
      label: "Days to decide an accreditation",
      value: days(accM),
      target: `Target: within ${t.accreditationDecisionDays} days`,
      met: accM === null ? null : accM <= t.accreditationDecisionDays,
      detail: accPeriod.length ? `Median of ${accPeriod.length} accreditation or renewal case${accPeriod.length === 1 ? "" : "s"} (${periodLabel.toLowerCase()}); average ${average(accPeriod)} days` : `None decided (${periodLabel.toLowerCase()})`,
      drill: dDrill("ACC", `Accreditations and renewals decided (${periodLabel.toLowerCase()})`, periodParams),
    },
    {
      key: "deficiency",
      label: "Cases returned for deficiency",
      value: share(retPeriod, subPeriod.length),
      target: `Target: under ${t.deficiencySharePct}%`,
      met: subPeriod.length ? (retPeriod / subPeriod.length) * 100 <= t.deficiencySharePct : null,
      detail: `${retPeriod} of ${subPeriod.length} cases submitted (${periodLabel.toLowerCase()})`,
      drill: sDrill("returned", `Cases returned for deficiency (submitted ${periodLabel.toLowerCase()})`, periodParams),
    },
    {
      key: "returns",
      label: "Annual return on time",
      value: lastClosed ? share(lastClosedOk, lastClosed.list.length) : "No year closed",
      target: `Target: at least ${t.onTimeSharePct}%`,
      met: lastClosed && lastClosed.list.length ? (lastClosedOk / lastClosed.list.length) * 100 >= t.onTimeSharePct : null,
      detail: lastClosed ? `${lastClosedOk} of ${lastClosed.list.length} institutions filed their ${lastClosed.year} return by ${fmtDay(lastClosed.deadline)}` : "No return year has passed its deadline yet",
      drill: lastClosed ? rDrill(lastClosed.year, "ontime", `Annual returns for ${lastClosed.year} filed on time`) : undefined,
    },
  ];

  // ---------- One table for the Excel / PDF / CSV export ----------
  const columns: ReportCol[] = [
    { key: "measure", title: "Measure" },
    { key: "period", title: "Period" },
    { key: "count", title: "Cases or institutions", type: "int" },
    { key: "median", title: "Median days", type: "num" },
    { key: "average", title: "Average days", type: "num" },
    { key: "share", title: "Share", type: "pct" },
    { key: "target", title: "Target" },
    { key: "against", title: "Against target" },
  ];
  const met = (k: ReportKpi) => (k.met === null ? "-" : k.met ? "Met" : "Not met");
  const rows: ReportRow[] = [
    { key: "k-noc", total: true, cells: { measure: "Days to decide an NOC", period: periodLabel, count: nocPeriod.length, median: nocM, average: average(nocPeriod), share: null, target: `Within ${t.nocDecisionDays} days`, against: met(kpis[0]) }, drill: { count: kpis[0].drill! } },
    { key: "k-acc", total: true, cells: { measure: "Days to decide an accreditation or renewal", period: periodLabel, count: accPeriod.length, median: accM, average: average(accPeriod), share: null, target: `Within ${t.accreditationDecisionDays} days`, against: met(kpis[1]) }, drill: { count: kpis[1].drill! } },
    { key: "k-def", total: true, cells: { measure: "Cases returned for deficiency", period: periodLabel, count: subPeriod.length, median: null, average: null, share: pct(retPeriod, subPeriod.length), target: `Under ${t.deficiencySharePct}%`, against: met(kpis[2]) }, drill: { count: kpis[2].drill! } },
    {
      key: "k-ret",
      total: true,
      cells: { measure: "Annual return filed on time", period: lastClosed ? String(lastClosed.year) : "-", count: lastClosed?.list.length ?? null, median: null, average: null, share: lastClosed ? pct(lastClosedOk, lastClosed.list.length) : null, target: `At least ${t.onTimeSharePct}%`, against: met(kpis[3]) },
      ...(kpis[3].drill ? { drill: { count: kpis[3].drill } } : {}),
    },
    ...decisionRows.flatMap((r) => [
      ...(Number(r.cells.noc) ? [{ key: `n-${r.key}`, cells: { measure: "Days to decide an NOC", period: r.cells.quarter, count: r.cells.noc, median: r.cells.nocMedian, average: r.cells.nocAverage, share: null, target: `Within ${t.nocDecisionDays} days`, against: r.cells.status } as Record<string, Cell>, drill: { count: r.drill!.noc } }] : []),
      ...(Number(r.cells.acc) ? [{ key: `a-${r.key}`, cells: { measure: "Days to decide an accreditation or renewal", period: r.cells.quarter, count: r.cells.acc, median: r.cells.accMedian, average: r.cells.accAverage, share: null, target: `Within ${t.accreditationDecisionDays} days`, against: verdict(r.cells.accMedian as number | null, t.accreditationDecisionDays) } as Record<string, Cell>, drill: { count: r.drill!.acc } }] : []),
    ]),
    ...defRows.map((r) => ({ key: `d-${r.key}`, cells: { measure: "Cases returned for deficiency", period: r.cells.quarter, count: r.cells.submitted, median: null, average: null, share: r.cells.share, target: r.cells.target, against: r.cells.status } as Record<string, Cell>, drill: { count: r.drill!.submitted } })),
    ...returnRows.map((r) => ({ key: `r-${r.key}`, cells: { measure: "Annual return filed on time", period: String(r.cells.year), count: r.cells.expected, median: null, average: null, share: r.cells.share, target: `At least ${t.onTimeSharePct}%`, against: r.cells.status } as Record<string, Cell>, drill: { count: r.drill!.expected } })),
  ];

  return {
    id: "measures",
    title: "Measures of success",
    sub: "The three measures in the working guide: days to decide an NOC, the share of cases returned for deficiency, and the share of institutions filing the annual return on time, each against its target.",
    filters: ["province", "sector", "programme", "year"],
    columns,
    rows,
    chart: null,
    kpis,
    sections: [sectionDecisions, sectionDeficiency, sectionReturns],
    notes: [
      `Targets from the kpi.targets reference rule${tv ? ` (version ${tv})` : " (defaults: the rule is not set)"}; the return deadline from annual.returnDeadline (${dl.label}${dl.version ? `, version ${dl.version}` : ", default"}).`,
      f.year ? `Year filter: decisions made, cases submitted and returns due in ${f.year}.` : "Headline figures cover the last 12 months; the tables show every quarter and year on record.",
      "Days run from submission (fee paid) to the council's approval or rejection. Cases decided before the portal were loaded from paper files.",
    ],
  };
}

// ---------- Drill-down lists ----------

const s = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : String(v));

export async function measuresDrill(d: Drill): Promise<DrillResult> {
  const p = d.params;
  const f: ReportFilters = { province: s(p.province), sector: s(p.sector), programme: s(p.programme) };
  if (d.kind === "cases") {
    const mode = s(p.mode) ?? "decided";
    const since = s(p.since);
    const year = p.year ? Number(p.year) : undefined;
    let list = await cases(f);
    if (s(p.group)) list = list.filter((c) => c.group === p.group);
    if (mode === "decided") {
      list = list.filter((c) => c.decidedAt);
      if (s(p.quarter)) list = list.filter((c) => quarterKey(c.decidedAt!) === p.quarter);
      if (year) list = list.filter((c) => c.decidedAt!.getUTCFullYear() === year);
      if (since) list = list.filter((c) => dateOnly(c.decidedAt)! >= since);
    } else {
      if (s(p.squarter)) list = list.filter((c) => quarterKey(c.submittedAt) === p.squarter);
      if (year) list = list.filter((c) => c.submittedAt.getUTCFullYear() === year);
      if (since) list = list.filter((c) => dateOnly(c.submittedAt)! >= since);
      if (mode === "returned") list = list.filter((c) => c.returned);
    }
    list.sort((a, b) => (mode === "decided" ? b.decidedAt!.getTime() - a.decidedAt!.getTime() : b.submittedAt.getTime() - a.submittedAt.getTime()));
    return {
      title: d.label,
      columns: [
        { key: "ref", title: "Case", type: "code" },
        { key: "institution", title: "Institution" },
        { key: "kind", title: "Kind" },
        { key: "programme", title: "Programme" },
        { key: "submitted", title: "Submitted", type: "date" },
        { key: "decided", title: "Decided", type: "date" },
        { key: "days", title: "Days to decide", type: "int" },
        { key: "outcome", title: "Outcome" },
        { key: "deficiencies", title: "Deficiencies", type: "int" },
      ],
      rows: list.map((c) => ({
        ref: c.ref,
        institution: c.inst,
        kind: c.kind === "NOC" ? "NOC" : c.kind === "RENEWAL" ? "Renewal" : "Accreditation",
        programme: prog(c.programType),
        submitted: dateOnly(c.submittedAt),
        decided: dateOnly(c.decidedAt),
        days: c.days,
        outcome: c.decision ? (c.decision === "APPROVED" ? "Approved" : "Rejected") : c.status.charAt(0) + c.status.slice(1).toLowerCase().replace(/_/g, " "),
        deficiencies: c.deficiencies,
      })),
    };
  }
  // return-timeliness
  const dl = await returnDeadline();
  const year = Number(p.year);
  const which = s(p.which) ?? "all";
  const y = (await returnTimeliness(f, dl)).find((x) => x.year === year);
  const list = (y?.list ?? []).filter((x) => which === "all" || (which === "ontime" ? x.onTime : !x.onTime));
  const order = (prov: string) => PROVINCES.indexOf(prov);
  list.sort((a, b) => order(a.province) - order(b.province) || a.name.localeCompare(b.name));
  return {
    title: d.label,
    columns: [
      { key: "code", title: "PCP ID", type: "code" },
      { key: "institution", title: "Institution" },
      { key: "programmes", title: "Programmes expected" },
      { key: "returns", title: "Returns filed" },
      { key: "submitted", title: "Last filed", type: "date" },
      { key: "deadline", title: "Deadline", type: "date" },
      { key: "result", title: "On time?" },
    ],
    rows: list.map((x) => {
      const last = x.filed.map((r) => r.submitted).filter(Boolean).sort().pop() ?? null;
      return {
        code: x.code,
        institution: x.name,
        programmes: x.expected.map(prog).join(", "),
        returns: x.filed.length ? x.filed.map((r) => `${r.ref} (${r.status.toLowerCase()})`).join(", ") : "None",
        submitted: last,
        deadline: y?.deadline ?? null,
        result: x.onTime ? "On time" : !x.allFiled ? (y?.open ? "Not filed yet" : "Not filed") : "Late",
      };
    }),
  };
}
