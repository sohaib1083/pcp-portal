// Quarterly access review (guide section 14, "Role-based access with a quarterly review of who holds which
// role"). The Super administrator goes through every account in Keycloak, keeps or removes access, and records
// the review. Removing access disables the account (it is never deleted, so the audit history keeps its name).
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { institutionGroupMembers, listUsersFull, realmRoleMembers } from "./keycloak-admin";
import { ROLE_LABELS } from "./roles";
import type { CurrentUser } from "./session";

export type AccessUser = {
  username: string;
  displayName: string;
  email: string | null;
  enabled: boolean;
  roles: string[];
  institution: string | null; // PCP-UNI code
  institutionName: string | null;
  lastActivity: string | null; // latest audit log entry by this account
  createdAt: string | null;
};

/** The quarter a date falls in: key "2026-Q4", label "Q4 2026", and when the next one starts. */
export function quarterOf(d = new Date()) {
  const y = d.getFullYear();
  const q = Math.floor(d.getMonth() / 3) + 1;
  const next = q === 4 ? new Date(y + 1, 0, 1) : new Date(y, q * 3, 1);
  return { key: `${y}-Q${q}`, label: `Q${q} ${y}`, start: new Date(y, (q - 1) * 3, 1), next, nextLabel: next.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) };
}

/** Every account in the realm with its roles, institution and last activity. */
export async function accessUsers(): Promise<AccessUser[]> {
  const [users, roles, groups] = await Promise.all([listUsersFull(), realmRoleMembers(Object.keys(ROLE_LABELS)), institutionGroupMembers()]);
  const names = users.map((u) => u.username);
  const directory = names.length ? await db.select().from(schema.staff).where(inArray(schema.staff.username, names)) : [];
  const insts = await db.select({ id: schema.institutions.id, code: schema.institutions.code, name: schema.institutions.name }).from(schema.institutions);
  const last = names.length
    ? await db
        .select({ actor: schema.auditLog.actor, ts: sql<string>`max(${schema.auditLog.ts})` })
        .from(schema.auditLog)
        .where(inArray(schema.auditLog.actor, names))
        .groupBy(schema.auditLog.actor)
    : [];
  return users
    .map((u) => {
      const dir = directory.find((d) => d.username === u.username);
      const code = groups[u.username] ?? (dir?.institutionId ? insts.find((i) => i.id === dir.institutionId)?.code : null) ?? null;
      const ts = last.find((l) => l.actor === u.username)?.ts;
      return {
        username: u.username,
        displayName: dir?.displayName ?? ([u.firstName, u.lastName].filter((x) => x && x !== "-").join(" ") || u.username),
        email: u.email ?? dir?.email ?? null,
        enabled: u.enabled,
        roles: roles[u.username] ?? [],
        institution: code,
        institutionName: code ? (insts.find((i) => i.code === code)?.name ?? null) : null,
        lastActivity: ts ? new Date(ts).toISOString() : null,
        createdAt: u.createdTimestamp ? new Date(u.createdTimestamp).toISOString() : null,
      };
    })
    .sort((a, b) => a.username.localeCompare(b.username));
}

export async function reviewsList(limit = 12) {
  return db.select().from(schema.accessReviews).orderBy(desc(schema.accessReviews.reviewedAt)).limit(limit);
}

export async function reviewFor(quarterKey: string) {
  return db.query.accessReviews.findFirst({ where: eq(schema.accessReviews.quarter, quarterKey), orderBy: desc(schema.accessReviews.reviewedAt) });
}

/**
 * The Super administrator's task on the PCP dashboard: shown while the current quarter has no recorded review.
 * Returns null for everyone else, and once the review is recorded.
 */
export async function accessReviewTask(user: Pick<CurrentUser, "roles">): Promise<{ text: string; link: string; due: string } | null> {
  if (!user.roles.includes("pcp_admin")) return null;
  const q = quarterOf();
  if (await reviewFor(q.key)) return null;
  const end = new Date(q.next.getTime() - 86400000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return { text: `Quarterly access review due: record the ${q.label} review of who holds which role`, link: "/pcp/admin?tab=access", due: end };
}
