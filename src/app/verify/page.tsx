import { eq, ilike, or } from "drizzle-orm";
import PublicVerify, { type PublicPharmacist } from "@/components/PublicVerify";
import { db, schema } from "@/db";
import { getLang } from "@/lib/i18n-server";
import { councilOfRegNo, normalizeRegNo } from "@/lib/register";

/** Public portal: shows only the fields PCP's draft lists for public verification. */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ q?: string; reg?: string; tab?: string }> }) {
  const { q, reg, tab } = await searchParams;
  const lang = await getLang();
  let results: { code: string; name: string; city: string; province: string; status: string; programs: { type: string; noc: string; nocNumber: string | null; acc: string; until: string | null }[] }[] = [];
  if (q && q.trim().length >= 2) {
    const term = `%${q.trim()}%`;
    const insts = await db.select().from(schema.institutions).where(or(ilike(schema.institutions.name, term), ilike(schema.institutions.code, term), ilike(schema.institutions.shortCode, term))).limit(10);
    const programs = await db.select().from(schema.programs);
    results = insts.map((i) => ({
      code: i.code,
      name: i.name,
      city: i.city,
      province: i.province,
      status: i.status,
      programs: programs
        .filter((p) => p.institutionId === i.id)
        .map((p) => ({ type: p.type, noc: p.nocStatus, nocNumber: p.nocStatus === "APPROVED" ? p.nocNumber : null, acc: p.accreditationStatus, until: p.accreditationValidUntil })),
    }));
  }

  // Pharmacist check (guide section 9): exact registration number only, so the register cannot be browsed.
  // Only the public fields leave the server: never CNIC, phone, email, address or practice place.
  let pharmacist: PublicPharmacist | null = null;
  let regResult: "found" | "notfound" | "badformat" | null = null;
  const regNo = reg ? normalizeRegNo(reg) : "";
  if (regNo) {
    const [row] = await db
      .select({ name: schema.pharmacists.fullName, regNo: schema.pharmacists.regNo, category: schema.pharmacists.category, status: schema.pharmacists.status, validUntil: schema.pharmacists.validUntil, council: schema.pharmacists.council })
      .from(schema.pharmacists)
      .where(eq(schema.pharmacists.regNo, regNo))
      .limit(1);
    pharmacist = row ?? null;
    regResult = row ? "found" : councilOfRegNo(regNo) ? "notfound" : "badformat";
  }
  const checkedAt = new Date().toLocaleString("en-GB", { timeZone: "Asia/Karachi", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " PKT";

  return <PublicVerify lang={lang} q={q ?? ""} reg={regNo} tab={tab ?? ""} results={results} searched={!!q} pharmacist={pharmacist} regResult={regResult} checkedAt={checkedAt} />;
}
