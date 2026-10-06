import { and, desc, eq, inArray, isNotNull, lte, ne } from "drizzle-orm";
import PcpQueue from "@/components/PcpQueue";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/session";
import { iso } from "@/lib/util";
import { CLOSED_STATUSES, KIND_LABELS, PROGRAM_LABELS, STATUS_LABELS, holderLabel, needsAction } from "@/lib/workflow";

type SP = { status?: string; kind?: string; program?: string; state?: string; overdue?: string; deficiencies?: string; renewals?: string };

const list = (v?: string) => (v ? v.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) : []);

/** The officer queue. Query filters let every dashboard figure open the list behind it. */
export default async function PcpApplicationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requirePermission("pcp.app.view");
  const rows = await db
    .select({
      id: schema.applications.id,
      ref: schema.applications.ref,
      kind: schema.applications.kind,
      programType: schema.applications.programType,
      status: schema.applications.status,
      feeAmount: schema.applications.feeAmount,
      feePaidAt: schema.applications.feePaidAt,
      submittedAt: schema.applications.submittedAt,
      updatedAt: schema.applications.updatedAt,
      stageDueAt: schema.applications.stageDueAt,
      escalatedAt: schema.applications.escalatedAt,
      deferUntil: schema.applications.deferUntil,
      assignedOfficer: schema.applications.assignedOfficer,
      instName: schema.institutions.name,
      instCode: schema.institutions.code,
      province: schema.institutions.province,
    })
    .from(schema.applications)
    .innerJoin(schema.institutions, eq(schema.institutions.id, schema.applications.institutionId))
    .where(ne(schema.applications.status, "DRAFT")) // drafts belong to institutions until submitted
    .orderBy(desc(schema.applications.updatedAt));
  const ids = rows.map((r) => r.id);
  const reviewed = new Set(ids.length ? (await db.select({ id: schema.technicalReviews.applicationId }).from(schema.technicalReviews).where(inArray(schema.technicalReviews.applicationId, ids))).map((r) => r.id) : []);
  const leads = ids.length ? await db.select({ id: schema.inspections.applicationId, lead: schema.inspections.inspector }).from(schema.inspections).where(and(inArray(schema.inspections.applicationId, ids), eq(schema.inspections.status, "SCHEDULED"))) : [];
  const openDefs = ids.length ? await db.select({ id: schema.deficiencies.applicationId }).from(schema.deficiencies).where(and(inArray(schema.deficiencies.applicationId, ids), inArray(schema.deficiencies.status, ["OUTSTANDING", "REJECTED"]))) : [];
  const now = Date.now();

  let data = rows.map((r) => {
    const ctx = { reviewDone: reviewed.has(r.id), deferUntil: r.deferUntil, inspectionLead: leads.find((l) => l.id === r.id)?.lead ?? null };
    const closed = CLOSED_STATUSES.includes(r.status);
    const overdueDays = !closed && r.stageDueAt && r.stageDueAt.getTime() < now ? Math.ceil((now - r.stageDueAt.getTime()) / 86400000) : 0;
    return {
      ref: r.ref,
      kind: r.kind,
      programType: r.programType,
      status: r.status,
      feeAmount: r.feeAmount,
      feePaid: !!r.feePaidAt,
      submittedAt: iso(r.submittedAt),
      updatedAt: iso(r.updatedAt)!,
      stageDueAt: closed ? null : iso(r.stageDueAt),
      escalated: !!r.escalatedAt && !closed,
      overdueDays,
      assignedOfficer: r.assignedOfficer,
      instName: r.instName,
      instCode: r.instCode,
      province: r.province,
      holder: holderLabel(r.status, ctx),
      needsMe: needsAction(r.status, user.roles, user.username, ctx),
      openDeficiencies: openDefs.filter((x) => x.id === r.id).length,
    };
  });

  // Filters from the dashboard tiles: ?status=COUNCIL_REVIEW, ?kind=NOC&state=open, ?overdue=1, ?deficiencies=open
  const labels: string[] = [];
  const statuses = list(sp.status);
  if (statuses.length) {
    data = data.filter((r) => statuses.includes(r.status));
    labels.push(statuses.map((s) => STATUS_LABELS[s] ?? s).join(" or "));
  }
  const kinds = list(sp.kind);
  if (kinds.length) {
    data = data.filter((r) => kinds.includes(r.kind));
    labels.push(kinds.map((k) => KIND_LABELS[k] ?? k).join(" and "));
  }
  if (sp.program) {
    data = data.filter((r) => r.programType === sp.program!.toUpperCase());
    labels.push(PROGRAM_LABELS[sp.program.toUpperCase()] ?? sp.program);
  }
  if (sp.state === "open") {
    data = data.filter((r) => !CLOSED_STATUSES.includes(r.status));
    labels.push("open");
  } else if (sp.state === "closed") {
    data = data.filter((r) => CLOSED_STATUSES.includes(r.status));
    labels.push("closed");
  }
  if (sp.overdue) {
    data = data.filter((r) => r.overdueDays > 0);
    labels.push("past their time limit");
  }
  if (sp.deficiencies) {
    data = data.filter((r) => r.openDeficiencies > 0);
    labels.push("with outstanding deficiencies");
  }

  // Renewals due: programmes whose accreditation expires within N days (the dashboard's renewal tile).
  let renewals = null;
  if (sp.renewals) {
    const days = Number(sp.renewals) || 90;
    const until = new Date(now + days * 86400000).toISOString().slice(0, 10);
    const progs = await db
      .select({ name: schema.institutions.name, code: schema.institutions.code, province: schema.institutions.province, type: schema.programs.type, until: schema.programs.accreditationValidUntil, intake: schema.programs.approvedIntake, status: schema.programs.accreditationStatus, institutionId: schema.programs.institutionId })
      .from(schema.programs)
      .innerJoin(schema.institutions, eq(schema.institutions.id, schema.programs.institutionId))
      .where(and(isNotNull(schema.programs.accreditationValidUntil), lte(schema.programs.accreditationValidUntil, until)))
      .orderBy(schema.programs.accreditationValidUntil);
    const cases = await db
      .select({ ref: schema.applications.ref, institutionId: schema.applications.institutionId, programType: schema.applications.programType, status: schema.applications.status })
      .from(schema.applications)
      .where(and(inArray(schema.applications.kind, ["RENEWAL", "ACCREDITATION"]), ne(schema.applications.status, "DRAFT")));
    renewals = {
      days,
      rows: progs.map((p) => {
        const c = cases.find((x) => x.institutionId === p.institutionId && x.programType === p.type && !CLOSED_STATUSES.includes(x.status));
        return { name: p.name, code: p.code, province: p.province, type: p.type, until: p.until!, intake: p.intake, status: p.status, caseRef: c?.ref ?? null, caseStatus: c?.status ?? null };
      }),
    };
  }

  // Overdue first (most overdue on top), then what needs me, then the soonest deadline.
  data.sort((a, b) => b.overdueDays - a.overdueDays || Number(b.needsMe) - Number(a.needsMe) || String(a.stageDueAt ?? "9").localeCompare(String(b.stageDueAt ?? "9")));

  return <PcpQueue rows={data} showFees filterLabel={labels.length ? labels.join(" · ") : null} renewals={renewals} />;
}
