// Faculty and student registry: server-side helpers (references, locks, availability, prefilled figures).
import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AnnualFigures } from "@/db/modules/students";
import { notify } from "./util";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | Tx;

export const thisYear = () => new Date().getFullYear();
export const today = () => new Date().toISOString().slice(0, 10);

/** Next reference of the form PREFIX-YYYY-NNNN for a table with a `ref` column. */
export async function nextYearRef(exec: Executor, prefix: "FCR" | "CR", pad = 4) {
  const year = thisYear();
  const like = `${prefix}-${year}-%`;
  const res =
    prefix === "FCR"
      ? await exec.execute(sql`select coalesce(max(split_part(ref, '-', 3)::int), 0) as n from faculty_change_requests where ref like ${like}`)
      : await exec.execute(sql`select coalesce(max(split_part(ref, '-', 3)::int), 0) as n from correction_requests where ref like ${like}`);
  const n = Number((res.rows[0] as { n: number }).n) + 1;
  return `${prefix}-${year}-${String(n).padStart(pad, "0")}`;
}

/** The verification desk: the verification officer and the all-duties PCP officer. */
export async function notifyVerifiers(exec: Executor, title: string, body: string, link: string) {
  await notify(exec, "role:pcp_verification", title, body, link);
  await notify(exec, "role:pcp_officer", title, body, link);
}

// ---------- Faculty ----------

export type Availability = {
  state: "MINE" | "ELSEWHERE" | "REQUESTED_MINE" | "REQUESTED_ELSEWHERE" | "FREE" | "DEACTIVATED";
  label: string;
  programType?: string;
};

/**
 * Where a faculty member stands, as seen by one institution. Another institution is never named:
 * a person active elsewhere reads "active at another institution".
 */
export function availabilityFor(
  person: { verificationStatus: string },
  links: { institutionId: number; status: string; programType: string; endDate: string | null }[],
  institutionId: number,
): Availability {
  if (person.verificationStatus === "REJECTED") return { state: "DEACTIVATED", label: "Record deactivated by PCP (duplicate)" };
  const active = links.find((l) => l.status === "ACTIVE");
  if (active && active.institutionId === institutionId) return { state: "MINE", label: "Already on your faculty list", programType: active.programType };
  if (active) return { state: "ELSEWHERE", label: "Active at another institution" };
  const requested = links.find((l) => l.status === "REQUESTED");
  if (requested && requested.institutionId === institutionId) return { state: "REQUESTED_MINE", label: "Your link request is with PCP", programType: requested.programType };
  if (requested) return { state: "REQUESTED_ELSEWHERE", label: "Another institution's link request is with PCP" };
  const ended = links.filter((l) => l.status === "ENDED" && l.endDate).sort((a, b) => (a.endDate! < b.endDate! ? 1 : -1))[0];
  if (ended) return { state: "FREE", label: `Free to link: previous appointment ended ${fmt(ended.endDate!)}` };
  return { state: "FREE", label: "Free to link: no current appointment" };
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

export async function linksFor(exec: Executor, facultyIds: number[]) {
  if (!facultyIds.length) return [];
  return exec
    .select({
      id: schema.facultyLinks.id,
      facultyId: schema.facultyLinks.facultyId,
      institutionId: schema.facultyLinks.institutionId,
      status: schema.facultyLinks.status,
      programType: schema.facultyLinks.programType,
      startDate: schema.facultyLinks.startDate,
      endDate: schema.facultyLinks.endDate,
    })
    .from(schema.facultyLinks)
    .where(inArray(schema.facultyLinks.facultyId, facultyIds));
}

/** A link PCP has verified: active, and the person's record is verified. After that, changes go through a change request. */
export const isVerifiedLink = (link: { status: string }, person: { verificationStatus: string }) => link.status === "ACTIVE" && person.verificationStatus === "VERIFIED";

// ---------- Students and annual returns ----------

/** True once PCP has accepted the institution's annual return for that programme and year. */
export async function lockedReturn(exec: Executor, institutionId: number, programType: string, year: number) {
  const r = await exec.query.annualReturns.findFirst({
    where: and(eq(schema.annualReturns.institutionId, institutionId), eq(schema.annualReturns.programType, programType), eq(schema.annualReturns.year, year), isNotNull(schema.annualReturns.lockedAt)),
  });
  return r ?? null;
}

export async function lockedYears(exec: Executor, institutionId: number) {
  return exec
    .select({ programType: schema.annualReturns.programType, year: schema.annualReturns.year, ref: schema.annualReturns.ref, lockedAt: schema.annualReturns.lockedAt })
    .from(schema.annualReturns)
    .where(and(eq(schema.annualReturns.institutionId, institutionId), isNotNull(schema.annualReturns.lockedAt)));
}

/**
 * Figures for one programme and year, read from the student records:
 * on roll that year, and the results and moves recorded against that year.
 */
export async function figuresFromRecords(exec: Executor, institutionId: number, programType: string, year: number): Promise<{ figures: AnnualFigures; records: number }> {
  const rows = await exec
    .select({ status: schema.students.status, result: schema.students.result, resultYear: schema.students.resultYear, enrollmentYear: schema.students.enrollmentYear })
    .from(schema.students)
    .where(and(eq(schema.students.institutionId, institutionId), eq(schema.students.programType, programType), lte(schema.students.enrollmentYear, year)));
  const onRoll = rows.filter((r) => !(["GRADUATED", "WITHDRAWN"].includes(r.status) && r.resultYear !== null && r.resultYear < year));
  const ofYear = rows.filter((r) => r.resultYear === year);
  const figures: AnnualFigures = {
    enrolled: onRoll.length,
    promoted: ofYear.filter((r) => r.status === "PROMOTED").length,
    passed: ofYear.filter((r) => r.result === "PASS").length,
    failed: ofYear.filter((r) => r.result === "FAIL").length,
    repeat: ofYear.filter((r) => r.status === "REPEAT").length,
    graduated: ofYear.filter((r) => r.status === "GRADUATED").length,
    withdrawn: ofYear.filter((r) => r.status === "WITHDRAWN").length,
  };
  return { figures, records: onRoll.length };
}

/**
 * Next PCP student IDs, in the form the enrol action has always used: PCP-<SHORT>-<YEAR>-<serial>,
 * technician serials starting at 5001 so the two programmes never collide.
 */
export async function nextStudentIds(exec: Executor, shortCode: string, year: number, programType: string, count: number) {
  const prefix = `PCP-${shortCode}-${year}-`;
  const base = programType === "TECH" ? 5000 : 0;
  const res = await exec.execute(
    sql`select coalesce(max(split_part(pcp_id, '-', 4)::int), 0) as n from students where pcp_id like ${prefix + "%"} and split_part(pcp_id, '-', 4)::int ${programType === "TECH" ? sql`> 5000` : sql`<= 5000`}`,
  );
  const start = Math.max(Number((res.rows[0] as { n: number }).n), base);
  return Array.from({ length: count }, (_, i) => `${prefix}${String(start + i + 1).padStart(8, "0")}`);
}
