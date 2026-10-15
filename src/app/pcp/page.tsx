import { and, desc, eq, gte, inArray, isNotNull, lt, lte, ne, notInArray, sql } from "drizzle-orm";
import ExecutiveDashboard, { type WorkItem } from "@/components/ExecutiveDashboard";
import GovernanceWork from "@/components/GovernanceWork";
import { db, schema } from "@/db";
import { accessReviewTask } from "@/lib/access-review";
import { loadGovernanceWork } from "@/lib/governance-data";
import { runJobsIfStale } from "@/lib/scheduler";
import { requirePermission } from "@/lib/session";
import { iso } from "@/lib/util";
import { CLOSED_STATUSES, OPEN_STATUSES, PG_TYPES, holderLabel, needsAction } from "@/lib/workflow";

const count = (rows: { n: number }[]) => rows[0]?.n ?? 0;

export const metadata = { title: "Executive dashboard" };

export default async function PcpDashboard() {
  const user = await requirePermission("pcp.dashboard");
  // Renewal alerts and service-level reminders: cheap and idempotent, at most every few minutes.
  await runJobsIfStale();
  const n = sql<number>`count(*)::int`;
  const now = new Date();
  const in90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const monthStart = `${now.toISOString().slice(0, 7)}-01`;
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  const notClosed = notInArray(schema.applications.status, ["DRAFT", ...CLOSED_STATUSES]);

  const kpis = {
    institutions: count(await db.select({ n }).from(schema.institutions)),
    pharmd: count(await db.select({ n }).from(schema.programs).where(and(eq(schema.programs.type, "PHARMD"), eq(schema.programs.nocStatus, "APPROVED")))),
    tech: count(await db.select({ n }).from(schema.programs).where(and(eq(schema.programs.type, "TECH"), eq(schema.programs.nocStatus, "APPROVED")))),
    // Postgraduate programmes are accredited per field; the HEC issues their NOC (RFP 4.1.10).
    mphil: count(await db.select({ n }).from(schema.programs).where(and(eq(schema.programs.type, "MPHIL"), eq(schema.programs.accreditationStatus, "VALID")))),
    phd: count(await db.select({ n }).from(schema.programs).where(and(eq(schema.programs.type, "PHD"), eq(schema.programs.accreditationStatus, "VALID")))),
    pharmacists: count(await db.select({ n }).from(schema.pharmacists)),
    pendingNoc: count(await db.select({ n }).from(schema.applications).where(and(eq(schema.applications.kind, "NOC"), notClosed))),
    pendingAcc: count(await db.select({ n }).from(schema.applications).where(and(inArray(schema.applications.kind, ["ACCREDITATION", "RENEWAL"]), notClosed))),
    renewals90: count(await db.select({ n }).from(schema.programs).where(and(isNotNull(schema.programs.accreditationValidUntil), lte(schema.programs.accreditationValidUntil, in90)))),
    inspectionsMonth: count(await db.select({ n }).from(schema.inspections).where(and(gte(schema.inspections.scheduledFor, monthStart), lt(schema.inspections.scheduledFor, nextMonth)))),
    pendingInspections: count(await db.select({ n }).from(schema.inspections).where(eq(schema.inspections.status, "SCHEDULED"))),
    deficiencies: count(await db.select({ n }).from(schema.deficiencies).where(inArray(schema.deficiencies.status, ["OUTSTANDING", "REJECTED"]))),
    awaitingDecision: count(await db.select({ n }).from(schema.applications).where(eq(schema.applications.status, "COUNCIL_REVIEW"))),
    overdue: count(await db.select({ n }).from(schema.applications).where(and(inArray(schema.applications.status, OPEN_STATUSES), lt(schema.applications.stageDueAt, now)))),
    escalated: count(await db.select({ n }).from(schema.applications).where(and(inArray(schema.applications.status, OPEN_STATUSES), isNotNull(schema.applications.escalatedAt)))),
    faculty: count(await db.select({ n }).from(schema.facultyLinks).where(eq(schema.facultyLinks.status, "ACTIVE"))),
    students: count(await db.select({ n }).from(schema.students).where(notInArray(schema.students.status, ["GRADUATED", "WITHDRAWN"]))),
    duplicates: count(await db.select({ n }).from(schema.duplicateFlags).where(eq(schema.duplicateFlags.status, "OPEN"))),
    pharmacistsActive: count(await db.select({ n }).from(schema.pharmacists).where(eq(schema.pharmacists.status, "ACTIVE"))),
  };
  Object.assign(kpis, { pg: kpis.mphil + kpis.phd });

  // ---------- My work: what is due, what is blocked or overdue, what was decided ----------
  const open = await db
    .select({
      id: schema.applications.id,
      ref: schema.applications.ref,
      kind: schema.applications.kind,
      programType: schema.applications.programType,
      field: schema.applications.field,
      status: schema.applications.status,
      stageDueAt: schema.applications.stageDueAt,
      escalatedAt: schema.applications.escalatedAt,
      deferUntil: schema.applications.deferUntil,
      instShort: schema.institutions.shortCode,
    })
    .from(schema.applications)
    .innerJoin(schema.institutions, eq(schema.institutions.id, schema.applications.institutionId))
    .where(inArray(schema.applications.status, OPEN_STATUSES));
  const ids = open.map((o) => o.id);
  const reviewed = new Set(ids.length ? (await db.select({ id: schema.technicalReviews.applicationId }).from(schema.technicalReviews).where(inArray(schema.technicalReviews.applicationId, ids))).map((r) => r.id) : []);
  const leads = ids.length ? await db.select({ id: schema.inspections.applicationId, lead: schema.inspections.inspector }).from(schema.inspections).where(and(inArray(schema.inspections.applicationId, ids), eq(schema.inspections.status, "SCHEDULED"))) : [];
  const item = (o: (typeof open)[number]): WorkItem & { mine: boolean } => {
    const ctx = { reviewDone: reviewed.has(o.id), deferUntil: o.deferUntil, inspectionLead: leads.find((l) => l.id === o.id)?.lead ?? null };
    return { ref: o.ref, kind: o.kind, programType: o.programType, field: o.field, status: o.status, inst: o.instShort, dueAt: iso(o.stageDueAt), holder: holderLabel(o.status, ctx), escalated: !!o.escalatedAt, mine: needsAction(o.status, user.roles, user.username, ctx) };
  };
  const all = open.map(item);
  const byDue = (a: WorkItem, b: WorkItem) => String(a.dueAt ?? "9").localeCompare(String(b.dueAt ?? "9"));
  const due = all.filter((w) => w.mine).sort(byDue);
  const blocked = all.filter((w) => w.dueAt && new Date(w.dueAt) < now).sort(byDue);
  const decidedRows = await db
    .select({ ref: schema.applications.ref, kind: schema.applications.kind, programType: schema.applications.programType, field: schema.applications.field, status: schema.applications.status, decision: schema.applications.decision, decidedAt: schema.applications.decidedAt, deferUntil: schema.applications.deferUntil, instShort: schema.institutions.shortCode })
    .from(schema.applications)
    .innerJoin(schema.institutions, eq(schema.institutions.id, schema.applications.institutionId))
    .where(and(isNotNull(schema.applications.decidedAt), gte(schema.applications.decidedAt, new Date(Date.now() - 30 * 86400000))))
    .orderBy(desc(schema.applications.decidedAt))
    .limit(6);

  const byProvince = await db.select({ k: schema.institutions.province, n }).from(schema.institutions).groupBy(schema.institutions.province);
  const bySector = await db.select({ k: schema.institutions.sector, n }).from(schema.institutions).groupBy(schema.institutions.sector);
  // NOC status covers PharmD and Technician only: the HEC issues postgraduate NOCs.
  const nocStatus = await db.select({ k: schema.programs.nocStatus, n }).from(schema.programs).where(notInArray(schema.programs.type, [...PG_TYPES])).groupBy(schema.programs.nocStatus);
  const accStatus = await db.select({ k: schema.programs.accreditationStatus, n }).from(schema.programs).groupBy(schema.programs.accreditationStatus);
  const enrol = await db
    .select({ year: schema.students.enrollmentYear, type: schema.students.programType, n })
    .from(schema.students)
    .groupBy(schema.students.enrollmentYear, schema.students.programType)
    .orderBy(schema.students.enrollmentYear);
  const graduates = await db.select({ year: schema.students.enrollmentYear, n }).from(schema.students).where(eq(schema.students.status, "GRADUATED")).groupBy(schema.students.enrollmentYear).orderBy(schema.students.enrollmentYear);
  const facultyQual = await db
    .select({ k: schema.faculty.qualification, n })
    .from(schema.faculty)
    .innerJoin(schema.facultyLinks, eq(schema.facultyLinks.facultyId, schema.faculty.id))
    .where(eq(schema.facultyLinks.status, "ACTIVE"))
    .groupBy(schema.faculty.qualification);

  // Unusual patterns: enrolment above approved intake (the draft asks PCP to spot these)
  const over = await db.execute(sql`
    select i.short_code, i.name, s.program_type, s.enrollment_year, count(*)::int as enrolled, p.approved_intake
    from students s join institutions i on i.id = s.institution_id
    join programs p on p.institution_id = s.institution_id and p.type = s.program_type
    group by i.short_code, i.name, s.program_type, s.enrollment_year, p.approved_intake
    having count(*) > p.approved_intake order by enrolled desc limit 5`);

  const audiences = [`user:${user.username}`, ...user.roles.map((x) => `role:${x}`)];
  const notes = await db.select().from(schema.notifications).where(inArray(schema.notifications.audience, audiences)).orderBy(desc(schema.notifications.createdAt)).limit(6);

  // Pipeline: where every open case sits right now
  const pipeline = await db.select({ k: schema.applications.status, n }).from(schema.applications).where(ne(schema.applications.status, "DRAFT")).groupBy(schema.applications.status);
  // Watchlist: accreditation expiring within 180 days
  const in180 = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
  const renewals = await db
    .select({ name: schema.institutions.name, code: schema.institutions.code, type: schema.programs.type, field: schema.programs.field, until: schema.programs.accreditationValidUntil })
    .from(schema.programs)
    .innerJoin(schema.institutions, eq(schema.institutions.id, schema.programs.institutionId))
    .where(and(isNotNull(schema.programs.accreditationValidUntil), lte(schema.programs.accreditationValidUntil, in180)))
    .orderBy(schema.programs.accreditationValidUntil);

  return (
    <ExecutiveDashboard
      adminTasks={[await accessReviewTask(user)].filter((t) => t !== null)}
      moreWork={<GovernanceWork data={await loadGovernanceWork(user)} />}
      kpis={kpis}
      month={now.toISOString().slice(0, 7)}
      work={{
        due: due.slice(0, 6),
        dueTotal: due.length,
        blocked: blocked.slice(0, 6),
        blockedTotal: blocked.length,
        decided: decidedRows.map((r) => ({ ref: r.ref, kind: r.kind, programType: r.programType, field: r.field, status: r.status, inst: r.instShort, decision: r.decision ?? r.status, at: iso(r.decidedAt)!, deferUntil: r.deferUntil })),
      }}
      byProvince={byProvince}
      bySector={bySector}
      nocStatus={nocStatus}
      accStatus={accStatus}
      enrol={enrol}
      graduates={graduates}
      facultyQual={facultyQual}
      overIntake={over.rows as { short_code: string; name: string; program_type: string; enrollment_year: number; enrolled: number; approved_intake: number }[]}
      pipeline={pipeline}
      renewals={renewals.map((r) => ({ ...r, until: r.until! }))}
      notifications={notes.map((x) => ({ id: x.id, title: x.title, body: x.body, link: x.link, createdAt: iso(x.createdAt)! }))}
    />
  );
}
