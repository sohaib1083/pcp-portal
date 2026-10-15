"use server";
// Court case ledger (RFP section 6 week 3, Annexure-III item 4): cases, hearings, orders and stay orders.
// A stay order on a linked case blocks council decisions on it until it is lifted (see assertNoStayOrder).
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { courtList, hearingReminder, nextGovRef, resolveLink, shortDay, stayText, today } from "@/lib/governance";
import { governanceFor } from "@/lib/governance-data";
import { COURT_STATUS, OPEN_COURT_STATUSES, ORDER_LABELS, courtShort, refHref } from "@/lib/governance-shared";
import { can } from "@/lib/roles";
import { requirePermission, requireUser } from "@/lib/session";
import { notify } from "@/lib/util";
import type { ActionResult } from "./faculty";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
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
  revalidatePath("/pcp/litigation");
  if (ref) revalidatePath(`/pcp/litigation/${ref}`);
  const href = linkedRef ? refHref(linkedRef) : null;
  if (href) revalidatePath(href);
  revalidatePath("/pcp");
}

async function getCase(ref: string) {
  const c = await db.query.courtCases.findFirst({ where: eq(schema.courtCases.ref, ref) });
  if (!c) throw new Error(`Court case ${ref} was not found.`);
  return c;
}

/** Who must know about an order on a linked PCP case: the Secretary (council decisions) and the case officer. */
async function tellCaseHolders(tx: Tx, linkedRef: string | null, title: string, body: string) {
  if (!linkedRef) return;
  const href = refHref(linkedRef) ?? "/pcp/litigation";
  await notify(tx, "role:pcp_secretary", title, body, href);
  const t = await resolveLink(tx, linkedRef);
  const app = t?.applicationId ? await tx.query.applications.findFirst({ where: eq(schema.applications.id, t.applicationId) }) : null;
  if (app?.assignedOfficer) await notify(tx, `user:${app.assignedOfficer}`, title, body, href);
}

const CaseInput = z.object({
  court: z.string().trim().min(2, "Choose the court."),
  caseNumber: z.string().trim().min(3, "Enter the case number as the court writes it, for example WP 1234/2026."),
  petitioner: z.string().trim().min(3, "Name the petitioner (or appellant, or plaintiff)."),
  respondent: z.string().trim().min(3, "Name the respondent."),
  title: z.string().trim().optional().nullable(),
  nature: z.enum(["WRIT", "APPEAL", "CONTEMPT", "CIVIL_SUIT", "SERVICE"], { message: "Choose the nature of the case." }),
  institutionId: z.number().int().optional().nullable(),
  linkedRef: z.string().trim().optional().nullable(),
  counsel: z.string().trim().min(3, "Name PCP's counsel."),
  counselEmail: z.string().trim().email("Counsel's email does not look right.").optional().nullable().or(z.literal("")),
  filedDate: z.string().regex(YMD, "Pick the date the case was filed."),
  summary: z.string().trim().optional().nullable(),
  hearingDate: z.string().regex(YMD).optional().nullable(),
  bench: z.string().trim().optional().nullable(),
  purpose: z.string().trim().optional().nullable(),
});

