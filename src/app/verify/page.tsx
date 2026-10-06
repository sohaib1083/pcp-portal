import { ilike, or } from "drizzle-orm";
import PublicVerify from "@/components/PublicVerify";
import { db, schema } from "@/db";

/** Public portal: shows only the fields PCP's draft lists for public verification. */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ q?: string; reg?: string }> }) {
  const { q, reg } = await searchParams;
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
  return <PublicVerify q={q ?? ""} reg={reg ?? ""} results={results} searched={!!q} />;
}
