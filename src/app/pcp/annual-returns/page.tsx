import { desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import PcpAnnualReturnsView from "@/components/PcpAnnualReturnsView";
import { db, schema } from "@/db";
import { thisYear } from "@/lib/registry";
import { can } from "@/lib/roles";
import { requireUser } from "@/lib/session";

export default async function PcpAnnualReturnsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const user = await requireUser("pcp");
  const canReview = can(user.roles, "pcp.annual.review");
  if (!canReview && !user.roles.includes("pcp_admin")) redirect("/home");

  const institutions = await db.select({ id: schema.institutions.id, name: schema.institutions.name, code: schema.institutions.shortCode }).from(schema.institutions);
  const inst = Object.fromEntries(institutions.map((i) => [i.id, i]));
  const returns = await db.select().from(schema.annualReturns).orderBy(desc(schema.annualReturns.year), desc(schema.annualReturns.submittedAt));
  const corrections = await db.select().from(schema.correctionRequests).orderBy(desc(schema.correctionRequests.createdAt));
  const docIds = [...returns.map((r) => r.evidenceDocumentId), ...corrections.map((c) => c.evidenceDocumentId)].filter((x): x is number => !!x);
  const docs = docIds.length ? await db.select({ id: schema.documents.id, fileName: schema.documents.fileName, version: schema.documents.version }).from(schema.documents).where(inArray(schema.documents.id, docIds)) : [];
  const doc = (id: number | null) => (id ? (docs.find((d) => d.id === id) ?? null) : null);

  // Approved programmes with students that have not filed this year's return yet.
  const year = thisYear();
  const programs = await db.select({ institutionId: schema.programs.institutionId, type: schema.programs.type }).from(schema.programs).where(eq(schema.programs.nocStatus, "APPROVED"));
  const notFiled = programs
    .filter((p) => !returns.some((r) => r.institutionId === p.institutionId && r.programType === p.type && r.year === year && ["SUBMITTED", "ACCEPTED"].includes(r.status)))
    .map((p) => `${inst[p.institutionId]?.code} ${p.type === "PHARMD" ? "PharmD" : "Technician"}`);

  return (
    <PcpAnnualReturnsView
      canReview={canReview}
      tab={tab ?? null}
      year={year}
      notFiled={notFiled}
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
        institutionId: r.institutionId,
        inst: inst[r.institutionId]?.name ?? "",
        instCode: inst[r.institutionId]?.code ?? "",
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
