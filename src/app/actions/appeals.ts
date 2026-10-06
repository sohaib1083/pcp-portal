"use server";
// Appeal and grievance case type (guide section 14): linked to the original decision and its evidence.
// Filing (with the evidence upload) is POST /api/appeals; the council decides in recordItemDecision (actions/council.ts).
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { fmtDay, nextPlannedMeeting, notifyOn, scheduledItems } from "@/lib/council";
import { requireInstitution, requirePermission } from "@/lib/session";
import type { ActionResult } from "./faculty";

const fail = (message: string): ActionResult => ({ ok: false, message, level: "error" });

async function getAppeal(ref: string) {
  const a = await db.query.appeals.findFirst({ where: eq(schema.appeals.ref, ref) });
  if (!a) throw new Error(`Appeal ${ref} was not found.`);
  const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, a.institutionId) });
  const app = await db.query.applications.findFirst({ where: eq(schema.applications.id, a.applicationId) });
  if (!inst || !app) throw new Error("The appeal's institution or case is missing.");
  return { a, inst, app };
}

function refresh(ref: string) {
  revalidatePath("/pcp/appeals");
  revalidatePath(`/pcp/appeals/${ref}`);
  revalidatePath("/pcp/council");
  revalidatePath("/institution/appeals");
}

async function run(fn: () => Promise<ActionResult>) {
  try {
    return await fn();
  } catch (e) {
    unstable_rethrow(e);
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/** The officer reads the appeal against the case file and records a review note for the council. */
export async function reviewAppeal(ref: string, note: string): Promise<ActionResult> {
  const user = await requirePermission("pcp.appeals.review");
  return run(async () => {
    const { a, inst } = await getAppeal(ref);
    if (!["FILED", "UNDER_REVIEW"].includes(a.status)) return fail(`${a.ref} is ${a.status.toLowerCase().replace(/_/g, " ")}; the review note can no longer change.`);
    const text = note.trim();
    if (text.length < 10) return fail("Write a review note of at least 10 characters: what the evidence shows and what you recommend.");
    await db.transaction(async (tx) => {
      await tx.update(schema.appeals).set({ status: "UNDER_REVIEW", reviewNote: text, reviewedBy: user.username, reviewedAt: new Date() }).where(eq(schema.appeals.id, a.id));
      if (a.status === "FILED")
        await notifyOn(tx, `inst:${inst.code}`, `Appeal ${a.ref} under review`, "A PCP officer is reviewing your appeal and its evidence against the case file.", `/institution/appeals/${a.ref}`, "appeal", a.ref);
      await audit(tx, { actor: user.username, action: "appeal.reviewed", entity: "appeal", entityId: a.ref, details: { note: text } });
    });
    refresh(a.ref);
    return { ok: true, message: "Review note saved. Next: place the appeal on the council agenda.", level: "success" };
  });
}

/** Ready for council: added to the next planned meeting's agenda, or picked up when the Secretary builds the next one. */
export async function placeAppealOnAgenda(ref: string): Promise<ActionResult> {
  const user = await requirePermission("pcp.appeals.review");
  return run(async () => {
    const { a, inst } = await getAppeal(ref);
    if (!["FILED", "UNDER_REVIEW"].includes(a.status)) return fail(`${a.ref} is already ${a.status === "ON_AGENDA" ? "on the agenda" : a.status.toLowerCase()}.`);
    if (!a.reviewNote) return fail("Save a review note first. The council reads it with the appeal.");
    const meeting = await db.transaction(async (tx) => {
      const m = await nextPlannedMeeting(tx);
      await tx.update(schema.appeals).set({ status: "ON_AGENDA" }).where(eq(schema.appeals.id, a.id));
      const already = (await scheduledItems(tx)).some((s) => s.appealId === a.id);
      if (m && !already) {
        const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${schema.councilItems.position}),0)::int` }).from(schema.councilItems).where(eq(schema.councilItems.meetingId, m.id));
        await tx.insert(schema.councilItems).values({ meetingId: m.id, appealId: a.id, position: max + 1, recommendation: a.reviewNote });
        await notifyOn(tx, `inst:${inst.code}`, `Appeal ${a.ref} is on the council agenda`, `The council will hear your appeal at its meeting ${m.ref} on ${fmtDay(m.meetingDate)}.`, `/institution/appeals/${a.ref}`, "appeal", a.ref);
      } else {
        await notifyOn(tx, `inst:${inst.code}`, `Appeal ${a.ref} sent to the council`, "Your appeal is ready for the council. You will be told the meeting date when it is placed on an agenda.", `/institution/appeals/${a.ref}`, "appeal", a.ref);
      }
      await notifyOn(tx, "role:pcp_secretary", `Appeal ${a.ref} ready for council`, m ? `Placed on the agenda of ${m.ref} (${fmtDay(m.meetingDate)}).` : "No meeting is planned yet; it is added when you build the next agenda.", `/pcp/appeals/${a.ref}`, "appeal", a.ref);
      await audit(tx, { actor: user.username, action: "appeal.placed_on_agenda", entity: "appeal", entityId: a.ref, details: { meeting: m?.ref ?? null } });
      return m;
    });
    refresh(a.ref);
    if (meeting) revalidatePath(`/pcp/council/${meeting.ref}`);
    return {
      ok: true,
      message: meeting ? `${a.ref} is on the agenda of ${meeting.ref} (${fmtDay(meeting.meetingDate)}). The institution and the Secretary are notified.` : `${a.ref} is ready for council. No meeting is planned yet, so the Secretary adds it when building the next agenda.`,
      level: "success",
    };
  });
}

/** The institution may withdraw its appeal until the council has started hearing it. */
export async function withdrawAppeal(ref: string): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.appeal.file");
  return run(async () => {
    const a = await db.query.appeals.findFirst({ where: and(eq(schema.appeals.ref, ref), eq(schema.appeals.institutionId, inst.id)) });
    if (!a) return fail("Appeal not found for your institution.");
    if (!["FILED", "UNDER_REVIEW", "ON_AGENDA"].includes(a.status)) return fail(`${a.ref} is ${a.status.toLowerCase()} and cannot be withdrawn.`);
    const items = await db
      .select({ id: schema.councilItems.id, status: schema.councilMeetings.status })
      .from(schema.councilItems)
      .innerJoin(schema.councilMeetings, eq(schema.councilMeetings.id, schema.councilItems.meetingId))
      .where(eq(schema.councilItems.appealId, a.id));
    if (items.some((i) => i.status === "IN_SESSION")) return fail("The council is hearing this appeal now; it can no longer be withdrawn.");
    await db.transaction(async (tx) => {
      for (const i of items.filter((x) => x.status === "PLANNED")) await tx.delete(schema.councilItems).where(eq(schema.councilItems.id, i.id));
      await tx.update(schema.appeals).set({ status: "WITHDRAWN" }).where(eq(schema.appeals.id, a.id));
      await notifyOn(tx, "role:pcp_officer", `Appeal ${a.ref} withdrawn`, `${inst.shortCode} withdrew its appeal.`, `/pcp/appeals/${a.ref}`, "appeal", a.ref);
      await audit(tx, { actor: user.username, action: "appeal.withdrawn", entity: "appeal", entityId: a.ref });
    });
    refresh(a.ref);
    revalidatePath(`/institution/appeals/${a.ref}`);
    return { ok: true, message: `${a.ref} withdrawn. The original decision stands.`, level: "success" };
  });
}
