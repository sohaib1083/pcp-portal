"use server";
// Council meetings (guide sections 4 and 14): agenda built from ready cases, a decision per item, minutes.
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { COUNCIL, DECISION_LABELS, draftFromRecommendation, fileAppealLetter, fileMinutes, fmtDay, lockAgenda, nextModuleRef, notifyOn, readyForCouncil, recommendationFor, renumberAgenda, reopenCaseForCouncil } from "@/lib/council";
import { assertNoStayOrder, committeeList } from "@/lib/governance";
import { assertQuorum, defaultAttendance, recordRecusals } from "@/lib/members";
import { requireOtp } from "@/lib/otp";
import { can } from "@/lib/roles";
import { requirePermission, requireUser } from "@/lib/session";
import { notify } from "@/lib/util";
import { recordDecision } from "./pcp";
import type { ActionResult } from "./faculty";

const fail = (message: string): ActionResult => ({ ok: false, message, level: "error" });

async function guard(fn: () => Promise<ActionResult & { ref?: string }>) {
  try {
    return await fn();
  } catch (e) {
    unstable_rethrow(e);
    return fail(e instanceof Error ? e.message : String(e));
  }
}

async function getMeeting(ref: string) {
  const m = await db.query.councilMeetings.findFirst({ where: eq(schema.councilMeetings.ref, ref) });
  if (!m) throw new Error(`Council meeting ${ref} was not found.`);
  return m;
}

function refresh(ref?: string) {
  revalidatePath("/pcp/council");
  if (ref) revalidatePath(`/pcp/council/${ref}`);
  revalidatePath("/pcp/appeals");
}

