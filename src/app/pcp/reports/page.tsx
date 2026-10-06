import { and, eq, sql } from "drizzle-orm";
import ReportsView from "@/components/ReportsView";
import { db, schema } from "@/db";
import { getFeedKeys } from "@/lib/accounts";
import { FEED_ENDPOINTS, FEED_HEADER, recentFeedCalls } from "@/lib/feed";
import { PROVINCES, STANDARD_REPORTS, filtersFromQuery } from "@/lib/report-types";
import { buildReport } from "@/lib/reports";
import { can } from "@/lib/roles";
import { requirePermission } from "@/lib/session";

export const metadata = { title: "Reports & exports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePermission("pcp.reports.view");
  const sp = await searchParams;
  const filters = filtersFromQuery(sp);
  const reports = [];
  for (const id of STANDARD_REPORTS) reports.push(await buildReport(id, filters));

  // Filter choices come from the register itself.
  const provinces = (await db.selectDistinct({ p: schema.institutions.province }).from(schema.institutions)).map((r) => r.p);
  const [{ lo, hi }] = await db.select({ lo: sql<number>`min(${schema.students.enrollmentYear})::int`, hi: sql<number>`max(${schema.students.enrollmentYear})::int` }).from(schema.students);
  const [{ until }] = await db.select({ until: sql<number>`max(extract(year from ${schema.programs.accreditationValidUntil}))::int` }).from(schema.programs);
  const thisYear = new Date().getFullYear();
  const years: number[] = [];
  for (let y = Math.max(until ?? thisYear, thisYear + 1, (hi ?? thisYear) + 2); y >= Math.min(lo ?? thisYear, thisYear - 4); y--) years.push(y);

  // Data feed: keys (never the hash), call counts and the latest calls from the audit log.
  const { value } = await getFeedKeys();
  const stats = await db
    .select({ actor: schema.auditLog.actor, n: sql<number>`count(*)::int`, last: sql<string>`max(${schema.auditLog.ts})` })
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.entity, "feed"), eq(schema.auditLog.action, "feed.called")))
    .groupBy(schema.auditLog.actor);
  const calls = await recentFeedCalls(12);
  const [{ pharmacists }] = await db.select({ pharmacists: sql<number>`count(*)::int` }).from(schema.pharmacists);
  const demo = value.keys.find((k) => k.demoKey && k.active);

  return (
    <ReportsView
      reports={reports}
      filters={filters}
      tab={typeof sp.tab === "string" ? sp.tab : undefined}
      provinces={[...PROVINCES.filter((p) => provinces.includes(p)), ...provinces.filter((p) => !PROVINCES.includes(p))]}
      years={years}
      feed={{
        baseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:8088",
        header: FEED_HEADER,
        demoKey: demo?.demoKey ?? null,
        demoHolder: demo?.name ?? null,
        canManageKeys: can(user.roles, "pcp.rules.manage"),
        pharmacists,
        endpoints: FEED_ENDPOINTS.map((e) => ({ path: e.path, title: e.title, what: e.what, fields: e.fields, filters: e.filters })),
        keys: value.keys.map((k) => {
          const s = stats.find((x) => x.actor === `feed:${k.id}`);
          return { id: k.id, name: k.name, audience: k.audience, prefix: k.prefix, active: k.active, issuedAt: k.issuedAt, issuedBy: k.issuedBy, revokedAt: k.revokedAt ?? null, calls: s?.n ?? 0, lastCall: s?.last ? new Date(s.last).toISOString() : null };
        }),
        calls: calls.map((c) => {
          const d = c.details as { keyName?: string; count?: number; reason?: string; filters?: Record<string, unknown> };
          return { id: c.id, ts: c.ts.toISOString(), actor: c.actor, keyName: d.keyName ?? null, endpoint: c.entityId, ok: c.action === "feed.called", count: d.count ?? null, reason: d.reason ?? null };
        }),
      }}
    />
  );
}
