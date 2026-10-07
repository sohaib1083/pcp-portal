"use server";
// CNIC check against NADRA (simulated) on a record, and PCP's resolution of a disagreement (guide section 14).
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { checkIdentity, resultSentence, toBadge, type CheckSubject } from "@/lib/identity";
import type { IdentityBadge, IdentityEntity } from "@/lib/identity-shared";
import { normalizeName } from "@/lib/names";
import { nextYearRef } from "@/lib/registry";
import { can } from "@/lib/roles";
import { getUser } from "@/lib/session";
import { notify } from "@/lib/util";
import type { ActionResult } from "./faculty";

const ENTITIES: IdentityEntity[] = ["faculty", "student", "pharmacist"];

function revalidate() {
  revalidatePath("/institution/faculty");
  revalidatePath("/institution/students");
  revalidatePath("/pcp/verification");
  revalidatePath("/pcp/pharmacists");
}

/**
 * The record behind a check, if this user may see it: an institution sees only its own faculty and students;
 * PCP's verification desk sees all; the registration officer sees pharmacists.
 */
async function subjectFor(entityType: IdentityEntity, entityId: number): Promise<{ subject: CheckSubject; institutionCode: string | null } | { error: string }> {
  const user = await getUser();
  if (!user) return { error: "Sign in again." };
  const pcpVerify = can(user.roles, "pcp.faculty.verify");
  const inst = user.institutionCode ? await db.query.institutions.findFirst({ where: eq(schema.institutions.code, user.institutionCode) }) : null;
  if (entityType === "faculty") {
    const f = await db.query.faculty.findFirst({ where: eq(schema.faculty.id, entityId) });
    if (!f) return { error: "This faculty record no longer exists." };
    const links = await db.select().from(schema.facultyLinks).where(and(eq(schema.facultyLinks.facultyId, f.id), inArray(schema.facultyLinks.status, ["ACTIVE", "REQUESTED"])));
    const mine = !!inst && can(user.roles, "inst.faculty.edit") && links.some((l) => l.institutionId === inst.id);
    if (!pcpVerify && !mine) return { error: "Your role cannot check this record." };
    const at = links.find((l) => l.status === "ACTIVE") ?? links[0];
    const code = at ? (await db.query.institutions.findFirst({ where: eq(schema.institutions.id, at.institutionId) }))?.code ?? null : null;
    return { subject: { entityType, entityId, ref: f.pcpId, cnic: f.cnic, name: f.fullName, fatherName: f.fatherName }, institutionCode: code };
  }
  if (entityType === "student") {
    const s = await db.query.students.findFirst({ where: eq(schema.students.id, entityId) });
    if (!s) return { error: "This student record no longer exists." };
    const mine = !!inst && can(user.roles, "inst.students.edit") && s.institutionId === inst.id;
    if (!pcpVerify && !mine) return { error: "Your role cannot check this record." };
    const code = (await db.query.institutions.findFirst({ where: eq(schema.institutions.id, s.institutionId) }))?.code ?? null;
    return { subject: { entityType, entityId, ref: s.pcpId, cnic: s.cnic, name: s.fullName, fatherName: s.fatherName }, institutionCode: code };
  }
  const p = await db.query.pharmacists.findFirst({ where: eq(schema.pharmacists.id, entityId) });
  if (!p) return { error: "This register entry no longer exists." };
  if (!pcpVerify && !can(user.roles, "pcp.pharmacists.manage")) return { error: "Your role cannot check this record." };
  return { subject: { entityType, entityId, ref: p.regNo, cnic: p.cnic, name: p.fullName, fatherName: p.fatherName }, institutionCode: null };
}

/** "Check CNIC with NADRA": runs the simulated check on one record and returns the new badge. */
export async function checkCnicNow(entityType: IdentityEntity, entityId: number): Promise<ActionResult & { badge?: IdentityBadge }> {
  if (!ENTITIES.includes(entityType) || !Number.isInteger(entityId)) return { ok: false, level: "error", message: "Unknown record." };
  const user = await getUser();
  const found = await subjectFor(entityType, entityId);
  if ("error" in found || !user) return { ok: false, level: "error", message: "error" in found ? found.error : "Sign in again." };
  const { result, check } = await checkIdentity(found.subject, "MANUAL", user.username);
  revalidate();
  return { ok: true, level: result.status === "MATCH" ? "success" : "warning", message: resultSentence(result, found.subject.name), badge: toBadge(check) };
}

/**
 * PCP resolves a NADRA disagreement with a note. "NAME_UPDATED" writes NADRA's spelling onto the record
 * (name mismatches only); "KEPT" keeps the record as it is (e.g. the CNIC copy was checked by hand).
 */
