// Programme cards for an institution: NOC, accreditation, intake, the accreditation history (old rows are
// never overwritten) and a pending row for any accreditation or renewal case still open (guide section 5).
// Postgraduate programmes (MS/MPhil, PhD) have one card per field of study and start with accreditation,
// because the HEC issues their NOC (RFP 4.1.10).
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requestedPeriod } from "./appdetail";
import { accreditationYearsFor } from "./rules";
import { CLOSED_STATUSES, PG_TYPES, UG_TYPES, isPg } from "./workflow";

export type HistoryRow = { key: string; kind: string; from: number; until: number; intake: number; decision: string; ref: string | null; pending: boolean; draft?: boolean };
export type ProgrammeCardData = {
  type: string;
  /** Postgraduate field of study; "" for PharmD and Technician. */
  field: string;
  postgraduate: boolean;
  nocStatus: string;
  nocNumber: string | null;
  accreditationStatus: string;
  validUntil: string | null;
  intake: number;
  history: HistoryRow[];
  openCase: { ref: string; kind: string; status: string } | null;
  openNoc: { ref: string; status: string } | null;
};

const ORDER = [...UG_TYPES, ...PG_TYPES] as string[];

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
  for (const t of new Set(programs.map((p) => p.type))) years[t] = await accreditationYearsFor(t);
  return programs
    .sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || a.field.localeCompare(b.field))
    .map((p) => {
      const pg = isPg(p.type);
      const mine = (a: (typeof open)[number]) => a.programType === p.type && (a.field ?? "") === p.field;
      // A postgraduate programme's first case is its accreditation (the HEC issues the NOC).
      const openAcc = open.find((a) => mine(a) && a.kind !== "NOC");
      const openNoc = pg ? null : open.find((a) => mine(a) && a.kind === "NOC");
      const pending: HistoryRow[] = openAcc
        ? (() => {
            const per = requestedPeriod(openAcc.kind, p.accreditationValidUntil, years[p.type], openAcc.submittedAt ?? new Date());
            return [{ key: `open-${openAcc.ref}`, kind: openAcc.kind === "RENEWAL" ? "Renewal" : "Accreditation", from: per.from, until: per.until, intake: Number(openAcc.data?.proposedIntake ?? p.approvedIntake), decision: openAcc.status === "DRAFT" ? "draft" : openAcc.status === "DEFERRED" ? "deferred" : "pending", ref: openAcc.ref, pending: true, draft: openAcc.status === "DRAFT" }];
          })()
        : [];
      return {
        type: p.type,
        field: p.field,
        postgraduate: pg,
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
