"use server";
// Committees beyond the Council (RFP 4.1.1 "committee workflow management, agenda routing, automated task tracking").
// Agenda items from cases, appeals, court cases, letters or other matters; recommendations (not decisions) for
// committees; outcomes for the council's discussion items; action points tracked as tasks with reminders.
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { COUNCIL, fmtDay, lockAgenda } from "@/lib/council";
import { pcpStaff, today } from "@/lib/governance";
import { courtShort } from "@/lib/governance-shared";
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

function refresh(ref: string) {
  revalidatePath("/pcp/council");
  revalidatePath(`/pcp/council/${ref}`);
  revalidatePath("/pcp");
}

async function getMeeting(ref: string) {
  const m = await db.query.councilMeetings.findFirst({ where: eq(schema.councilMeetings.ref, ref) });
  if (!m) throw new Error(`Meeting ${ref} was not found.`);
  return m;
}

const ItemInput = z.object({
  source: z.enum(["case", "appeal", "court", "letter", "other"], { message: "Choose where the item comes from." }),
  ref: z.string().trim().optional().nullable(),
  subject: z.string().trim().optional().nullable(),
  note: z.string().trim().optional().nullable(),
});

/** Add one item to an agenda: a case, appeal, court case, letter or another matter, with a background note. */
export async function addAgendaItem(meetingRef: string, raw: unknown): Promise<ActionResult> {
  const user = await requirePermission("pcp.council.manage");
  return guard(async () => {
    const m = await getMeeting(meetingRef);
    if (m.status === "CLOSED") return fail(`${m.ref} is closed. Add the item to a planned meeting.`);
    const parsed = ItemInput.safeParse(raw);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the item.");
    const v = parsed.data;
    const council = m.committee === COUNCIL;
    if (council && (v.source === "case" || v.source === "appeal"))
      return fail("Cases and appeals reach the council when they are ready for a decision: use Build agenda from ready cases. Add court cases, letters or other matters here.");
    let values: Partial<typeof schema.councilItems.$inferInsert> = {};
    let label = "";
    if (v.source === "other") {
      if (!v.subject || v.subject.length < 5) return fail("Describe the matter in a few words (at least 5 characters).");
      values = { subject: v.subject };
      label = v.subject;
    } else {
      if (!v.ref) return fail("Pick the item from the list.");
      if (v.source === "case") {
        const a = await db.query.applications.findFirst({ where: eq(schema.applications.ref, v.ref) });
        if (!a) return fail(`${v.ref} was not found.`);
        values = { applicationId: a.id };
      } else if (v.source === "appeal") {
        const p = await db.query.appeals.findFirst({ where: eq(schema.appeals.ref, v.ref) });
        if (!p) return fail(`${v.ref} was not found.`);
        values = { appealId: p.id };
      } else if (v.source === "court") {
        const c = await db.query.courtCases.findFirst({ where: eq(schema.courtCases.ref, v.ref) });
        if (!c) return fail(`${v.ref} was not found.`);
        values = { courtCaseId: c.id, subject: `${courtShort(c.court)} ${c.caseNumber}: ${c.title}` };
      } else {
        const l = await db.query.correspondence.findFirst({ where: eq(schema.correspondence.ref, v.ref) });
        if (!l) return fail(`${v.ref} was not found.`);
        values = { letterId: l.id, subject: l.subject };
      }
      label = v.ref;
      const where = values.applicationId
        ? eq(schema.councilItems.applicationId, values.applicationId)
        : values.appealId
          ? eq(schema.councilItems.appealId, values.appealId)
          : values.courtCaseId
            ? eq(schema.councilItems.courtCaseId, values.courtCaseId)
            : eq(schema.councilItems.letterId, values.letterId!);
      const dup = await db.query.councilItems.findFirst({ where: and(eq(schema.councilItems.meetingId, m.id), where) });
      if (dup) return fail(`${v.ref} is already item ${dup.position} on this agenda.`);
    }
    const pos = await db.transaction(async (tx) => {
      await lockAgenda(tx);
      const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${schema.councilItems.position}),0)::int` }).from(schema.councilItems).where(eq(schema.councilItems.meetingId, m.id));
      await tx.insert(schema.councilItems).values({ meetingId: m.id, position: max + 1, recommendation: v.note || null, ...values });
      await audit(tx, { actor: user.username, action: "committee.item.added", entity: "council_meeting", entityId: m.ref, details: { source: v.source, ref: v.ref ?? null, subject: v.subject ?? null } });
      return max + 1;
    });
    refresh(m.ref);
    return { ok: true, level: "success", message: `Added to ${m.ref} as item ${pos}: ${label}.` };
  });
}

/** The committee's recommendation on an item, or the council's recorded outcome on a discussion item. Not a decision. */
export async function recordItemResolution(itemId: number, text: string): Promise<ActionResult> {
  const user = await requirePermission("pcp.council.manage");
  return guard(async () => {
    const item = await db.query.councilItems.findFirst({ where: eq(schema.councilItems.id, itemId) });
    if (!item) return fail("Agenda item not found.");
    const m = await db.query.councilMeetings.findFirst({ where: eq(schema.councilMeetings.id, item.meetingId) });
    if (!m) return fail("Meeting not found.");
    const council = m.committee === COUNCIL;
    if (council && (item.applicationId || item.appealId)) return fail("The council decides cases and appeals with Record decision and a one-time code.");
    if (m.status !== "IN_SESSION") return fail(m.status === "PLANNED" ? "Start the session first." : `${m.ref} is closed; its minutes are filed.`);
    const t = (text ?? "").trim();
    if (t.length < 5) return fail(council ? "Record what the council resolved (at least a few words)." : "Write the committee's recommendation (at least a few words).");
    const app = item.applicationId ? await db.query.applications.findFirst({ where: eq(schema.applications.id, item.applicationId) }) : null;
    const appeal = item.appealId ? await db.query.appeals.findFirst({ where: eq(schema.appeals.id, item.appealId) }) : null;
    await db.transaction(async (tx) => {
      await tx.update(schema.councilItems).set({ resolution: t, resolvedBy: user.username, resolvedAt: new Date() }).where(eq(schema.councilItems.id, item.id));
      await audit(tx, { actor: user.username, action: "committee.item.resolved", entity: "council_meeting", entityId: m.ref, details: { itemId: item.id, committee: m.committee, case: app?.ref ?? appeal?.ref ?? null, resolution: t } });
      // A recommendation on a case reaches its officer, who carries it to the Council.
      if (app?.assignedOfficer) await notify(tx, `user:${app.assignedOfficer}`, `${m.committee} recommendation on ${app.ref}`, t, `/pcp/applications/${app.ref}`);
    });
    refresh(m.ref);
    return { ok: true, level: "success", message: council ? "Outcome recorded." : `Recommendation recorded${app ? ` on ${app.ref}; the case officer is told` : ""}.` };
  });
}

const ActionInput = z.object({
  title: z.string().trim().min(5, "Describe the action point (at least 5 characters)."),
  owner: z.string().trim().min(1, "Choose who owns the action point."),
  dueDate: z.string().regex(YMD, "Pick the due date."),
  itemId: z.number().int().optional().nullable(),
});

/** An action point recorded in the meeting becomes a tracked task: on the owner's work list, with reminders. */
export async function addActionPoint(meetingRef: string, raw: unknown): Promise<ActionResult> {
  const user = await requirePermission("pcp.council.manage");
  return guard(async () => {
    const m = await getMeeting(meetingRef);
    if (m.status !== "IN_SESSION") return fail(m.status === "PLANNED" ? "Action points are recorded during the meeting. Start the session first." : `${m.ref} is closed; its minutes are filed.`);
    const parsed = ActionInput.safeParse(raw);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the action point.");
    const v = parsed.data;
    if (v.dueDate < today()) return fail("The due date is in the past. Pick today or a later date.");
    const owner = (await pcpStaff()).find((s) => s.username === v.owner);
    if (!owner) return fail("Choose an active PCP officer as the owner.");
    if (v.itemId) {
      const it = await db.query.councilItems.findFirst({ where: and(eq(schema.councilItems.id, v.itemId), eq(schema.councilItems.meetingId, m.id)) });
      if (!it) return fail("That agenda item is not on this meeting.");
    }
    await db.transaction(async (tx) => {
      const [a] = await tx.insert(schema.committeeActions).values({ meetingId: m.id, itemId: v.itemId ?? null, title: v.title, owner: owner.username, dueDate: v.dueDate, createdBy: user.username }).returning();
      await audit(tx, { actor: user.username, action: "committee.action.created", entity: "council_meeting", entityId: m.ref, details: { action: a.id, title: v.title, owner: owner.username, due: v.dueDate } });
      await notify(tx, `user:${owner.username}`, `Action point for you from ${m.ref}`, `${v.title}. Due by ${fmtDay(v.dueDate)}. It is on your work list.`, `/pcp/council/${m.ref}#actions`);
    });
    refresh(m.ref);
    return { ok: true, level: "success", message: `Action point assigned to ${owner.name}, due ${fmtDay(v.dueDate)}. It is on their work list and they are notified.` };
  });
}