export async function createCourtCase(raw: unknown): Promise<ActionResult & { ref?: string }> {
  const user = await requirePermission("pcp.litigation.manage");
  return guard(async () => {
    const parsed = CaseInput.safeParse(raw);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form.");
    const v = parsed.data;
    if (!(await courtList()).includes(v.court)) return fail("Choose the court from the list. The Super Administrator keeps the list under Reference rules.");
    if (v.filedDate > today()) return fail("The filing date is in the future. Enter the date the case was filed.");
    const dup = await db.query.courtCases.findFirst({ where: and(eq(schema.courtCases.court, v.court), eq(schema.courtCases.caseNumber, v.caseNumber)) });
    if (dup) return fail(`${v.caseNumber} before the ${v.court} is already in the ledger as ${dup.ref}.`);
    let institutionId = v.institutionId ?? null;
    const linkedRef = v.linkedRef || null;
    if (linkedRef) {
      const t = await resolveLink(db, linkedRef);
      if (!t || (t.kind !== "case" && t.kind !== "appeal")) return fail(`${linkedRef} is not a PCP case or appeal. Link the NOC, accreditation or appeal reference the case is about.`);
      if (institutionId && t.institutionId !== institutionId) return fail(`${linkedRef} belongs to another institution. Pick the matching institution or another case.`);
      institutionId = t.institutionId;
    }
    if (v.hearingDate && v.hearingDate < v.filedDate) return fail("The first hearing cannot be before the filing date.");
    const title = v.title?.trim() || `${v.petitioner} v. ${v.respondent}`;
    const res = await db.transaction(async (tx) => {
      const ref = await nextGovRef(tx, "court_cases", "LIT", 4, Number(v.filedDate.slice(0, 4)));
      const [c] = await tx
        .insert(schema.courtCases)
        .values({ ref, court: v.court, caseNumber: v.caseNumber, title, petitioner: v.petitioner, respondent: v.respondent, nature: v.nature, institutionId, linkedRef, counsel: v.counsel, counselEmail: v.counselEmail || null, filedDate: v.filedDate, summary: v.summary || null, createdBy: user.username })
        .returning();
      await audit(tx, { actor: user.username, action: "litigation.case.created", entity: "court_case", entityId: ref, details: { court: v.court, caseNumber: v.caseNumber, nature: v.nature, linkedRef } });
      let reminded = 0;
      if (v.hearingDate) {
        const [h] = await tx.insert(schema.courtHearings).values({ courtCaseId: c.id, hearingDate: v.hearingDate, bench: v.bench || null, purpose: v.purpose || null, createdBy: user.username }).returning();
        await audit(tx, { actor: user.username, action: "litigation.hearing.added", entity: "court_case", entityId: ref, details: { date: v.hearingDate, bench: v.bench ?? null } });
        reminded = await hearingReminder(tx, h.id);
      }
      await tellCaseHolders(tx, linkedRef, `Court case on ${linkedRef}: ${courtShort(v.court)} ${v.caseNumber}`, `${title} was entered in the litigation ledger as ${ref}. Orders in it can stop action on ${linkedRef}.`);
      return { ref, reminded };
    });
    refresh(res.ref, linkedRef);
    return { ok: true, level: "success", ref: res.ref, message: `${res.ref} added to the ledger${v.hearingDate ? ` with a hearing on ${shortDay(v.hearingDate)}${res.reminded ? " (reminder sent: it is within 7 days)" : ""}` : ""}.` };
  });
}

const HearingInput = z.object({
  date: z.string().regex(YMD, "Pick the hearing date."),
  bench: z.string().trim().optional().nullable(),
  purpose: z.string().trim().optional().nullable(),
});

export async function addHearing(ref: string, raw: unknown): Promise<ActionResult> {
  const user = await requirePermission("pcp.litigation.manage");
  return guard(async () => {
    const c = await getCase(ref);
    if (!OPEN_COURT_STATUSES.includes(c.status)) return fail(`${c.ref} is ${COURT_STATUS[c.status]?.label.toLowerCase()}. Reopen it before adding hearings.`);
    const parsed = HearingInput.safeParse(raw);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Pick the hearing date.");
    const v = parsed.data;
    if (v.date < c.filedDate) return fail("A hearing cannot be before the filing date.");
    const clash = await db.query.courtHearings.findFirst({ where: and(eq(schema.courtHearings.courtCaseId, c.id), eq(schema.courtHearings.hearingDate, v.date)) });
    if (clash) return fail(`A hearing on ${shortDay(v.date)} is already listed.`);
    const reminded = await db.transaction(async (tx) => {
      const [h] = await tx.insert(schema.courtHearings).values({ courtCaseId: c.id, hearingDate: v.date, bench: v.bench || null, purpose: v.purpose || null, createdBy: user.username }).returning();
      await tx.update(schema.courtCases).set({ updatedAt: new Date() }).where(eq(schema.courtCases.id, c.id));
      await audit(tx, { actor: user.username, action: "litigation.hearing.added", entity: "court_case", entityId: c.ref, details: { date: v.date, bench: v.bench ?? null, purpose: v.purpose ?? null } });
      return hearingReminder(tx, h.id);
    });
    refresh(c.ref);
    return { ok: true, level: "success", message: `Hearing on ${shortDay(v.date)} added. Reminders go to you and to counsel 7 days and 1 day before${reminded ? "; the first one has been sent" : ""}.` };
  });
}

