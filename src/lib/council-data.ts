// Read models for the council, appeals and help desk screens. Everything returned is plain JSON for client components.
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { COUNCIL, caseLabel, readyForCouncil, slaFor } from "./council";
import { courtShort, pkToday } from "./governance-shared";
import { can } from "./roles";
import { iso } from "./util";

async function nameMap() {
  const staff = await db.select({ u: schema.staff.username, n: schema.staff.displayName, r: schema.staff.role }).from(schema.staff);
  return { name: (u: string | null | undefined) => (u ? staff.find((s) => s.u === u)?.n ?? u : null), staff };
}

async function instMap() {
  const rows = await db.select().from(schema.institutions);
  return (id: number | null | undefined) => {
    const i = rows.find((r) => r.id === id);
    return i ? { id: i.id, name: i.name, code: i.code, shortCode: i.shortCode, province: i.province, city: i.city } : null;
  };
}

// ---------- Council ----------

export async function loadMeetingsOverview() {
  const meetings = await db.select().from(schema.councilMeetings).orderBy(desc(schema.councilMeetings.meetingDate));
  const items = await db.select().from(schema.councilItems);
  const ready = await readyForCouncil(db);
  const inst = await instMap();
  const today = new Date().toISOString().slice(0, 10);
  const next = [...meetings].filter((m) => m.committee === COUNCIL && m.status !== "CLOSED" && m.meetingDate >= today).sort((a, b) => a.meetingDate.localeCompare(b.meetingDate))[0] ?? null;
  const actions = await db.select({ meetingId: schema.committeeActions.meetingId, status: schema.committeeActions.status }).from(schema.committeeActions);
  const year = String(new Date().getFullYear());
  return {
    meetings: meetings.map((m) => {
      const mine = items.filter((i) => i.meetingId === m.id);
      const tasks = actions.filter((a) => a.meetingId === m.id);
      return {
        ref: m.ref,
        committee: m.committee,
        title: m.title,
        date: m.meetingDate,
        status: m.status,
        items: mine.length,
        cases: mine.filter((i) => i.applicationId).length,
        appeals: mine.filter((i) => i.appealId).length,
        others: mine.filter((i) => !i.applicationId && !i.appealId).length,
        decided: mine.filter((i) => i.decision || i.resolution).length,
        actions: tasks.length,
        actionsOpen: tasks.filter((a) => a.status !== "DONE").length,
        minutesDocumentId: m.minutesDocumentId,
      };
    }),
    next: next ? { ref: next.ref, date: next.meetingDate, status: next.status, title: next.title } : null,
    ready: [
      ...ready.cases.map((a) => ({ kind: "case" as const, ref: a.ref, label: caseLabel(a), inst: inst(a.institutionId)?.shortCode ?? "", since: iso(a.updatedAt)! })),
      ...ready.appeals.map((p) => ({ kind: "appeal" as const, ref: p.ref, label: "Appeal", inst: inst(p.institutionId)?.shortCode ?? "", since: iso(p.createdAt)! })),
    ],
    decisionsThisYear: items.filter((i) => i.decision && iso(i.decidedAt)?.startsWith(year)).length,
  };
}

