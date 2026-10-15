// Read models for the court case, correspondence and committee screens. Everything returned is plain JSON.
import { and, asc, desc, eq, gte, inArray, isNull, like, lte, ne, notInArray, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { COUNCIL } from "./council";
import { activeStays, committeeList, courtList, pcpStaff, relatedRefs, today } from "./governance";
import { OPEN_COURT_STATUSES, courtShort, dayDiff, pkToday, refKind } from "./governance-shared";
import { can } from "./roles";
import { iso } from "./util";
import { CLOSED_STATUSES, KIND_LABELS, PROGRAM_LABELS } from "./workflow";

async function names() {
  const staff = await db.select({ u: schema.staff.username, n: schema.staff.displayName }).from(schema.staff);
  return (u: string | null | undefined) => (u ? (staff.find((s) => s.u === u)?.n ?? u) : null);
}

async function instMap() {
  const rows = await db.select().from(schema.institutions);
  return (id: number | null | undefined) => {
    const i = rows.find((r) => r.id === id);
    return i ? { id: i.id, name: i.name, code: i.code, shortCode: i.shortCode } : null;
  };
}

const addDays = (n: number) => pkToday(new Date(Date.now() + n * 86400000));

/** Documents filed in a folder (every version, newest first), wherever the owner is. */
async function folderDocs(folder: string) {
  const name = await names();
  const rows = await db
    .select()
    .from(schema.documents)
    .where(or(eq(schema.documents.folder, folder), like(schema.documents.folder, `${folder}/%`)))
    .orderBy(asc(schema.documents.docType), desc(schema.documents.version), desc(schema.documents.id));
  return rows.map((d) => ({ id: d.id, docType: d.docType, fileName: d.fileName, version: d.version, sha256: d.sha256, sizeBytes: d.sizeBytes, uploadedBy: name(d.uploadedBy), uploadedAt: iso(d.uploadedAt)!, folder: d.folder, institutionId: d.institutionId }));
}

async function history(entity: string, ref: string) {
  const name = await names();
  const rows = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.entity, entity), eq(schema.auditLog.entityId, ref))).orderBy(asc(schema.auditLog.id));
  return rows.map((h) => ({ id: h.id, action: h.action, actor: name(h.actor) ?? h.actor, at: iso(h.ts)!, details: h.details as Record<string, unknown> }));
}

/** Cases and appeals a court case or letter can be linked to (for the pickers). */
export async function linkableRefs() {
  const apps = await db
    .select({ ref: schema.applications.ref, kind: schema.applications.kind, programType: schema.applications.programType, status: schema.applications.status, institutionId: schema.applications.institutionId })
    .from(schema.applications)
    .where(ne(schema.applications.status, "DRAFT"))
    .orderBy(desc(schema.applications.ref));
  const appeals = await db.select({ ref: schema.appeals.ref, institutionId: schema.appeals.institutionId, status: schema.appeals.status }).from(schema.appeals).orderBy(desc(schema.appeals.ref));
  const courts = await db.select({ ref: schema.courtCases.ref, institutionId: schema.courtCases.institutionId, caseNumber: schema.courtCases.caseNumber, court: schema.courtCases.court }).from(schema.courtCases).orderBy(desc(schema.courtCases.ref));
  return [
    ...apps.map((a) => ({ ref: a.ref, kind: "case" as const, institutionId: a.institutionId, label: `${KIND_LABELS[a.kind] ?? a.kind} · ${PROGRAM_LABELS[a.programType] ?? a.programType} · ${a.status.toLowerCase().replace(/_/g, " ")}` })),
    ...appeals.map((p) => ({ ref: p.ref, kind: "appeal" as const, institutionId: p.institutionId, label: `Appeal · ${p.status.toLowerCase().replace(/_/g, " ")}` })),
    ...courts.map((c) => ({ ref: c.ref, kind: "court" as const, institutionId: c.institutionId, label: `${courtShort(c.court)} ${c.caseNumber}` })),
  ];
}

export async function institutionOptions() {
  const rows = await db.select().from(schema.institutions).orderBy(asc(schema.institutions.name));
  return rows.map((i) => ({ id: i.id, name: i.name, code: i.code, shortCode: i.shortCode, email: i.email }));
}

// ---------- Court cases ----------

