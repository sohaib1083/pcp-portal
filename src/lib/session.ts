import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "./auth";
import { db, schema } from "@/db";
import { officerCodeSatisfied } from "./officer-code";
import { HOME_BY_KIND, can, kindOf, primaryRole, type Permission, type UserKind } from "./roles";

export type CurrentUser = {
  username: string;
  name: string;
  roles: string[];
  role: string;
  institutionCode: string | null;
  kind: UserKind;
};

export async function getUser(): Promise<CurrentUser | null> {
  const session = await auth();
  if (!session?.user?.username) return null;
  const { username, name, roles, institutionCode } = session.user;
  // A user the Super Admin has disabled is locked out at once, even with a live session.
  const dir = await db.query.staff.findFirst({ where: eq(schema.staff.username, username) });
  if (!dir || !dir.active) return null;
  return { username, name, roles, role: primaryRole(roles), institutionCode, kind: kindOf(roles) };
}

/**
 * For data access (API routes): an officer who has not yet entered the sign-in code (RFP 4.1.3, 4.1.16)
 * counts as not signed in, so a download or upload cannot skip the second step.
 */
export async function getActiveUser(): Promise<CurrentUser | null> {
  const user = await getUser();
  if (user && !(await officerCodeSatisfied(user.roles))) return null;
  return user;
}

export async function requireUser(kind?: UserKind): Promise<CurrentUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  // Pages and server actions: an officer goes through the sign-in code first.
  if (!(await officerCodeSatisfied(user.roles))) redirect(`/login/code?next=${encodeURIComponent(HOME_BY_KIND[user.kind])}`);
  if (kind && user.kind !== kind) redirect("/home");
  return user;
}

export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.roles, permission)) redirect("/home?denied=" + encodeURIComponent(permission));
  return user;
}

/** The institution an institution user belongs to. Every institution query is scoped by this. */
export async function requireInstitution(permission?: Permission) {
  const user = await requireUser("institution");
  if (permission && !can(user.roles, permission)) redirect("/institution?denied=" + encodeURIComponent(permission));
  if (!user.institutionCode) throw new Error("Institution user without institution group");
  const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.code, user.institutionCode) });
  if (!inst) throw new Error("Unknown institution " + user.institutionCode);
  return { user, inst };
}