/** The other kinds of agenda item: a court case, a letter, or another matter (free text). */
async function otherItem(it: typeof schema.councilItems.$inferSelect, inst: Awaited<ReturnType<typeof instMap>>) {
  if (it.courtCaseId) {
    const c = await db.query.courtCases.findFirst({ where: eq(schema.courtCases.id, it.courtCaseId) });
    if (!c) return null;
    const stay = await db.query.courtOrders.findFirst({ where: and(eq(schema.courtOrders.courtCaseId, c.id), eq(schema.courtOrders.kind, "STAY"), isNull(schema.courtOrders.liftedAt)) });
    const [next] = await db
      .select()
      .from(schema.courtHearings)
      .where(and(eq(schema.courtHearings.courtCaseId, c.id), eq(schema.courtHearings.status, "SCHEDULED"), gte(schema.courtHearings.hearingDate, pkToday())))
      .orderBy(asc(schema.courtHearings.hearingDate))
      .limit(1);
    return {
      kind: "court" as const,
      ref: c.ref,
      court: { court: c.court, courtShort: courtShort(c.court), caseNumber: c.caseNumber, title: c.title, status: c.status, linkedRef: c.linkedRef, counsel: c.counsel, nextHearing: next?.hearingDate ?? null, stayUntil: stay ? (stay.stayUntil ?? "further orders") : null, inst: inst(c.institutionId) },
      letter: null,
    };
  }
  if (it.letterId) {
    const l = await db.query.correspondence.findFirst({ where: eq(schema.correspondence.id, it.letterId) });
    if (!l) return null;
    return { kind: "letter" as const, ref: l.ref, court: null, letter: { direction: l.direction, party: l.party, subject: l.subject, date: l.letterDate, status: l.status, linkedRef: l.linkedRef, documentId: l.documentId } };
  }
  return { kind: "other" as const, ref: `item-${it.id}`, court: null, letter: null };
}

/** The inspection report behind a case: the latest submitted checklist, its summary and the filed PDF. */
async function inspectionFor(applicationId: number, name: (u: string) => string | null) {
  const [insp] = await db
    .select()
    .from(schema.inspections)
    .where(and(eq(schema.inspections.applicationId, applicationId), eq(schema.inspections.status, "SUBMITTED")))
    .orderBy(desc(schema.inspections.id))
    .limit(1);
  const [doc] = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(and(eq(schema.documents.applicationId, applicationId), eq(schema.documents.docType, "Inspection report")))
    .orderBy(desc(schema.documents.version), desc(schema.documents.id))
    .limit(1);
  if (!insp) return null;
  const list = insp.checklist ?? [];
  // The score the lead entered on the tablet (RFP 4.1.2), with the pass mark of the rule used at submission.
  const score = await db.query.inspectionScores.findFirst({ where: eq(schema.inspectionScores.inspectionId, insp.id) });
  return {
    score: score ? { total: score.total, max: score.max, percent: score.percent, passPercent: score.passPercent, passed: score.passed } : null,
    summary: insp.summary,
    inspector: name(insp.inspector),
    date: insp.scheduledFor,
    compliant: list.filter((c) => c.result === "COMPLIANT").length,
    partial: list.filter((c) => c.result === "PARTIAL").length,
    nonCompliant: list.filter((c) => c.result === "NON_COMPLIANT").length,
    total: list.filter((c) => c.result !== "NA").length,
    issues: list.filter((c) => c.result === "PARTIAL" || c.result === "NON_COMPLIANT").map((c) => ({ criterion: c.criterion, result: c.result, remarks: c.remarks })),
    reportDocumentId: doc?.id ?? null,
  };
}

/** The decision an appeal is against: the last rejection or deferral recorded on the case before the appeal was filed. */
async function decisionUnderAppeal(appeal: { applicationId: number; createdAt: Date }) {
  const [ev] = await db
    .select()
    .from(schema.applicationEvents)
    .where(and(eq(schema.applicationEvents.applicationId, appeal.applicationId), inArray(schema.applicationEvents.toStatus, ["REJECTED", "DEFERRED"]), lte(schema.applicationEvents.createdAt, appeal.createdAt)))
    .orderBy(desc(schema.applicationEvents.id))
    .limit(1);
  return ev ? { decision: ev.toStatus, note: ev.note?.replace(/^Council decision:\s*/i, "") ?? null, at: iso(ev.createdAt)! } : null;
}

