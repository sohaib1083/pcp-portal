import { ProvinceInstitutions } from "@/components/ProvinceViews";
import { institutionRows, provinceInstitutions } from "@/lib/province-data";
import { requireProvince } from "@/lib/province";

export const dynamic = "force-dynamic";

/** Institutions in the officer's province and the status of their programmes. */
export default async function Page() {
  const ctx = await requireProvince();
  const rows = await institutionRows(await provinceInstitutions(ctx.province));
  return <ProvinceInstitutions province={ctx.province} rows={rows} />;
}
