// Council and committee members register (Annexure-III "Faculty, Members Ledger"): seats and terms, declared
// conflicts of interest, meeting attendance with a quorum from the `committee.quorum` rule, and recusals on
// agenda items. Shared server helpers: no Next.js imports, so the seed and the minutes use the same code.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | Tx;

export const SEAT_ROLES: Record<string, string> = { CHAIR: "Chair", VICE_CHAIR: "Vice chair", MEMBER: "Member", SECRETARY: "Secretary (ex officio)" };
export const CATEGORIES: Record<string, string> = { NOMINATED: "Nominated", ELECTED: "Elected", EX_OFFICIO: "Ex officio", CO_OPTED: "Co-opted" };
/** The Secretary keeps the record and does not vote; every other seat counts towards the quorum. */
export const votes = (role: string) => role !== "SECRETARY";

/** The `committee.quorum` rule: quorum = max(minimum, percent of the voting members), never more than the voting members. */
export type QuorumRule = { default: { percent: number; minimum: number }; committees?: Record<string, { percent?: number; minimum?: number }> };
export const DEFAULT_QUORUM: QuorumRule = { default: { percent: 50, minimum: 3 }, committees: { Council: { percent: 50, minimum: 6 } } };

export async function quorumRule(exec: Executor = db): Promise<{ value: QuorumRule; version: number }> {
  const row = await exec.query.rules.findFirst({ where: eq(schema.rules.key, "committee.quorum"), orderBy: desc(schema.rules.version) });
  const v = row?.value as Partial<QuorumRule> | undefined;
  return v?.default ? { value: { default: v.default, committees: v.committees ?? {} }, version: row!.version } : { value: DEFAULT_QUORUM, version: 0 };
}

export function quorumFor(rule: QuorumRule, committee: string, voting: number) {
  const r = { ...rule.default, ...(rule.committees?.[committee] ?? {}) };
  const ok = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  const percent = Math.min(100, ok(r.percent, 50));
  const minimum = ok(r.minimum, 0);
  const needed = Math.max(minimum, Math.ceil((voting * percent) / 100));
  return { needed: voting ? Math.min(voting, needed) : needed, percent, minimum };
}

/** A seat counts on a date when the date is inside its term and it had not been ended by then. */
export function seatOn(s: typeof schema.committeeSeats.$inferSelect, date: string) {
  return s.termStart <= date && (!s.termEnd || s.termEnd >= date) && (s.status === "ACTIVE" || (!!s.endedOn && s.endedOn > date));
}

/** Seat status as read today: serving, ended, or past its term end. */
export function seatStatus(s: typeof schema.committeeSeats.$inferSelect, today: string) {
  if (s.status === "ENDED") return "ENDED";
  if (s.termEnd && s.termEnd < today) return "EXPIRED";
  if (s.termStart > today) return "UPCOMING";
  return "ACTIVE";
}

export const maskEmail = (e: string | null) => (e ? e.replace(/^(.)[^@]*(@.*)$/, (_, a: string, b: string) => `${a}•••${b}`) : null);
export const maskMobile = (m: string | null) => (m ? m.replace(/\d(?=\d{2})/g, (d, i: number) => (i < 4 ? d : "•")) : null);

const today = () => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
/** A name without its title, for sorting: "Prof. Dr. Abdul Wahab Kakar" -> "Abdul Wahab Kakar". */
const plain = (name: string) => name.replace(/^(Prof\.\s+Dr\.|Prof\.|Dr\.|Mr\.|Ms\.)\s+/, "");

/** Active conflicts per member: those declared in the register, and an officer's own declarations as an inspector. */
async function conflictsByMember(exec: Executor, members: { id: number; username: string | null }[]) {
  const ids = members.map((m) => m.id);
  const own = ids.length ? await exec.select().from(schema.memberConflicts).where(and(inArray(schema.memberConflicts.memberId, ids), eq(schema.memberConflicts.active, true))) : [];
  const users = members.map((m) => m.username).filter((u): u is string => !!u);
  const declared = users.length ? await exec.select().from(schema.conflictDeclarations).where(and(inArray(schema.conflictDeclarations.username, users), eq(schema.conflictDeclarations.active, true))) : [];
  const insts = await exec.select({ id: schema.institutions.id, shortCode: schema.institutions.shortCode, name: schema.institutions.name }).from(schema.institutions);
  const inst = (id: number) => insts.find((i) => i.id === id);
  const out = new Map<number, { institutionId: number; shortCode: string; name: string; reason: string }[]>();
  for (const m of members) {
    const list = [
      ...own.filter((c) => c.memberId === m.id).map((c) => ({ institutionId: c.institutionId, reason: c.reason })),
      ...declared.filter((c) => c.username === m.username).map((c) => ({ institutionId: c.institutionId, reason: c.reason })),
    ];
    out.set(
      m.id,
      list.filter((c, i) => list.findIndex((x) => x.institutionId === c.institutionId) === i).map((c) => ({ ...c, shortCode: inst(c.institutionId)?.shortCode ?? "?", name: inst(c.institutionId)?.name ?? "" })),
    );
  }
  return out;
}

