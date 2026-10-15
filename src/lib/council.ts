// Council meetings, appeals and the help desk (guide sections 4, 12 and 14): shared server helpers.
// No Next.js imports here, so the seed can use the same code as the server actions.
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { emailAudience } from "./messages";
import { fileDocument, publicUrl, renderLetter } from "./letters";
import { KIND_LABELS, programmeName } from "./workflow";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | Tx;

// ---------- References ----------

/** Next reference such as CM-2026-07, APL-2026-0001 or TKT-2026-0001 (highest number + 1, so gaps never collide). */
export async function nextModuleRef(exec: Executor, table: "council_meetings" | "appeals" | "tickets", prefix: string, pad: number, year = new Date().getFullYear()) {
  // Inside a transaction, two requests at the same moment wait for each other instead of taking the same number.
  if (exec !== db) await exec.execute(sql`select pg_advisory_xact_lock(hashtext(${`ref:${table}`}))`);
  const like = `${prefix}-${year}-%`;
  const res = await exec.execute(sql`select coalesce(max(nullif(regexp_replace(ref, '^.*-', ''), '')::int), 0) as n from ${sql.identifier(table)} where ref like ${like}`);
  const n = Number((res.rows[0] as { n: number }).n) + 1;
  return `${prefix}-${year}-${String(n).padStart(pad, "0")}`;
}

// ---------- Service level ----------

export const TICKET_SLA_DAYS = 5;

