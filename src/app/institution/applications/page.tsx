import { desc, eq } from "drizzle-orm";
import InstitutionApplications from "@/components/InstitutionApplications";
import { db, schema } from "@/db";
import { programmeCards } from "@/lib/programmes";
import { can } from "@/lib/roles";
import { getPgRule } from "@/lib/rules";
import { requireInstitution } from "@/lib/session";
import { iso } from "@/lib/util";

export default async function ApplicationsPage() {
  const { user, inst } = await requireInstitution("inst.app.view");
  const apps = await db.select().from(schema.applications).where(eq(schema.applications.institutionId, inst.id)).orderBy(desc(schema.applications.updatedAt));
  const programmes = await programmeCards(inst.id);
  const startable = (["PHARMD", "TECH"] as const).filter((t) => programmes.find((p) => p.type === t)?.nocStatus !== "APPROVED");
  // Postgraduate (RFP 4.1.10): the type first, then the field of study from PCP's reference list.
  const pgFields = (await getPgRule()).value.fields;
  return (
    <InstitutionApplications
      canCreate={can(user.roles, "inst.app.edit")}
      startable={[...startable]}
      pgFields={pgFields}
      programmes={programmes}
      apps={apps.map((a) => ({ ref: a.ref, kind: a.kind, programType: a.programType, field: a.field, status: a.status, feeAmount: a.feeAmount, feePaid: !!a.feePaidAt, submittedAt: iso(a.submittedAt), updatedAt: iso(a.updatedAt)!, certificateNo: a.certificateNo, stageDueAt: iso(a.stageDueAt) }))}
    />
  );
}
