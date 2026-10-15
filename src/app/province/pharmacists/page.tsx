import { ProvincePharmacists } from "@/components/ProvinceViews";
import { councilFileRows, councilRegister, validationQueue } from "@/lib/province-data";
import { requireProvince } from "@/lib/province";

export const dynamic = "force-dynamic";

/** The council's register in PCP's index, its validation queue and the register files it sent to PCP. */
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string; tab?: string }> }) {
  const ctx = await requireProvince();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  if (!ctx.council) return <ProvincePharmacists province={ctx.province} councilName={ctx.councilName} council={null} filters={{ q: "", status: "", page, tab: "register" }} register={null} queue={{ waiting: [], decided: [] }} files={[]} />;
  const [register, queue, files] = await Promise.all([councilRegister(ctx.council, { q: sp.q, status: sp.status, page }), validationQueue(ctx.council), councilFileRows(ctx.council)]);
  return (
    <ProvincePharmacists
      province={ctx.province}
      councilName={ctx.councilName}
      council={ctx.council}
      filters={{ q: sp.q ?? "", status: sp.status ?? "", page, tab: ["register", "validation", "files"].includes(sp.tab ?? "") ? sp.tab! : queue.waiting.length ? "validation" : "register" }}
      register={register}
      queue={queue}
      files={files}
    />
  );
}
