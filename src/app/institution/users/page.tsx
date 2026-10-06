import { asc, eq } from "drizzle-orm";
import InstitutionUsersView from "@/components/InstitutionUsersView";
import { db, schema } from "@/db";
import { requireInstitution } from "@/lib/session";

export const metadata = { title: "Users & roles" };

export default async function InstitutionUsersPage() {
  const { user, inst } = await requireInstitution("inst.users.manage");
  // The Head first, then everyone else in the order they were added.
  const staff = (await db.select().from(schema.staff).where(eq(schema.staff.institutionId, inst.id)).orderBy(asc(schema.staff.createdAt), asc(schema.staff.username))).sort(
    (a, b) => Number(b.role === "inst_poc") - Number(a.role === "inst_poc"),
  );
  const names = Object.fromEntries((await db.select({ u: schema.staff.username, n: schema.staff.displayName }).from(schema.staff)).map((s) => [s.u, s.n]));
  return (
    <InstitutionUsersView
      me={user.username}
      inst={{ code: inst.code, name: inst.name, shortCode: inst.shortCode }}
      users={staff.map((s) => ({
        username: s.username,
        displayName: s.displayName,
        email: s.email,
        role: s.role,
        active: s.active,
        createdAt: s.createdAt.toISOString(),
        createdBy: s.createdBy ? (s.createdBy === "system" || s.createdBy === "self-registration" ? s.createdBy : (names[s.createdBy] ?? s.createdBy)) : null,
      }))}
    />
  );
}
