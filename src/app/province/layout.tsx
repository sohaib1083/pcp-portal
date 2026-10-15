import { and, eq, sql } from "drizzle-orm";
import SimpleAreaLayout from "@/components/SimpleAreaLayout";
import { db, schema } from "@/db";
import { requireOfficerCode } from "@/lib/officer-code";
import { requireProvince } from "@/lib/province";

export default async function ProvinceLayout({ children }: { children: React.ReactNode }) {
  const { user, province, councilName } = await requireProvince();
  // Two-step sign-in (RFP 4.1.3, 4.1.16): no /province page opens before the officer's one-time code.
  await requireOfficerCode(user.roles, "/province");
  const [{ waiting }] = await db
    .select({ waiting: sql<number>`count(*)::int` })
    .from(schema.practiceUpdates)
    .innerJoin(schema.pharmacists, eq(schema.pharmacists.id, schema.practiceUpdates.pharmacistId))
    .where(and(eq(schema.practiceUpdates.status, "WITH_COUNCIL"), eq(schema.pharmacists.council, province)));
  return (
    <SimpleAreaLayout
      kind="province"
      workspace={{ label: "Provincial council", name: councilName, code: province }}
      nav={[
        { href: "/province", label: "My province", icon: "region", group: "Overview" },
        { href: "/province/institutions", label: "Institutions", icon: "institutions", group: "Registry" },
        { href: "/province/pharmacists", label: "Pharmacists", icon: "pharmacists", group: "Registry", badge: waiting || undefined },
        { href: "/province/inspections", label: "Inspections", icon: "inspections", group: "Oversight" },
        { href: "/province/reports", label: "Reports & exports", icon: "reports", group: "Oversight" },
      ]}
    >
      {children}
    </SimpleAreaLayout>
  );
}
