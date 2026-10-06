import { desc } from "drizzle-orm";
import AuditView from "@/components/AuditView";
import { db, schema } from "@/db";
import { verifyAuditChain } from "@/lib/audit";
import { requirePermission } from "@/lib/session";

export default async function AuditPage() {
  await requirePermission("pcp.audit.view");
  const rows = await db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.id)).limit(300);
  const chain = await verifyAuditChain();
  return (
    <AuditView
      chain={chain}
      rows={rows.map((r) => ({ id: r.id, ts: r.ts.toISOString(), actor: r.actor, action: r.action, entity: r.entity, entityId: r.entityId, details: JSON.stringify(r.details), hash: r.hash, prevHash: r.prevHash }))}
    />
  );
}