export async function loadMeeting(ref: string) {
  const m = await db.query.councilMeetings.findFirst({ where: eq(schema.councilMeetings.ref, ref) });
  if (!m) return null;
  const { name } = await nameMap();
  const inst = await instMap();
  const rows = await db.select().from(schema.councilItems).where(eq(schema.councilItems.meetingId, m.id)).orderBy(asc(schema.councilItems.position));
  const items = [];
  for (const it of rows) {
    const base = {
      id: it.id,
      position: it.position,
      recommendation: it.recommendation,
      draftDecision: it.draftDecision,
      decision: it.decision,
      decisionNote: it.decisionNote,
      deferUntil: it.deferUntil,
      decidedAt: iso(it.decidedAt),
      decidedBy: name(it.decidedBy),
      subject: it.subject,
      resolution: it.resolution,
      resolvedBy: name(it.resolvedBy),
      resolvedAt: iso(it.resolvedAt),
      ref: "",
      court: null as null | NonNullable<Awaited<ReturnType<typeof otherItem>>>["court"],
      letter: null as null | NonNullable<Awaited<ReturnType<typeof otherItem>>>["letter"],
    };
    if (it.applicationId) {
      const a = await db.query.applications.findFirst({ where: eq(schema.applications.id, it.applicationId) });
      if (!a) continue;
      items.push({
        ...base,
        ref: a.ref,
        kind: "case" as const,
        case: {
          ref: a.ref,
          label: caseLabel(a),
          status: a.status,
          intake: Number(a.data?.proposedIntake ?? 0) || null,
          campus: a.data?.campus ?? null,
          submittedAt: iso(a.submittedAt),
          officer: name(a.assignedOfficer),
          inst: inst(a.institutionId),
          inspection: await inspectionFor(a.id, (u) => name(u)),
        },
        appeal: null,
      });
    } else if (it.appealId) {
      const p = await db.query.appeals.findFirst({ where: eq(schema.appeals.id, it.appealId) });
      if (!p) continue;
      const a = await db.query.applications.findFirst({ where: eq(schema.applications.id, p.applicationId) });
      items.push({
        ...base,
        ref: p.ref,
        kind: "appeal" as const,
        case: null,
        appeal: {
          ref: p.ref,
          status: p.status,
          grounds: p.grounds,
          evidenceDocumentId: p.evidenceDocumentId,
          reviewNote: p.reviewNote,
          reviewedBy: name(p.reviewedBy),
          filedBy: name(p.filedBy),
          filedAt: iso(p.createdAt)!,
          letterDocumentId: p.letterDocumentId,
          inst: inst(p.institutionId),
          caseRef: a?.ref ?? "",
          caseLabel: a ? caseLabel(a) : "",
          caseStatus: a?.status ?? "",
          underAppeal: await decisionUnderAppeal(p),
        },
      });
    } else {
      const o = await otherItem(it, inst);
      if (o) items.push({ ...base, ref: o.ref, kind: o.kind, court: o.court, letter: o.letter, case: null, appeal: null });
    }
  }
  return {
    meeting: { ref: m.ref, committee: m.committee, isCouncil: m.committee === COUNCIL, title: m.title, date: m.meetingDate, status: m.status, minutesDocumentId: m.minutesDocumentId, startedAt: iso(m.startedAt), closedAt: iso(m.closedAt), createdBy: name(m.createdBy) },
    items,
  };
}

export type MeetingDetail = NonNullable<Awaited<ReturnType<typeof loadMeeting>>>;
export type AgendaItem = MeetingDetail["items"][number];

// ---------- Appeals ----------

export async function loadAppeals(institutionId?: number) {
  const rows = await db
    .select()
    .from(schema.appeals)
    .where(institutionId ? eq(schema.appeals.institutionId, institutionId) : undefined)
    .orderBy(desc(schema.appeals.createdAt));
  const inst = await instMap();
  const { name } = await nameMap();
  const apps = rows.length ? await db.select().from(schema.applications).where(inArray(schema.applications.id, rows.map((r) => r.applicationId))) : [];
  const items = rows.length
    ? await db
        .select({ appealId: schema.councilItems.appealId, ref: schema.councilMeetings.ref, date: schema.councilMeetings.meetingDate, status: schema.councilMeetings.status })
        .from(schema.councilItems)
        .innerJoin(schema.councilMeetings, eq(schema.councilMeetings.id, schema.councilItems.meetingId))
        .where(inArray(schema.councilItems.appealId, rows.map((r) => r.id)))
        .orderBy(desc(schema.councilItems.id))
    : [];
  return Promise.all(
    rows.map(async (p) => {
      const a = apps.find((x) => x.id === p.applicationId);
      const m = items.find((i) => i.appealId === p.id);
      return {
        ref: p.ref,
        status: p.status,
        grounds: p.grounds,
        filedAt: iso(p.createdAt)!,
        filedBy: name(p.filedBy),
        decidedAt: iso(p.decidedAt),
        inst: inst(p.institutionId),
        caseRef: a?.ref ?? "",
        caseLabel: a ? caseLabel(a) : "",
        underAppeal: await decisionUnderAppeal(p),
        meeting: m ? { ref: m.ref, date: m.date, status: m.status } : null,
      };
    }),
  );
}