export async function resolveIdentityItem(checkId: number, outcome: "NAME_UPDATED" | "KEPT", note: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user || !can(user.roles, "pcp.faculty.verify")) return { ok: false, level: "error", message: "Only PCP's verification officer resolves NADRA checks." };
  const why = String(note ?? "").trim();
  if (why.length < 5) return { ok: false, level: "error", message: "Write a note of at least 5 characters: what you checked and what you decided." };
  const c = await db.query.identityChecks.findFirst({ where: eq(schema.identityChecks.id, checkId) });
  if (!c || c.reviewStatus !== "OPEN") return { ok: false, level: "warning", message: "This item was already resolved or replaced by a newer check. Reload the page." };
  if (outcome === "NAME_UPDATED" && (c.status !== "NAME_MISMATCH" || !c.nadraName)) return { ok: false, level: "error", message: "Only a name difference can be settled by taking NADRA's spelling." };
  const found = await subjectFor(c.entityType as IdentityEntity, c.entityId);
  if ("error" in found) return { ok: false, level: "error", message: found.error };
  const { subject, institutionCode } = found;
  const nadraName = c.nadraName ?? "";
  await db.transaction(async (tx) => {
    if (outcome === "NAME_UPDATED") {
      if (c.entityType === "faculty") {
        // Kept in the faculty record's change history, like any other correction.
        const link = await tx.query.facultyLinks.findFirst({ where: and(eq(schema.facultyLinks.facultyId, c.entityId), inArray(schema.facultyLinks.status, ["ACTIVE", "REQUESTED"])) });
        const title = /^(Dr|Prof)\.?\s/i.exec(subject.name)?.[0] ?? "";
        const newName = `${title}${nadraName}`.trim();
        await tx.update(schema.faculty).set({ fullName: newName, nameNorm: normalizeName(newName) }).where(eq(schema.faculty.id, c.entityId));
        if (link)
          await tx.insert(schema.facultyChangeRequests).values({
            ref: await nextYearRef(tx, "FCR"),
            facultyId: c.entityId,
            linkId: link.id,
            institutionId: link.institutionId,
            kind: "CORRECT_DETAILS",
            details: { changes: { fullName: { from: subject.name, to: newName } } },
            reason: `Name corrected to NADRA's record (simulated check ${c.txnId}). ${why}`,
            status: "APPLIED",
            requestedBy: user.username,
            decidedBy: user.username,
            decidedAt: new Date(),
            decisionNote: "Applied by PCP after the NADRA check",
          });
      } else if (c.entityType === "student") {
        await tx.update(schema.students).set({ fullName: nadraName }).where(eq(schema.students.id, c.entityId));
      } else {
        await tx.update(schema.pharmacists).set({ fullName: nadraName, updatedAt: new Date() }).where(eq(schema.pharmacists.id, c.entityId));
        await tx.insert(schema.pharmacistEvents).values({ pharmacistId: c.entityId, kind: "IDENTITY", note: `Name corrected from "${subject.name}" to NADRA's record "${nadraName}". ${why}`, actor: user.username });
      }
    }
    await tx
      .update(schema.identityChecks)
      .set({ reviewStatus: "RESOLVED", reviewOutcome: outcome, reviewNote: why, reviewedBy: user.username, reviewedAt: new Date() })
      .where(and(eq(schema.identityChecks.entityType, c.entityType), eq(schema.identityChecks.entityId, c.entityId), eq(schema.identityChecks.reviewStatus, "OPEN")));
    await audit(tx, {
      actor: user.username,
      action: outcome === "NAME_UPDATED" ? "identity.nadra.name_updated" : "identity.nadra.resolved",
      entity: c.entityType,
      entityId: subject.ref,
      details: { checkId: c.id, status: c.status, txnId: c.txnId, note: why, ...(outcome === "NAME_UPDATED" ? { from: subject.name, to: nadraName } : {}) },
    });
    if (institutionCode)
      await notify(
        tx,
        `inst:${institutionCode}`,
        outcome === "NAME_UPDATED" ? `Name corrected to NADRA's record: ${subject.ref}` : `NADRA check resolved: ${subject.ref}`,
        outcome === "NAME_UPDATED"
          ? `PCP corrected the name of ${subject.name} (${subject.ref}) to "${nadraName}", as NADRA holds it. Note: ${why}`
          : `PCP reviewed the NADRA result for ${subject.name} (${subject.ref}) and kept the record as it is. Note: ${why}`,
        c.entityType === "faculty" ? "/institution/faculty" : "/institution/students",
      );
  });
  revalidate();
  return { ok: true, level: "success", message: outcome === "NAME_UPDATED" ? `${subject.ref} now reads "${nadraName}", as NADRA holds it. The item is resolved.` : `Resolved: ${subject.ref} is kept as it is, with your note.` };
}
