"use server";
// Quarterly access review (guide section 14): keep or remove each account, then record the review.
import { revalidatePath } from "next/cache";
import { eq, like } from "drizzle-orm";
import { db, schema } from "@/db";
import { accessUsers, quarterOf, type AccessUser } from "@/lib/access-review";
import { audit } from "@/lib/audit";
import { setEnabled } from "@/lib/keycloak-admin";
import { requireOtp } from "@/lib/otp";
import { can } from "@/lib/roles";
import { getUser } from "@/lib/session";
import type { ActionResult } from "./faculty";

export async function recordAccessReview(decisions: Record<string, "KEEP" | "REMOVE">, note: string, otp: string): Promise<ActionResult & { ref?: string }> {
  const user = await getUser();
  if (!user || !can(user.roles, "pcp.users.manage")) return { ok: false, level: "error", message: "Only the Super administrator records the access review." };
  const q = quarterOf();
  try {
    await requireOtp(user.username, `access-review:${q.key}`, otp);
  } catch (e) {
    return { ok: false, level: "error", message: (e as Error).message };
  }
  let users;
  try {
    users = await accessUsers();
  } catch (e) {
    return { ok: false, level: "error", message: `Keycloak could not be reached, so nothing was recorded. ${(e as Error).message}` };
  }
  const wanted = Object.entries(decisions ?? {});
  const unknown = wanted.filter(([u]) => !users.some((x) => x.username === u)).map(([u]) => u);
  if (unknown.length) return { ok: false, level: "error", message: `These accounts are no longer in Keycloak: ${unknown.join(", ")}. Reload the list and review again.` };
  if (decisions[user.username] === "REMOVE") return { ok: false, level: "error", message: "You cannot remove your own access. Another Super administrator must do that." };

  // Remove access first (Keycloak), then record what actually happened.
  const items: (AccessUser & { decision: "KEEP" | "REMOVE"; enabledAfter: boolean; outcome: string })[] = [];
  for (const u of users) {
    const decision = decisions[u.username] === "REMOVE" ? "REMOVE" : "KEEP";
    let enabledAfter = u.enabled;
    let outcome = "Kept";
    if (decision === "REMOVE") {
      if (!u.enabled) outcome = "Already disabled";
      else {
        try {
          await setEnabled(u.username, false);
          enabledAfter = false;
          outcome = "Disabled";
        } catch (e) {
          outcome = `Could not disable: ${(e as Error).message.slice(0, 160)}`;
        }
      }
    }
    items.push({ ...u, decision, enabledAfter, outcome });
  }
  const removed = items.filter((i) => i.decision === "REMOVE");
  const failed = removed.filter((i) => i.outcome.startsWith("Could not"));

  const taken = await db.select({ ref: schema.accessReviews.ref }).from(schema.accessReviews).where(like(schema.accessReviews.ref, `UAR-${q.key}%`));
  const ref = taken.length ? `UAR-${q.key}-${taken.length + 1}` : `UAR-${q.key}`;
  await db.transaction(async (tx) => {
    const [review] = await tx
      .insert(schema.accessReviews)
      .values({ ref, quarter: q.key, total: items.length, kept: items.length - removed.length, removed: removed.length, note: String(note ?? "").trim().slice(0, 500) || null, reviewedBy: user.username })
      .returning();
    await tx.insert(schema.accessReviewItems).values(
      items.map((i) => ({
        reviewId: review.id,
        username: i.username,
        displayName: i.displayName,
        email: i.email,
        roles: i.roles,
        institution: i.institution,
        enabledBefore: i.enabled,
        lastActivity: i.lastActivity ? new Date(i.lastActivity) : null,
        decision: i.decision,
        enabledAfter: i.enabledAfter,
        outcome: i.outcome,
      })),
    );
    for (const r of removed.filter((x) => x.outcome === "Disabled")) {
      await tx.update(schema.staff).set({ active: false }).where(eq(schema.staff.username, r.username));
      await audit(tx, { actor: user.username, action: "user.disabled", entity: "user", entityId: r.username, details: { by: `access review ${ref}`, roles: r.roles } });
    }
    await audit(tx, {
      actor: user.username,
      action: "access.review.recorded",
      entity: "access_review",
      entityId: ref,
      details: { quarter: q.key, total: items.length, kept: items.length - removed.length, removed: removed.map((r) => r.username), failed: failed.map((f) => f.username) },
    });
  });
  revalidatePath("/pcp/admin");
  revalidatePath("/pcp");
  return {
    ok: true,
    level: failed.length ? "warning" : "success",
    ref,
    message: `${ref} recorded: ${items.length - removed.length} accounts kept, ${removed.length} removed.${failed.length ? ` Keycloak did not disable ${failed.map((f) => f.username).join(", ")}; try again from the list.` : ""} Next review due ${q.nextLabel}.`,
  };
}