export type AppealRow = Awaited<ReturnType<typeof loadAppeals>>[number];

export async function loadAppeal(ref: string) {
  const p = await db.query.appeals.findFirst({ where: eq(schema.appeals.ref, ref) });
  if (!p) return null;
  const inst = await instMap();
  const { name } = await nameMap();
  const a = await db.query.applications.findFirst({ where: eq(schema.applications.id, p.applicationId) });
  const evidence = p.evidenceDocumentId ? await db.query.documents.findFirst({ where: eq(schema.documents.id, p.evidenceDocumentId) }) : null;
  const letter = p.letterDocumentId ? await db.query.documents.findFirst({ where: eq(schema.documents.id, p.letterDocumentId) }) : null;
  const caseLetter = a?.letterDocumentId ? await db.query.documents.findFirst({ where: eq(schema.documents.id, a.letterDocumentId) }) : null;
  const [item] = await db
    .select({ ref: schema.councilMeetings.ref, date: schema.councilMeetings.meetingDate, status: schema.councilMeetings.status, position: schema.councilItems.position })
    .from(schema.councilItems)
    .innerJoin(schema.councilMeetings, eq(schema.councilMeetings.id, schema.councilItems.meetingId))
    .where(eq(schema.councilItems.appealId, p.id))
    .orderBy(desc(schema.councilItems.id))
    .limit(1);
  const history = await db
    .select()
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.entity, "appeal"), eq(schema.auditLog.entityId, p.ref)))
    .orderBy(asc(schema.auditLog.id));
  const under = await decisionUnderAppeal(p);
  return {
    appeal: {
      ref: p.ref,
      status: p.status,
      grounds: p.grounds,
      filedAt: iso(p.createdAt)!,
      filedBy: name(p.filedBy),
      reviewNote: p.reviewNote,
      reviewedBy: name(p.reviewedBy),
      reviewedAt: iso(p.reviewedAt),
      decidedBy: name(p.decidedBy),
      decidedAt: iso(p.decidedAt),
      decisionNote: p.decisionNote,
      evidence: evidence ? { id: evidence.id, fileName: evidence.fileName, sha256: evidence.sha256 } : null,
      letter: letter ? { id: letter.id, fileName: letter.fileName } : null,
    },
    inst: inst(p.institutionId),
    case: a
      ? {
          ref: a.ref,
          label: caseLabel(a),
          status: a.status,
          deferUntil: a.deferUntil,
          grounds: a.decisionGrounds,
          letter: caseLetter ? { id: caseLetter.id, fileName: caseLetter.fileName } : null,
        }
      : null,
    underAppeal: under,
    meeting: item ? { ref: item.ref, date: item.date, status: item.status, position: item.position } : null,
    // Filing is dated by the appeal itself; later steps come from the audit log.
    history: [
      { id: 0, action: "appeal.filed", actor: name(p.filedBy) ?? p.filedBy, at: iso(p.createdAt)! },
      ...history.filter((h) => h.action !== "appeal.filed").map((h) => ({ id: h.id, action: h.action, actor: name(h.actor) ?? h.actor, at: iso(h.ts)! })),
    ],
  };
}

export type AppealDetail = NonNullable<Awaited<ReturnType<typeof loadAppeal>>>;

/** One appeal per decision: an open appeal, or a dismissed one on the same decision, blocks a new one. Withdrawn ones do not. */
export function appealBlocks(p: { status: string; createdAt: Date }, decidedAt: Date | null) {
  if (["FILED", "UNDER_REVIEW", "ON_AGENDA"].includes(p.status)) return true;
  return p.status === "DISMISSED" && (!decidedAt || p.createdAt >= decidedAt);
}

