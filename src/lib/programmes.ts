// Programme cards for an institution: NOC, accreditation, intake, the accreditation history (old rows are
// never overwritten) and a pending row for any accreditation or renewal case still open (guide section 5).
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requestedPeriod } from "./appdetail";
import { getRule, type ProgramRule } from "./rules";
import { CLOSED_STATUSES } from "./workflow";

export type HistoryRow = { key: string; kind: string; from: number; until: number; intake: number; decision: string; ref: string | null; pending: boolean; draft?: boolean };
export type ProgrammeCardData = {
  type: string;
  nocStatus: string;
  nocNumber: string | null;
  accreditationStatus: string;
  validUntil: string | null;
  intake: number;
  history: HistoryRow[];
  openCase: { ref: string; kind: string; status: string } | null;
  openNoc: { ref: string; status: string } | null;
};

export async function programmeCards(institutionId: number): Promise<ProgrammeCardData[]> {
  const programs = await db.select().from(schema.programs).where(eq(schema.programs.institutionId, institutionId));
  if (!programs.length) return [];
  const hist = await db.select().from(schema.accreditationHistory).where(inArray(schema.accreditationHistory.programId, programs.map((p) => p.id))).orderBy(desc(schema.accreditationHistory.validFrom), desc(schema.accreditationHistory.id));
  const open = await db
    .select()
    .from(schema.applications)
    .where(and(eq(schema.applications.institutionId, institutionId), notInArray(schema.applications.status, CLOSED_STATUSES)))
    .orderBy(desc(schema.applications.id));
  const years: Record<string, number> = {};
  for (const t of ["PHARMD", "TECH"]) {
    try {
      years[t] = (await getRule<ProgramRule>(`noc.${t}`)).value.accreditationYears ?? 3;
    } catch {
      years[t] = 3;
    }
  }
  return programs
    .sort((a, b) => a.type.localeCompare(b.type))
    .map((p) => {
      const openAcc = open.find((a) => a.programType === p.type && a.kind !== "NOC");
      const openNoc = open.find((a) => a.programType === p.type && a.kind === "NOC");
      const pending: HistoryRow[] = openAcc
        ? (() => {
            const per = requestedPeriod(openAcc.kind, p.accreditationValidUntil, years[p.type], openAcc.submittedAt ?? new Date());
            return [{ key: `open-${openAcc.ref}`, kind: openAcc.kind === "RENEWAL" ? "Renewal" : "Accreditation", from: per.from, until: per.until, intake: Number(openAcc.data?.proposedIntake ?? p.approvedIntake), decision: openAcc.status === "DRAFT" ? "draft" : openAcc.status === "DEFERRED" ? "deferred" : "pending", ref: openAcc.ref, pending: true, draft: openAcc.status === "DRAFT" }];
          })()
        : [];
      return {
        type: p.type,
        nocStatus: p.nocStatus,
        nocNumber: p.nocNumber,
        accreditationStatus: p.accreditationStatus,
        validUntil: p.accreditationValidUntil,
        intake: p.approvedIntake,
        history: [
          ...pending,
          ...hist
            .filter((h) => h.programId === p.id)
            .map((h) => ({ key: `h-${h.id}`, kind: h.status, from: h.validFrom, until: h.validUntil, intake: h.intake, decision: h.decision, ref: h.applicationRef, pending: false })),
        ],
        openCase: openAcc ? { ref: openAcc.ref, kind: openAcc.kind, status: openAcc.status } : null,
        openNoc: openNoc ? { ref: openNoc.ref, status: openNoc.status } : null,
      };
    });
}