export async function loadCourtCases() {
  const rows = await db.select().from(schema.courtCases).orderBy(desc(schema.courtCases.filedDate), desc(schema.courtCases.id));
  const ids = rows.map((r) => r.id);
  const hearings = ids.length ? await db.select().from(schema.courtHearings).where(inArray(schema.courtHearings.courtCaseId, ids)).orderBy(asc(schema.courtHearings.hearingDate)) : [];
  const stays = ids.length ? await db.select().from(schema.courtOrders).where(and(inArray(schema.courtOrders.courtCaseId, ids), eq(schema.courtOrders.kind, "STAY"), isNull(schema.courtOrders.liftedAt))) : [];
  const inst = await instMap();
  const t = today();
  const week = addDays(7);
  const year = t.slice(0, 4);
  const cases = rows.map((c) => {
    const mine = hearings.filter((h) => h.courtCaseId === c.id);
    const next = mine.find((h) => h.status === "SCHEDULED" && h.hearingDate >= t);
    const last = [...mine].reverse().find((h) => h.status === "HELD");
    const stay = stays.find((s) => s.courtCaseId === c.id);
    return {
      ref: c.ref,
      court: c.court,
      courtShort: courtShort(c.court),
      caseNumber: c.caseNumber,
      title: c.title,
      petitioner: c.petitioner,
      respondent: c.respondent,
      nature: c.nature,
      inst: inst(c.institutionId),
      linkedRef: c.linkedRef,
      counsel: c.counsel,
      filedDate: c.filedDate,
      status: c.status,
      open: OPEN_COURT_STATUSES.includes(c.status),
      nextHearing: next ? { date: next.hearingDate, bench: next.bench, purpose: next.purpose, days: dayDiff(next.hearingDate) } : null,
      lastHearing: last ? { date: last.hearingDate, outcome: last.outcome } : null,
      stay: stay ? { until: stay.stayUntil, orderDate: stay.orderDate, summary: stay.summary } : null,
      updatedAt: iso(c.updatedAt)!,
    };
  });
  const upcoming = hearings
    .filter((h) => h.status === "SCHEDULED" && h.hearingDate >= t && h.hearingDate <= addDays(14))
    .map((h) => {
      const c = cases.find((x) => x.ref === rows.find((r) => r.id === h.courtCaseId)?.ref)!;
      return { date: h.hearingDate, days: dayDiff(h.hearingDate), bench: h.bench, purpose: h.purpose, ref: c.ref, court: c.courtShort, caseNumber: c.caseNumber, title: c.title, stay: !!c.stay };
    });
  return {
    cases,
    upcoming,
    counts: {
      open: cases.filter((c) => c.open).length,
      stays: cases.filter((c) => c.stay).length,
      hearingsWeek: hearings.filter((h) => h.status === "SCHEDULED" && h.hearingDate >= t && h.hearingDate <= week).length,
      disposedYear: cases.filter((c) => !c.open && c.updatedAt.startsWith(year)).length,
    },
    courts: await courtList(),
  };
}

export type CourtCaseRow = Awaited<ReturnType<typeof loadCourtCases>>["cases"][number];

