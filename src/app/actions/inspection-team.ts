"use server";
// Automated inspection team suggestion (RFP 4.1.1). The coordinator asks for a team; nothing is booked here.
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { suggestTeamFor, type TeamSuggestion } from "@/lib/inspection-team";
import { requirePermission } from "@/lib/session";

export type SuggestResult = { ok: true; suggestion: TeamSuggestion } | { ok: false; message: string };

export async function suggestInspectionTeam(ref: string): Promise<SuggestResult> {
  const user = await requirePermission("pcp.inspection.schedule");
  try {
    const app = await db.query.applications.findFirst({ where: eq(schema.applications.ref, ref) });
    if (!app) return { ok: false, message: "Case not found." };
    if (app.status !== "TECHNICAL_REVIEW") return { ok: false, message: `${ref} is not waiting for an inspection team.` };
    const review = await db.query.technicalReviews.findFirst({ where: eq(schema.technicalReviews.applicationId, app.id) });
    if (!review) return { ok: false, message: "Record the technical review before asking for a team." };
    const s = await suggestTeamFor(ref);
    await audit(db, {
      actor: user.username,
      action: "inspection.team.suggested",
      entity: "application",
      entityId: ref,
      details: { rule: `inspection.team@v${s.ruleVersion}`, team: s.team.map((t) => `${t.username}:${t.role}`), date: s.date, excluded: s.excluded.map((e) => `${e.username}: ${e.why}`) },
    });
    return { ok: true, suggestion: s };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
