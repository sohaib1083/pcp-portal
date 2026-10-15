// Governance module (RFP Oct 2026): court cases, the correspondence register and committee action points.
// Shared server helpers. No Next.js imports here, so the seed and the scheduler can use the same code.
import { and, asc, desc, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "./audit";
import { fileDocument, publicUrl, renderLetter } from "./letters";
import { sendEmail } from "./messages";
import { ROLE_LABELS, can } from "./roles";
import { notify } from "./util";
import { DEFAULT_COMMITTEES, DEFAULT_COURTS, OPEN_COURT_STATUSES, courtShort, dayDiff, pkToday, refKind, type Committee } from "./governance-shared";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | Tx;

/** Today in Pakistan, so a date picked on an office computer late in the evening is not "in the future". */
export const today = () => pkToday();

/** "12 Nov 2026" */
export const shortDay = (d: string | Date | null | undefined) =>
  d ? new Date(typeof d === "string" && d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";

// ---------- References ----------

/** Next LIT-2026-0001, IN-2026-00001 or OUT-2026-00001 (highest number + 1; serialised inside a transaction). */
export async function nextGovRef(exec: Executor, table: "court_cases" | "correspondence", prefix: string, pad: number, year = new Date().getFullYear()) {
  if (exec !== db) await exec.execute(sql`select pg_advisory_xact_lock(hashtext(${`ref:${table}:${prefix}`}))`);
  const like = `${prefix}-${year}-%`;
  const res = await exec.execute(sql`select coalesce(max(nullif(regexp_replace(ref, '^.*-', ''), '')::int), 0) as n from ${sql.identifier(table)} where ref like ${like}`);
  const n = Number((res.rows[0] as { n: number }).n) + 1;
  return `${prefix}-${year}-${String(n).padStart(pad, "0")}`;
}

// ---------- Reference rules ----------

async function latestRule(exec: Executor, key: string) {
  const row = await exec.query.rules.findFirst({ where: eq(schema.rules.key, key), orderBy: desc(schema.rules.version) });
  return row?.value;
}

/** Courts from the ref.courts rule (a reference list the Super Administrator keeps). */
export async function courtList(exec: Executor = db): Promise<string[]> {
  const v = await latestRule(exec, "ref.courts");
  return Array.isArray(v) && v.length ? v.map(String) : DEFAULT_COURTS;
}

/** Committees and their members from the ref.committees rule. The Council is always first. */
export async function committeeList(exec: Executor = db): Promise<Committee[]> {
  const v = await latestRule(exec, "ref.committees");
  const rows = Array.isArray(v) ? v : [];
  const clean = rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && typeof (r as { name?: unknown }).name === "string")
    .map((r) => ({
      name: String(r.name).trim(),
      prefix: String(r.prefix ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4) || "CMT",
      chair: typeof r.chair === "string" ? r.chair : null,
      members: Array.isArray(r.members) ? r.members.map(String) : [],
      remit: typeof r.remit === "string" ? r.remit : "",
      decides: String(r.name).trim() === "Council",
    }))
    .filter((c) => c.name);
  const list = clean.length ? clean : DEFAULT_COMMITTEES;
  const council = list.find((c) => c.name === "Council") ?? DEFAULT_COMMITTEES[0];
  return [{ ...council, prefix: "CM", decides: true }, ...list.filter((c) => c.name !== "Council")];
}

// ---------- Links to cases, appeals, court cases and letters ----------

export type LinkTarget = { kind: "case" | "appeal" | "court" | "letter"; ref: string; institutionId: number | null; applicationId: number | null; label: string };

/** What a reference points at, with its institution and (for a case or appeal) the case behind it. */
export async function resolveLink(exec: Executor, ref: string | null | undefined): Promise<LinkTarget | null> {
  if (!ref) return null;
  const kind = refKind(ref);
  if (kind === "case") {
    const a = await exec.query.applications.findFirst({ where: eq(schema.applications.ref, ref) });
    return a ? { kind, ref, institutionId: a.institutionId, applicationId: a.id, label: `${a.kind === "NOC" ? "NOC" : a.kind === "RENEWAL" ? "Renewal" : a.kind === "ACCREDITATION" ? "Accreditation" : a.kind} case` } : null;
  }
  if (kind === "appeal") {
    const p = await exec.query.appeals.findFirst({ where: eq(schema.appeals.ref, ref) });
    return p ? { kind, ref, institutionId: p.institutionId, applicationId: p.applicationId, label: "Appeal" } : null;
  }
  if (kind === "court") {
    const c = await exec.query.courtCases.findFirst({ where: eq(schema.courtCases.ref, ref) });
    return c ? { kind, ref, institutionId: c.institutionId, applicationId: null, label: `${courtShort(c.court)} ${c.caseNumber}` } : null;
  }
  if (kind === "letter") {
    const l = await exec.query.correspondence.findFirst({ where: eq(schema.correspondence.ref, ref) });
    return l ? { kind, ref, institutionId: l.institutionId, applicationId: null, label: l.subject } : null;
  }
  return null;
}

/**
 * The references a stay can be linked to for a case or an appeal: the case itself and its appeals,
 * or the appeal and the case under appeal. A court stays the matter, whichever reference it was filed against.
 */
export async function relatedRefs(exec: Executor, refs: string[]) {
  const out = new Set(refs.filter(Boolean));
  for (const ref of refs) {
    const k = refKind(ref);
    if (k === "case") {
      const a = await exec.query.applications.findFirst({ where: eq(schema.applications.ref, ref) });
      if (a) for (const p of await exec.select({ ref: schema.appeals.ref }).from(schema.appeals).where(eq(schema.appeals.applicationId, a.id))) out.add(p.ref);
    } else if (k === "appeal") {
      const p = await exec.query.appeals.findFirst({ where: eq(schema.appeals.ref, ref) });
      const a = p ? await exec.query.applications.findFirst({ where: eq(schema.applications.id, p.applicationId) }) : null;
      if (a) out.add(a.ref);
    }
  }
  return [...out];
}

// ---------- Stay orders ----------

export type ActiveStay = { orderId: number; courtRef: string; court: string; courtShort: string; caseNumber: string; linkedRef: string; orderDate: string; until: string | null; summary: string };

/** Stay orders in force (recorded and not lifted) on these references or the matters behind them. */
export async function activeStays(exec: Executor, refs: string[]): Promise<ActiveStay[]> {
  const all = await relatedRefs(exec, refs);
  if (!all.length) return [];
  const rows = await exec
    .select({ o: schema.courtOrders, c: schema.courtCases })
    .from(schema.courtOrders)
    .innerJoin(schema.courtCases, eq(schema.courtCases.id, schema.courtOrders.courtCaseId))
    .where(and(eq(schema.courtOrders.kind, "STAY"), isNull(schema.courtOrders.liftedAt), inArray(schema.courtCases.linkedRef, all)))
    .orderBy(desc(schema.courtOrders.orderDate));
  return rows.map(({ o, c }) => ({ orderId: o.id, courtRef: c.ref, court: c.court, courtShort: courtShort(c.court), caseNumber: c.caseNumber, linkedRef: c.linkedRef ?? "", orderDate: o.orderDate, until: o.stayUntil, summary: o.summary }));
}

/** "Stay order by IHC in WP 1234/2026: no further action until 12 Nov 2026" */
export const stayText = (s: Pick<ActiveStay, "courtShort" | "caseNumber" | "until">) => `Stay order by ${s.courtShort} in ${s.caseNumber}: no further action until ${s.until ? shortDay(s.until) : "further orders"}`;

/**
 * Refuse a council decision while a court's stay order is in force on the case (or on its appeal).
 * Called by recordDecision (case decisions), the council's appeal decisions and certificate issue.
 */
export async function assertNoStayOrder(...refs: string[]) {
  const [s] = await activeStays(db, refs);
  if (s) throw new Error(`${stayText(s)}. The decision on ${refs[0]} cannot be recorded while the stay is in force. When the court vacates it, the legal officer lifts the stay on ${s.courtRef}.`);
}

// ---------- Documents ----------

/** Court papers (petition, comments, orders) are PCP's own litigation file: PCP-level, versioned per document type. */
export async function fileCourtDocument(exec: Executor, o: { ref: string; docType: string; fileName: string; bytes: Buffer; mimeType?: string; uploadedBy: string }) {
  return fileDocument(exec, { folder: `court-cases/${o.ref}`, docType: o.docType, fileName: o.fileName, bytes: o.bytes, mimeType: o.mimeType, uploadedBy: o.uploadedBy });
}

/**
 * A scanned or generated letter. A letter to or from an institution goes into that institution's
 * Correspondence folder (and onto its case, when linked); any other letter is a PCP-level paper.
 */
export async function fileLetterDocument(exec: Executor, letter: typeof schema.correspondence.$inferSelect, o: { docType: string; fileName: string; bytes: Buffer; mimeType?: string; uploadedBy: string }) {
  const folder = `correspondence/${letter.direction === "IN" ? "inward" : "outward"}/${letter.ref}`;
  const instId = letter.partyInstitutionId;
  let applicationId: number | null = null;
  if (instId && letter.linkedRef) {
    const t = await resolveLink(exec, letter.linkedRef);
    if (t?.applicationId && t.institutionId === instId) applicationId = t.applicationId;
  }
  return fileDocument(exec, { institutionId: instId ?? null, folder, docType: o.docType, fileName: o.fileName, bytes: o.bytes, mimeType: o.mimeType, applicationId, uploadedBy: o.uploadedBy });
}

/** An outward letter on the standard PCP letterhead, with the QR code and signature block. */
export async function renderOutwardLetter(exec: Executor, letter: typeof schema.correspondence.$inferSelect, by: { name: string; role: string }) {
  const inst = letter.partyInstitutionId ? await exec.query.institutions.findFirst({ where: eq(schema.institutions.id, letter.partyInstitutionId) }) : null;
  const reply = letter.inReplyTo ? await exec.query.correspondence.findFirst({ where: eq(schema.correspondence.id, letter.inReplyTo) }) : null;
  const table: [string, string][] = [["Our reference", letter.ref]];
  if (reply) table.push(["In reply to", `${reply.ref}, your letter of ${shortDay(reply.letterDate)}`]);
  if (letter.linkedRef) table.push(["Regarding", letter.linkedRef]);
  table.push(["Sent by", `${letter.mode === "EMAIL" ? "Email" : letter.mode === "COURIER" ? "Courier" : letter.mode === "HAND" ? "By hand" : "Post"}${inst?.email ? `, copy by email to ${inst.email}` : letter.partyEmail ? `, copy by email to ${letter.partyEmail}` : ""}`]);
  const linked = letter.linkedRef && refKind(letter.linkedRef) === "case" && inst ? `/institution/applications/${letter.linkedRef}` : null;
  return renderLetter({
    kind: "Official letter",
    refNo: letter.ref,
    date: new Date(`${letter.letterDate}T09:00:00Z`),
    to: { name: letter.party, lines: inst ? [`${inst.city}, ${inst.province}`, inst.code] : letter.partyEmail ? [letter.partyEmail] : [] },
    subject: letter.subject,
    paragraphs: (letter.body ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
    table,
    signatory: { name: by.name, title: by.role === "pcp_secretary" ? "Secretary, Pharmacy Council of Pakistan" : `${ROLE_LABELS[by.role] ?? "Officer"}, for the Secretary, PCP` },
    ...(linked ? { qrUrl: publicUrl(linked), qrCaption: "Opens the case in the institution portal" } : {}),
  });
}

// ---------- Reminders (run by the daily scheduler; idempotent) ----------

/** Claim a reminder key; true only the first time, so each reminder is sent once. */
async function claim(tx: Executor, key: string) {
  const [r] = await tx.insert(schema.governanceNotices).values({ key }).onConflictDoNothing().returning();
  return !!r;
}

const inDays = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);

/** The 7-day and 1-day reminders for one hearing, to the legal officer (in-app and email) and to counsel (email). */
export async function hearingReminder(exec: Executor, hearingId: number, now = new Date()) {
  const h = await exec.query.courtHearings.findFirst({ where: eq(schema.courtHearings.id, hearingId) });
  if (!h || h.status !== "SCHEDULED") return 0;
  const c = await exec.query.courtCases.findFirst({ where: eq(schema.courtCases.id, h.courtCaseId) });
  if (!c || !OPEN_COURT_STATUSES.includes(c.status)) return 0;
  const days = dayDiff(h.hearingDate, now);
  if (days < 0 || days > 7) return 0;
  const key = `hearing:${h.id}:${days <= 1 ? 1 : 7}`;
  if (!(await claim(exec, key))) return 0;
  const title = `Hearing ${inDays(days)}: ${courtShort(c.court)} ${c.caseNumber}`;
  const body = `${c.title} (${c.ref}) is fixed before ${c.court}${h.bench ? `, ${h.bench}` : ""} on ${shortDay(h.hearingDate)}${h.purpose ? ` for ${h.purpose.toLowerCase()}` : ""}. Counsel: ${c.counsel}.`;
  await notify(exec, "role:pcp_legal", title, body, `/pcp/litigation/${c.ref}`);
  if (c.counselEmail) await sendEmail(exec, { to: c.counselEmail, toName: c.counsel, subject: title, body: `${body}\n\nPlease confirm your appearance to the PCP legal officer.`, entity: "court_case", entityRef: c.ref, link: `/pcp/litigation/${c.ref}` });
  await audit(exec, { actor: "system", action: "litigation.hearing.reminder", entity: "court_case", entityId: c.ref, details: { hearing: h.hearingDate, daysBefore: days <= 1 ? 1 : 7, counsel: c.counselEmail ?? null } });
  return 1;
}

/** Hearing reminders, action points due or overdue, and inward letters past their action date. */
export async function runGovernanceReminders(now = new Date()) {
  const horizon = pkToday(new Date(now.getTime() + 8 * 86400000));
  const hearings = await db.select({ id: schema.courtHearings.id }).from(schema.courtHearings).where(and(eq(schema.courtHearings.status, "SCHEDULED"), lte(schema.courtHearings.hearingDate, horizon)));
  let sent = 0;
  for (const h of hearings) sent += await db.transaction((tx) => hearingReminder(tx, h.id, now));

  // Action points: two days before the due date, then once when overdue.
  const tasks = await db
    .select({ t: schema.committeeActions, m: schema.councilMeetings })
    .from(schema.committeeActions)
    .innerJoin(schema.councilMeetings, eq(schema.councilMeetings.id, schema.committeeActions.meetingId))
    .where(ne(schema.committeeActions.status, "DONE"));
  for (const { t, m } of tasks) {
    const days = dayDiff(t.dueDate, now);
    if (days > 2) continue;
    const overdue = days < 0;
    sent += await db.transaction(async (tx) => {
      if (!(await claim(tx, `task:${t.id}:${overdue ? "overdue" : "due"}`))) return 0;
      await notify(
        tx,
        `user:${t.owner}`,
        overdue ? `Action point overdue: ${t.title.slice(0, 70)}` : `Action point due ${inDays(days)}`,
        overdue ? `From ${m.committee} meeting ${m.ref}: "${t.title}" was due on ${shortDay(t.dueDate)}. Update its status when it is done.` : `From ${m.committee} meeting ${m.ref}: "${t.title}" is due on ${shortDay(t.dueDate)}.`,
        `/pcp/council/${m.ref}#actions`,
      );
      await audit(tx, { actor: "system", action: overdue ? "committee.action.overdue" : "committee.action.reminder", entity: "council_meeting", entityId: m.ref, details: { action: t.id, owner: t.owner, due: t.dueDate } });
      return 1;
    });
  }

  // Inward letters still open after their action date: one reminder to the officer they are marked to.
  const letters = await db
    .select()
    .from(schema.correspondence)
    .where(and(eq(schema.correspondence.direction, "IN"), eq(schema.correspondence.status, "OPEN"), sql`${schema.correspondence.markedTo} is not null`, sql`${schema.correspondence.actionDue} < ${today()}`));
  for (const l of letters) {
    sent += await db.transaction(async (tx) => {
      if (!(await claim(tx, `letter:${l.id}:overdue`))) return 0;
      await notify(tx, `user:${l.markedTo}`, `Letter ${l.ref} is past its action date`, `"${l.subject}" from ${l.party} was due for action on ${shortDay(l.actionDue)}. Record what was done, or reply.`, `/pcp/correspondence/${l.ref}`);
      await audit(tx, { actor: "system", action: "correspondence.reminder", entity: "correspondence", entityId: l.ref, details: { to: l.markedTo, due: l.actionDue } });
      return 1;
    });
  }
  return { sent };
}

// ---------- Small read helpers ----------

/** Staff who can own an action point or receive a letter: active PCP desk users (they have a work list). */
export async function pcpStaff(exec: Executor = db) {
  const rows = await exec.select().from(schema.staff).where(eq(schema.staff.active, true)).orderBy(asc(schema.staff.displayName));
  return rows.filter((s) => can([s.role], "pcp.dashboard")).map((s) => ({ username: s.username, name: s.displayName, role: s.role, roleLabel: ROLE_LABELS[s.role] ?? s.role }));
}
