import { notFound, redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import PcpApplicationView from "@/components/PcpApplicationView";
import { db, schema } from "@/db";
import { loadApplication } from "@/lib/appdetail";
import { audit } from "@/lib/audit";
import { OVERRIDE_PERMISSION } from "@/lib/overrides";
import { requireUser } from "@/lib/session";
import { ROLE_LABELS, can } from "@/lib/roles";

export default async function PcpApplicationPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const user = await requireUser("pcp");
  const d = await loadApplication(ref);
  if (!d || d.app.status === "DRAFT") notFound();
  // Inspectors see only the cases they are on an inspection team for (lead or member).
  if (!can(user.roles, "pcp.app.view")) {
    if (!d.inspections.some((i) => i.team.some((m) => m.username === user.username))) redirect("/home");
  }
  // Complete audit trail: who viewed a case, and when (guide section 14). A refresh within 10 minutes is the same view.
  const recent = await db
    .select({ id: schema.auditLog.id })
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.action, "application.viewed"), eq(schema.auditLog.actor, user.username), eq(schema.auditLog.entityId, ref), gt(schema.auditLog.ts, new Date(Date.now() - 10 * 60 * 1000))))
    .limit(1);
  if (!recent.length) await audit(db, { actor: user.username, action: "application.viewed", entity: "application", entityId: ref, details: { status: d.app.status } });
  const inspectors = await db.select().from(schema.staff).where(and(eq(schema.staff.role, "pcp_inspector"), eq(schema.staff.active, true)));
  const declared = d.inst
    ? await db.select().from(schema.conflictDeclarations).where(and(eq(schema.conflictDeclarations.institutionId, d.inst.id), eq(schema.conflictDeclarations.active, true)))
    : [];
  // The Super Administrator's override panel (RFP 4.1.2): officers to reassign to, and whether a council review is possible.
  const override = can(user.roles, OVERRIDE_PERMISSION)
    ? {
        officers: (await db.select().from(schema.staff).where(eq(schema.staff.active, true)))
          .filter((s) => can([s.role], "pcp.app.scrutiny"))
          .map((s) => ({ username: s.username, name: s.displayName, role: ROLE_LABELS[s.role] ?? s.role })),
        hasReport: d.inspections.some((i) => i.status === "SUBMITTED"),
      }
    : null;
  return (
    <PcpApplicationView
      d={d}
      username={user.username}
      perms={{
        scrutiny: can(user.roles, "pcp.app.scrutiny"),
        technical: can(user.roles, "pcp.technical.review"),
        schedule: can(user.roles, "pcp.inspection.schedule"),
        decide: can(user.roles, "pcp.council.decide"),
        issue: can(user.roles, "pcp.noc.issue"),
        submitInspection: can(user.roles, "pcp.inspection.submit"),
      }}
      inspectors={inspectors.map((i) => ({ username: i.username, name: i.displayName, province: i.province ?? "" }))}
      declared={declared.map((x) => ({ username: x.username, reason: x.reason }))}
      override={override}
    />
  );
}
