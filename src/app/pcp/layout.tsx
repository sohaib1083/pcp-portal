import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import AppShell, { type NavItem } from "@/components/AppShell";
import { db, schema } from "@/db";
import { can, ROLE_LABELS } from "@/lib/roles";
import { requireUser } from "@/lib/session";
import { iso } from "@/lib/util";
import { TRANSITIONS } from "@/lib/workflow";

export default async function PcpLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("pcp");
  const r = user.roles;

  // Badges: how much is waiting for this user's role
  const statuses = await db.select({ status: schema.applications.status }).from(schema.applications).where(ne(schema.applications.status, "DRAFT"));
  const needsMe = statuses.filter(
    (a) => TRANSITIONS.some((t) => t.from.includes(a.status) && t.roles.some((role) => r.includes(role))) && !(a.status === "INSPECTION_SCHEDULED" && !r.includes("pcp_inspector")),
  ).length;
  const [{ myInspections }] = await db
    .select({ myInspections: sql<number>`count(*)::int` })
    .from(schema.inspections)
    .where(and(eq(schema.inspections.inspector, user.username), eq(schema.inspections.status, "SCHEDULED")));
  const [{ flags }] = await db.select({ flags: sql<number>`count(*)::int` }).from(schema.duplicateFlags).where(eq(schema.duplicateFlags.status, "OPEN"));

  const nav: NavItem[] = [];
  if (can(r, "pcp.dashboard")) nav.push({ href: "/pcp", label: "Executive dashboard", icon: "dashboard", group: "Overview" });
  if (can(r, "pcp.app.view")) nav.push({ href: "/pcp/applications", label: "Applications", icon: "applications", group: "Casework", badge: needsMe || undefined });
  if (r.includes("pcp_inspector") || r.includes("pcp_officer"))
    nav.push({ href: "/pcp/inspections", label: "Inspections", icon: "inspections", group: "Casework", badge: r.includes("pcp_inspector") ? myInspections || undefined : undefined });
  if (can(r, "pcp.faculty.verify") || r.includes("pcp_admin"))
    nav.push({ href: "/pcp/verification", label: "Data verification", icon: "verification", group: "Casework", badge: r.includes("pcp_officer") ? flags || undefined : undefined });
  if (can(r, "pcp.app.view")) nav.push({ href: "/pcp/institutions", label: "Institutions", icon: "institutions", group: "Registry" });
  if (can(r, "pcp.documents.view")) nav.push({ href: "/pcp/documents", label: "Documents", icon: "documents", group: "Registry" });
  if (can(r, "pcp.users.manage")) nav.push({ href: "/pcp/admin", label: "Users & institutions", icon: "users", group: "Administration" });
  if (can(r, "pcp.audit.view")) nav.push({ href: "/pcp/audit", label: "Audit log", icon: "audit", group: "Administration" });

  const audiences = [`user:${user.username}`, ...r.map((x) => `role:${x}`)];
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(and(inArray(schema.notifications.audience, audiences), isNull(schema.notifications.readAt)));
  const notes = await db.select().from(schema.notifications).where(inArray(schema.notifications.audience, audiences)).orderBy(desc(schema.notifications.createdAt)).limit(8);

  return (
    <AppShell
      nav={nav}
      unread={n}
      notifications={notes.map((x) => ({ id: x.id, title: x.title, body: x.body, link: x.link, createdAt: iso(x.createdAt)! }))}
      user={{ name: user.name, username: user.username, roleLabel: ROLE_LABELS[user.role] ?? user.role }}
      workspace={{ label: "PCP back office", name: "Pharmacy Council of Pakistan", code: "Islamabad" }}
    >
      {children}
    </AppShell>
  );
}
