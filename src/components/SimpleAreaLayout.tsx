import { and, desc, inArray, isNull, sql } from "drizzle-orm";
import AppShell, { type NavItem } from "@/components/AppShell";
import { db, schema } from "@/db";
import { ROLE_LABELS, type UserKind } from "@/lib/roles";
import { requireUser } from "@/lib/session";
import { iso } from "@/lib/util";

/** Shell for the small areas: students, pharmacists and institution applicants. */
export default async function SimpleAreaLayout({ kind, workspace, nav, children }: { kind: UserKind; workspace: { label: string; name: string; code?: string }; nav: NavItem[]; children: React.ReactNode }) {
  const user = await requireUser(kind);
  const audiences = [`user:${user.username}`];
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.notifications).where(and(inArray(schema.notifications.audience, audiences), isNull(schema.notifications.readAt)));
  const notes = await db.select().from(schema.notifications).where(inArray(schema.notifications.audience, audiences)).orderBy(desc(schema.notifications.createdAt)).limit(8);
  return (
    <AppShell
      nav={nav}
      unread={n}
      notifications={notes.map((x) => ({ id: x.id, title: x.title, body: x.body, link: x.link, createdAt: iso(x.createdAt)! }))}
      user={{ name: user.name, username: user.username, roleLabel: ROLE_LABELS[user.role] ?? user.role }}
      workspace={workspace}
    >
      {children}
    </AppShell>
  );
}
