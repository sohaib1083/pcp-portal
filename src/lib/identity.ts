// Identity checks: run the (simulated) NADRA CNIC check, store it, audit it, and raise an item on PCP's
// Data verification screen when NADRA disagrees (guide section 14, "Identity and data quality").
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "./audit";
import type { IdentityBadge, IdentityEntity } from "./identity-shared";
import { maskCnic } from "./names";
import { simulateNadra, verifyCnic, verifyCnicBatch, type NadraResult } from "./nadra";
import { notifyVerifiers, type Executor } from "./registry";

export type CheckSubject = {
  entityType: IdentityEntity;
  entityId: number;
  ref: string; // PCP-FAC-000095, PCP-RUH-2026-00000041, KPPC-A-04567: used in the audit log and messages
  cnic: string;
  name: string;
  fatherName?: string;
};

type Source = "REGISTRATION" | "IMPORT" | "MANUAL" | "SEED";

const LABEL: Record<IdentityEntity, string> = { faculty: "faculty member", student: "student", pharmacist: "pharmacist" };

/** Store one result. A match settles any open item on the same record; a disagreement opens one. */
async function store(exec: Executor, s: CheckSubject, r: NadraResult, source: Source, checkedBy: string) {
  const open = r.status !== "MATCH";
  const [row] = await exec
    .insert(schema.identityChecks)
    .values({
      entityType: s.entityType,
      entityId: s.entityId,
      cnic: s.cnic,
      nameSent: s.name,
      status: r.status,
      nadraName: r.nadraName,
      txnId: r.txnId,
      source,
      checkedBy,
      checkedAt: new Date(r.checkedAt),
      reviewStatus: open ? "OPEN" : null,
    })
    .returning();
  // Earlier open items on this record: a newer check replaces them.
  await exec
    .update(schema.identityChecks)
    .set(
      open
        ? { reviewStatus: "RESOLVED", reviewOutcome: "SUPERSEDED", reviewNote: "A newer NADRA check replaced this one", reviewedBy: checkedBy, reviewedAt: new Date() }
        : { reviewStatus: "RESOLVED", reviewOutcome: "SETTLED_BY_RECHECK", reviewNote: "A later NADRA check matched", reviewedBy: checkedBy, reviewedAt: new Date() },
    )
    .where(and(eq(schema.identityChecks.entityType, s.entityType), eq(schema.identityChecks.entityId, s.entityId), eq(schema.identityChecks.reviewStatus, "OPEN"), sql`${schema.identityChecks.id} <> ${row.id}`));
  await audit(exec, {
    actor: checkedBy,
    action: `identity.nadra.${r.status.toLowerCase()}`,
    entity: s.entityType,
    entityId: s.ref,
    details: { simulated: true, cnic: maskCnic(s.cnic), status: r.status, txnId: r.txnId, source, ...(r.status === "NAME_MISMATCH" ? { nadraName: r.nadraName, nameSent: s.name } : {}) },
  });
  return row;
}

/** One sentence for the person who ran the check. */
export function resultSentence(r: { status: string; nadraName: string | null }, name: string) {
  if (r.status === "MATCH") return "Simulated NADRA check: CNIC and name match.";
  if (r.status === "NAME_MISMATCH") return `Simulated NADRA check: NADRA holds the name as "${r.nadraName}", not "${name}". PCP's verification officer will review it.`;
  return "Simulated NADRA check: NADRA has no record of this CNIC. PCP's verification officer will review it.";
}

/** Check one record now (about a second, like a real round trip) and store the result. */
export async function checkIdentity(s: CheckSubject, source: Source, checkedBy: string) {
  const r = await verifyCnic({ cnic: s.cnic, name: s.name, fatherName: s.fatherName });
  const row = await db.transaction(async (tx) => {
    const saved = await store(tx, s, r, source, checkedBy);
    if (r.status !== "MATCH")
      await notifyVerifiers(
        tx,
        r.status === "NAME_MISMATCH" ? `Name differs at NADRA: ${s.ref}` : `CNIC not found at NADRA: ${s.ref}`,
        `${resultSentence(r, s.name)} Record: ${LABEL[s.entityType]} ${s.name} (${s.ref}).`,
        "/pcp/verification?tab=nadra",
      );
    return saved;
  });
  return { result: r, check: row };
}

/** Check a batch (bulk import) in one round trip and store every result; one message to PCP for the whole batch. */
export async function checkIdentities(subjects: CheckSubject[], source: Source, checkedBy: string, batchLabel: string) {
  if (!subjects.length) return [];
  const results = await verifyCnicBatch(subjects.map((s) => ({ cnic: s.cnic, name: s.name, fatherName: s.fatherName })));
  return db.transaction(async (tx) => {
    const out: { subject: CheckSubject; result: NadraResult }[] = [];
    for (let i = 0; i < subjects.length; i++) {
      await store(tx, subjects[i], results[i], source, checkedBy);
      out.push({ subject: subjects[i], result: results[i] });
    }
    const bad = out.filter((o) => o.result.status !== "MATCH");
    if (bad.length)
      await notifyVerifiers(
        tx,
        `${bad.length} NADRA ${bad.length === 1 ? "difference" : "differences"} in ${batchLabel}`,
        `Simulated NADRA check of ${out.length} records: ${bad.map((b) => `${b.subject.name} (${b.subject.ref}): ${b.result.status === "NOT_FOUND" ? "not found" : `NADRA holds "${b.result.nadraName}"`}`).slice(0, 10).join("; ")}${bad.length > 10 ? "; …" : ""}.`,
        "/pcp/verification?tab=nadra",
      );
    return out;
  });
}

/** Seed helper: store a check without the delay (the outcome rule is the same). */
export async function seedIdentityCheck(exec: Executor, s: CheckSubject, checkedAt: Date) {
  const r = { ...simulateNadra({ cnic: s.cnic, name: s.name }), checkedAt: checkedAt.toISOString() };
  const open = r.status !== "MATCH";
  await exec.insert(schema.identityChecks).values({
    entityType: s.entityType,
    entityId: s.entityId,
    cnic: s.cnic,
    nameSent: s.name,
    status: r.status,
    nadraName: r.nadraName,
    txnId: r.txnId,
    source: "SEED",
    checkedBy: "system",
    checkedAt,
    reviewStatus: open ? "OPEN" : null,
  });
  return r;
}

export function toBadge(c: typeof schema.identityChecks.$inferSelect): IdentityBadge {
  return {
    checkId: c.id,
    status: c.status as IdentityBadge["status"],
    nadraName: c.nadraName,
    nameSent: c.nameSent,
    txnId: c.txnId,
    checkedAt: c.checkedAt.toISOString(),
    checkedBy: c.checkedBy,
    reviewStatus: c.reviewStatus,
    reviewOutcome: c.reviewOutcome,
    reviewNote: c.reviewNote,
  };
}

/** The latest check per record, for badges. */
export async function latestIdentity(entityType: IdentityEntity, ids: number[]): Promise<Record<number, IdentityBadge>> {
  if (!ids.length) return {};
  const rows = await db
    .selectDistinctOn([schema.identityChecks.entityId])
    .from(schema.identityChecks)
    .where(and(eq(schema.identityChecks.entityType, entityType), inArray(schema.identityChecks.entityId, [...new Set(ids)])))
    .orderBy(schema.identityChecks.entityId, desc(schema.identityChecks.checkedAt), desc(schema.identityChecks.id));
  return Object.fromEntries(rows.map((r) => [r.entityId, toBadge(r)]));
}
