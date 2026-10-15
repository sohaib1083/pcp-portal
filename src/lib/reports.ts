// Standard reports and early warning (guide section 14, "Reporting and decision support").
// One builder per report, used by the Reports page, the Excel/PDF/CSV exports and the drill-down lists,
// so a figure on screen, in a file and in its underlying list always agree.
import { and, desc, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getRule, type ProgramRule } from "./rules";
import { purposeCategory } from "./accounts";
import { measuresDrill, measuresReport } from "./measures";
import {
  PROGRAMME_LABELS,
  PROVINCES,
  type Cell,
  type Drill,
  type DrillResult,
  type Report,
  type ReportFilters,
  type ReportId,
  type ReportRow,
} from "./report-types";

const SERIES = { a: "#0f8a63", b: "#2a78d6" };
const STATUS = { critical: "#b4141f", bad: "#d03b3b", warn: "#e8a20c", good: "#12a150", fine: "#0f8a63", none: "#aab5b0" };
const LENGTH: Record<string, number> = { PHARMD: 5, TECH: 2 };
const prog = (t: string) => PROGRAMME_LABELS[t] ?? t;
const progShort = (t: string) => (t === "PHARMD" ? "PharmD" : t === "TECH" ? "Tech" : PROGRAMME_LABELS[t] ?? t);
const isPgType = (t: string) => t === "MPHIL" || t === "PHD";
/**
 * Does a programme row count as offered? PharmD and Technician go by their PCP NOC; a postgraduate programme
 * (one per field) by its accreditation, because the HEC issues its NOC (RFP 4.1.10).
 */
const offered = (x: Prog, t: string, statuses: string[]) =>
  (t === "PG" ? isPgType(x.type) : x.type === t) && (isPgType(x.type) ? (statuses.includes("PENDING") ? ["VALID", "PENDING"] : ["VALID"]).includes(x.accreditationStatus) : statuses.includes(x.nocStatus));
const todayIso = () => new Date().toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000);
const MAX_DRILL = 500;

type Inst = typeof schema.institutions.$inferSelect;
type Prog = typeof schema.programs.$inferSelect;

async function registry(f: ReportFilters) {
  const insts = await db.select().from(schema.institutions).orderBy(schema.institutions.name);
  const progs = await db.select().from(schema.programs);
  const inScope = insts.filter((i) => (!f.province || i.province === f.province) && (!f.sector || i.sector === f.sector));
  return { insts, progs, inScope, byId: new Map(insts.map((i) => [i.id, i])) };
}

/** Filters carried into every drill-down, so the list matches the figure. */
const scope = (f: ReportFilters) => ({ province: f.province, sector: f.sector, programme: f.programme, year: f.year });

function orderProvinces(names: string[]) {
  const set = [...new Set(names)];
  return [...PROVINCES.filter((p) => set.includes(p)), ...set.filter((p) => !PROVINCES.includes(p)).sort()];
}

// ---------- 1. Institutions by province and sector ----------

async function institutionsReport(f: ReportFilters): Promise<Report> {
  const { progs, inScope } = await registry(f);
  const has = (i: Inst, t: string, statuses: string[]) => progs.some((p) => p.institutionId === i.id && offered(p, t, statuses));
  const list = inScope.filter((i) => (!f.programme || has(i, f.programme, ["APPROVED", "PENDING"])) && (!f.year || !i.establishedYear || i.establishedYear <= f.year));
  const provinces = orderProvinces(list.map((i) => i.province));
  const d = (label: string, extra: Record<string, string | undefined>): Drill => ({ kind: "institutions", label, params: { ...scope(f), ...extra } });
  const rowFor = (key: string, label: string, xs: Inst[], province?: string, total = false): ReportRow => ({
    key,
    total,
    cells: {
      province: label,
      public: xs.filter((i) => i.sector === "Public").length,
      private: xs.filter((i) => i.sector === "Private").length,
      total: xs.length,
      pharmd: xs.filter((i) => has(i, "PHARMD", ["APPROVED"])).length,
      tech: xs.filter((i) => has(i, "TECH", ["APPROVED"])).length,
      pg: xs.filter((i) => has(i, "PG", ["APPROVED"])).length,
    },
    drill: {
      public: d(`Public institutions${province ? ` in ${province}` : ""}`, { province, sector: "Public" }),
      private: d(`Private institutions${province ? ` in ${province}` : ""}`, { province, sector: "Private" }),
      total: d(`Institutions${province ? ` in ${province}` : ""}`, { province }),
      pharmd: d(`Institutions with an approved PharmD NOC${province ? ` in ${province}` : ""}`, { province, approved: "PHARMD" }),
      tech: d(`Institutions with an approved Pharmacy Technician NOC${province ? ` in ${province}` : ""}`, { province, approved: "TECH" }),
      pg: d(`Institutions with an accredited MS/MPhil or PhD programme${province ? ` in ${province}` : ""}`, { province, approved: "PG" }),
    },
  });
  const rows = provinces.map((p) => rowFor(p, p, list.filter((i) => i.province === p), p));
  if (rows.length) rows.push(rowFor("total", f.province ? "Total" : "All provinces", list, f.province, true));
  return {
    id: "institutions",
    title: "Institutions by province and sector",
    sub: "Registered institutions in each province, public and private, with the programmes that hold an approved NOC.",
    filters: ["province", "sector", "programme", "year"],
    columns: [
      { key: "province", title: "Province" },
      { key: "public", title: "Public", type: "int" },
      { key: "private", title: "Private", type: "int" },
      { key: "total", title: "Total", type: "int" },
      { key: "pharmd", title: "PharmD NOC approved", type: "int" },
      { key: "tech", title: "Technician NOC approved", type: "int" },
      { key: "pg", title: "MS/MPhil or PhD accredited", type: "int" },
    ],
    rows,
    chart: {
      type: "hbar",
      stacked: true,
      categories: provinces,
      series: (["Public", "Private"] as const)
        .filter((s) => !f.sector || f.sector === s)
        .map((s) => ({
          name: s,
          color: s === "Public" ? SERIES.a : SERIES.b,
          data: provinces.map((p) => list.filter((i) => i.province === p && i.sector === s).length),
          drills: provinces.map((p) => d(`${s} institutions in ${p}`, { province: p, sector: s })),
        })),
    },
    notes: [
      f.programme ? `Only institutions offering ${prog(f.programme)} (${isPgType(f.programme) ? "accredited or pending" : "NOC approved or pending"}).` : "",
      f.year ? `Institutions established in ${f.year} or earlier.` : "",
    ].filter(Boolean),
  };
}

