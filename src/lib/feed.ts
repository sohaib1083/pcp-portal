// Read-only data feed for the Ministry and the provincial councils (guide section 14).
// Each call needs an X-PCP-Feed-Key header that matches an active key in the "feed.keys" rule.
// The feed never returns CNICs or personal contact data (phone, email, address), and every call is audited.
import { eq, ne, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "./audit";
import { verifyFeedKey } from "./accounts";
import { PROGRAMME_LABELS } from "./report-types";

export const FEED_HEADER = "X-PCP-Feed-Key";

export const FEED_ENDPOINTS = [
  {
    path: "/api/feed/institutions",
    resource: "institutions",
    title: "Institutions",
    what: "Every registered institution with its PCP ID, province, sector, status and programmes.",
    fields: "pcpId, shortCode, name, city, province, sector, status, affiliatedUniversity, establishedYear, programmes[]",
    filters: "province, sector",
  },
  {
    path: "/api/feed/programmes",
    resource: "programmes",
    title: "Programmes",
    what: "Each PharmD and Pharmacy Technician programme: NOC, approved intake, accreditation and current numbers.",
    fields: "institution, institutionName, province, sector, programme, nocStatus, nocNumber, approvedIntake, accreditationStatus, accreditationValidUntil, currentStudents, activeFaculty",
    filters: "province, sector, programme (PHARMD or TECH)",
  },
  {
    path: "/api/feed/statistics",
    resource: "statistics",
    title: "Statistics",
    what: "National totals: institutions by province and sector, programmes, enrolment and graduates by year, faculty, open cases.",
    fields: "institutions, programmes, students, faculty, cases",
    filters: "none",
  },
  {
    path: "/api/feed/pharmacists",
    resource: "pharmacists",
    title: "Pharmacist register",
    what: "Public-check fields only: registration number, name, category, issuing council, status and validity.",
    fields: "regNo, name, category, council, status, validUntil, university, graduationYear",
    filters: "council, status",
  },
] as const;

export type FeedResource = (typeof FEED_ENDPOINTS)[number]["resource"];

const n = sql<number>`count(*)::int`;
const str = (u: URL, k: string) => u.searchParams.get(k)?.trim().slice(0, 60) || undefined;

async function institutionsFeed(u: URL) {
  const province = str(u, "province");
  const sector = str(u, "sector");
  const insts = (await db.select().from(schema.institutions).orderBy(schema.institutions.code)).filter((i) => (!province || i.province === province) && (!sector || i.sector === sector));
  const progs = await db.select().from(schema.programs);
  return {
    filters: { province: province ?? null, sector: sector ?? null },
    data: insts.map((i) => ({
      pcpId: i.code,
      shortCode: i.shortCode,
      name: i.name,
      city: i.city,
      province: i.province,
      sector: i.sector,
      status: i.status,
      affiliatedUniversity: i.affiliatedUniversity,
      establishedYear: i.establishedYear,
      programmes: progs
        .filter((p) => p.institutionId === i.id)
        .map((p) => ({ programme: p.type, nocStatus: p.nocStatus, accreditationStatus: p.accreditationStatus, accreditationValidUntil: p.accreditationValidUntil })),
    })),
  };
}

async function programmesFeed(u: URL) {
  const province = str(u, "province");
  const sector = str(u, "sector");
  const programme = str(u, "programme")?.toUpperCase();
  const insts = await db.select().from(schema.institutions);
  const progs = await db.select().from(schema.programs);
  const stu = await db
    .select({ inst: schema.students.institutionId, type: schema.students.programType, n })
    .from(schema.students)
    .where(notInArray(schema.students.status, ["GRADUATED", "WITHDRAWN"]))
    .groupBy(schema.students.institutionId, schema.students.programType);
  const fac = await db
    .select({ inst: schema.facultyLinks.institutionId, type: schema.facultyLinks.programType, n })
    .from(schema.facultyLinks)
    .where(eq(schema.facultyLinks.status, "ACTIVE"))
    .groupBy(schema.facultyLinks.institutionId, schema.facultyLinks.programType);
  const data = progs
    .map((p) => ({ p, i: insts.find((x) => x.id === p.institutionId)! }))
    .filter(({ p, i }) => i && (!province || i.province === province) && (!sector || i.sector === sector) && (!programme || p.type === programme))
    .sort((a, b) => a.i.code.localeCompare(b.i.code) || a.p.type.localeCompare(b.p.type))
    .map(({ p, i }) => ({
      institution: i.code,
      institutionName: i.name,
      province: i.province,
      sector: i.sector,
      programme: p.type,
      programmeName: PROGRAMME_LABELS[p.type] ?? p.type,
      nocStatus: p.nocStatus,
      nocNumber: p.nocStatus === "APPROVED" ? p.nocNumber : null,
      approvedIntake: p.approvedIntake,
      accreditationStatus: p.accreditationStatus,
      accreditationValidUntil: p.accreditationValidUntil,
      currentStudents: stu.find((s) => s.inst === i.id && s.type === p.type)?.n ?? 0,
      activeFaculty: fac.find((s) => s.inst === i.id && s.type === p.type)?.n ?? 0,
    }));
  return { filters: { province: province ?? null, sector: sector ?? null, programme: programme ?? null }, data };
}

async function statisticsFeed() {
  const insts = await db.select().from(schema.institutions);
  const progs = await db.select().from(schema.programs);
  const tally = <T,>(xs: T[], key: (x: T) => string) => xs.reduce<Record<string, number>>((a, x) => ((a[key(x)] = (a[key(x)] ?? 0) + 1), a), {});
  const enrol = await db
    .select({ year: schema.students.enrollmentYear, type: schema.students.programType, n })
    .from(schema.students)
    .groupBy(schema.students.enrollmentYear, schema.students.programType)
    .orderBy(schema.students.enrollmentYear);
  const gy = sql<number>`coalesce(${schema.students.resultYear}, ${schema.students.enrollmentYear} + case when ${schema.students.programType} = 'PHARMD' then 5 else 2 end)::int`;
  const grads = await db.select({ year: gy, type: schema.students.programType, n }).from(schema.students).where(eq(schema.students.status, "GRADUATED")).groupBy(gy, schema.students.programType).orderBy(gy);
  const [{ current }] = await db.select({ current: n }).from(schema.students).where(notInArray(schema.students.status, ["GRADUATED", "WITHDRAWN"]));
  const facQual = await db
    .select({ k: schema.faculty.qualification, n })
    .from(schema.faculty)
    .innerJoin(schema.facultyLinks, eq(schema.facultyLinks.facultyId, schema.faculty.id))
    .where(eq(schema.facultyLinks.status, "ACTIVE"))
    .groupBy(schema.faculty.qualification);
  const cases = await db.select({ k: schema.applications.status, n }).from(schema.applications).where(ne(schema.applications.status, "DRAFT")).groupBy(schema.applications.status);
  const byYear = <T extends { year: number; type: string; n: number }>(rows: T[]) =>
    [...new Set(rows.map((r) => r.year))].map((year) => ({ year, PHARMD: rows.find((r) => r.year === year && r.type === "PHARMD")?.n ?? 0, TECH: rows.find((r) => r.year === year && r.type === "TECH")?.n ?? 0 }));
  return {
    filters: {},
    data: [
      {
        institutions: { total: insts.length, byProvince: tally(insts, (i) => i.province), bySector: tally(insts, (i) => i.sector), byStatus: tally(insts, (i) => i.status) },
        programmes: {
          pharmdNocApproved: progs.filter((p) => p.type === "PHARMD" && p.nocStatus === "APPROVED").length,
          technicianNocApproved: progs.filter((p) => p.type === "TECH" && p.nocStatus === "APPROVED").length,
          nocStatus: tally(progs, (p) => p.nocStatus),
          accreditationStatus: tally(progs, (p) => p.accreditationStatus),
          approvedIntake: { PHARMD: progs.filter((p) => p.type === "PHARMD").reduce((a, p) => a + p.approvedIntake, 0), TECH: progs.filter((p) => p.type === "TECH").reduce((a, p) => a + p.approvedIntake, 0) },
        },
        students: { current, enrolmentByIntakeYear: byYear(enrol), graduatesByYear: byYear(grads) },
        faculty: { active: facQual.reduce((a, x) => a + x.n, 0), byQualification: Object.fromEntries(facQual.map((x) => [x.k, x.n])) },
        cases: { open: cases.filter((c) => !["NOC_ISSUED", "REJECTED"].includes(c.k)).reduce((a, c) => a + c.n, 0), byStatus: Object.fromEntries(cases.map((c) => [c.k, c.n])) },
      },
    ],
  };
}

async function pharmacistsFeed(u: URL) {
  const council = str(u, "council");
  const status = str(u, "status")?.toUpperCase();
  const rows = (await db.select().from(schema.pharmacists).orderBy(schema.pharmacists.regNo)).filter((p) => (!council || p.council === council) && (!status || p.status === status));
  return {
    filters: { council: council ?? null, status: status ?? null },
    data: rows.map((p) => ({ regNo: p.regNo, name: p.fullName, category: p.category, council: p.council, status: p.status, validUntil: p.validUntil, university: p.university, graduationYear: p.graduationYear })),
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

/** Check the key, build the resource, audit the call. */
export async function serveFeed(req: Request, resource: string) {
  const endpoint = FEED_ENDPOINTS.find((e) => e.resource === resource);
  const given = req.headers.get(FEED_HEADER);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  if (!endpoint) return json(404, { error: `No feed called "${resource}". See /api/feed for the list.` });
  if (!given) {
    await audit(db, { actor: "feed:anonymous", action: "feed.denied", entity: "feed", entityId: resource, details: { reason: "missing key", ip } });
    return json(401, { error: `Missing ${FEED_HEADER} header. Ask PCP for a feed key.` });
  }
  const key = await verifyFeedKey(given);
  if (!key) {
    await audit(db, { actor: "feed:unknown", action: "feed.denied", entity: "feed", entityId: resource, details: { reason: "unknown or revoked key", keyPrefix: given.slice(0, 14), ip } });
    return json(403, { error: "This feed key is not valid or has been revoked. Ask PCP for a new key." });
  }
  const u = new URL(req.url);
  const out =
    resource === "institutions" ? await institutionsFeed(u) : resource === "programmes" ? await programmesFeed(u) : resource === "statistics" ? await statisticsFeed() : await pharmacistsFeed(u);
  await audit(db, { actor: `feed:${key.id}`, action: "feed.called", entity: "feed", entityId: resource, details: { keyName: key.name, count: out.data.length, filters: out.filters, ip } });
  return json(200, {
    source: "Pharmacy Council of Pakistan, PCP Digital Portal (demo: fictional data)",
    feed: resource,
    generatedAt: new Date().toISOString(),
    keyHolder: key.name,
    filters: out.filters,
    count: out.data.length,
    note: resource === "pharmacists" && out.data.length === 0 ? "The pharmacist register has no rows yet." : undefined,
    data: out.data,
  });
}

/** Recent feed calls for the Reports page. */
export async function recentFeedCalls(limit = 10) {
  return db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.entity, "feed"))
    .orderBy(sql`${schema.auditLog.id} desc`)
    .limit(limit);
}
