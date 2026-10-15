import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { ProvinceInstitution } from "@/components/ProvinceViews";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { institutionRows, provinceDeficiencyRows, provinceInspectionRows } from "@/lib/province-data";
import { institutionInProvince, requireProvince } from "@/lib/province";

export const dynamic = "force-dynamic";

/** One institution in the officer's province. Another province's institution is a plain 404. */
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const ctx = await requireProvince();
  const code = decodeURIComponent((await params).code);
  const inst = await institutionInProvince(code, ctx.province);
  if (!inst) {
    await audit(db, { actor: ctx.user.username, action: "province.access.denied", entity: "institution", entityId: code.slice(0, 40), details: { province: ctx.province } });
    notFound();
  }
  const [[row], cases, inspections, deficiencies, byYear] = await Promise.all([
    institutionRows([inst]),
    db.select().from(schema.applications).where(eq(schema.applications.institutionId, inst.id)).orderBy(desc(schema.applications.createdAt)),
    provinceInspectionRows(ctx.province),
    provinceDeficiencyRows(ctx.province),
    db
      .select({ year: schema.students.enrollmentYear, type: schema.students.programType, status: schema.students.status })
      .from(schema.students)
      .where(eq(schema.students.institutionId, inst.id)),
  ]);
  await audit(db, { actor: ctx.user.username, action: "province.institution.viewed", entity: "institution", entityId: inst.code });
  const years = [...new Set(byYear.map((s) => s.year))].sort((a, b) => b - a).slice(0, 6);
  return (
    <ProvinceInstitution
      inst={{ code: inst.code, name: inst.name, shortCode: inst.shortCode, city: inst.city, province: inst.province, sector: inst.sector, status: inst.status, affiliatedUniversity: inst.affiliatedUniversity, establishedYear: inst.establishedYear, website: inst.website }}
      row={row}
      cases={cases.filter((c) => c.status !== "DRAFT").map((c) => ({ ref: c.ref, kind: c.kind, programType: c.programType, status: c.status, submittedAt: c.submittedAt?.toISOString() ?? null, certificateNo: c.certificateNo, validUntil: c.validUntil }))}
      inspections={inspections.filter((i) => i.inst.code === inst.code)}
      deficiencies={deficiencies.filter((d) => d.inst.code === inst.code)}
      intake={years.map((y) => ({
        year: y,
        pharmd: byYear.filter((s) => s.year === y && s.type === "PHARMD").length,
        tech: byYear.filter((s) => s.year === y && s.type === "TECH").length,
        graduated: byYear.filter((s) => s.year === y && s.status === "GRADUATED").length,
      }))}
    />
  );
}
