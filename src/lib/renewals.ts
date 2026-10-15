// Renewal that starts itself (guide section 5): at 180, 120, 90, 60 and 30 days before expiry, and on the
// expiry date, the institution gets a dashboard alert and an email, once per threshold.
import { and, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "./audit";
import { notify } from "./util";
import { CLOSED_STATUSES, programmeName } from "./workflow";

export const RENEWAL_THRESHOLDS = [180, 120, 90, 60, 30, 0];

const todayPk = () => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000);
const nice = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The threshold a programme has reached, or null when expiry is more than 180 days away. */
export function thresholdFor(daysLeft: number) {
  if (daysLeft > RENEWAL_THRESHOLDS[0]) return null;
  if (daysLeft <= 0) return 0;
  return [...RENEWAL_THRESHOLDS].reverse().find((t) => t > 0 && daysLeft <= t) ?? null;
}

export async function runRenewalAlerts(today = todayPk()) {
  const programs = await db
    .select({ p: schema.programs, code: schema.institutions.code, shortCode: schema.institutions.shortCode })
    .from(schema.programs)
    .innerJoin(schema.institutions, eq(schema.institutions.id, schema.programs.institutionId))
    .where(and(isNotNull(schema.programs.accreditationValidUntil), inArray(schema.programs.accreditationStatus, ["VALID", "PENDING", "EXPIRED"])));
  let sent = 0;
  for (const { p, code, shortCode } of programs) {
    const until = p.accreditationValidUntil!;
    const left = daysBetween(today, until);
    const threshold = thresholdFor(left);
    if (threshold === null) continue;
    // A renewal already with PCP needs no reminder; a draft still does.
    const open = await db.query.applications.findFirst({
      where: and(
        eq(schema.applications.institutionId, p.institutionId),
        eq(schema.applications.programType, p.type),
        eq(schema.applications.field, p.field),
        inArray(schema.applications.kind, ["RENEWAL", "ACCREDITATION"]),
        notInArray(schema.applications.status, ["DRAFT", ...CLOSED_STATUSES]),
      ),
    });
    if (open && threshold > 0) continue;
    const prog = programmeName(p.type, p.field);
    await db.transaction(async (tx) => {
      const [row] = await tx.insert(schema.renewalAlerts).values({ programId: p.id, validUntil: until, threshold }).onConflictDoNothing().returning();
      if (!row) return;
      sent++;
      if (threshold === 0) {
        if (p.accreditationStatus === "VALID") await tx.update(schema.programs).set({ accreditationStatus: "EXPIRED" }).where(eq(schema.programs.id, p.id));
        await notify(tx, `inst:${code}`, `Renewal due: ${prog} accreditation expired on ${nice(until)}`, `Your ${prog} accreditation reached its expiry date (${nice(until)}). Open the prepared renewal file from the programme card and submit it now.`, "/institution/applications");
      } else {
        await notify(tx, `inst:${code}`, `Renewal due: ${prog} accreditation expires on ${nice(until)}`, `${left} days left. Open the prepared renewal file from the programme card, confirm annual compliance, update what changed and submit.`, "/institution/applications");
      }
      await audit(tx, { actor: "system", action: "renewal.alert", entity: "program", entityId: `${shortCode}:${p.type}${p.field ? `:${p.field}` : ""}`, details: { validUntil: until, threshold, daysLeft: left } });
    });
  }
  return { programs: programs.length, sent };
}