// ---------- 2. Intake against enrolment ----------

async function intakeReport(f: ReportFilters): Promise<Report> {
  const { progs, inScope } = await registry(f);
  const n = sql<number>`count(*)::int`;
  const enrol = await db
    .select({ inst: schema.students.institutionId, type: schema.students.programType, year: schema.students.enrollmentYear, n })
    .from(schema.students)
    .groupBy(schema.students.institutionId, schema.students.programType, schema.students.enrollmentYear);
  const rows: (ReportRow & { _year: number; _cat: string; _approved: number; _enrolled: number })[] = [];
  for (const i of inScope) {
    for (const p of progs.filter((x) => x.institutionId === i.id && (!f.programme || x.type === f.programme))) {
      const mine = enrol.filter((e) => e.inst === i.id && e.type === p.type);
      const years = f.year ? [f.year] : [...new Set(mine.map((e) => e.year))].sort((a, b) => b - a);
      for (const y of years) {
        const enrolled = mine.find((e) => e.year === y)?.n ?? 0;
        if (!enrolled && !p.approvedIntake) continue;
        const approved = p.approvedIntake;
        const over = approved > 0 && enrolled > approved;
        const noIntake = approved === 0 && enrolled > 0;
        rows.push({
          key: `${i.code}-${p.type}-${y}`,
          _year: y,
          _cat: `${i.shortCode} ${progShort(p.type)}`,
          _approved: approved,
          _enrolled: enrolled,
          flag: over || noIntake ? "bad" : null,
          cells: {
            institution: i.name,
            code: i.code,
            province: i.province,
            programme: prog(p.type),
            year: y,
            approved,
            enrolled,
            utilisation: approved ? enrolled / approved : null,
            status: over ? "Above approved intake" : noIntake ? "Enrolled with no approved intake" : enrolled === 0 ? "No students enrolled" : "Within approved intake",
          },
          drill: {
            enrolled: { kind: "students", label: `${i.shortCode} ${prog(p.type)} students enrolled in ${y}`, params: { code: i.code, programme: p.type, year: y } },
          },
        });
      }
    }
  }
  const chartYear = f.year ?? Math.max(0, ...rows.map((r) => r._year));
  const forChart = rows.filter((r) => r._year === chartYear);
  return {
    id: "intake",
    title: "Intake against enrolment",
    sub: "Students enrolled in each intake year compared with the programme's approved annual intake.",
    filters: ["province", "sector", "programme", "year"],
    columns: [
      { key: "institution", title: "Institution" },
      { key: "code", title: "PCP ID", type: "code" },
      { key: "province", title: "Province" },
      { key: "programme", title: "Programme" },
      { key: "year", title: "Intake year", type: "code" },
      { key: "approved", title: "Approved intake", type: "int" },
      { key: "enrolled", title: "Enrolled", type: "int" },
      { key: "utilisation", title: "Utilisation", type: "pct" },
      { key: "status", title: "Status" },
    ],
    rows: rows.map(({ _year, _cat, _approved, _enrolled, ...r }) => r),
    chart: forChart.length
      ? {
          type: "vbar",
          categories: forChart.map((r) => r._cat),
          caption: `Intake year ${chartYear}`,
          series: [
            { name: "Approved intake", color: SERIES.b, data: forChart.map((r) => r._approved) },
            { name: "Enrolled", color: SERIES.a, data: forChart.map((r) => r._enrolled), drills: forChart.map((r) => r.drill!.enrolled) },
          ],
        }
      : null,
    notes: ["Approved intake is the programme's current approved intake. Enrolment counts every student record with that intake year, including those who later withdrew."],
  };
}

// ---------- 3. Graduates per year ----------

const gradYearSql = sql<number>`coalesce(${schema.students.resultYear}, ${schema.students.enrollmentYear} + case when ${schema.students.programType} = 'PHARMD' then 5 else 2 end)::int`;