export async function loadCourtCase(ref: string) {
  const c = await db.query.courtCases.findFirst({ where: eq(schema.courtCases.ref, ref) });
  if (!c) return null;
  const name = await names();
  const inst = await instMap();
  const hearings = await db.select().from(schema.courtHearings).where(eq(schema.courtHearings.courtCaseId, c.id)).orderBy(asc(schema.courtHearings.hearingDate), asc(schema.courtHearings.id));
  const orders = await db.select().from(schema.courtOrders).where(eq(schema.courtOrders.courtCaseId, c.id)).orderBy(desc(schema.courtOrders.orderDate), desc(schema.courtOrders.id));
  let linked: { ref: string; kind: string; status: string; label: string; href: string } | null = null;
  if (c.linkedRef) {
    const k = refKind(c.linkedRef);
    if (k === "case") {
      const a = await db.query.applications.findFirst({ where: eq(schema.applications.ref, c.linkedRef) });
      if (a) linked = { ref: a.ref, kind: "case", status: a.status, label: `${KIND_LABELS[a.kind] ?? a.kind} · ${PROGRAM_LABELS[a.programType] ?? a.programType}`, href: `/pcp/applications/${a.ref}` };
    } else if (k === "appeal") {
      const p = await db.query.appeals.findFirst({ where: eq(schema.appeals.ref, c.linkedRef) });
      if (p) linked = { ref: p.ref, kind: "appeal", status: p.status, label: "Appeal", href: `/pcp/appeals/${p.ref}` };
    }
  }
  const letters = await db.select().from(schema.correspondence).where(eq(schema.correspondence.linkedRef, c.ref)).orderBy(desc(schema.correspondence.letterDate));
  const items = await db
    .select({ ref: schema.councilMeetings.ref, committee: schema.councilMeetings.committee, date: schema.councilMeetings.meetingDate, status: schema.councilMeetings.status, resolution: schema.councilItems.resolution })
    .from(schema.councilItems)
    .innerJoin(schema.councilMeetings, eq(schema.councilMeetings.id, schema.councilItems.meetingId))
    .where(eq(schema.councilItems.courtCaseId, c.id))
    .orderBy(desc(schema.councilMeetings.meetingDate));
  const reminders = await db.select().from(schema.messages).where(and(eq(schema.messages.entity, "court_case"), eq(schema.messages.entityRef, c.ref))).orderBy(desc(schema.messages.id)).limit(20);
  const t = today();
  return {
    c: {
      ref: c.ref,
      court: c.court,
      courtShort: courtShort(c.court),
      caseNumber: c.caseNumber,
      title: c.title,
      petitioner: c.petitioner,
      respondent: c.respondent,
      nature: c.nature,
      linkedRef: c.linkedRef,
      counsel: c.counsel,
      counselEmail: c.counselEmail,
      filedDate: c.filedDate,
      status: c.status,
      open: OPEN_COURT_STATUSES.includes(c.status),
      summary: c.summary,
      createdBy: name(c.createdBy),
      createdAt: iso(c.createdAt)!,
    },
    inst: inst(c.institutionId),
    linked,
    hearings: hearings.map((h) => ({ id: h.id, date: h.hearingDate, days: dayDiff(h.hearingDate), bench: h.bench, purpose: h.purpose, outcome: h.outcome, nextDate: h.nextDate, status: h.status, recordedBy: name(h.recordedBy), recordedAt: iso(h.recordedAt), past: h.hearingDate < t })),
    orders: orders.map((o) => ({ id: o.id, kind: o.kind, date: o.orderDate, summary: o.summary, stayUntil: o.stayUntil, active: o.kind === "STAY" && !o.liftedAt, liftedAt: iso(o.liftedAt), liftedBy: name(o.liftedBy), liftNote: o.liftNote, documentId: o.documentId, by: name(o.createdBy) })),
    documents: await folderDocs(`court-cases/${c.ref}`),
    letters: letters.map((l) => ({ ref: l.ref, direction: l.direction, party: l.party, subject: l.subject, date: l.letterDate, status: l.status, dispatchedAt: iso(l.dispatchedAt) })),
    meetings: items.map((i) => ({ ...i })),
    reminders: reminders.map((m) => ({ id: m.id, to: m.toName ?? m.toAddress, subject: m.subject, at: iso(m.createdAt)! })),
    history: await history("court_case", c.ref),
  };
}

export type CourtCaseDetail = NonNullable<Awaited<ReturnType<typeof loadCourtCase>>>;

// ---------- Correspondence ----------

export async function loadCorrespondence(username: string) {
  const rows = await db.select().from(schema.correspondence).orderBy(desc(schema.correspondence.letterDate), desc(schema.correspondence.id));
  const name = await names();
  const inst = await instMap();
  const t = today();
  const monthStart = `${t.slice(0, 7)}-01`;
  const letters = rows.map((l) => ({
    ref: l.ref,
    direction: l.direction as "IN" | "OUT",
    date: l.letterDate,
    receivedAt: iso(l.createdAt)!,
    party: l.party,
    partyInst: inst(l.partyInstitutionId),
    inst: inst(l.institutionId),
    subject: l.subject,
    mode: l.mode,
    linkedRef: l.linkedRef,
    markedTo: l.markedTo,
    markedToName: name(l.markedTo),
    actionDue: l.actionDue,
    overdue: l.direction === "IN" && l.status === "OPEN" && !!l.actionDue && l.actionDue < t,
    status: l.status,
    documentId: l.documentId,
    dispatchedAt: iso(l.dispatchedAt),
  }));
  return {
    letters,
    counts: {
      openIn: letters.filter((l) => l.direction === "IN" && l.status === "OPEN").length,
      mine: letters.filter((l) => l.direction === "IN" && l.status === "OPEN" && l.markedTo === username).length,
      overdue: letters.filter((l) => l.overdue).length,
      dispatchedMonth: letters.filter((l) => l.direction === "OUT" && l.dispatchedAt && l.dispatchedAt.slice(0, 10) >= monthStart).length,
      drafts: letters.filter((l) => l.direction === "OUT" && !l.dispatchedAt && l.status !== "CLOSED").length,
    },
  };
}