const OutcomeInput = z.object({
  outcome: z.string().trim().min(5, "Say what happened at the hearing (at least a few words)."),
  bench: z.string().trim().optional().nullable(),
  nextDate: z.string().regex(YMD).optional().nullable(),
  nextPurpose: z.string().trim().optional().nullable(),
});

/** What happened at a hearing; a next date lists the next hearing (with its reminders). */
export async function recordHearing(hearingId: number, raw: unknown): Promise<ActionResult> {
  const user = await requirePermission("pcp.litigation.manage");
  return guard(async () => {
    const h = await db.query.courtHearings.findFirst({ where: eq(schema.courtHearings.id, hearingId) });
    if (!h) return fail("Hearing not found.");
    const c = await db.query.courtCases.findFirst({ where: eq(schema.courtCases.id, h.courtCaseId) });
    if (!c) return fail("Court case not found.");
    if (h.status === "HELD") return fail("This hearing is already recorded.");
    if (h.hearingDate > today()) return fail(`The hearing is on ${shortDay(h.hearingDate)}. Record what happened on or after that day.`);
    const parsed = OutcomeInput.safeParse(raw);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Say what happened.");
    const v = parsed.data;
    if (v.nextDate && v.nextDate <= h.hearingDate) return fail("The next date must be after this hearing.");
    await db.transaction(async (tx) => {
      await tx.update(schema.courtHearings).set({ status: "HELD", outcome: v.outcome, bench: v.bench || h.bench, nextDate: v.nextDate || null, recordedBy: user.username, recordedAt: new Date() }).where(eq(schema.courtHearings.id, h.id));
      if (v.nextDate) {
        const exists = await tx.query.courtHearings.findFirst({ where: and(eq(schema.courtHearings.courtCaseId, c.id), eq(schema.courtHearings.hearingDate, v.nextDate)) });
        if (!exists) {
          const [n] = await tx.insert(schema.courtHearings).values({ courtCaseId: c.id, hearingDate: v.nextDate, bench: v.bench || h.bench, purpose: v.nextPurpose || null, createdBy: user.username }).returning();
          await hearingReminder(tx, n.id);
        }
      }
      await tx.update(schema.courtCases).set({ updatedAt: new Date() }).where(eq(schema.courtCases.id, c.id));
      await audit(tx, { actor: user.username, action: "litigation.hearing.recorded", entity: "court_case", entityId: c.ref, details: { date: h.hearingDate, outcome: v.outcome, nextDate: v.nextDate ?? null } });
    });
    refresh(c.ref);
    return { ok: true, level: "success", message: `Hearing of ${shortDay(h.hearingDate)} recorded${v.nextDate ? `; next hearing listed for ${shortDay(v.nextDate)}` : ""}.` };
  });
}

const OrderInput = z.object({
  kind: z.enum(["STAY", "INTERIM", "FINAL", "OTHER"], { message: "Choose the kind of order." }),
  date: z.string().regex(YMD, "Pick the date of the order."),
  summary: z.string().trim().min(10, "Summarise what the court ordered (at least a sentence)."),
  stayUntil: z.string().regex(YMD).optional().nullable(),
  outcome: z.enum(["DISPOSED_FAVOUR", "DISPOSED_AGAINST"]).optional().nullable(),
});

