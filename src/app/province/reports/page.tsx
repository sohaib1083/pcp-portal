import { sql } from "drizzle-orm";
import { ProvinceReports } from "@/components/ProvinceViews";
import { db, schema } from "@/db";
import { STANDARD_REPORTS, filtersFromQuery } from "@/lib/report-types";
import { buildReport } from "@/lib/reports";
import { requireProvince } from "@/lib/province";

export const dynamic = "force-dynamic";

/** The standard reports with the province fixed to the officer's own (RFP 4.1.2 "regional reporting"). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireProvince();
  const sp = await searchParams;
  const f = filtersFromQuery(sp);
  // The province always comes from the officer's staff row; a province in the address is ignored.
  const filters = { province: ctx.province, sector: f.sector, programme: f.programme, year: f.year };
  const reports = [];
  for (const id of STANDARD_REPORTS) reports.push(await buildReport(id, filters));
  const [{ lo, hi }] = await db.select({ lo: sql<number>`min(${schema.students.enrollmentYear})::int`, hi: sql<number>`max(${schema.students.enrollmentYear})::int` }).from(schema.students);
  const thisYear = new Date().getFullYear();
  const years: number[] = [];
  for (let y = Math.max(thisYear + 1, (hi ?? thisYear) + 2); y >= Math.min(lo ?? thisYear, thisYear - 4); y--) years.push(y);
  return <ProvinceReports province={ctx.province} reports={reports} filters={filters} years={years} tab={typeof sp.tab === "string" ? sp.tab : undefined} />;
}
