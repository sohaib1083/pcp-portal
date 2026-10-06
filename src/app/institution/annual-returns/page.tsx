import { and, desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import AnnualReturnsView from "@/components/AnnualReturnsView";
import { db, schema } from "@/db";
import { figuresFromRecords, thisYear } from "@/lib/registry";
import { annualReturnDue } from "@/lib/registry-shared";
import { can } from "@/lib/roles";
import { requireInstitution } from "@/lib/session";

export default async function AnnualReturnsPage() {
  const { user, inst } = await requireInstitution();
  const canView = can(user.roles, "inst.students.view") || can(user.roles, "inst.annual.file");
  if (!canView) redirect("/institution?denied=inst.students.view");

  const programmes = (await db.select().from(schema.programs).where(and(eq(schema.programs.institutionId, inst.id), eq(schema.programs.nocStatus, "APPROVED")))).map((p) => p.type);
  const returns = await db.select().from(schema.annualReturns).where(eq(schema.annualReturns.institutionId, inst.id)).orderBy(desc(schema.annualReturns.year), schema.annualReturns.programType);
  const corrections = returns.length
    ? await db.select().from(schema.correctionRequests).where(inArray(schema.correctionRequests.annualReturnId, returns.map((r) => r.id))).orderBy(desc(schema.correctionRequests.createdAt))
    : [];
  const docIds = [...returns.map((r) => r.evidenceDocumentId), ...corrections.map((c) => c.evidenceDocumentId)].filter((x): x is number => !!x);
  const docs = docIds.length ? await db.select({ id: schema.documents.id, fileName: schema.documents.fileName, version: schema.documents.version }).from(schema.documents).where(inArray(schema.documents.id, docIds)) : [];

  const year = thisYear();
  const years = Array.from({ length: 5 }, (_, i) => year - i);
  const fromRecords: Record<string, { figures: Record<string, number>; records: number }> = {};
  for (const p of programmes) for (const y of years) fromRecords[`${p}:${y}`] = await figuresFromRecords(db, inst.id, p, y);

  const doc = (id: number | null) => (id ? (docs.find((d) => d.id === id) ?? null) : null);
  return (
    <AnnualReturnsView
      shortCode={inst.shortCode}
      canFile={can(user.roles, "inst.annual.file")}
      programmes={programmes}
      years={years}
      dueDate={annualReturnDue(year)}
      fromRecords={fromRecords}
      returns={returns.map((r) => ({
        id: r.id,
        ref: r.ref,
        programType: r.programType,
        year: r.year,
        status: r.status,
        figures: r.figures,
        note: r.note,
        evidence: doc(r.evidenceDocumentId),
        dueDate: r.dueDate,
        submittedBy: r.submittedBy,
        submittedAt: r.submittedAt?.toISOString() ?? null,
        reviewedBy: r.reviewedBy,
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        reviewNote: r.reviewNote,
        lockedAt: r.lockedAt?.toISOString() ?? null,
      }))}
      corrections={corrections.map((c) => ({
        id: c.id,
        ref: c.ref,
        annualReturnId: c.annualReturnId,
        changes: c.changes,
        reason: c.reason,
        evidence: doc(c.evidenceDocumentId),
        status: c.status,
        requestedBy: c.requestedBy,
        createdAt: c.createdAt.toISOString(),
        decidedBy: c.decidedBy,
        decidedAt: c.decidedAt?.toISOString() ?? null,
        decisionNote: c.decisionNote,
      }))}
    />
  );
}
