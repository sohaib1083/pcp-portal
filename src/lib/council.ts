// Council meetings, appeals and the help desk (guide sections 4, 12 and 14): shared server helpers.
// No Next.js imports here, so the seed can use the same code as the server actions.
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { emailAudience } from "./messages";
import { fileDocument, publicUrl, renderLetter } from "./letters";
import { KIND_LABELS, PROGRAM_LABELS } from "./workflow";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | Tx;

// ---------- References ----------

/** Next reference such as CM-2026-07, APL-2026-0001 or TKT-2026-0001 (highest number + 1, so gaps never collide). */
export async function nextModuleRef(exec: Executor, table: "council_meetings" | "appeals" | "tickets", prefix: string, pad: number, year = new Date().getFullYear()) {
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

export const caseLabel = (a: { kind: string; programType: string }) => `${KIND_LABELS[a.kind] ?? a.kind} · ${PROGRAM_LABELS[a.programType] ?? a.programType}`;

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
  const [ev] = await exec
    .select({ note: schema.applicationEvents.note })
    .from(schema.applicationEvents)
    .where(and(eq(schema.applicationEvents.applicationId, applicationId), eq(schema.applicationEvents.toStatus, "COUNCIL_REVIEW")))
    .orderBy(desc(schema.applicationEvents.id))
    .limit(1);
  const note = ev?.note?.replace(/^Recommendation:\s*/i, "").trim();
  return note && note !== "—" && !/^Seeded state/i.test(note) ? note : null;
}

/** A first draft of the decision, read from the recommendation; the Secretary changes it if needed. */
export function draftFromRecommendation(rec: string | null) {
  if (!rec) return null;
  const r = rec.toLowerCase();
  if (/\breject/.test(r)) return "REJECTED";
  if (/\bdefer/.test(r)) return "DEFERRED";
  if (/\bapprov/.test(r)) return "APPROVED";
  return null;
}

/** Undecided agenda items in meetings that are not closed: these cases and appeals are already scheduled. */
export async function scheduledItems(exec: Executor) {
  return exec
    .select({ applicationId: schema.councilItems.applicationId, appealId: schema.councilItems.appealId, meetingId: schema.councilItems.meetingId })
    .from(schema.councilItems)
    .innerJoin(schema.councilMeetings, eq(schema.councilMeetings.id, schema.councilItems.meetingId))
    .where(and(ne(schema.councilMeetings.status, "CLOSED"), isNull(schema.councilItems.decision)));
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

/** The next council meeting that is still planned (today or later). */
export async function nextPlannedMeeting(exec: Executor) {
  const today = new Date().toISOString().slice(0, 10);
  const [m] = await exec
    .select()
    .from(schema.councilMeetings)
    .where(and(eq(schema.councilMeetings.status, "PLANNED"), sql`${schema.councilMeetings.meetingDate} >= ${today}`))
    .orderBy(asc(schema.councilMeetings.meetingDate))
    .limit(1);
  return m ?? null;
}

// ---------- Minutes ----------

/** Minutes of a council meeting: one row per agenda item with the decision. A PCP-level document (no owner). */
export async function fileMinutes(exec: Executor, meetingId: number, by: { username: string; name: string }) {
  const meeting = await exec.query.councilMeetings.findFirst({ where: eq(schema.councilMeetings.id, meetingId) });
  if (!meeting) throw new Error("Meeting not found");
  const items = await exec.select().from(schema.councilItems).where(eq(schema.councilItems.meetingId, meetingId)).orderBy(asc(schema.councilItems.position));
  const appIds = items.map((i) => i.applicationId).filter((x): x is number => x != null);
  const appealIds = items.map((i) => i.appealId).filter((x): x is number => x != null);
  const apps = appIds.length ? await exec.select().from(schema.applications).where(inArray(schema.applications.id, appIds)) : [];
  const appeals = appealIds.length ? await exec.select().from(schema.appeals).where(inArray(schema.appeals.id, appealIds)) : [];
  const insts = await exec.select().from(schema.institutions);
  const instName = (id: number) => insts.find((i) => i.id === id)?.shortCode ?? "";
  const appealCase = appeals.length ? await exec.select().from(schema.applications).where(inArray(schema.applications.id, appeals.map((a) => a.applicationId))) : [];

  // Left column is narrow in the letter layout: the reference only; the rest goes with the decision.
  const table: [string, string][] = items.map((it, n) => {
    let left = "";
    let what = "";
    if (it.applicationId) {
      const a = apps.find((x) => x.id === it.applicationId);
      left = `${n + 1}. ${a?.ref ?? "?"}`;
      what = a ? `${instName(a.institutionId)}, ${KIND_LABELS[a.kind] ?? a.kind} ${PROGRAM_LABELS[a.programType] ?? a.programType}` : "";
    } else {
      const p = appeals.find((x) => x.id === it.appealId);
      const c = appealCase.find((x) => x.id === p?.applicationId);
      left = `${n + 1}. ${p?.ref ?? "?"}`;
      what = `${instName(p?.institutionId ?? 0)}, appeal against the decision on ${c?.ref ?? "?"}`;
    }
    let outcome = "Not taken up; carried forward to the next meeting";
    if (it.decision) {
      const note = it.decisionNote?.slice(0, 200) ?? "";
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
    }
    return [left, `${what}: ${outcome}`];
  });
  const decided = items.filter((i) => i.decision).length;
  const bytes = await renderLetter({
    kind: "Council minutes",
    refNo: meeting.ref,
    date: meeting.closedAt ?? new Date(),
    subject: `Minutes of ${meeting.title} (${meeting.ref}) held on ${fmtDay(meeting.meetingDate)}`,
    paragraphs: [
      `The council considered ${items.length} item${items.length === 1 ? "" : "s"} placed on the agenda by the Secretary from cases and appeals ready for a decision. ${decided} decision${decided === 1 ? " was" : "s were"} recorded, each confirmed with a one-time code and written to the audit log.`,
      "Each decision is communicated to the institution with a standard decision letter. A deferral states the reason and the date the case returns; a rejection states its grounds.",
    ],
    table,
    signatory: { name: by.name, title: "Secretary, Pharmacy Council of Pakistan", signedAt: meeting.closedAt ?? new Date() },
    qrUrl: publicUrl(`/pcp/council/${meeting.ref}`),
    qrCaption: "Opens the meeting record (PCP staff sign-in)",
  });
  return fileDocument(exec, { folder: `council/${meeting.ref}`, docType: "Council minutes", fileName: `minutes-${meeting.ref}.pdf`, bytes, uploadedBy: by.username });
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
