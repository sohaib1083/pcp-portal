import { notFound } from "next/navigation";
import { ProvincePharmacist } from "@/components/ProvinceViews";
import { db } from "@/db";
import { audit } from "@/lib/audit";
import { councilPharmacistRecord } from "@/lib/province-data";
import { pharmacistInProvince, requireProvince } from "@/lib/province";

export const dynamic = "force-dynamic";

/** One registration issued by this council. Another council's registration is a plain 404. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireProvince();
  const id = Number((await params).id);
  const p = await pharmacistInProvince(id, ctx.province);
  if (!p) {
    await audit(db, { actor: ctx.user.username, action: "province.access.denied", entity: "pharmacist", entityId: String((await params).id).slice(0, 20), details: { province: ctx.province } });
    notFound();
  }
  await audit(db, { actor: ctx.user.username, action: "pharmacist.viewed", entity: "pharmacist", entityId: p.regNo, details: { cnicShown: false, by: "provincial council" } });
  return <ProvincePharmacist councilName={ctx.councilName} {...await councilPharmacistRecord(p)} />;
}
