import { createHash } from "node:crypto";
import { asc, desc, sql } from "drizzle-orm";
import { db, schema } from "@/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export type AuditInput = {
  actor: string;
  action: string;
  entity: string;
  entityId: string | number;
  details?: Record<string, unknown>;
};

const GENESIS = "0".repeat(64);

// Canonical JSON (sorted keys): jsonb does not keep key order, so hashes must not depend on it.
// Keys whose value is undefined are left out, as JSON and jsonb leave them out when the row is stored.
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as Record<string, unknown>)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v ?? null);
}

function hashRow(prevHash: string, ts: string, a: AuditInput) {
  const payload = canonical([prevHash, ts, a.actor, a.action, a.entity, String(a.entityId), a.details ?? {}]);
  return createHash("sha256").update(payload).digest("hex");
}

/** Appends to the hash-chained audit log. A transaction-level advisory lock keeps the chain in order. */
export async function audit(exec: Executor, a: AuditInput): Promise<void> {
  // Outside a transaction the lock would be released at once, so open one.
  if (exec === db) return db.transaction((tx) => audit(tx, a));
  await exec.execute(sql`select pg_advisory_xact_lock(424242)`);
  const last = await exec.select({ hash: schema.auditLog.hash }).from(schema.auditLog).orderBy(desc(schema.auditLog.id)).limit(1);
  const prevHash = last[0]?.hash ?? GENESIS;
  const ts = new Date().toISOString();
  const hash = hashRow(prevHash, ts, a);
  await exec.insert(schema.auditLog).values({
    ts: new Date(ts),
    actor: a.actor,
    action: a.action,
    entity: a.entity,
    entityId: String(a.entityId),
    details: a.details ?? {},
    prevHash,
    hash,
  });
}

/** Recomputes the whole chain. Any edited or deleted row breaks it from that point on. */
export async function verifyAuditChain() {
  const rows = await db.select().from(schema.auditLog).orderBy(asc(schema.auditLog.id));
  let prev = GENESIS;
  for (const r of rows) {
    const expected = hashRow(prev, r.ts.toISOString(), {
      actor: r.actor,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      details: r.details as Record<string, unknown>,
    });
    if (r.prevHash !== prev || r.hash !== expected) {
      return { ok: false as const, total: rows.length, brokenAt: r.id };
    }
    prev = r.hash;
  }
  return { ok: true as const, total: rows.length, brokenAt: null };
}