/** The institution an agenda item concerns, if any: the case's, the appeal's, the court case's or the letter's. */
async function itemInstitutions(exec: Executor, items: (typeof schema.councilItems.$inferSelect)[]) {
  const out = new Map<number, number | null>();
  for (const it of items) {
    let id: number | null = null;
    if (it.applicationId) id = (await exec.query.applications.findFirst({ where: eq(schema.applications.id, it.applicationId), columns: { institutionId: true } }))?.institutionId ?? null;
    else if (it.appealId) id = (await exec.query.appeals.findFirst({ where: eq(schema.appeals.id, it.appealId), columns: { institutionId: true } }))?.institutionId ?? null;
    else if (it.courtCaseId) id = (await exec.query.courtCases.findFirst({ where: eq(schema.courtCases.id, it.courtCaseId) }))?.institutionId ?? null;
    else if (it.letterId) id = (await exec.query.correspondence.findFirst({ where: eq(schema.correspondence.id, it.letterId) }))?.partyInstitutionId ?? null;
    out.set(it.id, id);
  }
  return out;
}

export type Recusal = { memberId: number; name: string; reason: string; shortCode: string; present: boolean | null };

/**
 * Attendance, quorum and recusals for a meeting, from the register. Before the session, an unmarked member is
 * "not marked"; when the session starts, unmarked members are recorded as present. A closed meeting reads the
 * recusals written when it closed.
 */
export async function meetingRoll(exec: Executor, meetingId: number, opts: { live?: boolean } = {}) {
  const m = await exec.query.councilMeetings.findFirst({ where: eq(schema.councilMeetings.id, meetingId) });
  if (!m) throw new Error("Meeting not found");
  const seats = (await exec.select().from(schema.committeeSeats).where(eq(schema.committeeSeats.committee, m.committee))).filter((s) => seatOn(s, m.meetingDate));
  const people = seats.length ? await exec.select().from(schema.councilMembers).where(inArray(schema.councilMembers.id, [...new Set(seats.map((s) => s.memberId))])) : [];
  const marks = await exec.select().from(schema.meetingAttendance).where(eq(schema.meetingAttendance.meetingId, meetingId));
  const conflicts = await conflictsByMember(exec, people);
  const order = ["CHAIR", "VICE_CHAIR", "MEMBER", "SECRETARY"];
  const members = seats
    .map((s) => {
      const p = people.find((x) => x.id === s.memberId)!;
      const mark = marks.find((x) => x.memberId === p.id);
      return {
        memberId: p.id,
        ref: p.ref,
        name: [p.honorific, p.name].filter(Boolean).join(" "),
        role: s.role,
        voting: votes(s.role),
        nominatingBody: p.nominatingBody,
        external: !p.username,
        present: mark ? mark.present : null,
        conflicts: conflicts.get(p.id) ?? [],
      };
    })
    .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || plain(a.name).localeCompare(plain(b.name)));
  const { value: rule, version } = await quorumRule(exec);
  const voting = members.filter((x) => x.voting).length;
  const q = quorumFor(rule, m.committee, voting);
  const presentVoting = members.filter((x) => x.voting && x.present === true).length;
  const items = await exec.select().from(schema.councilItems).where(eq(schema.councilItems.meetingId, meetingId)).orderBy(asc(schema.councilItems.position));
  const recusals: Record<number, Recusal[]> = {};
  if (m.status === "CLOSED" && !opts.live) {
    const rows = await exec.select().from(schema.itemRecusals).where(eq(schema.itemRecusals.meetingId, meetingId));
    const recusedPeople = rows.length ? await exec.select().from(schema.councilMembers).where(inArray(schema.councilMembers.id, rows.map((r) => r.memberId))) : [];
    for (const r of rows) {
      const p = recusedPeople.find((x) => x.id === r.memberId);
      (recusals[r.itemId] ??= []).push({ memberId: r.memberId, name: p ? [p.honorific, p.name].filter(Boolean).join(" ") : "?", reason: r.reason, shortCode: /conflict with (\S+?):/.exec(r.reason)?.[1] ?? "", present: r.present });
    }
  } else {
    const instOf = await itemInstitutions(exec, items);
    for (const it of items) {
      const instId = instOf.get(it.id);
      if (!instId) continue;
      const list = members
        .filter((x) => x.voting || x.role === "SECRETARY")
        .flatMap((x) => x.conflicts.filter((c) => c.institutionId === instId).map((c) => ({ memberId: x.memberId, name: x.name, reason: `declared conflict with ${c.shortCode}: ${c.reason}`, shortCode: c.shortCode, present: x.present })));
      if (list.length) recusals[it.id] = list;
    }
  }
  // Per item: the voting members present once the recused members step out.
  const itemQuorum: Record<number, { voting: number; met: boolean }> = {};
  for (const it of items) {
    const out = (recusals[it.id] ?? []).filter((r) => r.present === true && members.find((x) => x.memberId === r.memberId)?.voting).length;
    const v = presentVoting - out;
    itemQuorum[it.id] = { voting: v, met: v >= q.needed };
  }
  return {
    applicable: members.length > 0,
    committee: m.committee,
    status: m.status,
    members,
    voting,
    presentVoting,
    marked: marks.length,
    needed: q.needed,
    met: presentVoting >= q.needed,
    rule: { percent: q.percent, minimum: q.minimum, version },
    recusals,
    itemQuorum,
  };
}

