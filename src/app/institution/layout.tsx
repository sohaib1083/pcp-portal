import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import AppShell, { type NavItem } from "@/components/AppShell";
import { db, schema } from "@/db";
import { can, ROLE_LABELS } from "@/lib/roles";
import { requireInstitution } from "@/lib/session";
import { iso } from "@/lib/util";

export default async function InstitutionLayout({ children }: { children: React.ReactNode }) {
  const { user, inst } = await requireInstitution();
  const [{ open }] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(schema.deficiencies)
    .where(and(eq(schema.deficiencies.institutionId, inst.id), inArray(schema.deficiencies.status, ["OUTSTANDING", "REJECTED"])));

  const nav: NavItem[] = [{ href: "/institution", label: "Dashboard", icon: "dashboard", group: "Overview" }];
  if (can(user.roles, "inst.faculty.view")) nav.push({ href: "/institution/faculty", label: "Faculty", icon: "faculty", group: "Registry" });
  if (can(user.roles, "inst.students.view")) nav.push({ href: "/institution/students", label: "Students", icon: "students", group: "Registry" });
  if (can(user.roles, "inst.app.view")) nav.push({ href: "/institution/applications", label: "Applications", icon: "applications", group: "With PCP", badge: open || undefined });
  if (can(user.roles, "inst.documents.view")) nav.push({ href: "/institution/documents", label: "Documents", icon: "documents", group: "With PCP" });

  const audience = `inst:${inst.code}`;
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.audience, audience), isNull(schema.notifications.readAt)));
  const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.audience, audience)).orderBy(desc(schema.notifications.createdAt)).limit(8);

  return (
    <AppShell
      nav={nav}
      unread={n}
      notifications={notes.map((x) => ({ id: x.id, title: x.title, body: x.body, link: x.link, createdAt: iso(x.createdAt)! }))}
      user={{ name: user.name, username: user.username, roleLabel: ROLE_LABELS[user.role] ?? user.role }}
      workspace={{ label: "Institution portal", name: inst.name, code: inst.code }}
    >
      {children}
    </AppShell>
  );
}