/** Cases an institution can appeal: rejected or deferred, and not already appealed (see appealBlocks). */
export async function appealableCases(institutionId: number) {
  const apps = await db
    .select()
    .from(schema.applications)
    .where(and(eq(schema.applications.institutionId, institutionId), inArray(schema.applications.status, ["REJECTED", "DEFERRED"])))
    .orderBy(desc(schema.applications.decidedAt));
  const prior = apps.length ? await db.select().from(schema.appeals).where(inArray(schema.appeals.applicationId, apps.map((a) => a.id))) : [];
  return apps
    .filter((a) => !prior.some((p) => p.applicationId === a.id && appealBlocks(p, a.decidedAt)))
    .map((a) => ({ ref: a.ref, label: caseLabel(a), status: a.status, decidedAt: iso(a.decidedAt), note: a.decisionNote, grounds: a.decisionGrounds, deferUntil: a.deferUntil }));
}

// ---------- Help desk ----------

export async function loadTickets(filter: { source?: string[]; username?: string; institutionId?: number; ref?: string } = {}) {
  const conds: SQL[] = [];
  if (filter.ref) conds.push(eq(schema.tickets.ref, filter.ref));
  if (filter.username && filter.institutionId) {
    // An institution sees every ticket raised from its own account.
    conds.push(or(eq(schema.tickets.username, filter.username), and(eq(schema.tickets.institutionId, filter.institutionId), eq(schema.tickets.source, "INSTITUTION")))!);
  } else if (filter.username) conds.push(eq(schema.tickets.username, filter.username));
  if (filter.source?.length) conds.push(inArray(schema.tickets.source, filter.source));
  const rows = await db.select().from(schema.tickets).where(conds.length ? and(...conds) : undefined).orderBy(desc(schema.tickets.createdAt));
  const replies = rows.length ? await db.select().from(schema.ticketReplies).where(inArray(schema.ticketReplies.ticketId, rows.map((r) => r.id))).orderBy(asc(schema.ticketReplies.id)) : [];
  const inst = await instMap();
  const { name, staff } = await nameMap();
  const now = new Date();
  const isPcp = (u: string) => {
    const r = staff.find((s) => s.u === u)?.r;
    return !!r && r.startsWith("pcp_");
  };
  return rows.map((t) => {
    const mine = replies.filter((r) => r.ticketId === t.id);
    const sla = slaFor(t, now);
    return {
      ref: t.ref,
      source: t.source,
      category: t.category,
      subject: t.subject,
      body: t.body,
      contactName: t.contactName,
      contactEmail: t.contactEmail,
      contactMobile: t.contactMobile,
      raisedBy: t.username ? name(t.username) : t.contactName,
      inst: inst(t.institutionId),
      status: t.status,
      assignedTo: t.assignedTo,
      assignedName: name(t.assignedTo),
      createdAt: iso(t.createdAt)!,
      slaDueAt: iso(t.slaDueAt),
      resolvedAt: iso(t.resolvedAt),
      sla,
      replyCount: mine.filter((r) => !r.internal).length,
      noteCount: mine.filter((r) => r.internal).length,
      lastActivity: iso(mine[mine.length - 1]?.createdAt ?? t.createdAt)!,
      replies: mine.map((r) => ({ id: r.id, author: name(r.author) ?? r.author, fromPcp: isPcp(r.author), body: r.body, internal: r.internal, createdAt: iso(r.createdAt)! })),
    };
  });
}

export type TicketRow = Awaited<ReturnType<typeof loadTickets>>[number];

/** Requester view: no internal notes. */
export const publicView = (t: TicketRow): TicketRow => ({ ...t, replies: t.replies.filter((r) => !r.internal), noteCount: 0 });

export async function helpdeskStaff() {
  const staff = await db.select().from(schema.staff).where(eq(schema.staff.active, true));
  return staff.filter((s) => can([s.role], "pcp.helpdesk")).map((s) => ({ username: s.username, name: s.displayName, role: s.role }));
}