async function graduatesReport(f: ReportFilters): Promise<Report> {
  const { inScope } = await registry(f);
  const ids = inScope.map((i) => i.id);
  const grads = ids.length
    ? await db
        .select({ inst: schema.students.institutionId, type: schema.students.programType, year: gradYearSql, n: sql<number>`count(*)::int` })
        .from(schema.students)
        .where(and(eq(schema.students.status, "GRADUATED"), inArray(schema.students.institutionId, ids)))
        .groupBy(schema.students.institutionId, schema.students.programType, gradYearSql)
    : [];
  const returns = ids.length
    ? await db
        .select()
        .from(schema.annualReturns)
        .where(and(inArray(schema.annualReturns.status, ["SUBMITTED", "ACCEPTED"]), inArray(schema.annualReturns.institutionId, ids)))
    : [];
  const keep = (t: string, y: number) => (!f.programme || t === f.programme) && (!f.year || y === f.year);
  const g = grads.filter((x) => keep(x.type, x.year));
  const r = returns.filter((x) => keep(x.programType, x.year));
  const keys = [...new Set([...g.map((x) => `${x.year}|${x.type}`), ...r.map((x) => `${x.year}|${x.programType}`)])].sort();
  const rows: ReportRow[] = keys.map((k) => {
    const [ys, t] = k.split("|");
    const y = Number(ys);
    const mine = g.filter((x) => x.year === y && x.type === t);
    const rep = r.filter((x) => x.year === y && x.programType === t);
    return {
      key: k,
      cells: {
        year: y,
        programme: prog(t),
        graduates: mine.reduce((a, x) => a + x.n, 0),
        institutions: new Set(mine.map((x) => x.inst)).size,
        reported: rep.length ? rep.reduce((a, x) => a + Number(x.figures?.graduated ?? 0), 0) : null,
      },
      drill: { graduates: { kind: "students", label: `${prog(t)} graduates, ${y}`, params: { ...scope(f), programme: t, gradYear: y } } },
    };
  });
  const years = [...new Set(g.map((x) => x.year))].sort();
  const types = (["PHARMD", "TECH"] as const).filter((t) => !f.programme || f.programme === t);
  if (rows.length)
    rows.push({
      key: "total",
      total: true,
      cells: { year: "All years", programme: f.programme ? prog(f.programme) : "All programmes", graduates: g.reduce((a, x) => a + x.n, 0), institutions: new Set(g.map((x) => x.inst)).size, reported: r.length ? r.reduce((a, x) => a + Number(x.figures?.graduated ?? 0), 0) : null },
      drill: { graduates: { kind: "students", label: "All graduates", params: { ...scope(f), graduated: 1 } } },
    });
  return {
    id: "graduates",
    title: "Graduates per year",
    sub: "Students who completed their programme, by year of graduation, checked against the figures institutions filed in their annual returns.",
    filters: ["province", "sector", "programme", "year"],
    columns: [
      { key: "year", title: "Year", type: "text" },
      { key: "programme", title: "Programme" },
      { key: "graduates", title: "Graduates (student records)", type: "int" },
      { key: "institutions", title: "Institutions", type: "int" },
      { key: "reported", title: "Reported in annual returns", type: "int" },
    ],
    rows,
    chart: years.length
      ? {
          type: "vbar",
          stacked: true,
          categories: years.map(String),
          series: types.map((t) => ({
            name: prog(t),
            color: t === "PHARMD" ? SERIES.a : SERIES.b,
            data: years.map((y) => g.filter((x) => x.year === y && x.type === t).reduce((a, x) => a + x.n, 0)),
            drills: years.map((y) => ({ kind: "students" as const, label: `${prog(t)} graduates, ${y}`, params: { ...scope(f), programme: t, gradYear: y } })),
          })),
        }
      : null,
    notes: [
      "Graduation year is the year of the final result, or the intake year plus the programme length (5 years PharmD, 2 years Technician).",
      returns.length ? "" : "No annual returns are filed yet, so the reported column is empty.",
    ].filter(Boolean),
  };
}

// ---------- 4. Faculty-to-student ratio ----------

async function ratioRules() {
  const out: Record<string, number> = { PHARMD: 10, TECH: 15 };
  for (const t of ["PHARMD", "TECH"]) {
    try {
      out[t] = (await getRule<ProgramRule>(`noc.${t}`)).value.studentsPerFaculty;
    } catch {
      /* keep the default */
    }
  }
  return out;
}