/** Record an order. A stay blocks council decisions on the linked case; a final order disposes of the case and ends any stay. */
export async function recordOrder(ref: string, raw: unknown): Promise<ActionResult & { orderId?: number }> {
  const user = await requirePermission("pcp.litigation.manage");
  return guard(async () => {
    const c = await getCase(ref);
    if (!OPEN_COURT_STATUSES.includes(c.status)) return fail(`${c.ref} is ${COURT_STATUS[c.status]?.label.toLowerCase()}; no further orders can be recorded.`);
    const parsed = OrderInput.safeParse(raw);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the order.");
    const v = parsed.data;
    if (v.date > today()) return fail("The order date is in the future. Enter the date the court passed the order.");
    if (v.date < c.filedDate) return fail("The order cannot be before the filing date.");
    if (v.kind === "STAY" && v.stayUntil && v.stayUntil <= v.date) return fail("The stay must run past the date of the order.");
    if (v.kind === "FINAL" && !v.outcome) return fail("Say whether the case was disposed of in PCP's favour or against it.");
    const active = await db.select().from(schema.courtOrders).where(and(eq(schema.courtOrders.courtCaseId, c.id), eq(schema.courtOrders.kind, "STAY"), isNull(schema.courtOrders.liftedAt)));
    const status = v.kind === "STAY" ? "STAY_GRANTED" : v.kind === "FINAL" ? v.outcome! : v.kind === "INTERIM" && !active.length ? "INTERIM_ORDER" : c.status;
    const orderId = await db.transaction(async (tx) => {
      const now = new Date();
      // A new stay extends the one in force; a final order ends it.
      if (v.kind === "STAY" || v.kind === "FINAL")
        for (const s of active)
          await tx.update(schema.courtOrders).set({ liftedAt: now, liftedBy: user.username, liftNote: v.kind === "STAY" ? `Superseded by the stay order of ${shortDay(v.date)}` : `Ended by the final order of ${shortDay(v.date)}` }).where(eq(schema.courtOrders.id, s.id));
      const [o] = await tx.insert(schema.courtOrders).values({ courtCaseId: c.id, kind: v.kind, orderDate: v.date, summary: v.summary, stayUntil: v.kind === "STAY" ? v.stayUntil || null : null, createdBy: user.username }).returning();
      await tx.update(schema.courtCases).set({ status, updatedAt: now }).where(eq(schema.courtCases.id, c.id));
      await audit(tx, { actor: user.username, action: "litigation.order.recorded", entity: "court_case", entityId: c.ref, details: { kind: v.kind, date: v.date, stayUntil: v.stayUntil ?? null, status, linkedRef: c.linkedRef } });
      if (v.kind === "STAY") {
        const text = stayText({ courtShort: courtShort(c.court), caseNumber: c.caseNumber, until: v.stayUntil ?? null });
        await tellCaseHolders(tx, c.linkedRef, `Stay order on ${c.linkedRef}`, `${text}. Council decisions on ${c.linkedRef} are blocked until the legal officer lifts the stay on ${c.ref}.`);
      } else if (v.kind === "FINAL" && active.length) {
        await tellCaseHolders(tx, c.linkedRef, `Stay ended on ${c.linkedRef}`, `${c.caseNumber} was disposed of on ${shortDay(v.date)}. The stay no longer applies; the case can go ahead.`);
      }
      return o.id;
    });
    refresh(c.ref, c.linkedRef);
    const what = ORDER_LABELS[v.kind];
    return {
      ok: true,
      level: "success",
      orderId,
      message:
        v.kind === "STAY"
          ? `${what} recorded.${c.linkedRef ? ` Council decisions on ${c.linkedRef} are blocked until you lift it; the Secretary and the case officer are told.` : ""}`
          : v.kind === "FINAL"
            ? `${what} recorded: ${COURT_STATUS[status].label.toLowerCase()}.${active.length ? " The stay is ended." : ""}`
            : `${what} recorded.`,
    };
  });
}

