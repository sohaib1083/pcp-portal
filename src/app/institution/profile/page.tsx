import { asc, desc, eq } from "drizzle-orm";
import InstitutionProfileView from "@/components/InstitutionProfileView";
import { db, schema } from "@/db";
import { ruleList } from "@/lib/onboarding";
import { can } from "@/lib/roles";
import { requireInstitution } from "@/lib/session";

export const metadata = { title: "Profile & campuses" };

export default async function InstitutionProfilePage() {
  const { user, inst } = await requireInstitution();
  const [campuses, programs, apps, provinces] = await Promise.all([
    db.select().from(schema.campuses).where(eq(schema.campuses.institutionId, inst.id)).orderBy(desc(schema.campuses.isMain), asc(schema.campuses.id)),
    db.select().from(schema.programs).where(eq(schema.programs.institutionId, inst.id)).orderBy(asc(schema.programs.type)),
    db.select({ campusId: schema.applications.campusId }).from(schema.applications).where(eq(schema.applications.institutionId, inst.id)),
    ruleList("ref.provinces"),
  ]);
  const onboarding = inst.onboardingId ? await db.query.onboardingRequests.findFirst({ where: eq(schema.onboardingRequests.id, inst.onboardingId) }) : null;
  return (
    <InstitutionProfileView
      canEdit={can(user.roles, "inst.profile.edit")}
      provinces={provinces}
      inst={{
        code: inst.code,
        shortCode: inst.shortCode,
        name: inst.name,
        sector: inst.sector,
        status: inst.status,
        province: inst.province,
        city: inst.city,
        affiliatedUniversity: inst.affiliatedUniversity,
        establishedYear: inst.establishedYear,
        email: inst.email,
        phone: inst.phone,
        address: inst.address,
        website: inst.website,
        registeredVia: onboarding ? onboarding.ref : null,
      }}
      campuses={campuses.map((c) => ({ id: c.id, name: c.name, city: c.city, province: c.province, address: c.address, isMain: c.isMain, cases: apps.filter((a) => a.campusId === c.id).length }))}
      programs={programs.map((p) => ({
        type: p.type,
        nocStatus: p.nocStatus,
        nocNumber: p.nocNumber,
        approvedIntake: p.approvedIntake,
        accreditationStatus: p.accreditationStatus,
        accreditationValidUntil: p.accreditationValidUntil,
      }))}
    />
  );
}