const MeetingInput = z.object({
  title: z.string().trim().min(3, "Give the meeting a title of at least 3 characters."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the meeting date."),
  committee: z.string().trim().optional(), // Council when left out
});

export async function createMeeting(raw: unknown): Promise<ActionResult & { ref?: string }> {
  const user = await requirePermission("pcp.council.manage");
  return guard(async () => {
    const parsed = MeetingInput.safeParse(raw);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the title and date.");
    const v = parsed.data;
    if (v.date < new Date().toISOString().slice(0, 10)) return fail("The meeting date is in the past. Pick today or a later date.");
    const committees = await committeeList();
    const c = committees.find((x) => x.name === (v.committee || COUNCIL));
    if (!c) return fail(`${v.committee} is not in the committees list. Pick one of: ${committees.map((x) => x.name).join(", ")}.`);
    const ref = await db.transaction(async (tx) => {
      const r = await nextModuleRef(tx, "council_meetings", c.prefix, 2, Number(v.date.slice(0, 4)));
      await tx.insert(schema.councilMeetings).values({ ref: r, committee: c.name, title: v.title, meetingDate: v.date, createdBy: user.username });
      await audit(tx, { actor: user.username, action: "council.meeting.created", entity: "council_meeting", entityId: r, details: { title: v.title, date: v.date, committee: c.name } });
      // Committee members hear about the meeting in their work list and by email.
      if (c.name !== COUNCIL) for (const m of c.members.filter((u) => u !== user.username)) await notify(tx, `user:${m}`, `${c.name} meets on ${fmtDay(v.date)}`, `${v.title} (${r}). The agenda is on the meeting page.`, `/pcp/council/${r}`);
      return r;
    });
    refresh(ref);
    return {
      ok: true,
      message: c.name === COUNCIL ? `Meeting ${ref} created for ${fmtDay(v.date)}. Next: build its agenda from the ready cases.` : `${c.name} meeting ${ref} created for ${fmtDay(v.date)}. Its members are notified. Next: add its agenda items.`,
      level: "success",
      ref,
    };
  });
}

/** Adds every case awaiting a council decision and every appeal ready for council that is not on an open agenda yet. */
export async function buildAgenda(meetingRef: string): Promise<ActionResult> {
  const user = await requirePermission("pcp.council.manage");
  return guard(async () => {
    const m = await getMeeting(meetingRef);
    if (m.status === "CLOSED") return fail(`${m.ref} is closed. Build the agenda of a planned meeting instead.`);
    if (m.committee !== COUNCIL) return fail(`${m.ref} is a ${m.committee} meeting. Only the Council takes the cases awaiting a decision; add committee items with Add agenda item.`);
    const added = await db.transaction(async (tx) => {
      await lockAgenda(tx);
      const { cases, appeals } = await readyForCouncil(tx);
      const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${schema.councilItems.position}),0)::int` }).from(schema.councilItems).where(eq(schema.councilItems.meetingId, m.id));
      let pos = max;
      const refs: string[] = [];
      for (const a of cases) {
        const rec = await recommendationFor(tx, a.id);
        await tx.insert(schema.councilItems).values({ meetingId: m.id, applicationId: a.id, position: ++pos, recommendation: rec, draftDecision: draftFromRecommendation(rec) });
        const inst = await tx.query.institutions.findFirst({ where: eq(schema.institutions.id, a.institutionId) });
        if (inst) await notify(tx, `inst:${inst.code}`, `${a.ref} is on the council agenda`, `The council will consider ${a.ref} at its meeting ${m.ref} on ${fmtDay(m.meetingDate)}.`, `/institution/applications/${a.ref}`);
        refs.push(a.ref);
      }
      for (const p of appeals) {
        await tx.insert(schema.councilItems).values({ meetingId: m.id, appealId: p.id, position: ++pos, recommendation: p.reviewNote });
        const inst = await tx.query.institutions.findFirst({ where: eq(schema.institutions.id, p.institutionId) });
        if (inst) await notifyOn(tx, `inst:${inst.code}`, `Appeal ${p.ref} is on the council agenda`, `The council will hear your appeal at its meeting ${m.ref} on ${fmtDay(m.meetingDate)}.`, `/institution/appeals/${p.ref}`, "appeal", p.ref);
        refs.push(p.ref);
      }
      if (refs.length) await audit(tx, { actor: user.username, action: "council.agenda.built", entity: "council_meeting", entityId: m.ref, details: { added: refs } });
      return refs;
    });
    refresh(m.ref);
    if (!added.length) return { ok: true, message: "Nothing new to add: every case and appeal ready for council is already on an agenda.", level: "warning" };
    return { ok: true, message: `Added ${added.length} item${added.length === 1 ? "" : "s"} to ${m.ref}: ${added.join(", ")}. Each institution was told.`, level: "success" };
  });
}

export async function setDraftDecision(itemId: number, draft: string | null): Promise<ActionResult> {
  const user = await requirePermission("pcp.council.manage");
  return guard(async () => {
    const item = await db.query.councilItems.findFirst({ where: eq(schema.councilItems.id, itemId) });
    if (!item) return fail("Agenda item not found.");
    const m = await db.query.councilMeetings.findFirst({ where: eq(schema.councilMeetings.id, item.meetingId) });
    if (!m || m.status === "CLOSED") return fail("The meeting is closed; its drafts can no longer change.");
    if (item.decision) return fail("This item is already decided.");
    const allowed = item.appealId ? ["UPHELD", "DISMISSED"] : ["APPROVED", "DEFERRED", "REJECTED"];
    if (draft && !allowed.includes(draft)) return fail("Choose one of the listed draft decisions.");
    await db.update(schema.councilItems).set({ draftDecision: draft }).where(eq(schema.councilItems.id, itemId));
    await audit(db, { actor: user.username, action: "council.item.draft", entity: "council_meeting", entityId: m.ref, details: { itemId, draft } });
    refresh(m.ref);
    return { ok: true, message: draft ? `Draft decision set: ${DECISION_LABELS[draft].toLowerCase()}.` : "Draft decision cleared.", level: "success" };
  });
}

export async function removeAgendaItem(itemId: number): Promise<ActionResult> {
  const user = await requirePermission("pcp.council.manage");
  return guard(async () => {
    const item = await db.query.councilItems.findFirst({ where: eq(schema.councilItems.id, itemId) });
    if (!item) return fail("Agenda item not found.");
    const m = await db.query.councilMeetings.findFirst({ where: eq(schema.councilMeetings.id, item.meetingId) });
    if (!m || m.status !== "PLANNED") return fail("Items can be removed only before the session starts.");
    await db.transaction(async (tx) => {
      await lockAgenda(tx);
      await tx.delete(schema.councilItems).where(eq(schema.councilItems.id, itemId));
      await renumberAgenda(tx, m.id);
      await audit(tx, { actor: user.username, action: "council.item.removed", entity: "council_meeting", entityId: m.ref, details: { applicationId: item.applicationId, appealId: item.appealId } });
    });
    refresh(m.ref);
    return { ok: true, message: "Removed from the agenda. It stays ready for the next meeting.", level: "success" };
  });
}

export async function startSession(meetingRef: string): Promise<ActionResult> {
  const user = await requirePermission("pcp.council.manage");
  return guard(async () => {
    const m = await getMeeting(meetingRef);
    if (m.status !== "PLANNED") return fail(`${m.ref} is not a planned meeting.`);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.councilItems).where(eq(schema.councilItems.meetingId, m.id));
    if (!n) return fail(m.committee === COUNCIL ? "The agenda is empty. Build the agenda from the ready cases first." : "The agenda is empty. Add agenda items first.");
    // Attendance from the members register: anyone not marked yet is recorded as present (the Secretary marks absentees).
    const roll = await db.transaction(async (tx) => {
      await tx.update(schema.councilMeetings).set({ status: "IN_SESSION", startedAt: new Date() }).where(eq(schema.councilMeetings.id, m.id));
      const r = await defaultAttendance(tx, m.id, user.username);
      await audit(tx, { actor: user.username, action: "council.session.started", entity: "council_meeting", entityId: m.ref, details: { items: n, ...(r.applicable ? { present: r.presentVoting, voting: r.voting, quorum: r.needed, markedPresentByDefault: r.defaulted } : {}) } });
      return r;
    });
    refresh(m.ref);
    const att = roll.applicable ? ` ${roll.presentVoting} of ${roll.voting} voting members present; quorum ${roll.needed} ${roll.presentVoting >= roll.needed ? "met" : "not met"}.` : "";
    return { ok: true, message: `${m.ref} is in session.${att} ${m.committee === COUNCIL ? "Record a decision for each item." : "Record a recommendation for each item, and the action points agreed."}`, level: roll.applicable && roll.presentVoting < roll.needed ? "warning" : "success" };
  });
}

const DecisionInput = z.object({
  decision: z.enum(["APPROVED", "DEFERRED", "REJECTED", "UPHELD", "DISMISSED"]),
  note: z.string().trim().default(""),
  deferUntil: z.string().optional().nullable(),
  grounds: z.string().trim().optional().nullable(),
  otp: z.string().optional().nullable(),
});

/**
 * Record the council's decision on one agenda item.
 * Cases go through recordDecision (the case workflow owns the decision, its letter and its one-time code check);
 * appeals are decided here: upheld reopens the original case, dismissed leaves the decision standing.
 */
export async function recordItemDecision(itemId: number, raw: unknown): Promise<ActionResult> {
  const user = await requirePermission("pcp.council.decide");
  return guard(async () => {
    const parsed = DecisionInput.safeParse(raw);
    if (!parsed.success) return fail("Choose a decision.");
    const v = parsed.data;
    const item = await db.query.councilItems.findFirst({ where: eq(schema.councilItems.id, itemId) });
    if (!item) return fail("Agenda item not found.");
    const m = await db.query.councilMeetings.findFirst({ where: eq(schema.councilMeetings.id, item.meetingId) });
    if (!m) return fail("Meeting not found.");
    if (m.committee !== COUNCIL) return fail(`The ${m.committee} records recommendations, not decisions. The Council decides.`);
    if (!item.applicationId && !item.appealId) return fail("This item is a matter for discussion: record its outcome instead of a decision.");
    if (m.status !== "IN_SESSION") return fail(m.status === "PLANNED" ? "Start the session before recording decisions." : `${m.ref} is closed; its decisions are final.`);
    if (item.decision) return fail("This item already has a recorded decision.");
    // A quorum of voting members, counted after any member with a declared conflict on the item steps out.
    await assertQuorum(db, m.id, item.id);

    if (item.applicationId) {
      if (!["APPROVED", "DEFERRED", "REJECTED"].includes(v.decision)) return fail("A case is approved, deferred or rejected.");
      const app = await db.query.applications.findFirst({ where: eq(schema.applications.id, item.applicationId) });
      if (!app) return fail("Case not found.");
      if (app.status !== "COUNCIL_REVIEW") return fail(`${app.ref} is no longer awaiting a council decision (it was decided on the case file).`);
      let note = v.note;
      let grounds: string | undefined;
      let deferUntil: string | undefined;
      if (v.decision === "DEFERRED") {
        if (note.length < 5) return fail("A deferral needs a reason. Say what must happen before the case returns.");
        if (!v.deferUntil || !/^\d{4}-\d{2}-\d{2}$/.test(v.deferUntil)) return fail("A deferral needs a date to return. Pick one.");
        if (v.deferUntil <= new Date().toISOString().slice(0, 10)) return fail("The return date must be after today.");
        deferUntil = v.deferUntil;
      }
      if (v.decision === "REJECTED") {
        grounds = (v.grounds || note).trim();
        if (grounds.length < 5) return fail("A rejection must state its grounds.");
        if (!note) note = grounds;
      }
      const r = await recordDecision(app.ref, v.decision as "APPROVED" | "DEFERRED" | "REJECTED", note, { deferUntil, grounds, otp: v.otp ?? undefined });
      if (!r.ok) return r;
      const fresh = await db.query.applications.findFirst({ where: eq(schema.applications.id, app.id) });
      if (fresh?.status === "COUNCIL_REVIEW") return fail(`The decision on ${app.ref} was not recorded. Try again.`);
      await db.transaction(async (tx) => {
        await tx
          .update(schema.councilItems)
          .set({ decision: v.decision, decisionNote: grounds && v.decision === "REJECTED" ? grounds : note || null, deferUntil: deferUntil ?? null, decidedBy: user.username, decidedAt: new Date() })
          .where(eq(schema.councilItems.id, item.id));
        const recused = await recordRecusals(tx, m.id, item.id);
        await audit(tx, { actor: user.username, action: "council.item.decided", entity: "council_meeting", entityId: m.ref, details: { case: app.ref, decision: v.decision, deferUntil: deferUntil ?? null, ...(recused.length ? { recused: recused.map((r) => r.reason) } : {}) } });
      });
      refresh(m.ref);
      return { ok: true, message: `${app.ref}: ${DECISION_LABELS[v.decision].toLowerCase()}. The institution is notified.`, level: "success" };
    }

    // Appeal
    if (!["UPHELD", "DISMISSED"].includes(v.decision)) return fail("An appeal is upheld or dismissed.");
    const appeal = await db.query.appeals.findFirst({ where: eq(schema.appeals.id, item.appealId ?? -1) });
    if (!appeal) return fail("Appeal not found.");
    if (["UPHELD", "DISMISSED", "WITHDRAWN"].includes(appeal.status)) return fail(`${appeal.ref} is already closed.`);
    const note = v.note || (v.decision === "UPHELD" ? "The council found the grounds of appeal valid and will decide the case afresh." : "");
    if (v.decision === "DISMISSED" && note.length < 5) return fail("Dismissing an appeal needs the council's reasons.");
    const original = await db.query.applications.findFirst({ where: eq(schema.applications.id, appeal.applicationId) });
    const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, appeal.institutionId) });
    if (!original || !inst) return fail("The case under appeal was not found.");
    if (v.decision === "UPHELD" && !["REJECTED", "DEFERRED"].includes(original.status))
      return fail(`${original.ref} is ${original.status.toLowerCase().replace(/_/g, " ")} now, so it cannot be reopened. Dismiss the appeal or ask the officer to check the case.`);
    await assertNoStayOrder(appeal.ref); // a court's stay order on the appeal or its case blocks the decision until lifted
    // Checked last, so a refused decision does not use up the code.
    await requireOtp(user.username, `decision:${appeal.ref}`, v.otp);
    await db.transaction(async (tx) => {
      const now = new Date();
      await tx.update(schema.appeals).set({ status: v.decision, decidedBy: user.username, decisionNote: note, decidedAt: now }).where(eq(schema.appeals.id, appeal.id));
      await tx.update(schema.councilItems).set({ decision: v.decision, decisionNote: note, decidedBy: user.username, decidedAt: now }).where(eq(schema.councilItems.id, item.id));
      if (v.decision === "UPHELD") {
        await reopenCaseForCouncil(tx, { applicationId: original.id, appealRef: appeal.ref, meetingRef: m.ref, actor: user.username, actorRole: user.role });
        await audit(tx, { actor: user.username, action: "application.reopened", entity: "application", entityId: original.ref, details: { appeal: appeal.ref, from: original.status, to: "COUNCIL_REVIEW" } });
      }
      const letter = await fileAppealLetter(tx, { appeal, caseRef: original.ref, outcome: v.decision as "UPHELD" | "DISMISSED", note, meetingRef: m.ref, by: { username: user.username, name: user.name } });
      await tx.update(schema.appeals).set({ letterDocumentId: letter.id }).where(eq(schema.appeals.id, appeal.id));
      await notifyOn(
        tx,
        `inst:${inst.code}`,
        `Appeal ${appeal.ref} ${v.decision === "UPHELD" ? "upheld" : "dismissed"}`,
        v.decision === "UPHELD" ? `The council upheld your appeal. ${original.ref} returns to the council for a fresh decision. The decision letter is on the appeal.` : `The council dismissed your appeal. The decision on ${original.ref} stands. The decision letter is on the appeal.`,
        `/institution/appeals/${appeal.ref}`,
        "appeal",
        appeal.ref,
      );
      await notifyOn(tx, "role:pcp_officer", `Appeal ${appeal.ref} ${v.decision === "UPHELD" ? "upheld" : "dismissed"}`, v.decision === "UPHELD" ? `${original.ref} is back in council review.` : `The decision on ${original.ref} stands.`, `/pcp/appeals/${appeal.ref}`, "appeal", appeal.ref);
      await audit(tx, { actor: user.username, action: v.decision === "UPHELD" ? "appeal.upheld" : "appeal.dismissed", entity: "appeal", entityId: appeal.ref, details: { meeting: m.ref, case: original.ref, letter: letter.id, note } });
      const recused = await recordRecusals(tx, m.id, item.id);
      await audit(tx, { actor: user.username, action: "council.item.decided", entity: "council_meeting", entityId: m.ref, details: { appeal: appeal.ref, decision: v.decision, ...(recused.length ? { recused: recused.map((r) => r.reason) } : {}) } });
    });
    refresh(m.ref);
    revalidatePath(`/pcp/appeals/${appeal.ref}`);
    revalidatePath(`/pcp/applications/${original.ref}`);
    return {
      ok: true,
      message: v.decision === "UPHELD" ? `${appeal.ref} upheld: ${original.ref} is back in council review and the decision letter is filed.` : `${appeal.ref} dismissed: the decision on ${original.ref} stands. The decision letter is filed.`,
      level: "success",
    };
  });
}

/** Close the meeting and file its minutes. Undecided items are carried forward to the next agenda. */
export async function closeMeeting(meetingRef: string): Promise<ActionResult> {
  const user = await requirePermission("pcp.council.manage");
  return guard(async () => {
    const m = await getMeeting(meetingRef);
    if (m.status !== "IN_SESSION") return fail(m.status === "PLANNED" ? "Start the session first." : `${m.ref} is already closed.`);
    const items = await db.select().from(schema.councilItems).where(eq(schema.councilItems.meetingId, m.id));
    const open = items.filter((i) => !i.decision && !i.resolution).length;
    const doc = await db.transaction(async (tx) => {
      // Recusals are written on every item before the meeting closes, so the minutes and the record keep them.
      await recordRecusals(tx, m.id);
      await tx.update(schema.councilMeetings).set({ status: "CLOSED", closedAt: new Date() }).where(eq(schema.councilMeetings.id, m.id));
      const d = await fileMinutes(tx, m.id, { username: user.username, name: user.name });
      await tx.update(schema.councilMeetings).set({ minutesDocumentId: d.id }).where(eq(schema.councilMeetings.id, m.id));
      await audit(tx, { actor: user.username, action: "council.meeting.closed", entity: "council_meeting", entityId: m.ref, details: { items: items.length, carriedForward: open, minutes: d.id, sha256: d.sha256 } });
      const done = items.length - open;
      await notify(tx, "role:pcp_officer", `Minutes of ${m.ref} filed`, `${done} ${m.committee === COUNCIL ? "decision" : "recommendation"}${done === 1 ? "" : "s"} recorded${open ? `; ${open} item${open === 1 ? "" : "s"} carried forward` : ""}.`, `/pcp/council/${m.ref}`);
      return d;
    });
    refresh(m.ref);
    return { ok: true, message: `${m.ref} closed. Minutes filed (${doc.fileName})${open ? `; ${open} undecided item${open === 1 ? " is" : "s are"} carried forward` : ""}.`, level: "success" };
  });
}

/** For the case screen: is this case on a council agenda, or when was it last decided at a meeting? */
export async function agendaForCase(caseRef: string) {
  const user = await requireUser("pcp");
  if (!can(user.roles, "pcp.app.view") && !can(user.roles, "pcp.council.manage")) return null;
  const app = await db.query.applications.findFirst({ where: eq(schema.applications.ref, caseRef) });
  if (!app) return null;
  const rows = await db
    .select({ ref: schema.councilMeetings.ref, date: schema.councilMeetings.meetingDate, status: schema.councilMeetings.status, position: schema.councilItems.position, decision: schema.councilItems.decision, decidedAt: schema.councilItems.decidedAt })
    .from(schema.councilItems)
    .innerJoin(schema.councilMeetings, eq(schema.councilMeetings.id, schema.councilItems.meetingId))
    .where(and(eq(schema.councilItems.applicationId, app.id), eq(schema.councilMeetings.committee, COUNCIL)))
    .orderBy(desc(schema.councilItems.id));
  const open = rows.find((r) => r.status !== "CLOSED" && !r.decision);
  if (open) return { kind: "scheduled" as const, meetingRef: open.ref, date: open.date, status: open.status, position: open.position };
  const decided = rows.find((r) => r.decision);
  if (decided) return { kind: "decided" as const, meetingRef: decided.ref, date: decided.date, status: decided.status, decision: decided.decision! };
  return null;
}
