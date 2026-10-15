import { desc, eq, inArray, like, or, sql } from "drizzle-orm";
import AuditView from "@/components/AuditView";
import { db, schema } from "@/db";
import { verifyAuditChain } from "@/lib/audit";
import { OVERRIDE_LABELS } from "@/lib/overrides";
import { ROLE_LABELS } from "@/lib/roles";
import { requirePermission } from "@/lib/session";

/** Audit actions that record someone reading or taking a record out of the system: the database access log (RFP 4.1.2). */
const ACCESS = or(like(schema.auditLog.action, "%.viewed"), like(schema.auditLog.action, "%.downloaded"), like(schema.auditLog.action, "%.exported"), like(schema.auditLog.action, "%.denied"));

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePermission("pcp.audit.view");
  const { tab } = await searchParams;
  const rows = await db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.id)).limit(300);
  const chain = await verifyAuditChain();
  const staff = await db.select({ username: schema.staff.username, name: schema.staff.displayName, role: schema.staff.role }).from(schema.staff);
  const who = (u: string) => {
    const s = staff.find((x) => x.username === u);
    return { name: s?.name ?? u, role: s ? (ROLE_LABELS[s.role] ?? s.role) : u === "system" ? "System" : "Public or former user" };
  };

  // Overrides: every super administrator override, with the audit entry that records it.
  const overrides = await db
    .select({ o: schema.caseOverrides, ref: schema.applications.ref, status: schema.applications.status, inst: schema.institutions.shortCode })
    .from(schema.caseOverrides)
    .innerJoin(schema.applications, eq(schema.applications.id, schema.caseOverrides.applicationId))
    .innerJoin(schema.institutions, eq(schema.institutions.id, schema.applications.institutionId))
    .orderBy(desc(schema.caseOverrides.id));
  const overrideAudit = overrides.length
    ? await db.select({ id: schema.auditLog.id, hash: schema.auditLog.hash, override: sql<string>`${schema.auditLog.details}->>'override'` }).from(schema.auditLog).where(like(schema.auditLog.action, "override.%"))
    : [];
  const holds = await db.select({ applicationId: schema.caseHolds.applicationId }).from(schema.caseHolds).where(sql`${schema.caseHolds.releasedAt} is null`);

  // Database access log: views, downloads, exports and refused attempts, newest first.
  const access = await db.select().from(schema.auditLog).where(ACCESS).orderBy(desc(schema.auditLog.id)).limit(600);
  const docIds = access.filter((a) => a.entity === "document" && /^\d+$/.test(a.entityId)).map((a) => Number(a.entityId));
  const docs = docIds.length ? await db.select({ id: schema.documents.id, fileName: schema.documents.fileName, docType: schema.documents.docType, version: schema.documents.version }).from(schema.documents).where(inArray(schema.documents.id, [...new Set(docIds)])) : [];

  return (
    <AuditView
      tab={tab}
      chain={chain}
      rows={rows.map((r) => ({ id: r.id, ts: r.ts.toISOString(), actor: r.actor, action: r.action, entity: r.entity, entityId: r.entityId, details: JSON.stringify(r.details), hash: r.hash, prevHash: r.prevHash }))}
      overrides={overrides.map(({ o, ref, status, inst }) => {
        const a = overrideAudit.find((x) => x.override === o.ref);
        return {
          ref: o.ref,
          caseRef: ref,
          caseStatus: status,
          inst,
          kind: o.kind,
          label: OVERRIDE_LABELS[o.kind] ?? o.kind,
          reason: o.reason,
          before: o.before,
          after: o.after,
          actor: who(o.actor).name,
          at: o.createdAt.toISOString(),
          auditId: a?.id ?? null,
          auditHash: a?.hash ?? null,
        };
      })}
      activeHolds={holds.length}
      access={access.map((a) => {
        const w = who(a.actor);
        const d = a.entity === "document" ? docs.find((x) => String(x.id) === a.entityId) : null;
        return {
          id: a.id,
          ts: a.ts.toISOString(),
          actor: a.actor,
          name: w.name,
          role: w.role,
          action: a.action,
          kind: /denied$/.test(a.action) ? "REFUSED" : /downloaded$/.test(a.action) ? "DOWNLOAD" : /exported$/.test(a.action) ? "EXPORT" : "VIEW",
          entity: a.entity,
          entityId: a.entityId,
          label: d ? `${d.docType} v${d.version} · ${d.fileName}` : null,
          details: JSON.stringify(a.details),
        };
      })}
    />
  );
}