/** Add working days (Monday to Friday; Pakistan's government offices close on Saturday and Sunday). */
export function addWorkingDays(from: Date, days: number) {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

export type SlaState = "OVERDUE" | "DUE_SOON" | "ON_TRACK" | "MET" | "MISSED";

/** Where a ticket stands against its time limit. The clock stops when the ticket is resolved. */
export function slaFor(t: { status: string; slaDueAt: Date | null; resolvedAt: Date | null }, now = new Date()) {
  const due = t.slaDueAt ?? now;
  if (t.status === "RESOLVED" || t.status === "CLOSED") {
    const at = t.resolvedAt ?? now;
    return { state: (at <= due ? "MET" : "MISSED") as SlaState, msLeft: due.getTime() - at.getTime() };
  }
  const left = due.getTime() - now.getTime();
  return { state: (left < 0 ? "OVERDUE" : left < 86400000 ? "DUE_SOON" : "ON_TRACK") as SlaState, msLeft: left };
}

// ---------- Messages filed on the record ----------

/** In-app alert plus email, filed on the appeal or ticket (the link alone does not always name it). */
export async function notifyOn(exec: Executor, audience: string, title: string, body: string, link: string, entity: "appeal" | "ticket" | "council", entityRef: string) {
  await exec.insert(schema.notifications).values({ audience, title, body, link });
  await emailAudience(exec, audience, title, body, link, { entity, entityRef });
}

// ---------- Labels ----------

/** Meetings of the Council decide; meetings of any other committee record recommendations. */
export const COUNCIL = "Council";

export const caseLabel = (a: { kind: string; programType: string; field?: string | null }) => `${KIND_LABELS[a.kind] ?? a.kind} · ${programmeName(a.programType, a.field)}`;

export const DECISION_LABELS: Record<string, string> = {
  APPROVED: "Approved",
  DEFERRED: "Deferred",
  REJECTED: "Rejected",
  UPHELD: "Appeal upheld",
  DISMISSED: "Appeal dismissed",
};

export const fmtDay = (d: string | Date | null | undefined) =>
  d ? new Date(typeof d === "string" && d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";

// ---------- Council agenda ----------

/** The officer's recommendation is the note on the forward-to-council step. */
export async function recommendationFor(exec: Executor, applicationId: number) {
  const events = await exec
    .select({ note: schema.applicationEvents.note, at: schema.applicationEvents.createdAt })
    .from(schema.applicationEvents)
    .where(and(eq(schema.applicationEvents.applicationId, applicationId), eq(schema.applicationEvents.toStatus, "COUNCIL_REVIEW")))
    .orderBy(desc(schema.applicationEvents.id));
  const fwd = events.find((e) => /^Recommendation:/i.test(e.note ?? ""));
  const note = fwd?.note?.replace(/^Recommendation:\s*/i, "").trim();
  const rec = note && note !== "—" ? note : null;
  // A case reopened by an upheld appeal: the appeal's review is the newer advice; keep the original next to it.
  const [appeal] = await exec
    .select()
    .from(schema.appeals)
    .where(and(eq(schema.appeals.applicationId, applicationId), eq(schema.appeals.status, "UPHELD")))
    .orderBy(desc(schema.appeals.decidedAt))
    .limit(1);
  if (appeal?.decidedAt && (!fwd || appeal.decidedAt > fwd.at)) {
    const why = appeal.reviewNote ?? appeal.decisionNote ?? "";
    return `Reopened after appeal ${appeal.ref} was upheld.${why ? ` Appeal review: ${why}` : ""}${rec ? ` Original recommendation: ${rec}` : ""}`;
  }
  return rec;
}

/** A first draft of the decision, read from the recommendation; the Secretary changes it if needed. */
export function draftFromRecommendation(rec: string | null) {
  // A reopened case carries two pieces of advice; the Secretary sets its draft by hand.
  if (!rec || rec.startsWith("Reopened after appeal")) return null;
  const r = rec.toLowerCase();
  if (/\breject/.test(r)) return "REJECTED";
  if (/\bdefer/.test(r)) return "DEFERRED";
  if (/\bapprov/.test(r)) return "APPROVED";
  return null;
}

/** Undecided agenda items in council meetings that are not closed: these cases and appeals are already scheduled. */
export async function scheduledItems(exec: Executor) {
  return exec
    .select({ applicationId: schema.councilItems.applicationId, appealId: schema.councilItems.appealId, meetingId: schema.councilItems.meetingId })
    .from(schema.councilItems)
    .innerJoin(schema.councilMeetings, eq(schema.councilMeetings.id, schema.councilItems.meetingId))
    .where(and(eq(schema.councilMeetings.committee, COUNCIL), ne(schema.councilMeetings.status, "CLOSED"), isNull(schema.councilItems.decision)));
}

/** Cases awaiting a council decision and appeals ready for council that are not on an open agenda yet. */
export async function readyForCouncil(exec: Executor) {
  const taken = await scheduledItems(exec);
  const takenApps = new Set(taken.map((t) => t.applicationId).filter((x): x is number => x != null));
  const takenAppeals = new Set(taken.map((t) => t.appealId).filter((x): x is number => x != null));
  const cases = (await exec.select().from(schema.applications).where(eq(schema.applications.status, "COUNCIL_REVIEW")).orderBy(asc(schema.applications.updatedAt))).filter((a) => !takenApps.has(a.id));
  const appeals = (await exec.select().from(schema.appeals).where(eq(schema.appeals.status, "ON_AGENDA")).orderBy(asc(schema.appeals.createdAt))).filter((a) => !takenAppeals.has(a.id));
  return { cases, appeals };
}

/** Serialise agenda changes (build, place, remove) so an item is never added twice. Call inside a transaction. */
export async function lockAgenda(tx: Executor) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('council:agenda'))`);
}

/** Keep agenda numbering continuous after an item leaves. */
export async function renumberAgenda(exec: Executor, meetingId: number) {
  const rest = await exec.select().from(schema.councilItems).where(eq(schema.councilItems.meetingId, meetingId)).orderBy(asc(schema.councilItems.position), asc(schema.councilItems.id));
  for (const [i, r] of rest.entries()) if (r.position !== i + 1) await exec.update(schema.councilItems).set({ position: i + 1 }).where(eq(schema.councilItems.id, r.id));
}

/** The next council meeting that is still planned (today or later). Committee meetings are not council meetings. */
export async function nextPlannedMeeting(exec: Executor) {
  const today = new Date().toISOString().slice(0, 10);
  const [m] = await exec
    .select()
    .from(schema.councilMeetings)
    .where(and(eq(schema.councilMeetings.committee, COUNCIL), eq(schema.councilMeetings.status, "PLANNED"), sql`${schema.councilMeetings.meetingDate} >= ${today}`))
    .orderBy(asc(schema.councilMeetings.meetingDate))
    .limit(1);
  return m ?? null;
}

// ---------- Minutes ----------

/**
 * Minutes of a council or committee meeting: one row per agenda item with the decision (council) or the
 * recommendation (committee), then the action points with owner and due date. A PCP-level document (no owner).
 */
export async function fileMinutes(exec: Executor, meetingId: number, by: { username: string; name: string }) {
  const meeting = await exec.query.councilMeetings.findFirst({ where: eq(schema.councilMeetings.id, meetingId) });
  if (!meeting) throw new Error("Meeting not found");
  const isCouncil = meeting.committee === COUNCIL;
  const items = await exec.select().from(schema.councilItems).where(eq(schema.councilItems.meetingId, meetingId)).orderBy(asc(schema.councilItems.position));
  const appIds = items.map((i) => i.applicationId).filter((x): x is number => x != null);
  const appealIds = items.map((i) => i.appealId).filter((x): x is number => x != null);
  const courtIds = items.map((i) => i.courtCaseId).filter((x): x is number => x != null);
  const letterIds = items.map((i) => i.letterId).filter((x): x is number => x != null);
  const apps = appIds.length ? await exec.select().from(schema.applications).where(inArray(schema.applications.id, appIds)) : [];
  const appeals = appealIds.length ? await exec.select().from(schema.appeals).where(inArray(schema.appeals.id, appealIds)) : [];
  const courts = courtIds.length ? await exec.select().from(schema.courtCases).where(inArray(schema.courtCases.id, courtIds)) : [];
  const letters = letterIds.length ? await exec.select().from(schema.correspondence).where(inArray(schema.correspondence.id, letterIds)) : [];
  const actions = await exec.select().from(schema.committeeActions).where(eq(schema.committeeActions.meetingId, meetingId)).orderBy(asc(schema.committeeActions.id));
  const staff = actions.length ? await exec.select().from(schema.staff) : [];
  const insts = await exec.select().from(schema.institutions);
  const instName = (id: number) => insts.find((i) => i.id === id)?.shortCode ?? "";
  const appealCase = appeals.length ? await exec.select().from(schema.applications).where(inArray(schema.applications.id, appeals.map((a) => a.applicationId))) : [];

  // The minutes are one page: shorten the notes when the agenda is long.
  const rows = items.length + actions.length;
  const cut = (t: string | null | undefined) => (t ?? "").slice(0, rows > 6 ? 90 : 200);
  // Left column is narrow in the letter layout: the reference only; the rest goes with the outcome.
  const table: [string, string][] = items.map((it, n) => {
    let left = "";
    let what = "";
    if (it.applicationId) {
      const a = apps.find((x) => x.id === it.applicationId);
      left = `${n + 1}. ${a?.ref ?? "?"}`;
      what = a ? `${instName(a.institutionId)}, ${KIND_LABELS[a.kind] ?? a.kind} ${programmeName(a.programType, a.field)}` : "";
    } else if (it.appealId) {
      const p = appeals.find((x) => x.id === it.appealId);
      const c = appealCase.find((x) => x.id === p?.applicationId);
      left = `${n + 1}. ${p?.ref ?? "?"}`;
      what = `${instName(p?.institutionId ?? 0)}, appeal against the decision on ${c?.ref ?? "?"}`;
    } else if (it.courtCaseId) {
      const c = courts.find((x) => x.id === it.courtCaseId);
      left = `${n + 1}. ${c?.ref ?? "?"}`;
      what = c ? `${c.caseNumber}, ${c.title}` : "Court case";
    } else if (it.letterId) {
      const l = letters.find((x) => x.id === it.letterId);
      left = `${n + 1}. ${l?.ref ?? "?"}`;
      what = l ? `${l.direction === "IN" ? "Letter from" : "Letter to"} ${l.party}: ${l.subject}` : "Letter";
    } else {
      left = `${n + 1}. Other matter`;
      what = it.subject ?? "";
    }
    let outcome = "Not taken up; carried forward to the next meeting";
    if (it.decision) {
      const note = cut(it.decisionNote);
      outcome =
        it.decision === "DEFERRED"
          ? `Deferred to ${fmtDay(it.deferUntil)}.${note ? ` Reason: ${note}` : ""}`
          : it.decision === "REJECTED"
            ? `Rejected.${note ? ` Grounds: ${note}` : ""}`
            : it.decision === "APPROVED"
              ? `Approved.${note ? ` ${note}` : ""}`
              : it.decision === "UPHELD"
                ? `Appeal upheld; the case returns to the council.${note ? ` ${note}` : ""}`
                : `Appeal dismissed; the decision stands.${note ? ` ${note}` : ""}`;
    } else if (it.resolution) {
      outcome = `${isCouncil ? "Outcome" : "Recommendation"}: ${cut(it.resolution)}`;
    }
    return [left, `${what}: ${outcome}`];
  });
  const name = (u: string) => staff.find((s) => s.username === u)?.displayName ?? u;
  for (const [i, a] of actions.entries()) table.push([`Action ${i + 1}`, `${cut(a.title).replace(/[.\s]*$/, ".")} Owner: ${name(a.owner)}, due ${fmtDay(a.dueDate)}.`]);

  const decided = items.filter((i) => i.decision).length;
  const resolved = items.filter((i) => i.resolution).length;
  const actionLine = actions.length ? ` ${actions.length} action point${actions.length === 1 ? " was" : "s were"} assigned, each tracked with an owner, a due date and reminders.` : "";
  const bytes = await renderLetter({
    kind: isCouncil ? "Council minutes" : "Committee minutes",
    refNo: meeting.ref,
    date: meeting.closedAt ?? new Date(),
    subject: `Minutes of ${meeting.title} (${meeting.ref}) held on ${fmtDay(meeting.meetingDate)}`,
    paragraphs: isCouncil
      ? [
          `The council considered ${items.length} item${items.length === 1 ? "" : "s"} placed on the agenda by the Secretary from cases and appeals ready for a decision. ${decided} decision${decided === 1 ? " was" : "s were"} recorded, each confirmed with a one-time code and written to the audit log.${resolved ? ` ${resolved} other matter${resolved === 1 ? " was" : "s were"} discussed and noted.` : ""}${actionLine}`,
          "Each decision is communicated to the institution with a standard decision letter. A deferral states the reason and the date the case returns; a rejection states its grounds.",
        ]
      : [
          `The ${meeting.committee} considered ${items.length} item${items.length === 1 ? "" : "s"} and recorded ${resolved} recommendation${resolved === 1 ? "" : "s"}.${actionLine}`,
          "A committee recommends; it does not decide. Recommendations on cases and appeals go to the Council, which records its decisions with a one-time code.",
        ],
    table,
    signatory: { name: by.name, title: isCouncil ? "Secretary, Pharmacy Council of Pakistan" : `Secretary to the ${meeting.committee}`, signedAt: meeting.closedAt ?? new Date() },
    qrUrl: publicUrl(`/pcp/council/${meeting.ref}`),
    qrCaption: "Opens the meeting record (PCP staff sign-in)",
  });
  return fileDocument(exec, { folder: `council/${meeting.ref}`, docType: isCouncil ? "Council minutes" : "Committee minutes", fileName: `minutes-${meeting.ref}.pdf`, bytes, uploadedBy: by.username });
}

// ---------- Appeal decision letter ----------

export async function fileAppealLetter(
  exec: Executor,
  o: {
    appeal: { ref: string; institutionId: number; applicationId: number; grounds: string };
    caseRef: string;
    outcome: "UPHELD" | "DISMISSED";
    note: string;
    meetingRef: string | null;
    by: { username: string; name: string };
    date?: Date;
  },
) {
  const inst = await exec.query.institutions.findFirst({ where: eq(schema.institutions.id, o.appeal.institutionId) });
  const upheld = o.outcome === "UPHELD";
  const bytes = await renderLetter({
    kind: "Appeal decision",
    refNo: o.appeal.ref,
    date: o.date,
    to: { name: inst?.name ?? "Institution", lines: [inst ? `${inst.city}, ${inst.province}` : "", inst?.code ?? ""].filter(Boolean) },
    subject: `Decision on your appeal ${o.appeal.ref} against the council decision on ${o.caseRef}: ${upheld ? "upheld" : "dismissed"}`,
    paragraphs: [
      `The council considered your appeal${o.meetingRef ? ` at its meeting ${o.meetingRef}` : ""}, together with the original case file, the decision under appeal and the evidence you submitted.`,
      upheld
        ? `The appeal is upheld. Case ${o.caseRef} is reopened and returns to the council for a fresh decision. You will be told the meeting date when it is placed on the agenda.`
        : `The appeal is dismissed. The council's original decision on ${o.caseRef} stands.`,
      `Reasons: ${o.note}`,
    ],
    table: [
      ["Appeal", o.appeal.ref],
      ["Case under appeal", o.caseRef],
      ["Outcome", upheld ? "Upheld: case reopened" : "Dismissed: decision stands"],
      ...(o.meetingRef ? ([["Council meeting", o.meetingRef]] as [string, string][]) : []),
    ],
    signatory: { name: o.by.name, title: "Secretary, Pharmacy Council of Pakistan" },
    qrUrl: publicUrl(`/institution/appeals/${o.appeal.ref}`),
    qrCaption: "Opens the appeal in the institution portal",
  });
  return fileDocument(exec, {
    institutionId: o.appeal.institutionId,
    folder: `correspondence/appeals/${o.appeal.ref}`,
    docType: "Appeal decision letter",
    fileName: `appeal-decision-${o.appeal.ref}.pdf`,
    bytes,
    applicationId: o.appeal.applicationId,
    uploadedBy: o.by.username,
  });
}