export type LetterRow = Awaited<ReturnType<typeof loadCorrespondence>>["letters"][number];

export async function loadLetter(ref: string) {
  const l = await db.query.correspondence.findFirst({ where: eq(schema.correspondence.ref, ref) });
  if (!l) return null;
  const name = await names();
  const inst = await instMap();
  const original = l.inReplyTo ? await db.query.correspondence.findFirst({ where: eq(schema.correspondence.id, l.inReplyTo) }) : null;
  const replies = await db.select().from(schema.correspondence).where(eq(schema.correspondence.inReplyTo, l.id)).orderBy(asc(schema.correspondence.id));
  // Dispatch emails are filed on the linked case when there is one; the subject always names the letter.
  const messages = await db
    .select()
    .from(schema.messages)
    .where(or(and(eq(schema.messages.entity, "correspondence"), eq(schema.messages.entityRef, l.ref)), like(schema.messages.subject, `%${l.ref}%`)))
    .orderBy(desc(schema.messages.id))
    .limit(30);
  const linked = l.linkedRef ? { ref: l.linkedRef, kind: refKind(l.linkedRef) } : null;
  return {
    l: {
      ref: l.ref,
      direction: l.direction as "IN" | "OUT",
      date: l.letterDate,
      party: l.party,
      partyEmail: l.partyEmail,
      partyInst: inst(l.partyInstitutionId),
      inst: inst(l.institutionId),
      subject: l.subject,
      body: l.body,
      mode: l.mode,
      linkedRef: l.linkedRef,
      markedTo: l.markedTo,
      markedToName: name(l.markedTo),
      actionDue: l.actionDue,
      overdue: l.direction === "IN" && l.status === "OPEN" && !!l.actionDue && l.actionDue < today(),
      status: l.status,
      actionNote: l.actionNote,
      documentId: l.documentId,
      dispatchedAt: iso(l.dispatchedAt),
      dispatchedBy: name(l.dispatchedBy),
      createdBy: name(l.createdBy),
      createdAt: iso(l.createdAt)!,
    },
    linked,
    original: original ? { ref: original.ref, subject: original.subject, party: original.party, date: original.letterDate } : null,
    replies: replies.map((r) => ({ ref: r.ref, subject: r.subject, date: r.letterDate, dispatchedAt: iso(r.dispatchedAt) })),
    documents: await folderDocs(`correspondence/${l.direction === "IN" ? "inward" : "outward"}/${l.ref}`),
    messages: messages.map((m) => ({ id: m.id, to: m.toName ?? m.toAddress, address: m.toAddress, subject: m.subject, at: iso(m.createdAt)! })),
    history: await history("correspondence", l.ref),
  };
}

export type LetterDetail = NonNullable<Awaited<ReturnType<typeof loadLetter>>>;

/** Options for the register forms: institutions, officers, linkable references and open inward letters. */
export async function correspondenceOptions() {
  const open = await db.select().from(schema.correspondence).where(and(eq(schema.correspondence.direction, "IN"), ne(schema.correspondence.status, "CLOSED"))).orderBy(desc(schema.correspondence.id));
  return {
    institutions: await institutionOptions(),
    staff: await pcpStaff(),
    refs: await linkableRefs(),
    openInward: open.map((l) => ({ id: l.id, ref: l.ref, subject: l.subject, party: l.party, partyInstitutionId: l.partyInstitutionId, partyEmail: l.partyEmail, linkedRef: l.linkedRef })),
  };
}

export type CorrespondenceOptions = Awaited<ReturnType<typeof correspondenceOptions>>;

// ---------- Committees ----------