async function ratioReport(f: ReportFilters): Promise<Report> {
  const { progs, inScope } = await registry(f);
  const n = sql<number>`count(*)::int`;
  const fac = await db
    .select({ inst: schema.facultyLinks.institutionId, type: schema.facultyLinks.programType, n })
    .from(schema.facultyLinks)
    .where(eq(schema.facultyLinks.status, "ACTIVE"))
    .groupBy(schema.facultyLinks.institutionId, schema.facultyLinks.programType);
  const stu = await db
    .select({ inst: schema.students.institutionId, type: schema.students.programType, n })
    .from(schema.students)
    .where(notInArray(schema.students.status, ["GRADUATED", "WITHDRAWN"]))
    .groupBy(schema.students.institutionId, schema.students.programType);
  const rule = await ratioRules();
  const rows: (ReportRow & { _ratio: number; _cat: string })[] = [];
  for (const i of inScope) {
    for (const p of progs.filter((x) => x.institutionId === i.id && (!f.programme || x.type === f.programme))) {
      const faculty = fac.find((x) => x.inst === i.id && x.type === p.type)?.n ?? 0;
      const students = stu.find((x) => x.inst === i.id && x.type === p.type)?.n ?? 0;
      if (!faculty && !students) continue;
      const limit = rule[p.type] ?? 10;
      const ratio = faculty ? students / faculty : Infinity;
      const status = !students ? "No students enrolled yet" : !faculty ? "No active faculty" : ratio > limit ? `Above the 1:${limit} rule` : ratio > limit * 0.8 ? "Near the limit" : "Within the rule";
      rows.push({
        key: `${i.code}-${p.type}`,
        _ratio: students ? ratio : -1,
        _cat: `${i.shortCode} ${progShort(p.type)}`,
        flag: !students ? null : !faculty || ratio > limit ? "bad" : ratio > limit * 0.8 ? "warn" : null,
        cells: {
          institution: i.name,
          code: i.code,
          province: i.province,
          programme: prog(p.type),
          faculty,
          students,
          ratio: students && Number.isFinite(ratio) ? Math.round(ratio * 10) / 10 : null,
          rule: `1 : ${limit}`,
          status,
        },
        drill: {
          faculty: { kind: "faculty", label: `${i.shortCode} ${prog(p.type)} active faculty`, params: { code: i.code, programme: p.type } },
          students: { kind: "students", label: `${i.shortCode} ${prog(p.type)} current students`, params: { code: i.code, programme: p.type, current: 1 } },
        },
      });
    }
  }
  rows.sort((a, b) => b._ratio - a._ratio);
  const finite = rows.filter((r) => Number.isFinite(r._ratio) && r._ratio > 0);
  return {
    id: "ratio",
    title: "Faculty-to-student ratio",
    sub: "Current students for each active faculty member, by institution and programme, against the NOC rule.",
    filters: ["province", "sector", "programme"],
    columns: [
      { key: "institution", title: "Institution" },
      { key: "code", title: "PCP ID", type: "code" },
      { key: "province", title: "Province" },
      { key: "programme", title: "Programme" },
      { key: "faculty", title: "Active faculty", type: "int" },
      { key: "students", title: "Current students", type: "int" },
      { key: "ratio", title: "Students per faculty", type: "num" },
      { key: "rule", title: "Rule" },
      { key: "status", title: "Status" },
    ],
    rows: rows.map(({ _ratio, _cat, ...r }) => r),
    chart: finite.length
      ? {
          type: "hbar",
          categories: finite.map((r) => r._cat),
          caption: `Red bars are above the rule (1:${rule.PHARMD} PharmD, 1:${rule.TECH} Technician)`,
          series: [
            {
              name: "Students per faculty",
              color: SERIES.a,
              data: finite.map((r) => Math.round(r._ratio * 10) / 10),
              colors: finite.map((r) => (r.flag === "bad" ? STATUS.bad : r.flag === "warn" ? STATUS.warn : null)),
              drills: finite.map((r) => r.drill!.faculty),
            },
          ],
        }
      : null,
    notes: [`Rule from the NOC reference rules: one faculty member per ${rule.PHARMD} PharmD students and per ${rule.TECH} Technician students. Current students exclude graduates and withdrawals.`],
  };
}

// ---------- 5. Licence and accreditation validity ----------

export const VALIDITY_BANDS = ["Expired", "Within 90 days", "91 to 180 days", "181 to 365 days", "More than a year", "Not accredited yet"] as const;
const BAND_COLOR: Record<string, string> = {
  Expired: STATUS.critical,
  "Within 90 days": STATUS.bad,
  "91 to 180 days": STATUS.warn,
  "181 to 365 days": STATUS.good,
  "More than a year": STATUS.good,
  "Not accredited yet": STATUS.none,
};

function band(p: Prog) {
  const until = p.accreditationValidUntil;
  const days = until ? daysBetween(todayIso(), until) : null;
  if (p.accreditationStatus === "EXPIRED" || (days !== null && days < 0)) return { band: "Expired", days };
  if (days === null) return { band: "Not accredited yet", days };
  if (days <= 90) return { band: "Within 90 days", days };
  if (days <= 180) return { band: "91 to 180 days", days };
  if (days <= 365) return { band: "181 to 365 days", days };
  return { band: "More than a year", days };
}

async function validityRows(f: ReportFilters) {
  const { progs, inScope } = await registry(f);
  const out: (ReportRow & { _band: string })[] = [];
  for (const i of inScope) {
    for (const p of progs.filter((x) => x.institutionId === i.id && (!f.programme || x.type === f.programme))) {
      if (p.nocStatus === "NONE" && p.accreditationStatus === "NONE") continue;
      if (f.year && (!p.accreditationValidUntil || Number(p.accreditationValidUntil.slice(0, 4)) !== f.year)) continue;
      const b = band(p);
      out.push({
        key: `${i.code}-${p.type}${p.field ? `-${p.field}` : ""}`,
        _band: b.band,
        flag: b.band === "Expired" || b.band === "Within 90 days" ? "bad" : b.band === "91 to 180 days" ? "warn" : null,
        cells: {
          institution: i.name,
          code: i.code,
          province: i.province,
          programme: p.field ? `${prog(p.type)} ${p.field}` : prog(p.type),
          noc: isPgType(p.type) ? "HEC" : p.nocStatus.charAt(0) + p.nocStatus.slice(1).toLowerCase(),
          nocNumber: p.nocNumber,
          accreditation: p.accreditationStatus.charAt(0) + p.accreditationStatus.slice(1).toLowerCase(),
          validUntil: p.accreditationValidUntil,
          days: b.days,
          band: b.band,
        },
      });
    }
  }
  return out.sort((a, b) => (a.cells.days === null ? 1 : 0) - (b.cells.days === null ? 1 : 0) || Number(a.cells.days ?? 0) - Number(b.cells.days ?? 0));
}

