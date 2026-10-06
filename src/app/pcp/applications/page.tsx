import { desc, eq } from "drizzle-orm";
import PcpQueue from "@/components/PcpQueue";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/session";
import { iso } from "@/lib/util";
import { TRANSITIONS } from "@/lib/workflow";

export default async function PcpApplicationsPage() {
  const user = await requirePermission("pcp.app.view");
  const rows = await db
    .select({
      ref: schema.applications.ref,
      kind: schema.applications.kind,
      programType: schema.applications.programType,
      status: schema.applications.status,
      feeAmount: schema.applications.feeAmount,
      feePaidAt: schema.applications.feePaidAt,
      submittedAt: schema.applications.submittedAt,
      updatedAt: schema.applications.updatedAt,
      assignedOfficer: schema.applications.assignedOfficer,
      instName: schema.institutions.name,
      instCode: schema.institutions.code,
      province: schema.institutions.province,
    })
    .from(schema.applications)
    .innerJoin(schema.institutions, eq(schema.institutions.id, schema.applications.institutionId))
    .orderBy(desc(schema.applications.updatedAt));

  // Drafts belong to institutions until submitted.
  const visible = rows.filter((r) => r.status !== "DRAFT");
  const mine = (status: string) => TRANSITIONS.some((t) => t.from.includes(status) && t.roles.some((role) => user.roles.includes(role)));

  return (
    <PcpQueue
      rows={visible.map((r) => ({
        ...r,
        feePaid: !!r.feePaidAt,
        feePaidAt: iso(r.feePaidAt),
        submittedAt: iso(r.submittedAt),
        updatedAt: iso(r.updatedAt)!,
        needsMe: mine(r.status) && !(r.status === "INSPECTION_SCHEDULED" && !user.roles.includes("pcp_inspector")),
      }))}
      showFees
    />
  );
}