/** Options for adding an agenda item: open cases, appeals, court cases and letters, plus officers for action points. */
export async function agendaOptions() {
  const apps = await db
    .select({ id: schema.applications.id, ref: schema.applications.ref, kind: schema.applications.kind, programType: schema.applications.programType, status: schema.applications.status, inst: schema.institutions.shortCode })
    .from(schema.applications)
    .innerJoin(schema.institutions, eq(schema.institutions.id, schema.applications.institutionId))
    .where(notInArray(schema.applications.status, ["DRAFT", ...CLOSED_STATUSES]))
    .orderBy(desc(schema.applications.ref));
  const appeals = await db
    .select({ id: schema.appeals.id, ref: schema.appeals.ref, status: schema.appeals.status, inst: schema.institutions.shortCode })
    .from(schema.appeals)
    .innerJoin(schema.institutions, eq(schema.institutions.id, schema.appeals.institutionId))
    .where(inArray(schema.appeals.status, ["FILED", "UNDER_REVIEW", "ON_AGENDA"]))
    .orderBy(desc(schema.appeals.ref));
  const courts = await db.select().from(schema.courtCases).where(inArray(schema.courtCases.status, OPEN_COURT_STATUSES)).orderBy(desc(schema.courtCases.ref));
  const letters = await db.select().from(schema.correspondence).where(ne(schema.correspondence.status, "CLOSED")).orderBy(desc(schema.correspondence.id)).limit(60);
  return {
    sources: {
      case: apps.map((a) => ({ id: a.id, ref: a.ref, label: `${a.inst} · ${KIND_LABELS[a.kind] ?? a.kind} ${PROGRAM_LABELS[a.programType] ?? a.programType} · ${a.status.toLowerCase().replace(/_/g, " ")}` })),
      appeal: appeals.map((p) => ({ id: p.id, ref: p.ref, label: `${p.inst} · appeal · ${p.status.toLowerCase().replace(/_/g, " ")}` })),
      court: courts.map((c) => ({ id: c.id, ref: c.ref, label: `${courtShort(c.court)} ${c.caseNumber} · ${c.title}` })),
      letter: letters.map((l) => ({ id: l.id, ref: l.ref, label: `${l.direction === "IN" ? "From" : "To"} ${l.party} · ${l.subject}` })),
    },
    staff: await pcpStaff(),
  };
}

export type AgendaOptions = Awaited<ReturnType<typeof agendaOptions>>;

/** Action points of one meeting. */
export async function meetingActions(meetingId: number) {
  const name = await names();
  const rows = await db.select().from(schema.committeeActions).where(eq(schema.committeeActions.meetingId, meetingId)).orderBy(asc(schema.committeeActions.id));
  return rows.map((a) => ({ id: a.id, itemId: a.itemId, title: a.title, owner: a.owner, ownerName: name(a.owner) ?? a.owner, dueDate: a.dueDate, days: dayDiff(a.dueDate), status: a.status, note: a.note, doneAt: iso(a.doneAt) }));
}

/** Open action points across meetings (the meetings screen). */
export async function openActions() {
  const name = await names();
  const rows = await db
    .select({ a: schema.committeeActions, m: schema.councilMeetings })
    .from(schema.committeeActions)
    .innerJoin(schema.councilMeetings, eq(schema.councilMeetings.id, schema.committeeActions.meetingId))
    .where(ne(schema.committeeActions.status, "DONE"))
    .orderBy(asc(schema.committeeActions.dueDate));
  return rows.map(({ a, m }) => ({ id: a.id, title: a.title, owner: name(a.owner) ?? a.owner, dueDate: a.dueDate, days: dayDiff(a.dueDate), status: a.status, meetingRef: m.ref, committee: m.committee }));
}

export async function committeesWithNames() {
  const name = await names();
  return (await committeeList()).map((c) => ({ ...c, chairName: name(c.chair), memberNames: c.members.map((m) => name(m) ?? m) }));
}

// ---------- On a case or appeal screen ----------

/** Stay orders, court cases, letters and committee items linked to a case or an appeal. */
export async function governanceFor(ref: string) {
  const refs = await relatedRefs(db, [ref]);
  const stays = await activeStays(db, [ref]);
  const t = today();
  const courts = await db.select().from(schema.courtCases).where(inArray(schema.courtCases.linkedRef, refs)).orderBy(desc(schema.courtCases.filedDate));
  const hearings = courts.length ? await db.select().from(schema.courtHearings).where(and(inArray(schema.courtHearings.courtCaseId, courts.map((c) => c.id)), eq(schema.courtHearings.status, "SCHEDULED"), gte(schema.courtHearings.hearingDate, t))).orderBy(asc(schema.courtHearings.hearingDate)) : [];
  const letters = await db.select().from(schema.correspondence).where(inArray(schema.correspondence.linkedRef, refs)).orderBy(desc(schema.correspondence.letterDate), desc(schema.correspondence.id));
  const app = refKind(ref) === "case" ? await db.query.applications.findFirst({ where: eq(schema.applications.ref, ref) }) : null;
  const appeal = refKind(ref) === "appeal" ? await db.query.appeals.findFirst({ where: eq(schema.appeals.ref, ref) }) : null;
  const items =
    app || appeal
      ? await db
          .select({ ref: schema.councilMeetings.ref, committee: schema.councilMeetings.committee, date: schema.councilMeetings.meetingDate, status: schema.councilMeetings.status, resolution: schema.councilItems.resolution })
          .from(schema.councilItems)
          .innerJoin(schema.councilMeetings, eq(schema.councilMeetings.id, schema.councilItems.meetingId))
          .where(and(ne(schema.councilMeetings.committee, COUNCIL), app ? eq(schema.councilItems.applicationId, app.id) : eq(schema.councilItems.appealId, appeal!.id)))
          .orderBy(desc(schema.councilMeetings.meetingDate))
      : [];
  return {
    stays: stays.map((s) => ({ ...s })),
    courts: courts.map((c) => {
      const next = hearings.find((h) => h.courtCaseId === c.id);
      return { ref: c.ref, court: courtShort(c.court), caseNumber: c.caseNumber, status: c.status, nextHearing: next?.hearingDate ?? null };
    }),
    letters: letters.map((l) => ({ ref: l.ref, direction: l.direction, party: l.party, subject: l.subject, date: l.letterDate, status: l.status, dispatchedAt: iso(l.dispatchedAt) })),
    committees: items,
  };
}

