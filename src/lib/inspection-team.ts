// Automated inspection team suggestion (RFP 4.1.1 "inspection and visitation management engine with automated
// team scheduling tools", 4.1.14, 4.1.18.3). Proposes a lead and members from the inspection panel and the
// earliest visit date with no clash, and says why each person was chosen or left out. The coordinator decides:
// the suggestion fills the form, and scheduleInspection still runs every conflict check on submit.
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { getRule } from "./rules";

/** The `inspection.team` rule. */
export type TeamRule = {
  /** Members besides the lead. */
  members: number;
  /** Days of notice the institution gets before the visit. */
  noticeDays: number;
  /** The visit falls within this many days of the technical review (the service level for the visit). */
  visitWithinDays: number;
  /** A panel member with this many open visits is not proposed. */
  maxOpenVisits: number;
  /** The lead has led at least this many inspections. */
  leadMinLed: number;
  /** Visits on working days only (Monday to Friday). */
  weekdaysOnly: boolean;
};

export const DEFAULT_TEAM_RULE: TeamRule = { members: 2, noticeDays: 7, visitWithinDays: 30, maxOpenVisits: 3, leadMinLed: 1, weekdaysOnly: true };

export async function getTeamRule(): Promise<{ value: TeamRule; version: number }> {
  try {
    const r = await getRule<Partial<TeamRule>>("inspection.team");
    // An edited rule with a missing or nonsensical number falls back to the default for that number.
    const num = (k: Exclude<keyof TeamRule, "weekdaysOnly">, min: number, max: number) => {
      const n = Number(r.value?.[k]);
      return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : DEFAULT_TEAM_RULE[k];
    };
    return {
      value: {
        members: num("members", 0, 6),
        noticeDays: num("noticeDays", 0, 60),
        visitWithinDays: num("visitWithinDays", 1, 180),
        maxOpenVisits: num("maxOpenVisits", 1, 50),
        leadMinLed: num("leadMinLed", 0, 50),
        weekdaysOnly: typeof r.value?.weekdaysOnly === "boolean" ? r.value.weekdaysOnly : DEFAULT_TEAM_RULE.weekdaysOnly,
      },
      version: r.version,
    };
  } catch {
    return { value: DEFAULT_TEAM_RULE, version: 0 };
  }
}

export type PanelMember = {
  username: string;
  name: string;
  province: string;
  /** Open (scheduled, not yet reported) visits as lead or member. */
  open: number;
  openDates: string[];
  /** Inspections led and reported. */
  led: number;
  conflict: string | null;
};

export type Suggested = PanelMember & { role: "LEAD" | "MEMBER"; why: string };
export type Excluded = { username: string; name: string; province: string; why: string };

export type TeamSuggestion = {
  ref: string;
  institution: { shortCode: string; name: string; province: string };
  rule: TeamRule;
  ruleVersion: number;
  team: Suggested[];
  /** Members needed by the rule that could not be proposed (too few eligible panel members). */
  shortBy: number;
  date: string | null;
  dateWhy: string;
  window: { from: string; to: string; late: boolean };
  excluded: Excluded[];
  /** Eligible panel members not proposed, for a swap: free on the proposed date or not. */
  alternates: (PanelMember & { why: string; freeOnDate: boolean })[];
  warnings: string[];
};

const DAY = 86400000;
/** Today's date in Pakistan (UTC+5). */
const pkDate = (at = new Date()) => new Date(at.getTime() + 5 * 3600000).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekday = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0 Sunday, 6 Saturday
export const visits = (n: number) => `${n} open visit${n === 1 ? "" : "s"}`;

/** The panel as it stands today: every active inspector with workload, experience and any declared conflict with the institution. */
export async function loadPanel(institutionId: number): Promise<PanelMember[]> {
  const staff = await db.select().from(schema.staff).where(and(eq(schema.staff.role, "pcp_inspector"), eq(schema.staff.active, true)));
  if (!staff.length) return [];
  const names = staff.map((s) => s.username);
  const open = await db.select().from(schema.inspections).where(eq(schema.inspections.status, "SCHEDULED"));
  const team = open.length ? await db.select().from(schema.inspectionTeam).where(inArray(schema.inspectionTeam.inspectionId, open.map((i) => i.id))) : [];
  const led = await db.select({ inspector: schema.inspections.inspector }).from(schema.inspections).where(and(eq(schema.inspections.status, "SUBMITTED"), inArray(schema.inspections.inspector, names)));
  const declared = await db
    .select()
    .from(schema.conflictDeclarations)
    .where(and(eq(schema.conflictDeclarations.institutionId, institutionId), eq(schema.conflictDeclarations.active, true), inArray(schema.conflictDeclarations.username, names)));
  return staff.map((s) => {
    const mine = open.filter((i) => i.inspector === s.username || team.some((t) => t.inspectionId === i.id && t.username === s.username));
    return {
      username: s.username,
      name: s.displayName,
      province: s.province ?? "",
      open: mine.length,
      openDates: [...new Set(mine.map((i) => i.scheduledFor))].sort(),
      led: led.filter((l) => l.inspector === s.username).length,
      conflict: declared.find((d) => d.username === s.username)?.reason ?? null,
    };
  });
}

/**
 * The suggestion itself, from the panel, the institution and the rule. Pure: the same inputs give the same team.
 * Eligible: not from the institution's province, no declared conflict, under the open-visit limit.
 * Lead: the eligible member with the lowest workload among those who have led enough inspections.
 * Members: the next lowest workloads, preferring a province not yet on the team.
 * Date: the earliest working day after the notice period when nobody on the team has another visit.
 */
