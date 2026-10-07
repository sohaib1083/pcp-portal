"use server";
// Retention clean-up by hand (guide section 14). The daily scheduler runs the same runRetention().
import { revalidatePath } from "next/cache";
import { requireOtp } from "@/lib/otp";
import { runRetention, type RetentionSummary } from "@/lib/retention";
import { can } from "@/lib/roles";
import { getUser } from "@/lib/session";
import type { ActionResult } from "./faculty";

/** A dry run: records what would be cleared now, changes nothing. */
export async function retentionDryRun(): Promise<ActionResult & { summary?: RetentionSummary }> {
  const user = await getUser();
  if (!user || !can(user.roles, "pcp.rules.manage")) return { ok: false, level: "error", message: "Only the Super administrator runs the retention clean-up." };
  const summary = await runRetention({ dryRun: true, actor: user.username, trigger: "MANUAL" });
  revalidatePath("/pcp/admin");
  return { ok: true, level: "success", message: `Dry run recorded. ${summary.message}`, summary };
}

/** "Run clean-up now": needs a one-time code, like every other irreversible action. */
export async function retentionRunNow(otp: string): Promise<ActionResult & { summary?: RetentionSummary }> {
  const user = await getUser();
  if (!user || !can(user.roles, "pcp.rules.manage")) return { ok: false, level: "error", message: "Only the Super administrator runs the retention clean-up." };
  try {
    await requireOtp(user.username, "retention:run", otp);
  } catch (e) {
    return { ok: false, level: "error", message: (e as Error).message };
  }
  const summary = await runRetention({ dryRun: false, actor: user.username, trigger: "MANUAL" });
  revalidatePath("/pcp/admin");
  return { ok: true, level: "success", message: summary.message, summary };
}
