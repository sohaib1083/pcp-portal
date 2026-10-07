"use server";
// Reference rules (guide sections 2 and 14): thresholds, fees, document lists and drop-down reference lists.
// A change is always a new version; earlier versions are never overwritten.
import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { parseDeadline } from "@/lib/measures";
import { requirePermission } from "@/lib/session";
import type { ActionResult } from "./faculty";

const count = (label: string, min = 0) => z.number({ message: `${label} must be a number` }).int(`${label} must be a whole number`).min(min, `${label} must be at least ${min}`);

const NocRule = z.object({
  maxIntake: count("Maximum intake", 1),
  studentsPerFaculty: count("Students per faculty member", 1),
  minPhdFaculty: count("Minimum PhD faculty"),
  minLabs: count("Minimum laboratories"),
  minClassrooms: count("Minimum classrooms"),
  minLibraryBooks: count("Minimum library books"),
  requiredDocs: z.array(z.string().trim().min(3, "Each document name needs at least 3 characters")).min(1, "List at least one required document"),
});

// Retention schedule (guide section 14): days before temporary data is cleared.
const RetentionRule = z.object({
  draftApplicationDays: count("Days before an untouched draft application is cleared", 1).max(3650, "Keep the limit under 10 years"),
  onboardingDraftDays: count("Days before an onboarding draft is cleared", 1).max(3650, "Keep the limit under 10 years"),
  expiredCodeDays: count("Days after expiry before a one-time code is deleted", 1).max(365, "Keep codes at most a year"),
  unpaidChallanDays: count("Days before an unpaid challan is cancelled", 1).max(365, "Cancel unpaid challans within a year"),
});

// Measures of success (guide section 14): targets shown next to each figure.
const pctOf = (label: string) => count(label, 0).max(100, `${label} must be 100 or less`);
const KpiRule = z.object({
  nocDecisionDays: count("Days to decide an NOC", 1),
  accreditationDecisionDays: count("Days to decide an accreditation", 1),
  deficiencySharePct: pctOf("Share of cases returned for deficiency (%)"),
  onTimeSharePct: pctOf("Share of annual returns on time (%)"),
});

const StringList = z
  .array(z.string().trim().min(2, "Each entry needs at least 2 characters"))
  .min(1, "The list cannot be empty")
  .refine((a) => new Set(a.map((x) => x.toLowerCase())).size === a.length, "The list has the same entry twice");

const kindOf = (v: unknown) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v ?? null);
}

/** Validate a proposed value against the shape the rule's consumers expect. */
function validate(key: string, value: unknown, previous: unknown): unknown {
  if (key.startsWith("noc.")) return NocRule.parse(value);
  if (key === "retention.policy") return RetentionRule.parse(value);
  if (key === "kpi.targets") return KpiRule.parse(value);
  if (key === "annual.returnDeadline") {
    const d = parseDeadline(value);
    if (!d) throw new Error('Write the deadline as a day and a month, for example "31 October".');
    return d.label;
  }
  if (key === "fees") {
    const prevKeys = Object.keys((previous as Record<string, number>) ?? {});
    const v = z.record(z.string(), count("Each fee")).parse(value);
    const missing = prevKeys.filter((k) => !(k in v));
    if (missing.length) throw new Error(`Every fee must keep a value. Missing: ${missing.join(", ")}`);
    return v;
  }
  if (Array.isArray(previous) && previous.every((x) => typeof x === "string")) return StringList.parse(value);
  if (kindOf(value) !== kindOf(previous)) throw new Error(`This rule holds ${kindOf(previous) === "array" ? "a list" : `a JSON ${kindOf(previous)}`}; the new value must have the same shape.`);
  return value;
}

export async function saveRuleVersion(key: string, value: unknown, note: string): Promise<ActionResult & { version?: number }> {
  try {
    const user = await requirePermission("pcp.rules.manage");
    const latest = await db.query.rules.findFirst({ where: eq(schema.rules.key, key), orderBy: desc(schema.rules.version) });
    if (!latest) throw new Error(`Unknown rule ${key}`);
    const description = String(note ?? "").trim();
    if (description.length < 5) throw new Error("Say what changed and why (at least 5 characters). It is shown in the version history.");
    const clean = validate(key, value, latest.value);
    if (canonical(clean) === canonical(latest.value)) throw new Error("Nothing changed compared with the current version.");
    const version = latest.version + 1;
    const today = new Date().toISOString().slice(0, 10);
    await db.transaction(async (tx) => {
      await tx.insert(schema.rules).values({ key, version, value: clean, description, effectiveFrom: today });
      await audit(tx, { actor: user.username, action: "rule.versioned", entity: "rule", entityId: `${key}@v${version}`, details: { previous: latest.version, description } });
    });
    revalidatePath("/pcp/rules");
    return { ok: true, level: "success", message: `${key} saved as version ${version}. Version ${latest.version} is kept in the history.`, version };
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
    if (e instanceof z.ZodError) return { ok: false, level: "error", message: e.issues.map((i) => i.message).join(". ") };
    return { ok: false, level: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
