import { ProvinceInspections } from "@/components/ProvinceViews";
import { provinceDeficiencyRows, provinceInspectionRows } from "@/lib/province-data";
import { requireProvince } from "@/lib/province";

export const dynamic = "force-dynamic";

/** Inspections and outstanding deficiencies at institutions in the province. Read-only for the council. */
export default async function Page() {
  const ctx = await requireProvince();
  const [inspections, deficiencies] = await Promise.all([provinceInspectionRows(ctx.province), provinceDeficiencyRows(ctx.province)]);
  return <ProvinceInspections province={ctx.province} inspections={inspections} deficiencies={deficiencies} />;
}
