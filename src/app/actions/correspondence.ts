"use server";
// Correspondence register (RFP 4.1.1 "official council correspondence management"): the inward diary and the
// outward dispatch register. Outward letters use the standard letterhead and are dispatched by (simulated) email.
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { fileLetterDocument, nextGovRef, pcpStaff, renderOutwardLetter, resolveLink, shortDay, today } from "@/lib/governance";
import { MODE_LABELS, refHref, refKind } from "@/lib/governance-shared";
import { emailAudience, sendEmail } from "@/lib/messages";
import { can } from "@/lib/roles";
import { requirePermission, requireUser } from "@/lib/session";
import { notify } from "@/lib/util";
import type { ActionResult } from "./faculty";

const fail = (message: string): ActionResult => ({ ok: false, message, level: "error" });
const YMD = /^\d{4}-\d{2}-\d{2}$/;

async function guard<T extends ActionResult>(fn: () => Promise<T>): Promise<T | ActionResult> {
  try {
    return await fn();
  } catch (e) {
    unstable_rethrow(e);
    return fail(e instanceof Error ? e.message : String(e));
  }
}

function refresh(ref?: string, linkedRef?: string | null) {
  revalidatePath("/pcp/correspondence");
  if (ref) revalidatePath(`/pcp/correspondence/${ref}`);
  const href = linkedRef ? refHref(linkedRef) : null;
  if (href) revalidatePath(href);
  revalidatePath("/pcp");
}

async function getLetter(ref: string) {
  const l = await db.query.correspondence.findFirst({ where: eq(schema.correspondence.ref, ref) });
  if (!l) throw new Error(`Letter ${ref} was not found in the register.`);
  return l;
}

/** Sender or addressee: an institution from the registry, or anyone else by name. */
async function party(v: { partyInstitutionId?: number | null; party?: string | null; partyEmail?: string | null }) {
  if (v.partyInstitutionId) {
    const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, v.partyInstitutionId) });
    if (!inst) throw new Error("That institution is not in the registry. Pick it from the list.");
    return { name: inst.name, institutionId: inst.id, email: inst.email ?? null };
  }
  const name = (v.party ?? "").trim();
  if (name.length < 3) throw new Error("Pick the institution, or type who the letter is from or to.");
  const email = (v.partyEmail ?? "").trim();
  if (email && !z.string().email().safeParse(email).success) throw new Error("The email address does not look right.");
  return { name, institutionId: null, email: email || null };
}

/** The reference a letter is about must exist, and belong to the same institution when there is one. */
async function link(linkedRef: string | null | undefined, institutionId: number | null) {
  if (!linkedRef) return { linkedRef: null, institutionId };
  const t = await resolveLink(db, linkedRef);
  if (!t) throw new Error(`${linkedRef} was not found. Link a case, appeal or court case reference.`);
  if (institutionId && t.institutionId && t.institutionId !== institutionId) throw new Error(`${linkedRef} belongs to another institution. Pick a case of the same institution.`);
  return { linkedRef, institutionId: institutionId ?? t.institutionId };
}

async function assertOfficer(username: string | null | undefined) {
  if (!username) return null;
  const s = (await pcpStaff()).find((x) => x.username === username);
  if (!s) throw new Error("Mark the letter to an active PCP officer from the list.");
  return s;
}

const InwardInput = z.object({
  letterDate: z.string().regex(YMD, "Pick the date on the letter."),
  mode: z.enum(["POST", "COURIER", "EMAIL", "HAND"], { message: "Say how the letter arrived." }),
  partyInstitutionId: z.number().int().optional().nullable(),
  party: z.string().optional().nullable(),
  partyEmail: z.string().optional().nullable(),
  subject: z.string().trim().min(5, "Give the subject of the letter (at least 5 characters)."),
  linkedRef: z.string().trim().optional().nullable(),
  markedTo: z.string().trim().optional().nullable(),
  actionDue: z.string().regex(YMD).optional().nullable(),
  note: z.string().trim().optional().nullable(),
});