const VALIDITY_COLUMNS = [
  { key: "institution", title: "Institution" },
  { key: "code", title: "PCP ID", type: "code" as const },
  { key: "province", title: "Province" },
  { key: "programme", title: "Programme" },
  { key: "noc", title: "NOC" },
  { key: "nocNumber", title: "NOC number", type: "code" as const },
  { key: "accreditation", title: "Accreditation" },
  { key: "validUntil", title: "Valid until", type: "date" as const },
  { key: "days", title: "Days left", type: "int" as const },
  { key: "band", title: "Validity" },
];

async function validityReport(f: ReportFilters): Promise<Report> {
  const rows = await validityRows(f);
  const counts = VALIDITY_BANDS.map((b) => rows.filter((r) => r._band === b).length);
  return {
    id: "validity",
    title: "Licence and accreditation validity",
    sub: "Every licensed programme with its NOC and how long its accreditation has left. Rows expiring within 180 days are highlighted.",
    filters: ["province", "sector", "programme", "year"],
    columns: VALIDITY_COLUMNS,
    rows: rows.map(({ _band, ...r }) => ({
      ...r,
      drill: { band: { kind: "programmes", label: `Programmes: ${_band.toLowerCase()}`, params: { ...scope(f), band: _band } } },
    })),
    chart: rows.length
      ? {
          type: "vbar",
          categories: [...VALIDITY_BANDS],
          series: [
            {
              name: "Programmes",
              color: SERIES.a,
              data: counts,
              colors: VALIDITY_BANDS.map((b) => BAND_COLOR[b]),
              drills: VALIDITY_BANDS.map((b) => ({ kind: "programmes" as const, label: `Programmes: ${b.toLowerCase()}`, params: { ...scope(f), band: b } })),
            },
          ],
        }
      : null,
    notes: [f.year ? `Accreditation ending in ${f.year}.` : "", "Renewal reminders go out at 180, 120, 90, 60 and 30 days before expiry."].filter(Boolean),
  };
}

// ---------- 6. Early-warning list ----------

const dateOnly = (d: Date | string | null | undefined) => (d ? (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10)) : null);

