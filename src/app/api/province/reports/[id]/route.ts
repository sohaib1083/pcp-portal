import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { tableCsv, tablePdf, tableXlsx, toTable } from "@/lib/exports";
import { officerCodeSatisfied } from "@/lib/officer-code";
import { STANDARD_REPORTS, describeFilters, filtersFromQuery, type ReportId } from "@/lib/report-types";
import { buildReport } from "@/lib/reports";
import { can } from "@/lib/roles";
import { getActiveUser } from "@/lib/session";

const TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
} as const;

/**
 * A provincial council officer's export of a standard report (RFP 4.1.2 "regional reporting"). The province is
 * always the officer's own, from their staff row; asking for another province gets 404, not someone else's data.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getActiveUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  if (!can(user.roles, "province.dashboard")) return new Response("Not found", { status: 404 });
  if (!(await officerCodeSatisfied(user.roles))) return new Response("Enter your sign-in code first: open /province", { status: 403 });
  const row = await db.query.staff.findFirst({ where: eq(schema.staff.username, user.username) });
  const province = row?.province;
  if (!province || !(STANDARD_REPORTS as string[]).includes(id)) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const asked = url.searchParams.get("province");
  if (asked && asked !== province) {
    await audit(db, { actor: user.username, action: "report.export.denied", entity: "report", entityId: id, details: { asked, province } });
    return new Response("Not found", { status: 404 });
  }
  const format = (url.searchParams.get("format") ?? "xlsx") as keyof typeof TYPES;
  if (!(format in TYPES)) return new Response("Format must be xlsx, pdf or csv", { status: 400 });
  const filters = { ...filtersFromQuery(url.searchParams), province, status: undefined, from: undefined, to: undefined, institution: undefined, purpose: undefined };
  const report = await buildReport(id as ReportId, filters);
  const meta = { filters: describeFilters(filters, report.filters), generatedBy: `${user.name} (${user.username}), ${province} council`, generatedAt: new Date() };
  const table = toTable(report);
  const body = format === "xlsx" ? await tableXlsx(table, meta) : format === "pdf" ? await tablePdf(table, meta) : Buffer.from(tableCsv(table), "utf8");
  await audit(db, { actor: user.username, action: "report.exported", entity: "report", entityId: id, details: { format, filters: meta.filters, rows: report.rows.length, province } });
  const name = `pcp-${province.toLowerCase().replace(/\W+/g, "-")}-${id}-${new Date().toISOString().slice(0, 10)}.${format}`;
  return new Response(new Uint8Array(body), {
    headers: { "Content-Type": TYPES[format], "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" },
  });
}
