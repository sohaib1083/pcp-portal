"use server";
// Council and committee members register (Annexure-III "Faculty, Members Ledger") and meeting attendance.
// The Secretary (pcp.council.manage) keeps it; other desk roles read it.
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { committeeList } from "@/lib/governance";
import { CATEGORIES, SEAT_ROLES, meetingRoll, nextMemberRef, seatOn } from "@/lib/members";
import { requirePermission } from "@/lib/session";
import type { ActionResult } from "./faculty";

const fail = (message: string): ActionResult => ({ ok: false, message, level: "error" });
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);

function refresh(meetingRef?: string) {
  revalidatePath("/pcp/council");
  if (meetingRef) revalidatePath(`/pcp/council/${meetingRef}`);
}

async function guard(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

const SeatInput = z.object({
  committee: z.string().min(2, "Choose the Council or a committee."),
  role: z.enum(["CHAIR", "VICE_CHAIR", "MEMBER", "SECRETARY"]),
  termStart: z.string().regex(YMD, "Pick the start of the term."),
  termEnd: z.string().regex(YMD, "Pick the end of the term.").optional().nullable(),
});

const MemberInput = SeatInput.extend({
  honorific: z.string().trim().max(20).optional().nullable(),
  name: z.string().trim().min(3, "Enter the member's name."),
  designation: z.string().trim().min(3, "Enter the member's designation."),
  nominatingBody: z.string().trim().min(2, "Enter the nominating body (for example HEC, a province or a university)."),
  category: z.enum(["NOMINATED", "ELECTED", "EX_OFFICIO", "CO_OPTED"]),
  province: z.string().trim().optional().nullable(),
  email: z.string().trim().email("Enter a valid email address.").optional().nullable().or(z.literal("")),
  mobile: z.string().trim().regex(/^03\d{2}-?\d{7}$/, "Enter a mobile number like 0300-1234567.").optional().nullable().or(z.literal("")),
});

/** One chair (and one vice chair) per committee at a time, and one seat per member per committee. */
async function checkSeat(memberId: number | null, v: z.infer<typeof SeatInput>) {
  const committees = await committeeList();
  if (!committees.some((c) => c.name === v.committee)) throw new Error(`${v.committee} is not in the committees list (rule ref.committees).`);
  if (v.termEnd && v.termEnd <= v.termStart) throw new Error("The term must end after it starts.");
  const seats = (await db.select().from(schema.committeeSeats).where(eq(schema.committeeSeats.committee, v.committee))).filter((s) => s.status === "ACTIVE" && (!s.termEnd || s.termEnd >= v.termStart));
  if (memberId && seats.some((s) => s.memberId === memberId)) throw new Error(`This member already has a seat on the ${v.committee}. End it first to change the role or term.`);
  if (v.role === "CHAIR" || v.role === "VICE_CHAIR" || v.role === "SECRETARY") {
    const held = seats.find((s) => s.role === v.role);
    if (held) {
      const p = await db.query.councilMembers.findFirst({ where: eq(schema.councilMembers.id, held.memberId) });
      throw new Error(`${p?.name ?? "Another member"} is already ${SEAT_ROLES[v.role].toLowerCase()} of the ${v.committee}. End that seat first.`);
    }
  }
}

export async function addMember(raw: unknown): Promise<ActionResult> {
  const user = await requirePermission("pcp.council.manage");
  return guard(async () => {
    const parsed = MemberInput.safeParse(raw);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Complete the form.");
    const v = parsed.data;
    await checkSeat(null, v);
    const ref = await db.transaction(async (tx) => {
      const r = await nextMemberRef(tx);
      const [m] = await tx
        .insert(schema.councilMembers)
        .values({ ref: r, honorific: v.honorific || null, name: v.name, designation: v.designation, nominatingBody: v.nominatingBody, category: v.category, province: v.province || null, email: v.email || null, mobile: v.mobile || null, createdBy: user.username })
        .returning();
      await tx.insert(schema.committeeSeats).values({ memberId: m.id, committee: v.committee, role: v.role, termStart: v.termStart, termEnd: v.termEnd || null, createdBy: user.username });
      await audit(tx, { actor: user.username, action: "council.member.added", entity: "council_member", entityId: r, details: { name: v.name, nominatingBody: v.nominatingBody, category: CATEGORIES[v.category], committee: v.committee, role: v.role, termStart: v.termStart, termEnd: v.termEnd ?? null } });
      return r;
    });
    refresh();
    return { ok: true, level: "success", message: `${v.name} added to the register as ${ref}, ${SEAT_ROLES[v.role].toLowerCase()} of the ${v.committee}.` };
  });
}

export async function addSeat(memberId: number, raw: unknown): Promise<ActionResult> {
  const user = await requirePermission("pcp.council.manage");
  return guard(async () => {
    const m = await db.query.councilMembers.findFirst({ where: eq(schema.councilMembers.id, memberId) });
    if (!m) return fail("Member not found.");
    const parsed = SeatInput.safeParse(raw);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Complete the form.");
    const v = parsed.data;
    await checkSeat(m.id, v);
    await db.transaction(async (tx) => {
      await tx.insert(schema.committeeSeats).values({ memberId: m.id, committee: v.committee, role: v.role, termStart: v.termStart, termEnd: v.termEnd || null, createdBy: user.username });
      await audit(tx, { actor: user.username, action: "council.member.seat.added", entity: "council_member", entityId: m.ref, details: { committee: v.committee, role: v.role, termStart: v.termStart, termEnd: v.termEnd ?? null } });
    });
    refresh();
    return { ok: true, level: "success", message: `${m.name} now sits on the ${v.committee} as ${SEAT_ROLES[v.role].toLowerCase()}.` };
  });
}

export async function endSeat(seatId: number, reason: string): Promise<ActionResult> {
  const user = await requirePermission("pcp.council.manage");
  return guard(async () => {
    const s = await db.query.committeeSeats.findFirst({ where: eq(schema.committeeSeats.id, seatId) });
    if (!s || s.status !== "ACTIVE") return fail("That seat is not active.");
    const r = (reason ?? "").trim();
    if (r.length < 5) return fail("Say why the seat ends (for example: term completed, resigned, nomination withdrawn).");
    const m = await db.query.councilMembers.findFirst({ where: eq(schema.councilMembers.id, s.memberId) });
    await db.transaction(async (tx) => {
      await tx.update(schema.committeeSeats).set({ status: "ENDED", endedOn: today(), endReason: r }).where(eq(schema.committeeSeats.id, s.id));
      await audit(tx, { actor: user.username, action: "council.member.seat.ended", entity: "council_member", entityId: m?.ref ?? String(s.memberId), details: { committee: s.committee, role: s.role, reason: r } });
    });
    refresh();
    return { ok: true, level: "success", message: `${m?.name ?? "The member"}'s seat on the ${s.committee} has ended. It stays in the register's history.` };
  });
}

const ConflictInput = z.object({ institutionId: z.coerce.number().int().positive("Choose the institution."), reason: z.string().trim().min(5, "Give the reason for the conflict.") });

export async function declareMemberConflict(memberId: number, raw: unknown): Promise<ActionResult> {
  const user = await requirePermission("pcp.council.manage");
  return guard(async () => {
    const m = await db.query.councilMembers.findFirst({ where: eq(schema.councilMembers.id, memberId) });
    if (!m) return fail("Member not found.");
    const parsed = ConflictInput.safeParse(raw);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Complete the form.");
    const v = parsed.data;
    const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, v.institutionId) });
    if (!inst) return fail("Choose the institution.");
    const dup = await db.query.memberConflicts.findFirst({ where: and(eq(schema.memberConflicts.memberId, m.id), eq(schema.memberConflicts.institutionId, inst.id), eq(schema.memberConflicts.active, true)) });
    if (dup) return fail(`${m.name} already has a declared conflict with ${inst.shortCode}.`);
    await db.transaction(async (tx) => {
      await tx.insert(schema.memberConflicts).values({ memberId: m.id, institutionId: inst.id, reason: v.reason, recordedBy: user.username });
      await audit(tx, { actor: user.username, action: "council.member.conflict.declared", entity: "council_member", entityId: m.ref, details: { institution: inst.code, reason: v.reason } });
    });
    refresh();
    return { ok: true, level: "success", message: `Conflict recorded: ${m.name} is recused from every agenda item about ${inst.shortCode}.` };
  });
}