export type GovernanceForCase = Awaited<ReturnType<typeof governanceFor>>;

// ---------- Work list (dashboard) ----------

export async function loadGovernanceWork(user: { username: string; roles: string[] }) {
  const t = today();
  const letters = await db
    .select()
    .from(schema.correspondence)
    .where(and(eq(schema.correspondence.direction, "IN"), eq(schema.correspondence.status, "OPEN"), eq(schema.correspondence.markedTo, user.username)))
    .orderBy(asc(schema.correspondence.actionDue));
  const tasks = await db
    .select({ a: schema.committeeActions, m: schema.councilMeetings })
    .from(schema.committeeActions)
    .innerJoin(schema.councilMeetings, eq(schema.councilMeetings.id, schema.committeeActions.meetingId))
    .where(and(eq(schema.committeeActions.owner, user.username), ne(schema.committeeActions.status, "DONE")))
    .orderBy(asc(schema.committeeActions.dueDate));
  let legal: { hearings: { ref: string; court: string; caseNumber: string; title: string; date: string; days: number; stay: boolean }[]; hearingsWeek: number; stays: number; stayRefs: { ref: string; linkedRef: string | null; until: string | null }[] } | null = null;
  if (can(user.roles, "pcp.litigation.view")) {
    const week = addDays(7);
    const hs = await db
      .select({ h: schema.courtHearings, c: schema.courtCases })
      .from(schema.courtHearings)
      .innerJoin(schema.courtCases, eq(schema.courtCases.id, schema.courtHearings.courtCaseId))
      .where(and(eq(schema.courtHearings.status, "SCHEDULED"), gte(schema.courtHearings.hearingDate, t), lte(schema.courtHearings.hearingDate, week)))
      .orderBy(asc(schema.courtHearings.hearingDate));
    const stays = await db
      .select({ o: schema.courtOrders, c: schema.courtCases })
      .from(schema.courtOrders)
      .innerJoin(schema.courtCases, eq(schema.courtCases.id, schema.courtOrders.courtCaseId))
      .where(and(eq(schema.courtOrders.kind, "STAY"), isNull(schema.courtOrders.liftedAt)));
    const stayCases = new Set(stays.map((s) => s.c.id));
    legal = {
      hearings: hs.map(({ h, c }) => ({ ref: c.ref, court: courtShort(c.court), caseNumber: c.caseNumber, title: c.title, date: h.hearingDate, days: dayDiff(h.hearingDate), stay: stayCases.has(c.id) })),
      hearingsWeek: hs.length,
      stays: stayCases.size,
      stayRefs: [...new Map(stays.map((s) => [s.c.id, { ref: s.c.ref, linkedRef: s.c.linkedRef, until: s.o.stayUntil }])).values()],
    };
  }
  return {
    letters: letters.map((l) => ({ ref: l.ref, party: l.party, subject: l.subject, actionDue: l.actionDue, overdue: !!l.actionDue && l.actionDue < t })),
    tasks: tasks.map(({ a, m }) => ({ id: a.id, title: a.title, dueDate: a.dueDate, days: dayDiff(a.dueDate), status: a.status, meetingRef: m.ref, committee: m.committee })),
    legal,
  };
}

export type GovernanceWork = Awaited<ReturnType<typeof loadGovernanceWork>>;