/** An upheld appeal reopens the original case for a fresh council decision; the step is written to the case history. */
export async function reopenCaseForCouncil(exec: Executor, o: { applicationId: number; appealRef: string; meetingRef: string | null; actor: string; actorRole: string }) {
  const app = await exec.query.applications.findFirst({ where: eq(schema.applications.id, o.applicationId) });
  if (!app) throw new Error("Original case not found");
  await exec
    .update(schema.applications)
    .set({ status: "COUNCIL_REVIEW", decision: null, decisionNote: null, decidedAt: null, deferUntil: null, decisionGrounds: null, updatedAt: new Date() })
    .where(eq(schema.applications.id, app.id));
  await exec.insert(schema.applicationEvents).values({
    applicationId: app.id,
    fromStatus: app.status,
    toStatus: "COUNCIL_REVIEW",
    actor: o.actor,
    actorRole: o.actorRole,
    note: `Appeal ${o.appealRef} upheld${o.meetingRef ? ` at ${o.meetingRef}` : ""}: the case returns to the council for a fresh decision`,
  });
  // A rejection had marked the programme's NOC as rejected; it is pending again while the council reconsiders.
  if (app.status === "REJECTED" && app.kind === "NOC")
    await exec
      .update(schema.programs)
      .set({ nocStatus: "PENDING" })
      .where(and(eq(schema.programs.institutionId, app.institutionId), eq(schema.programs.type, app.programType), eq(schema.programs.nocStatus, "REJECTED")));
  return app;
}
