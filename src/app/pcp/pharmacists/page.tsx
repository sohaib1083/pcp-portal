import { redirect } from "next/navigation";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import PharmacistRegister from "@/components/PharmacistRegister";
import { db, schema } from "@/db";
import { CATEGORIES, STATUSES, isCouncil } from "@/lib/register";
import { can } from "@/lib/roles";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 20;

/** Pharmacist register: the registration officer manages it; other PCP desk roles can look. */
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; council?: string; category?: string; status?: string; page?: string; tab?: string }> }) {
  const user = await requireUser("pcp");
  const canManage = can(user.roles, "pcp.pharmacists.manage");
  if (!canManage && !can(user.roles, "pcp.dashboard")) redirect("/home");
  const sp = await searchParams;
  const P = schema.pharmacists;

  const conds: SQL[] = [];
  const q = (sp.q ?? "").trim();
  if (q) {
    const term = `%${q}%`;
    const any = [ilike(P.fullName, term), ilike(P.regNo, term), ilike(P.university, term)];
    if (canManage) any.push(ilike(P.cnic, term)); // only officers who may see CNICs may search by one
    conds.push(or(...any)!);
  }
  if (sp.council && isCouncil(sp.council)) conds.push(eq(P.council, sp.council));
  if (sp.category && (CATEGORIES as readonly string[]).includes(sp.category)) conds.push(eq(P.category, sp.category));
  if (sp.status && (STATUSES as readonly string[]).includes(sp.status)) conds.push(eq(P.status, sp.status));
  const where = conds.length ? and(...conds) : undefined;
  const page = Math.max(1, Number(sp.page) || 1);

  const n = sql<number>`count(*)::int`;
  const [[{ total }], rows, byStatus, pending, recent, imports] = await Promise.all([
    db.select({ total: n }).from(P).where(where),
    db
      .select({ id: P.id, regNo: P.regNo, fullName: P.fullName, council: P.council, category: P.category, status: P.status, validUntil: P.validUntil, university: P.university, practiceConfirmed: P.practiceConfirmed, practicePlace: P.practicePlace, designation: P.designation, username: P.username })
      .from(P)
      .where(where)
      .orderBy(asc(P.fullName), asc(P.regNo))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ status: P.status, n }).from(P).groupBy(P.status),
    db
      .select({ u: schema.practiceUpdates, p: { id: P.id, regNo: P.regNo, fullName: P.fullName, council: P.council, status: P.status, practicePlace: P.practicePlace, designation: P.designation, practiceConfirmed: P.practiceConfirmed }, doc: { id: schema.documents.id, fileName: schema.documents.fileName } })
      .from(schema.practiceUpdates)
      .innerJoin(P, eq(P.id, schema.practiceUpdates.pharmacistId))
      .leftJoin(schema.documents, eq(schema.documents.id, schema.practiceUpdates.evidenceDocumentId))
      .where(eq(schema.practiceUpdates.status, "PENDING"))
      .orderBy(asc(schema.practiceUpdates.submittedAt)),
    db
      .select({ u: schema.practiceUpdates, p: { id: P.id, regNo: P.regNo, fullName: P.fullName } })
      .from(schema.practiceUpdates)
      .innerJoin(P, eq(P.id, schema.practiceUpdates.pharmacistId))
      .where(inArray(schema.practiceUpdates.status, ["VERIFIED", "REJECTED"]))
      .orderBy(desc(schema.practiceUpdates.reviewedAt))
      .limit(8),
    db.select().from(schema.pharmacistImports).orderBy(desc(schema.pharmacistImports.createdAt)).limit(20),
  ]);
  const count = (s: string) => byStatus.find((x) => x.status === s)?.n ?? 0;

  return (
    <PharmacistRegister
      canManage={canManage}
      filters={{ q, council: sp.council ?? "", category: sp.category ?? "", status: sp.status ?? "", page, tab: sp.tab ?? "register" }}
      stats={{ total: byStatus.reduce((a, x) => a + x.n, 0), active: count("ACTIVE"), dormant: count("DORMANT"), suspended: count("SUSPENDED"), cancelled: count("CANCELLED"), pending: pending.length }}
      list={{ total, pageSize: PAGE_SIZE, rows: rows.map((r) => ({ ...r, practicePlace: r.practiceConfirmed ? r.practicePlace : null, designation: r.practiceConfirmed ? r.designation : null, hasLogin: !!r.username, username: undefined })) }}
      pending={pending.map(({ u, p, doc }) => ({
        id: u.id,
        practicePlace: u.practicePlace,
        designation: u.designation,
        submittedAt: u.submittedAt.toISOString(),
        evidence: doc?.id ? { id: doc.id, fileName: doc.fileName ?? "evidence" } : null,
        pharmacist: { id: p.id, regNo: p.regNo, fullName: p.fullName, council: p.council, status: p.status, current: p.practiceConfirmed ? `${p.designation}, ${p.practicePlace}` : null },
      }))}
      recent={recent.map(({ u, p }) => ({ id: u.id, status: u.status, practicePlace: u.practicePlace, designation: u.designation, reviewedBy: u.reviewedBy, reviewedAt: u.reviewedAt?.toISOString() ?? null, reviewNote: u.reviewNote, pharmacist: p }))}
      imports={imports.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() }))}
    />
  );
}
