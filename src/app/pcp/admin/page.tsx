import { asc, inArray } from "drizzle-orm";
import type { AccessReviewData } from "@/components/AccessReview";
import AdminView from "@/components/AdminView";
import type { RetentionData } from "@/components/RetentionPanel";
import { db, schema } from "@/db";
import { accessUsers, quarterOf, reviewsList, type AccessUser } from "@/lib/access-review";
import { listUsers } from "@/lib/keycloak-admin";
import { planRetention, protectedCounts, retentionRuns } from "@/lib/retention";
import { requirePermission } from "@/lib/session";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await requirePermission("pcp.users.manage");
  const { tab } = await searchParams;
  const insts = await db.select().from(schema.institutions).orderBy(asc(schema.institutions.code));
  const staff = await db.select().from(schema.staff).orderBy(asc(schema.staff.username));
  let kc: Record<string, boolean> = {};
  let kcError: string | null = null;
  try {
    kc = Object.fromEntries((await listUsers()).map((u) => [u.username, u.enabled]));
  } catch (e) {
    kcError = e instanceof Error ? e.message : String(e);
  }
  const user = (s: (typeof staff)[number]) => ({
    username: s.username,
    displayName: s.displayName,
    email: s.email,
    role: s.role,
    province: s.province,
    active: s.active,
    inKeycloak: s.username in kc,
    createdAt: s.createdAt.toISOString(),
  });
  // Quarterly access review (guide section 14): every Keycloak account, its roles and last activity.
  let users: AccessUser[] = [];
  let accessError: string | null = null;
  try {
    users = await accessUsers();
  } catch (e) {
    accessError = e instanceof Error ? e.message : String(e);
  }
  const q = quarterOf();
  const reviews = await reviewsList();
  const removedDecisions = reviews.length
    ? await db.select({ reviewId: schema.accessReviewItems.reviewId, username: schema.accessReviewItems.username, decision: schema.accessReviewItems.decision }).from(schema.accessReviewItems).where(inArray(schema.accessReviewItems.reviewId, reviews.map((r) => r.id)))
    : [];
  const names = Object.fromEntries(staff.map((s) => [s.username, s.displayName]));
  const past = reviews.map((r) => ({
    ref: r.ref,
    quarter: r.quarter,
    reviewedBy: r.reviewedBy,
    reviewerName: names[r.reviewedBy] ?? r.reviewedBy,
    reviewedAt: r.reviewedAt.toISOString(),
    total: r.total,
    kept: r.kept,
    removed: r.removed,
    note: r.note,
    removedUsers: removedDecisions.filter((x) => x.reviewId === r.id && x.decision === "REMOVE").map((x) => x.username),
  }));
  const access: AccessReviewData = {
    error: accessError,
    users,
    quarter: { key: q.key, label: q.label, nextLabel: q.nextLabel },
    current: past.find((r) => r.quarter === q.key) ?? null,
    past,
    me: me.username,
  };

  // Retention rules (guide section 14): the policy, what a clean-up would clear now, and the last runs.
  const plan = await planRetention();
  const runs = await retentionRuns(10);
  const retention: RetentionData = {
    policy: plan.policy,
    version: plan.version,
    preview: { items: plan.items, kept: plan.kept, counts: plan.counts },
    runs: runs.map((r) => ({ id: r.id, dryRun: r.dryRun, trigger: r.trigger, counts: r.counts, runBy: r.runBy, startedAt: r.startedAt.toISOString(), policyVersion: r.policyVersion })),
    protectedCounts: await protectedCounts(),
  };

  return (
    <AdminView
      tab={tab}
      access={access}
      retention={retention}
      me={me.username}
      kcError={kcError}
      institutions={insts.map((i) => ({
        code: i.code,
        shortCode: i.shortCode,
        name: i.name,
        city: i.city,
        province: i.province,
        sector: i.sector,
        status: i.status,
        pocs: staff.filter((s) => s.institutionId === i.id && s.role === "inst_poc").map(user),
        members: staff.filter((s) => s.institutionId === i.id && s.role !== "inst_poc").map(user),
      }))}
      staff={staff.filter((s) => s.role.startsWith("pcp_")).map(user)}
    />
  );
}
