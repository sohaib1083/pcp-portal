import { asc, desc, eq } from "drizzle-orm";
import RulesView from "@/components/RulesView";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/session";

export const metadata = { title: "Reference rules" };

export default async function RulesPage() {
  await requirePermission("pcp.rules.manage");
  const rows = await db.select().from(schema.rules).orderBy(asc(schema.rules.key), desc(schema.rules.version));
  // Who saved each version comes from the tamper-evident audit log.
  const log = await db.select({ entityId: schema.auditLog.entityId, actor: schema.auditLog.actor, ts: schema.auditLog.ts }).from(schema.auditLog).where(eq(schema.auditLog.entity, "rule"));
  const by = Object.fromEntries(log.map((l) => [l.entityId, { actor: l.actor, at: l.ts.toISOString() }]));
  const names = Object.fromEntries((await db.select({ u: schema.staff.username, n: schema.staff.displayName }).from(schema.staff)).map((s) => [s.u, s.n]));
  const keys = [...new Set(rows.map((r) => r.key))];
  return (
    <RulesView
      rules={keys.map((key) => ({
        key,
        versions: rows
          .filter((r) => r.key === key)
          .map((r) => {
            const who = by[`${key}@v${r.version}`];
            return { version: r.version, value: r.value, description: r.description, effectiveFrom: r.effectiveFrom, savedBy: who ? (who.actor === "system" ? "Initial data" : (names[who.actor] ?? who.actor)) : "Initial data", savedAt: who?.at ?? null };
          }),
      }))}
    />
  );
}
