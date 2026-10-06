import { desc, eq } from "drizzle-orm";
import InstitutionApplications from "@/components/InstitutionApplications";
import { db, schema } from "@/db";
import { can } from "@/lib/roles";
import { requireInstitution } from "@/lib/session";
import { iso } from "@/lib/util";

export default async function ApplicationsPage() {
  const { user, inst } = await requireInstitution("inst.app.view");
  const apps = await db.select().from(schema.applications).where(eq(schema.applications.institutionId, inst.id)).orderBy(desc(schema.applications.updatedAt));
  const programs = await db.select().from(schema.programs).where(eq(schema.programs.institutionId, inst.id));
  const startable = (["PHARMD", "TECH"] as const).filter((t) => programs.find((p) => p.type === t)?.nocStatus !== "APPROVED");
  return (
    <InstitutionApplications
      canCreate={can(user.roles, "inst.app.edit")}
      startable={[...startable]}
      apps={apps.map((a) => ({ ref: a.ref, kind: a.kind, programType: a.programType, status: a.status, feeAmount: a.feeAmount, feePaid: !!a.feePaidAt, submittedAt: iso(a.submittedAt), updatedAt: iso(a.updatedAt)!, certificateNo: a.certificateNo }))}
    />
  );
}