function isLate(r: typeof schema.annualReturns.$inferSelect, today: string) {
  const due = r.dueDate?.slice(0, 10);
  if (!due || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return false;
  const submitted = dateOnly(r.submittedAt);
  return submitted ? submitted > due : due < today;
}

function activeAt(l: { startDate: string; endDate: string | null; status: string }, day: string, today: string) {
  if (l.startDate > day) return false;
  if (l.endDate) return l.endDate > day;
  return l.status === "ACTIVE" || day < today;
}

async function earlyWarningData(f: ReportFilters) {
  const { inScope } = await registry(f);
  const today = todayIso();
  const since = new Date();
  since.setMonth(since.getMonth() - 24);
  const defs = await db
    .select({ inst: schema.deficiencies.institutionId, type: schema.applications.programType, ref: schema.deficiencies.ref })
    .from(schema.deficiencies)
    .innerJoin(schema.applications, eq(schema.applications.id, schema.deficiencies.applicationId))
    .where(gte(schema.deficiencies.createdAt, since));
  const returns = await db.select().from(schema.annualReturns);
  const links = await db
    .select({ inst: schema.facultyLinks.institutionId, type: schema.facultyLinks.programType, startDate: schema.facultyLinks.startDate, endDate: schema.facultyLinks.endDate, status: schema.facultyLinks.status })
    .from(schema.facultyLinks);
  const y = new Date().getFullYear();
  const lastEnd = `${y - 1}-12-31`;
  const prevEnd = `${y - 2}-12-31`;
  const progOk = (t: string) => !f.programme || t === f.programme;
  const rows = inScope.map((i) => {
    const d = defs.filter((x) => x.inst === i.id && progOk(x.type)).length;
    const late = returns.filter((r) => r.institutionId === i.id && progOk(r.programType) && isLate(r, today)).length;
    const mine = links.filter((l) => l.inst === i.id && progOk(l.type));
    const now = mine.filter((l) => activeAt(l, today, today)).length;
    const last = mine.filter((l) => activeAt(l, lastEnd, today)).length;
    const prev = mine.filter((l) => activeAt(l, prevEnd, today)).length;
    const falling = now < last || last < prev;
    const signals = [d >= 2 ? "Repeated deficiencies" : "", late > 0 ? "Late annual returns" : "", falling ? "Falling faculty" : ""].filter(Boolean);
    return { i, d, late, now, last, prev, falling, signals };
  });
  return { rows, returnsCount: returns.length, lastYear: y - 1 };
}

async function earlyWarningReport(f: ReportFilters): Promise<Report> {
  const { rows: all, returnsCount, lastYear } = await earlyWarningData(f);
  const flagged = all.filter((r) => r.signals.length).sort((a, b) => b.signals.length - a.signals.length || b.d - a.d);
  const codes = (pred: (r: (typeof all)[number]) => boolean) => all.filter(pred).map((r) => r.i.code).join(",");
  const signalDefs = [
    { name: "Repeated deficiencies", pred: (r: (typeof all)[number]) => r.d >= 2 },
    { name: "Late annual returns", pred: (r: (typeof all)[number]) => r.late > 0 },
    { name: "Falling faculty", pred: (r: (typeof all)[number]) => r.falling },
  ];
  return {
    id: "early-warning",
    title: "Early-warning list",
    sub: "Institutions with repeated deficiencies, late annual returns or falling faculty numbers. Each signal opens the records behind it.",
    filters: ["province", "sector", "programme"],
    columns: [
      { key: "institution", title: "Institution" },
      { key: "code", title: "PCP ID", type: "code" },
      { key: "province", title: "Province" },
      { key: "signals", title: "Signals" },
      { key: "deficiencies", title: "Deficiencies (24 months)", type: "int" },
      { key: "late", title: "Late annual returns", type: "int" },
      { key: "facultyLast", title: `Faculty end of ${lastYear}`, type: "int" },
      { key: "facultyNow", title: "Faculty now", type: "int" },
      { key: "change", title: "Change", type: "int" },
    ],
    rows: flagged.map((r) => ({
      key: r.i.code,
      flag: r.signals.length >= 2 ? "bad" : "warn",
      cells: {
        institution: r.i.name,
        code: r.i.code,
        province: r.i.province,
        signals: r.signals.join(", "),
        deficiencies: r.d,
        late: r.late,
        facultyLast: r.last,
        facultyNow: r.now,
        change: r.now - r.last,
      },
      drill: {
        deficiencies: { kind: "deficiencies", label: `${r.i.shortCode}: deficiencies in the last 24 months`, params: { code: r.i.code, programme: f.programme } },
        late: { kind: "returns", label: `${r.i.shortCode}: annual returns`, params: { code: r.i.code, programme: f.programme } },
        facultyNow: { kind: "faculty-moves", label: `${r.i.shortCode}: faculty joining and leaving since ${lastYear - 1}`, params: { code: r.i.code, programme: f.programme } },
        change: { kind: "faculty-moves", label: `${r.i.shortCode}: faculty joining and leaving since ${lastYear - 1}`, params: { code: r.i.code, programme: f.programme } },
      },
    })),
    chart: {
      type: "vbar",
      categories: signalDefs.map((s) => s.name),
      series: [
        {
          name: "Institutions",
          color: STATUS.warn,
          data: signalDefs.map((s) => all.filter(s.pred).length),
          drills: signalDefs.map((s) => ({ kind: "institutions" as const, label: `Institutions with ${s.name.toLowerCase()}`, params: { codes: codes(s.pred) || "-" } })),
        },
      ],
    },
    notes: [
      "Repeated deficiencies: 2 or more raised in the last 24 months.",
      "Late annual return: submitted after its due date, or past due and not submitted.",
      `Falling faculty: fewer active faculty now than at the end of ${lastYear}, or fewer at the end of ${lastYear} than a year earlier.`,
      returnsCount ? "" : "No annual returns are in the system yet, so the late-return check has nothing to test.",
    ].filter(Boolean),
  };
}

// ---------- Payments ledger (Accounts) ----------

export async function paymentRows(f: ReportFilters = {}) {
  const rows = await db
    .select({ p: schema.payments, inst: schema.institutions, ref: schema.applications.ref })
    .from(schema.payments)
    .leftJoin(schema.institutions, eq(schema.institutions.id, schema.payments.institutionId))
    .leftJoin(schema.applications, eq(schema.applications.id, schema.payments.applicationId))
    .orderBy(desc(schema.payments.createdAt), desc(schema.payments.id));
  return rows.filter(({ p, inst }) => {
    const day = dateOnly(p.paidAt ?? p.createdAt)!;
    return (
      (!f.status || p.status === f.status || (f.status === "COLLECTED" && (p.status === "PAID" || p.status === "RECONCILED"))) &&
      (!f.from || day >= f.from) &&
      (!f.to || day <= f.to) &&
      (!f.institution || inst?.code === f.institution) &&
      (!f.purpose || purposeCategory(p.purpose) === f.purpose)
    );
  });
}

async function paymentsReport(f: ReportFilters): Promise<Report> {
  const rows = await paymentRows(f);
  const sum = (s: string[]) => rows.filter(({ p }) => s.includes(p.status)).reduce((a, { p }) => a + p.amount, 0);
  return {
    id: "payments",
    title: "Payments ledger",
    sub: "Every challan with its receipt, status and reconciliation against the bank statement.",
    filters: [],
    columns: [
      { key: "psid", title: "PSID", type: "code" },
      { key: "receipt", title: "Receipt no.", type: "code" },
      { key: "institution", title: "Institution" },
      { key: "purpose", title: "Purpose" },
      { key: "amount", title: "Amount (Rs)", type: "int" },
      { key: "status", title: "Status" },
      { key: "method", title: "Method" },
      { key: "paidAt", title: "Paid", type: "date" },
      { key: "reconciledAt", title: "Reconciled", type: "date" },
      { key: "reconciledBy", title: "Reconciled by" },
    ],
    rows: rows.map(({ p, inst }) => ({
      key: p.psid,
      cells: {
        psid: p.psid,
        receipt: p.receiptNo,
        institution: inst?.name ?? "-",
        purpose: p.purpose,
        amount: p.amount,
        status: p.status.charAt(0) + p.status.slice(1).toLowerCase(),
        method: p.method ? ({ RAAST_QR: "Raast QR", BANK_BRANCH: "Bank branch", INTERNET_BANKING: "Internet banking" } as Record<string, string>)[p.method] ?? p.method : null,
        paidAt: dateOnly(p.paidAt),
        reconciledAt: dateOnly(p.reconciledAt),
        reconciledBy: p.reconciledBy,
      },
    })),
    chart: null,
    notes: [
      `Collected Rs ${sum(["PAID", "RECONCILED"]).toLocaleString("en-PK")}, of which reconciled Rs ${sum(["RECONCILED"]).toLocaleString("en-PK")}. Pending challans Rs ${sum(["PENDING"]).toLocaleString("en-PK")}.`,
    ],
  };
}

export async function buildReport(id: ReportId, f: ReportFilters): Promise<Report> {
  switch (id) {
    case "institutions":
      return institutionsReport(f);
    case "intake":
      return intakeReport(f);
    case "graduates":
      return graduatesReport(f);
    case "ratio":
      return ratioReport(f);
    case "validity":
      return validityReport(f);
    case "early-warning":
      return earlyWarningReport(f);
    case "measures":
      return measuresReport(f);
    case "payments":
      return paymentsReport(f);
  }
}

// ---------- Drill-down: the list behind a figure ----------

const str = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : String(v));

