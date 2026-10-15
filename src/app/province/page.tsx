import { ProvinceDashboard } from "@/components/ProvinceViews";
import { audit } from "@/lib/audit";
import { db } from "@/db";
import { councilFileRows, councilRegister, institutionRows, provinceDeficiencyRows, provinceInspectionRows, provinceInstitutions, validationQueue } from "@/lib/province-data";
import { requireProvince } from "@/lib/province";

export const dynamic = "force-dynamic";

/** The provincial officer lands on work: what to validate, what is blocked, what PCP decided (RFP 4.1.2, 4.1.4). */
export default async function ProvincePage() {
  const ctx = await requireProvince();
  const insts = await institutionRows(await provinceInstitutions(ctx.province));
  const [register, queue, files, inspections, deficiencies] = await Promise.all([
    ctx.council ? councilRegister(ctx.council, { page: 1 }, 1) : null,
    ctx.council ? validationQueue(ctx.council) : { waiting: [], decided: [] },
    ctx.council ? councilFileRows(ctx.council) : [],
    provinceInspectionRows(ctx.province),
    provinceDeficiencyRows(ctx.province),
  ]);
  await audit(db, { actor: ctx.user.username, action: "province.dashboard.viewed", entity: "province", entityId: ctx.province });
  const year = String(new Date().getFullYear());
  const soon = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ProvinceDashboard
      province={ctx.province}
      councilName={ctx.councilName}
      hasCouncil={!!ctx.council}
      stats={{
        institutions: insts.length,
        programmes: insts.reduce((a, i) => a + i.programmes.filter((p) => p.nocStatus === "APPROVED").length, 0),
        students: insts.reduce((a, i) => a + i.students, 0),
        pharmacists: register ? Object.values(register.byStatus).reduce((a, x) => a + x, 0) : 0,
        activePharmacists: register?.byStatus.ACTIVE ?? 0,
        inspections: inspections.filter((i) => i.scheduledFor.startsWith(year)).length,
        deficiencies: deficiencies.filter((d) => ["OUTSTANDING", "REJECTED"].includes(d.status)).length,
        toValidate: queue.waiting.length,
      }}
      waiting={queue.waiting.slice(0, 5)}
      returnedFiles={files.filter((f) => f.status === "RETURNED").slice(0, 3)}
      expiring={insts.flatMap((i) => i.programmes.filter((p) => p.accreditationStatus !== "NONE" && p.validUntil && p.validUntil <= soon).map((p) => ({ code: i.code, name: i.name, type: p.type, validUntil: p.validUntil!, lapsed: p.validUntil! < today })))}
      upcoming={inspections.filter((i) => i.status === "SCHEDULED").slice(0, 5)}
      decided={queue.decided.slice(0, 6)}
    />
  );
}