/** The owner (or the Secretary) moves an action point along; done needs a note of what was done. */
export async function updateActionPoint(id: number, raw: { status: string; note?: string | null }): Promise<ActionResult> {
  const user = await requireUser("pcp");
  return guard(async () => {
    const a = await db.query.committeeActions.findFirst({ where: eq(schema.committeeActions.id, id) });
    if (!a) return fail("Action point not found.");
    if (a.owner !== user.username && !can(user.roles, "pcp.council.manage")) return fail("Only the owner of the action point or the Secretary can update it.");
    if (!["OPEN", "IN_PROGRESS", "DONE"].includes(raw.status)) return fail("Choose open, in progress or done.");
    if (raw.status === a.status) return fail("Nothing changed.");
    const note = (raw.note ?? "").trim();
    if (raw.status === "DONE" && note.length < 5) return fail("Say what was done (at least a few words). It goes on the meeting record.");
    const m = await db.query.councilMeetings.findFirst({ where: eq(schema.councilMeetings.id, a.meetingId) });
    if (!m) return fail("Meeting not found.");
    await db.transaction(async (tx) => {
      await tx
        .update(schema.committeeActions)
        .set({ status: raw.status, note: note || a.note, doneAt: raw.status === "DONE" ? new Date() : null, updatedAt: new Date() })
        .where(eq(schema.committeeActions.id, a.id));
      await audit(tx, { actor: user.username, action: "committee.action.updated", entity: "council_meeting", entityId: m.ref, details: { action: a.id, from: a.status, to: raw.status, note: note || null } });
      if (raw.status === "DONE" && m.createdBy !== user.username) await notify(tx, `user:${m.createdBy}`, `Action point done (${m.ref})`, `${a.title}: ${note}`, `/pcp/council/${m.ref}#actions`);
    });
    refresh(m.ref);
    return { ok: true, level: "success", message: raw.status === "DONE" ? "Action point done. It leaves the work list." : `Action point marked ${raw.status === "IN_PROGRESS" ? "in progress" : "open"}.` };
  });
}