export async function drillList(d: Drill): Promise<DrillResult> {
  if (d.kind === "cases" || d.kind === "return-timeliness") return measuresDrill(d);
  const p = d.params;
  const f: ReportFilters = { province: str(p.province), sector: str(p.sector), programme: str(p.programme), year: p.year ? Number(p.year) : undefined };
  const { insts, progs, inScope, byId } = await registry(f);
  const instByCode = (c?: string) => insts.find((i) => i.code === c);

  if (d.kind === "institutions") {
    const codes = str(p.codes)?.split(",");
    let list = codes ? insts.filter((i) => codes.includes(i.code)) : inScope;
    if (!codes) {
      if (f.programme) list = list.filter((i) => progs.some((x) => x.institutionId === i.id && offered(x, f.programme!, ["APPROVED", "PENDING"])));
      if (f.year) list = list.filter((i) => !i.establishedYear || i.establishedYear <= f.year!);
      if (str(p.approved)) list = list.filter((i) => progs.some((x) => x.institutionId === i.id && offered(x, String(p.approved), ["APPROVED"])));
    }
    return {
      title: d.label,
      columns: [
        { key: "code", title: "PCP ID", type: "code" },
        { key: "name", title: "Institution" },
        { key: "city", title: "City" },
        { key: "province", title: "Province" },
        { key: "sector", title: "Sector" },
        { key: "programmes", title: "Programmes (NOC)" },
      ],
      rows: list.map((i) => ({
        code: i.code,
        name: i.name,
        city: i.city,
        province: i.province,
        sector: i.sector,
        programmes: progs
          .filter((x) => x.institutionId === i.id && (x.nocStatus !== "NONE" || isPgType(x.type)))
          .map((x) => (isPgType(x.type) ? `${progShort(x.type)} ${x.field} ${x.accreditationStatus === "VALID" ? "accredited" : x.accreditationStatus.toLowerCase()}` : `${progShort(x.type)} ${x.nocStatus.toLowerCase()}`))
          .join(", ") || "None",
      })),
    };
  }

  if (d.kind === "students") {
    const inst = instByCode(str(p.code));
    const conds = [];
    if (inst) conds.push(eq(schema.students.institutionId, inst.id));
    else if (f.province || f.sector) conds.push(inArray(schema.students.institutionId, inScope.map((i) => i.id).concat(-1)));
    if (f.programme) conds.push(eq(schema.students.programType, f.programme));
    if (p.year && str(p.code)) conds.push(eq(schema.students.enrollmentYear, Number(p.year)));
    if (p.gradYear) conds.push(eq(schema.students.status, "GRADUATED"), sql`${gradYearSql} = ${Number(p.gradYear)}`);
    if (p.graduated) conds.push(eq(schema.students.status, "GRADUATED"));
    if (p.graduated && f.year) conds.push(sql`${gradYearSql} = ${f.year}`);
    if (p.current) conds.push(notInArray(schema.students.status, ["GRADUATED", "WITHDRAWN"]));
    const rows = await db
      .select({ s: schema.students, gy: gradYearSql })
      .from(schema.students)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(schema.students.pcpId)
      .limit(MAX_DRILL + 1);
    return {
      title: d.label,
      truncated: rows.length > MAX_DRILL,
      columns: [
        { key: "pcpId", title: "Student ID", type: "code" },
        { key: "name", title: "Name" },
        { key: "institution", title: "Institution" },
        { key: "programme", title: "Programme" },
        { key: "year", title: "Intake year", type: "code" },
        { key: "study", title: "Year of study", type: "int" },
        { key: "status", title: "Status" },
        ...(p.gradYear || p.graduated ? [{ key: "gy", title: "Graduated", type: "code" as const }] : []),
      ],
      rows: rows.slice(0, MAX_DRILL).map(({ s, gy }) => ({
        pcpId: s.pcpId,
        name: s.fullName,
        institution: byId.get(s.institutionId)?.shortCode ?? "",
        programme: prog(s.programType),
        year: s.enrollmentYear,
        study: s.currentYear,
        status: s.status.charAt(0) + s.status.slice(1).toLowerCase(),
        gy,
      })),
    };
  }

  if (d.kind === "faculty" || d.kind === "faculty-moves") {
    const inst = instByCode(str(p.code));
    if (!inst) return { title: d.label, columns: [], rows: [] };
    const conds = [eq(schema.facultyLinks.institutionId, inst.id)];
    if (f.programme) conds.push(eq(schema.facultyLinks.programType, f.programme));
    if (d.kind === "faculty") conds.push(eq(schema.facultyLinks.status, "ACTIVE"));
    const rows = await db
      .select({ l: schema.facultyLinks, fac: schema.faculty })
      .from(schema.facultyLinks)
      .innerJoin(schema.faculty, eq(schema.faculty.id, schema.facultyLinks.facultyId))
      .where(and(...conds))
      .orderBy(desc(schema.facultyLinks.startDate));
    const since = `${new Date().getFullYear() - 2}-01-01`;
    const list = d.kind === "faculty" ? rows : rows.filter(({ l }) => l.startDate >= since || (l.endDate ?? "") >= since || l.status === "ENDED");
    return {
      title: d.label,
      columns: [
        { key: "pcpId", title: "Faculty ID", type: "code" },
        { key: "name", title: "Name" },
        { key: "qualification", title: "Qualification" },
        { key: "designation", title: "Designation" },
        { key: "programme", title: "Programme" },
        { key: "start", title: "Linked since", type: "date" },
        ...(d.kind === "faculty-moves" ? [{ key: "end", title: "Left", type: "date" as const }, { key: "status", title: "Link" }] : [{ key: "verification", title: "Verification" }]),
      ],
      rows: list.map(({ l, fac }) => ({
        pcpId: fac.pcpId,
        name: fac.fullName,
        qualification: fac.qualification,
        designation: fac.designation,
        programme: prog(l.programType),
        start: l.startDate,
        end: l.endDate,
        status: l.status === "ACTIVE" ? "Active" : "Ended",
        verification: fac.verificationStatus.charAt(0) + fac.verificationStatus.slice(1).toLowerCase(),
      })),
    };
  }

  if (d.kind === "programmes") {
    const rows = (await validityRows(f)).filter((r) => !p.band || r._band === p.band);
    return { title: d.label, columns: VALIDITY_COLUMNS, rows: rows.map((r) => r.cells) };
  }

  if (d.kind === "deficiencies") {
    const inst = instByCode(str(p.code));
    if (!inst) return { title: d.label, columns: [], rows: [] };
    const since = new Date();
    since.setMonth(since.getMonth() - 24);
    const rows = await db
      .select({ d: schema.deficiencies, ref: schema.applications.ref, type: schema.applications.programType })
      .from(schema.deficiencies)
      .innerJoin(schema.applications, eq(schema.applications.id, schema.deficiencies.applicationId))
      .where(and(eq(schema.deficiencies.institutionId, inst.id), gte(schema.deficiencies.createdAt, since), ...(f.programme ? [eq(schema.applications.programType, f.programme)] : [])))
      .orderBy(desc(schema.deficiencies.createdAt));
    return {
      title: d.label,
      columns: [
        { key: "ref", title: "Deficiency", type: "code" },
        { key: "case", title: "Case", type: "code" },
        { key: "criterion", title: "Criterion" },
        { key: "action", title: "Required action" },
        { key: "raised", title: "Raised", type: "date" },
        { key: "due", title: "Due", type: "date" },
        { key: "status", title: "Status" },
      ],
      rows: rows.map((r) => ({
        ref: r.d.ref,
        case: r.ref,
        criterion: r.d.criterion,
        action: r.d.requiredAction,
        raised: dateOnly(r.d.createdAt),
        due: r.d.dueDate,
        status: r.d.status.charAt(0) + r.d.status.slice(1).toLowerCase(),
      })),
    };
  }

  if (d.kind === "returns") {
    const inst = instByCode(str(p.code));
    if (!inst) return { title: d.label, columns: [], rows: [] };
    const today = todayIso();
    const rows = (await db.select().from(schema.annualReturns).where(eq(schema.annualReturns.institutionId, inst.id)).orderBy(desc(schema.annualReturns.year))).filter(
      (r) => !f.programme || r.programType === f.programme,
    );
    return {
      title: d.label,
      columns: [
        { key: "ref", title: "Return", type: "code" },
        { key: "programme", title: "Programme" },
        { key: "year", title: "Year", type: "code" },
        { key: "due", title: "Due", type: "date" },
        { key: "submitted", title: "Submitted", type: "date" },
        { key: "status", title: "Status" },
        { key: "late", title: "On time?" },
      ],
      rows: rows.map((r) => ({
        ref: r.ref,
        programme: prog(r.programType),
        year: r.year,
        due: r.dueDate,
        submitted: dateOnly(r.submittedAt),
        status: r.status.charAt(0) + r.status.slice(1).toLowerCase(),
        late: isLate(r, today) ? "Late" : r.submittedAt ? "On time" : "Not yet due",
      })),
    };
  }

  if (d.kind === "payments") {
    const report = await paymentsReport({ status: str(p.status), institution: str(p.institution), purpose: str(p.purpose), from: str(p.from), to: str(p.to) });
    return { title: d.label, columns: report.columns, rows: report.rows.map((r) => r.cells) };
  }

  return { title: d.label, columns: [], rows: [] as Record<string, Cell>[] };
}