export async function withdrawMemberConflict(conflictId: number): Promise<ActionResult> {
  const user = await requirePermission("pcp.council.manage");
  return guard(async () => {
    const c = await db.query.memberConflicts.findFirst({ where: eq(schema.memberConflicts.id, conflictId) });
    if (!c || !c.active) return fail("That declaration is not active.");
    const m = await db.query.councilMembers.findFirst({ where: eq(schema.councilMembers.id, c.memberId) });
    await db.transaction(async (tx) => {
      await tx.update(schema.memberConflicts).set({ active: false, withdrawnBy: user.username, withdrawnAt: new Date() }).where(eq(schema.memberConflicts.id, c.id));
      await audit(tx, { actor: user.username, action: "council.member.conflict.withdrawn", entity: "council_member", entityId: m?.ref ?? String(c.memberId), details: { institutionId: c.institutionId } });
    });
    refresh();
    return { ok: true, level: "success", message: "Declaration withdrawn. It stays in the register's history." };
  });
}

/** Mark a member present or absent at a meeting (before or during the session; the record is fixed once closed). */
export async function markAttendance(meetingRef: string, memberId: number, present: boolean): Promise<ActionResult> {
  const user = await requirePermission("pcp.council.manage");
  return guard(async () => {
    const m = await db.query.councilMeetings.findFirst({ where: eq(schema.councilMeetings.ref, meetingRef) });
    if (!m) return fail("Meeting not found.");
    if (m.status === "CLOSED") return fail(`${m.ref} is closed; its attendance is part of the minutes.`);
    const seats = await db.select().from(schema.committeeSeats).where(and(eq(schema.committeeSeats.memberId, memberId), eq(schema.committeeSeats.committee, m.committee)));
    if (!seats.some((s) => seatOn(s, m.meetingDate))) return fail(`That member has no seat on the ${m.committee} on ${m.meetingDate}.`);
    const p = await db.query.councilMembers.findFirst({ where: eq(schema.councilMembers.id, memberId) });
    await db.transaction(async (tx) => {
      await tx
        .insert(schema.meetingAttendance)
        .values({ meetingId: m.id, memberId, present, recordedBy: user.username })
        .onConflictDoUpdate({ target: [schema.meetingAttendance.meetingId, schema.meetingAttendance.memberId], set: { present, recordedBy: user.username, recordedAt: new Date() } });
      await audit(tx, { actor: user.username, action: "council.attendance.marked", entity: "council_meeting", entityId: m.ref, details: { member: p?.ref, present } });
    });
    const roll = await meetingRoll(db, m.id);
    refresh(m.ref);
    return {
      ok: true,
      level: roll.met ? "success" : "warning",
      message: `${p?.name ?? "Member"} marked ${present ? "present" : "absent"}. ${roll.presentVoting} of ${roll.voting} voting members present; quorum ${roll.needed} ${roll.met ? "met" : "not met"}.`,
    };
  });
}