/** The court vacated (or did not extend) a stay: decisions on the linked case can go ahead again. */
export async function liftStay(orderId: number, note: string): Promise<ActionResult> {
  const user = await requirePermission("pcp.litigation.manage");
  return guard(async () => {
    const o = await db.query.courtOrders.findFirst({ where: eq(schema.courtOrders.id, orderId) });
    if (!o || o.kind !== "STAY") return fail("Stay order not found.");
    if (o.liftedAt) return fail("This stay is already lifted.");
    const text = (note ?? "").trim();
    if (text.length < 5) return fail("Say why the stay no longer applies, for example: vacated by the order of 12 November 2026.");
    const c = await db.query.courtCases.findFirst({ where: eq(schema.courtCases.id, o.courtCaseId) });
    if (!c) return fail("Court case not found.");
    await db.transaction(async (tx) => {
      await tx.update(schema.courtOrders).set({ liftedAt: new Date(), liftedBy: user.username, liftNote: text }).where(eq(schema.courtOrders.id, o.id));
      const others = await tx.select().from(schema.courtOrders).where(and(eq(schema.courtOrders.courtCaseId, c.id), eq(schema.courtOrders.kind, "STAY"), isNull(schema.courtOrders.liftedAt), ne(schema.courtOrders.id, o.id)));
      if (!others.length && c.status === "STAY_GRANTED") await tx.update(schema.courtCases).set({ status: "PENDING", updatedAt: new Date() }).where(eq(schema.courtCases.id, c.id));
      await audit(tx, { actor: user.username, action: "litigation.stay.lifted", entity: "court_case", entityId: c.ref, details: { order: o.id, note: text, linkedRef: c.linkedRef } });
      await tellCaseHolders(tx, c.linkedRef, `Stay lifted on ${c.linkedRef}`, `The stay in ${c.caseNumber} (${c.ref}) no longer applies: ${text}. The council can decide ${c.linkedRef} again.`);
    });
    refresh(c.ref, c.linkedRef);
    return { ok: true, level: "success", message: `Stay lifted.${c.linkedRef ? ` ${c.linkedRef} can be decided again; the Secretary and the case officer are told.` : ""}` };
  });
}

export async function setCourtStatus(ref: string, status: string, note: string): Promise<ActionResult> {
  const user = await requirePermission("pcp.litigation.manage");
  return guard(async () => {
    const c = await getCase(ref);
    if (!COURT_STATUS[status]) return fail("Choose a status from the list.");
    if (status === c.status) return fail(`${c.ref} is already ${COURT_STATUS[status].label.toLowerCase()}.`);
    if (status === "STAY_GRANTED") return fail("Record the stay order itself (Record an order), so its terms and date are on file.");
    const text = (note ?? "").trim();
    if (text.length < 5) return fail("Say why the status changes (at least a few words).");
    const active = await db.select().from(schema.courtOrders).where(and(eq(schema.courtOrders.courtCaseId, c.id), eq(schema.courtOrders.kind, "STAY"), isNull(schema.courtOrders.liftedAt)));
    const closing = !OPEN_COURT_STATUSES.includes(status);
    if (!closing && active.length) return fail("A stay order is in force. Lift it first, or record the court's next order.");
    await db.transaction(async (tx) => {
      if (closing) for (const s of active) await tx.update(schema.courtOrders).set({ liftedAt: new Date(), liftedBy: user.username, liftNote: `Case ${COURT_STATUS[status].label.toLowerCase()}: ${text}` }).where(eq(schema.courtOrders.id, s.id));
      await tx.update(schema.courtCases).set({ status, updatedAt: new Date() }).where(eq(schema.courtCases.id, c.id));
      await audit(tx, { actor: user.username, action: "litigation.status.changed", entity: "court_case", entityId: c.ref, details: { from: c.status, to: status, note: text } });
      if (closing && active.length) await tellCaseHolders(tx, c.linkedRef, `Stay ended on ${c.linkedRef}`, `${c.caseNumber} is ${COURT_STATUS[status].label.toLowerCase()}. The stay no longer applies.`);
    });
    refresh(c.ref, c.linkedRef);
    return { ok: true, level: "success", message: `${c.ref} is now ${COURT_STATUS[status].label.toLowerCase()}.${closing && active.length ? " The stay is ended." : ""}` };
  });
}

/** For the case and appeal screens: stay orders, court cases, letters and committee items on this reference. */
export async function governanceForRef(ref: string) {
  const user = await requireUser("pcp");
  if (!can(user.roles, "pcp.app.view") && !can(user.roles, "pcp.litigation.view") && !can(user.roles, "pcp.appeals.review")) return null;
  return governanceFor(ref);
}