export type MeetingRoll = Awaited<ReturnType<typeof meetingRoll>>;

/** When a session starts, members not marked are recorded as present (the Secretary marks absentees). */
export async function defaultAttendance(exec: Executor, meetingId: number, by: string) {
  const roll = await meetingRoll(exec, meetingId);
  const unmarked = roll.members.filter((x) => x.present === null);
  if (unmarked.length) await exec.insert(schema.meetingAttendance).values(unmarked.map((x) => ({ meetingId, memberId: x.memberId, present: true, recordedBy: by }))).onConflictDoNothing();
  return { ...roll, presentVoting: roll.presentVoting + unmarked.filter((x) => x.voting).length, defaulted: unmarked.length };
}

/** Refuses a decision or recommendation on an item without a quorum of voting members once recused members step out. */
export async function assertQuorum(exec: Executor, meetingId: number, itemId: number) {
  const roll = await meetingRoll(exec, meetingId);
  if (!roll.applicable) return; // nobody in the register for this committee: nothing to count
  const q = roll.itemQuorum[itemId];
  if (!q || q.met) return;
  const recused = (roll.recusals[itemId] ?? []).filter((r) => r.present).length;
  throw new Error(
    `No quorum on this item: ${q.voting} voting member${q.voting === 1 ? "" : "s"} present${recused ? ` after ${recused} recusal${recused === 1 ? "" : "s"}` : ""}; the ${roll.committee} needs ${roll.needed} (rule committee.quorum). Mark attendance, or leave the item to be carried forward.`,
  );
}

/** Writes the recusals on a meeting's items (one item, or all of them) so the record and the minutes keep them. */
export async function recordRecusals(exec: Executor, meetingId: number, itemId?: number) {
  const roll = await meetingRoll(exec, meetingId, { live: true });
  const rows = Object.entries(roll.recusals)
    .filter(([id]) => !itemId || Number(id) === itemId)
    .flatMap(([id, list]) => list.map((r) => ({ meetingId, itemId: Number(id), memberId: r.memberId, reason: r.reason, present: r.present !== false })));
  if (rows.length) await exec.insert(schema.itemRecusals).values(rows).onConflictDoNothing();
  return rows;
}

/** For the minutes: the attendance line and, per item, who was recused. */
export async function minutesRoll(exec: Executor, meetingId: number) {
  const roll = await meetingRoll(exec, meetingId);
  if (!roll.applicable) return { attendance: null as string | null, recused: {} as Record<number, string> };
  const present = roll.members.filter((x) => x.present === true);
  const absent = roll.members.filter((x) => x.present === false);
  const short = (x: { name: string }) => x.name.replace(/^(Prof\. Dr\.|Prof\.|Dr\.|Mr\.|Ms\.)\s+/, "");
  const attendance = `Attendance: ${roll.presentVoting} of ${roll.voting} voting members present; quorum ${roll.needed} (rule committee.quorum v${roll.rule.version}) ${roll.presentVoting >= roll.needed ? "was met" : "was NOT met"}. Present: ${present.map(short).join(", ") || "none recorded"}.${absent.length ? ` Absent: ${absent.map(short).join(", ")}.` : ""}`;
  const recused: Record<number, string> = {};
  for (const [id, list] of Object.entries(roll.recusals)) recused[Number(id)] = `Recused: ${list.map((r) => `${short(r)} (conflict with ${r.shortCode})`).join(", ")}.`;
  return { attendance, recused };
}