/** Diary an inward letter. Marking it to an officer puts it on their work list and tells them. */
export async function registerInward(raw: unknown): Promise<ActionResult & { ref?: string }> {
  const user = await requirePermission("pcp.correspondence.manage");
  return guard(async () => {
    const parsed = InwardInput.safeParse(raw);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form.");
    const v = parsed.data;
    if (v.letterDate > today()) return fail("The letter date is in the future. Enter the date written on the letter.");
    if (v.actionDue && v.actionDue < today()) return fail("The action date is in the past. Pick today or a later date.");
    if (v.actionDue && !v.markedTo) return fail("An action date needs an officer to act. Mark the letter to someone.");
    const p = await party(v);
    const l = await link(v.linkedRef, p.institutionId);
    const officer = await assertOfficer(v.markedTo);
    const ref = await db.transaction(async (tx) => {
      const r = await nextGovRef(tx, "correspondence", "IN", 5);
      await tx.insert(schema.correspondence).values({
        ref: r,
        direction: "IN",
        letterDate: v.letterDate,
        party: p.name,
        partyEmail: p.email,
        partyInstitutionId: p.institutionId,
        institutionId: l.institutionId,
        subject: v.subject,
        mode: v.mode,
        linkedRef: l.linkedRef,
        markedTo: officer?.username ?? null,
        actionDue: v.actionDue || null,
        actionNote: v.note || null,
        createdBy: user.username,
      });
      await audit(tx, { actor: user.username, action: "correspondence.registered", entity: "correspondence", entityId: r, details: { direction: "IN", from: p.name, subject: v.subject, linkedRef: l.linkedRef, markedTo: officer?.username ?? null } });
      if (officer && officer.username !== user.username)
        await notify(tx, `user:${officer.username}`, `Letter ${r} marked to you`, `From ${p.name}: ${v.subject}.${v.actionDue ? ` Action due by ${shortDay(v.actionDue)}.` : ""}`, `/pcp/correspondence/${r}`);
      return r;
    });
    refresh(ref, l.linkedRef);
    return { ok: true, level: "success", ref, message: `${ref} entered in the diary${officer ? ` and marked to ${officer.name}${officer.username !== user.username ? ", who is notified" : ""}` : ""}.` };
  });
}

export async function markLetter(ref: string, raw: { markedTo: string; actionDue?: string | null }): Promise<ActionResult> {
  const user = await requirePermission("pcp.correspondence.manage");
  return guard(async () => {
    const l = await getLetter(ref);
    if (l.direction !== "IN") return fail("Only inward letters are marked to an officer.");
    if (l.status === "CLOSED") return fail(`${l.ref} is closed.`);
    const officer = await assertOfficer(raw.markedTo);
    if (!officer) return fail("Choose the officer.");
    if (raw.actionDue && (!YMD.test(raw.actionDue) || raw.actionDue < today())) return fail("Pick an action date from today onwards.");
    await db.transaction(async (tx) => {
      await tx.update(schema.correspondence).set({ markedTo: officer.username, actionDue: raw.actionDue || l.actionDue, status: "OPEN", updatedAt: new Date() }).where(eq(schema.correspondence.id, l.id));
      await audit(tx, { actor: user.username, action: "correspondence.marked", entity: "correspondence", entityId: l.ref, details: { from: l.markedTo, to: officer.username, actionDue: raw.actionDue ?? l.actionDue } });
      if (officer.username !== user.username) await notify(tx, `user:${officer.username}`, `Letter ${l.ref} marked to you`, `From ${l.party}: ${l.subject}.${raw.actionDue || l.actionDue ? ` Action due by ${shortDay(raw.actionDue || l.actionDue)}.` : ""}`, `/pcp/correspondence/${l.ref}`);
    });
    refresh(l.ref, l.linkedRef);
    return { ok: true, level: "success", message: `${l.ref} marked to ${officer.name}.` };
  });
}

/** The officer the letter is marked to (or a register keeper) records what was done. */
export async function recordLetterAction(ref: string, note: string): Promise<ActionResult> {
  const user = await requireUser("pcp");
  return guard(async () => {
    const l = await getLetter(ref);
    if (!can(user.roles, "pcp.correspondence.manage") && l.markedTo !== user.username) return fail("Only the officer the letter is marked to, or a register keeper, can record action on it.");
    if (l.status === "CLOSED") return fail(`${l.ref} is closed.`);
    const text = (note ?? "").trim();
    if (text.length < 5) return fail("Say what was done (at least a few words).");
    await db.transaction(async (tx) => {
      await tx.update(schema.correspondence).set({ status: "ACTIONED", actionNote: text, updatedAt: new Date() }).where(eq(schema.correspondence.id, l.id));
      await audit(tx, { actor: user.username, action: "correspondence.actioned", entity: "correspondence", entityId: l.ref, details: { note: text } });
    });
    refresh(l.ref, l.linkedRef);
    return { ok: true, level: "success", message: `${l.ref} marked as actioned. It leaves the work list.` };
  });
}

