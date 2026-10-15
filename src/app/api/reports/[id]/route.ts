import { db } from "@/db";
import { audit } from "@/lib/audit";
import { tableCsv, tablePdf, tableXlsx, toTable } from "@/lib/exports";
import { STANDARD_REPORTS, describeFilters, filtersFromQuery, type ReportId } from "@/lib/report-types";
import { buildReport } from "@/lib/reports";
import { can } from "@/lib/roles";
import { getActiveUser } from "@/lib/session";

const TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
} as const;

/** Export a report as Excel, PDF or CSV with the same filters as the screen. Permission-checked and audited. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getActiveUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  if (!([...STANDARD_REPORTS, "payments"] as string[]).includes(id)) return new Response("No such report", { status: 404 });
  if (!can(user.roles, id === "payments" ? "pcp.accounts.view" : "pcp.reports.view")) return new Response("Your role cannot export this report", { status: 403 });
  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "xlsx") as keyof typeof TYPES;
  if (!(format in TYPES)) return new Response("Format must be xlsx, pdf or csv", { status: 400 });
  const filters = filtersFromQuery(url.searchParams);
  const report = await buildReport(id as ReportId, filters);
  const meta = { filters: describeFilters(filters, report.filters), generatedBy: `${user.name} (${user.username})`, generatedAt: new Date() };
  const table = toTable(report);
  const body = format === "xlsx" ? await tableXlsx(table, meta) : format === "pdf" ? await tablePdf(table, meta) : Buffer.from(tableCsv(table), "utf8");
  await audit(db, { actor: user.username, action: "report.exported", entity: "report", entityId: id, details: { format, filters: meta.filters, rows: report.rows.length } });
  const name = `pcp-${id}-${new Date().toISOString().slice(0, 10)}.${format}`;
  return new Response(new Uint8Array(body), {
    headers: { "Content-Type": TYPES[format], "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" },
  });
}