/** Who sits on each committee today, from the register: chair and voting members' names. */
export async function seatedToday(exec: Executor = db) {
  const t = today();
  const seats = (await exec.select().from(schema.committeeSeats)).filter((s) => seatOn(s, t));
  const people = seats.length ? await exec.select().from(schema.councilMembers).where(inArray(schema.councilMembers.id, [...new Set(seats.map((s) => s.memberId))])) : [];
  const name = (id: number) => {
    const p = people.find((x) => x.id === id);
    return p ? [p.honorific, p.name].filter(Boolean).join(" ") : "?";
  };
  const out: Record<string, { chair: string | null; members: string[] }> = {};
  for (const s of seats) {
    const c = (out[s.committee] ??= { chair: null, members: [] });
    if (s.role === "CHAIR") c.chair = name(s.memberId);
    if (votes(s.role)) c.members.push(name(s.memberId));
  }
  return out;
}

// ---------- The register ----------

export async function loadRegister(o: { showContact: boolean }) {
  const t = today();
  const members = await db.select().from(schema.councilMembers).orderBy(asc(schema.councilMembers.id));
  const seats = await db.select().from(schema.committeeSeats).orderBy(asc(schema.committeeSeats.termStart));
  const conflicts = await db.select().from(schema.memberConflicts).orderBy(desc(schema.memberConflicts.id));
  const officerConflicts = await conflictsByMember(db, members);
  const insts = await db.select({ id: schema.institutions.id, shortCode: schema.institutions.shortCode, name: schema.institutions.name }).from(schema.institutions).orderBy(asc(schema.institutions.name));
  const inst = (id: number) => insts.find((i) => i.id === id);
  return {
    institutions: insts,
    members: members.map((m) => {
      const mine = seats.filter((s) => s.memberId === m.id).map((s) => ({ id: s.id, committee: s.committee, role: s.role, termStart: s.termStart, termEnd: s.termEnd, status: seatStatus(s, t), endedOn: s.endedOn, endReason: s.endReason }));
      const own = conflicts.filter((c) => c.memberId === m.id);
      // An officer's inspection conflicts also bar them from that institution's items.
      const fromInspection = (officerConflicts.get(m.id) ?? []).filter((c) => !own.some((x) => x.institutionId === c.institutionId && x.active));
      return {
        id: m.id,
        ref: m.ref,
        name: [m.honorific, m.name].filter(Boolean).join(" "),
        designation: m.designation,
        nominatingBody: m.nominatingBody,
        category: m.category,
        province: m.province,
        username: m.username,
        email: o.showContact ? m.email : maskEmail(m.email),
        mobile: o.showContact ? m.mobile : maskMobile(m.mobile),
        status: mine.some((s) => s.status === "ACTIVE") ? "SERVING" : mine.some((s) => s.status === "UPCOMING") ? "UPCOMING" : "FORMER",
        seats: mine,
        conflicts: [
          ...own.map((c) => ({ id: c.id, institution: inst(c.institutionId)?.shortCode ?? "?", institutionName: inst(c.institutionId)?.name ?? "", reason: c.reason, active: c.active, source: "REGISTER" as const, createdAt: c.createdAt.toISOString() })),
          ...fromInspection.map((c, i) => ({ id: -1 - i, institution: c.shortCode, institutionName: c.name, reason: c.reason, active: true, source: "INSPECTION" as const, createdAt: null })),
        ],
      };
    }),
  };
}

export type Register = Awaited<ReturnType<typeof loadRegister>>;

/** Next member reference, MBR-0001. */
export async function nextMemberRef(exec: Executor) {
  const rows = await exec.select({ ref: schema.councilMembers.ref }).from(schema.councilMembers);
  const n = rows.reduce((mx, r) => Math.max(mx, Number(r.ref.replace(/\D/g, "")) || 0), 0) + 1;
  return `MBR-${String(n).padStart(4, "0")}`;
}