export async function closeLetter(ref: string): Promise<ActionResult> {
  const user = await requireUser("pcp");
  return guard(async () => {
    const l = await getLetter(ref);
    if (!can(user.roles, "pcp.correspondence.manage") && l.markedTo !== user.username) return fail("Only the officer the letter is marked to, or a register keeper, can close it.");
    if (l.status === "CLOSED") return fail(`${l.ref} is already closed.`);
    if (l.direction === "OUT" && !l.dispatchedAt) return fail("Dispatch the letter before closing it, or leave it as a draft.");
    await db.transaction(async (tx) => {
      await tx.update(schema.correspondence).set({ status: "CLOSED", updatedAt: new Date() }).where(eq(schema.correspondence.id, l.id));
      await audit(tx, { actor: user.username, action: "correspondence.closed", entity: "correspondence", entityId: l.ref });
    });
    refresh(l.ref, l.linkedRef);
    return { ok: true, level: "success", message: `${l.ref} closed and filed.` };
  });
}

const OutwardInput = z.object({
  partyInstitutionId: z.number().int().optional().nullable(),
  party: z.string().optional().nullable(),
  partyEmail: z.string().optional().nullable(),
  subject: z.string().trim().min(5, "Give the letter a subject (at least 5 characters)."),
  body: z.string().trim().min(20, "Write the text of the letter (at least a sentence)."),
  mode: z.enum(["POST", "COURIER", "EMAIL", "HAND"], { message: "Say how the letter will be sent." }),
  linkedRef: z.string().trim().optional().nullable(),
  inReplyTo: z.number().int().optional().nullable(),
});

/** Draft an outward letter: the standard letterhead PDF is generated and filed. Dispatch is a separate step. */
export async function createOutward(raw: unknown): Promise<ActionResult & { ref?: string }> {
  const user = await requirePermission("pcp.correspondence.manage");
  return guard(async () => {
    const parsed = OutwardInput.safeParse(raw);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the letter.");
    const v = parsed.data;
    const p = await party(v);
    const reply = v.inReplyTo ? await db.query.correspondence.findFirst({ where: eq(schema.correspondence.id, v.inReplyTo) }) : null;
    if (v.inReplyTo && (!reply || reply.direction !== "IN")) return fail("The letter you are replying to was not found in the inward register.");
    const l = await link(v.linkedRef || reply?.linkedRef, p.institutionId);
    const ref = await db.transaction(async (tx) => {
      const r = await nextGovRef(tx, "correspondence", "OUT", 5);
      const [row] = await tx
        .insert(schema.correspondence)
        .values({ ref: r, direction: "OUT", letterDate: today(), party: p.name, partyEmail: p.email, partyInstitutionId: p.institutionId, institutionId: l.institutionId, subject: v.subject, body: v.body, mode: v.mode, linkedRef: l.linkedRef, inReplyTo: reply?.id ?? null, createdBy: user.username })
        .returning();
      const pdf = await renderOutwardLetter(tx, row, { name: user.name, role: user.role });
      const doc = await fileLetterDocument(tx, row, { docType: "Outward letter", fileName: `${r}.pdf`, bytes: pdf, uploadedBy: user.username });
      await tx.update(schema.correspondence).set({ documentId: doc.id }).where(eq(schema.correspondence.id, row.id));
      await audit(tx, { actor: user.username, action: "correspondence.generated", entity: "correspondence", entityId: r, details: { to: p.name, subject: v.subject, linkedRef: l.linkedRef, inReplyTo: reply?.ref ?? null, sha256: doc.sha256 } });
      return r;
    });
    refresh(ref, l.linkedRef);
    return { ok: true, level: "success", ref, message: `${ref} generated on the PCP letterhead. Check the PDF, then dispatch it.` };
  });
}