export function proposeTeam(
  panel: PanelMember[],
  inst: { shortCode: string; name: string; province: string },
  rule: TeamRule,
  o: { today: string; reviewedOn: string | null; ref: string; ruleVersion: number },
): TeamSuggestion {
  const excluded: Excluded[] = [];
  const eligible: PanelMember[] = [];
  for (const p of panel) {
    const why =
      p.province === inst.province
        ? `same province as ${inst.shortCode} (${p.province})`
        : p.conflict
          ? `declared conflict with ${inst.shortCode}: ${p.conflict}`
          : p.open >= rule.maxOpenVisits
            ? `${visits(p.open)}, at the limit of ${rule.maxOpenVisits}`
            : null;
    if (why) excluded.push({ username: p.username, name: p.name, province: p.province, why });
    else eligible.push(p);
  }
  const byLoad = (a: PanelMember, b: PanelMember) => a.open - b.open || b.led - a.led || a.name.localeCompare(b.name);
  const warnings: string[] = [];
  const experienced = eligible.filter((p) => p.led >= rule.leadMinLed).sort(byLoad);
  let lead = experienced[0];
  if (!lead && eligible.length) {
    lead = [...eligible].sort(byLoad)[0];
    warnings.push(`No eligible panel member has led ${rule.leadMinLed === 1 ? "an inspection" : `${rule.leadMinLed} inspections`} yet, so ${lead.name} is proposed as lead on workload alone.`);
  }
  const team: Suggested[] = [];
  const reasonFor = (p: PanelMember, isLead: boolean) =>
    [p.province, visits(p.open), ...(isLead ? [`led ${p.led} inspection${p.led === 1 ? "" : "s"}`] : []), "no conflicts"].join(" · ");
  if (lead) team.push({ ...lead, role: "LEAD", why: reasonFor(lead, true) });
  const rest = eligible.filter((p) => p.username !== lead?.username);
  while (team.length < 1 + rule.members && rest.length) {
    const provinces = new Set(team.map((t) => t.province));
    rest.sort((a, b) => a.open - b.open || Number(provinces.has(a.province)) - Number(provinces.has(b.province)) || a.name.localeCompare(b.name));
    const next = rest.shift()!;
    team.push({ ...next, role: "MEMBER", why: reasonFor(next, false) });
  }
  const shortBy = Math.max(0, 1 + rule.members - team.length);
  if (shortBy) warnings.push(`The rule asks for a lead and ${rule.members} member${rule.members === 1 ? "" : "s"}; only ${team.length} eligible panel member${team.length === 1 ? " is" : "s are"} free of conflicts.`);

  // The visit window: after the notice period, within the service level counted from the technical review.
  const from = addDays(o.today, rule.noticeDays);
  let to = addDays(o.reviewedOn ?? o.today, rule.visitWithinDays);
  const late = to < from;
  if (late) to = addDays(from, 14);
  const busy = new Set(team.flatMap((t) => t.openDates));
  const working = (d: string) => !rule.weekdaysOnly || (weekday(d) !== 0 && weekday(d) !== 6);
  let date: string | null = null;
  let skipped = 0;
  if (team.length)
    for (let d = from; d <= addDays(to, 30); d = addDays(d, 1)) {
      if (!working(d)) continue;
      if (busy.has(d)) {
        skipped++;
        continue;
      }
      date = d;
      break;
    }
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  let dateWhy = "";
  if (!date) dateWhy = "No date: there is no eligible team to schedule.";
  else {
    dateWhy = `Earliest ${rule.weekdaysOnly ? "working day" : "day"} after the ${rule.noticeDays}-day notice to the institution${skipped ? ` (${skipped} date${skipped === 1 ? "" : "s"} skipped: a team member has another visit)` : " with no other visit for anyone on the team"}.`;
    if (late) {
      dateWhy += ` The ${rule.visitWithinDays}-day service level from the technical review has passed, so this is the earliest possible date.`;
      warnings.push(`The visit is late: the service level (${rule.visitWithinDays} days from the technical review) ended before the notice period does.`);
    } else if (date > to) {
      dateWhy += ` It is after the service-level window, which ends ${fmt(to)}.`;
      warnings.push(`No clash-free date inside the service-level window (by ${fmt(to)}). Swap a member to find an earlier date.`);
    } else dateWhy += ` Within the service level: the visit is due by ${fmt(to)}.`;
  }
  const chosen = new Set(team.map((t) => t.username));
  const alternates = eligible
    .filter((p) => !chosen.has(p.username))
    .sort(byLoad)
    .map((p) => ({ ...p, why: reasonFor(p, false), freeOnDate: !date || !p.openDates.includes(date) }));
  return { ref: o.ref, institution: inst, rule, ruleVersion: o.ruleVersion, team, shortBy, date, dateWhy, window: { from, to, late }, excluded, alternates, warnings };
}

/** The suggestion for a case that is ready for an inspection team. */
export async function suggestTeamFor(ref: string): Promise<TeamSuggestion> {
  const app = await db.query.applications.findFirst({ where: eq(schema.applications.ref, ref) });
  if (!app) throw new Error("Case not found");
  const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, app.institutionId) });
  if (!inst) throw new Error("Institution not found");
  const review = await db.query.technicalReviews.findFirst({ where: eq(schema.technicalReviews.applicationId, app.id) });
  const { value: rule, version } = await getTeamRule();
  const panel = await loadPanel(inst.id);
  return proposeTeam(panel, { shortCode: inst.shortCode, name: inst.name, province: inst.province }, rule, {
    today: pkDate(),
    reviewedOn: review ? pkDate(review.createdAt) : null,
    ref,
    ruleVersion: version,
  });
}
