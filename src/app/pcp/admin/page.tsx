import { asc } from "drizzle-orm";
import AdminView from "@/components/AdminView";
import { db, schema } from "@/db";
import { listUsers } from "@/lib/keycloak-admin";
import { requirePermission } from "@/lib/session";

export default async function AdminPage() {
  const me = await requirePermission("pcp.users.manage");
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
  return (
    <AdminView
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
      }))}
      staff={staff.filter((s) => s.role.startsWith("pcp_")).map(user)}
    />
  );
}