/** Change the text of an outward letter before it goes; the PDF is generated again as a new version. */
export async function updateOutward(ref: string, raw: { subject: string; body: string; mode: string }): Promise<ActionResult> {
  const user = await requirePermission("pcp.correspondence.manage");
  return guard(async () => {
    const l = await getLetter(ref);
    if (l.direction !== "OUT") return fail("Only outward letters are generated here.");
    if (l.dispatchedAt) return fail(`${l.ref} was dispatched on ${shortDay(l.dispatchedAt)}; it can no longer change. Send a corrigendum as a new letter.`);
    const subject = (raw.subject ?? "").trim();
    const body = (raw.body ?? "").trim();
    if (subject.length < 5) return fail("Give the letter a subject (at least 5 characters).");
    if (body.length < 20) return fail("Write the text of the letter (at least a sentence).");
    if (!MODE_LABELS[raw.mode]) return fail("Say how the letter will be sent.");
    const version = await db.transaction(async (tx) => {
      const [row] = await tx.update(schema.correspondence).set({ subject, body, mode: raw.mode, letterDate: today(), updatedAt: new Date() }).where(eq(schema.correspondence.id, l.id)).returning();
      const pdf = await renderOutwardLetter(tx, row, { name: user.name, role: user.role });
      const doc = await fileLetterDocument(tx, row, { docType: "Outward letter", fileName: `${l.ref}.pdf`, bytes: pdf, uploadedBy: user.username });
      await tx.update(schema.correspondence).set({ documentId: doc.id }).where(eq(schema.correspondence.id, l.id));
      await audit(tx, { actor: user.username, action: "correspondence.regenerated", entity: "correspondence", entityId: l.ref, details: { version: doc.version, sha256: doc.sha256 } });
      return doc.version;
    });
    refresh(l.ref, l.linkedRef);
    return { ok: true, level: "success", message: `${l.ref} regenerated as version ${version}. Earlier versions are kept.` };
  });
}

/** Send the letter: an email copy to the institution's users (or the addressee's email), and the dispatch is recorded. */
export async function dispatchOutward(ref: string): Promise<ActionResult> {
  const user = await requirePermission("pcp.correspondence.manage");
  return guard(async () => {
    const l = await getLetter(ref);
    if (l.direction !== "OUT") return fail("Only outward letters are dispatched.");
    if (l.dispatchedAt) return fail(`${l.ref} was already dispatched on ${shortDay(l.dispatchedAt)}.`);
    if (!l.documentId) return fail("Generate the letter first.");
    const inst = l.partyInstitutionId ? await db.query.institutions.findFirst({ where: eq(schema.institutions.id, l.partyInstitutionId) }) : null;
    const caseRef = l.linkedRef && refKind(l.linkedRef) === "case" ? l.linkedRef : null;
    const res = await db.transaction(async (tx) => {
      let sent = 0;
      const subject = `Letter ${l.ref} from PCP: ${l.subject}`;
      const body = `The Pharmacy Council of Pakistan has sent you letter ${l.ref} (${MODE_LABELS[l.mode].toLowerCase()}${l.mode === "EMAIL" ? "" : ", with this email copy"}). The signed PDF is in your Correspondence folder${caseRef ? ` and on case ${caseRef}` : ""}.`;
      if (inst) {
        const link = caseRef ? `/institution/applications/${caseRef}` : "/institution/documents";
        await tx.insert(schema.notifications).values({ audience: `inst:${inst.code}`, title: subject, body, link });
        // Filed on the case when the letter is about one, otherwise on the letter itself.
        sent = await emailAudience(tx, `inst:${inst.code}`, subject, body, link, caseRef ? { entity: "application", entityRef: caseRef } : { entity: "correspondence", entityRef: l.ref });
      } else if (l.partyEmail) {
        await sendEmail(tx, { to: l.partyEmail, toName: l.party, subject, body: `${body.replace(" The signed PDF is in your Correspondence folder.", "")} The signed letter is attached (demo: attachment not sent).`, entity: "correspondence", entityRef: l.ref });
        sent = 1;
      }
      await tx.update(schema.correspondence).set({ dispatchedAt: new Date(), dispatchedBy: user.username, status: "ACTIONED", updatedAt: new Date() }).where(eq(schema.correspondence.id, l.id));
      if (l.inReplyTo) {
        const orig = await tx.query.correspondence.findFirst({ where: eq(schema.correspondence.id, l.inReplyTo) });
        if (orig && orig.status === "OPEN") {
          await tx.update(schema.correspondence).set({ status: "ACTIONED", actionNote: `Replied by ${l.ref} on ${shortDay(new Date())}.`, updatedAt: new Date() }).where(eq(schema.correspondence.id, orig.id));
          await audit(tx, { actor: user.username, action: "correspondence.actioned", entity: "correspondence", entityId: orig.ref, details: { reply: l.ref } });
        }
      }
      await audit(tx, { actor: user.username, action: "correspondence.dispatched", entity: "correspondence", entityId: l.ref, details: { to: l.party, mode: l.mode, emails: sent } });
      return sent;
    });
    refresh(l.ref, l.linkedRef);
    return {
      ok: true,
      level: "success",
      message: `${l.ref} dispatched by ${MODE_LABELS[l.mode].toLowerCase()}.${res ? ` Email copy sent to ${res} recipient${res === 1 ? "" : "s"}${inst ? ` at ${inst.shortCode}` : ""} (simulated).` : " No email address on record, so no email copy was sent."}`,
    };
  });
}
