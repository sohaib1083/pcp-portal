// Seed data for the faculty module. Runs after the core seed (see scripts/seed/index.ts).
// Adds people whose earlier appointment ended (free to link by ID), one link request and one change request
// for PCP's queue, a decided change request for history, and the annual faculty confirmations.
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../src/db";
import { audit } from "../../src/lib/audit";
import { normalizeName } from "../../src/lib/names";

type Inst = typeof schema.institutions.$inferSelect;

export default async function seedFaculty(): Promise<string | void> {
  const inst: Record<string, Inst> = Object.fromEntries((await db.select().from(schema.institutions)).map((i) => [i.shortCode, i]));
  const res = await db.execute(sql`select coalesce(max(split_part(pcp_id, '-', 3)::int), 0) as n from faculty`);
  let facNo = Number((res.rows[0] as { n: number }).n);

  const person = async (f: { full: string; father: string; cnic: string; qual: string; spec: string; desig: string; reg: string }) => {
    facNo++;
    const [row] = await db
      .insert(schema.faculty)
      .values({
        pcpId: `PCP-FAC-${String(facNo).padStart(6, "0")}`,
        cnic: f.cnic,
        fullName: f.full,
        fatherName: f.father,
        nameNorm: normalizeName(f.full),
        qualification: f.qual,
        specialization: f.spec,
        pcpRegNo: f.reg,
        designation: f.desig,
        verificationStatus: "VERIFIED",
      })
      .returning();
    return row;
  };
  const link = async (facultyId: number, s: string, programType: string, status: string, startDate: string, endDate: string | null = null, createdBy = "system") => {
    const [row] = await db.insert(schema.facultyLinks).values({ facultyId, institutionId: inst[s].id, programType, status, startDate, endDate, createdBy }).returning();
    return row;
  };

  // 1. Free to link by ID: their previous appointment ended, the history is kept.
  const farhan = await person({ full: "Dr. Farhan Saeed", father: "Saeed Akhtar", cnic: "61101-4455667-1", qual: "PhD", spec: "Pharmacology", desig: "Assistant Professor", reg: "PC-48213" });
  const farhanLink = await link(farhan.id, "NHC", "PHARMD", "ENDED", "2019-09-01", "2026-07-31", "nhc.poc");
  await db.insert(schema.facultyChangeRequests).values({
    ref: "FCR-2026-0001",
    facultyId: farhan.id,
    linkId: farhanLink.id,
    institutionId: inst.NHC.id,
    kind: "END_LINK",
    details: { changes: { status: { from: "ACTIVE", to: "ENDED" }, endDate: { from: null, to: "2026-07-31" } }, category: "Transfer" },
    reason: "Transfer: moved to Islamabad at his own request",
    status: "APPROVED",
    requestedBy: "nhc.poc",
    decidedBy: "pcp.verification",
    decisionNote: "Relieving letter checked",
    decidedAt: new Date("2026-07-28T10:00:00Z"),
    createdAt: new Date("2026-07-20T09:00:00Z"),
  });
  // A spelling variant of this name is the "Did you mean ...?" demo (Mohammad Yousaf / Muhammad Yousuf).
  const yousuf = await person({ full: "Dr. Muhammad Yousuf Qureshi", father: "Abdul Rauf Qureshi", cnic: "42101-3344556-7", qual: "PhD", spec: "Pharmaceutics", desig: "Associate Professor", reg: "PC-37702" });
  await link(yousuf.id, "CCP", "PHARMD", "ENDED", "2016-02-01", "2025-12-31", "ccp.poc");

  // 2. A link request in PCP's queue: Ravi Bank University asks to link a lecturer who left Sindh Coastal.
  const hina = await person({ full: "Dr. Hina Shafiq", father: "Muhammad Shafiq", cnic: "35202-6677889-4", qual: "MPhil", spec: "Pharmacy Practice", desig: "Lecturer", reg: "PC-51190" });
  await link(hina.id, "SCU", "TECH", "ENDED", "2021-03-01", "2026-06-30", "scu.poc");
  const hinaReq = await link(hina.id, "RBU", "TECH", "REQUESTED", "2026-09-29", null, "rbu.poc");
  await db.insert(schema.facultyChangeRequests).values({
    ref: "FCR-2026-0002",
    facultyId: hina.id,
    linkId: hinaReq.id,
    institutionId: inst.RBU.id,
    kind: "NEW_LINK",
    details: { changes: { programType: { from: null, to: "TECH" } } },
    reason: "New appointment as Lecturer, Pharmacy Technician",
    requestedBy: "rbu.poc",
    createdAt: new Date("2026-09-29T08:30:00Z"),
  });

  // 3. A change request on a verified Riverside appointment, waiting for PCP.
  const [target] = await db
    .select({ id: schema.faculty.id, linkId: schema.facultyLinks.id, designation: schema.faculty.designation, pcpId: schema.faculty.pcpId })
    .from(schema.facultyLinks)
    .innerJoin(schema.faculty, eq(schema.faculty.id, schema.facultyLinks.facultyId))
    .where(and(eq(schema.facultyLinks.institutionId, inst.RUH.id), eq(schema.facultyLinks.programType, "PHARMD"), eq(schema.facultyLinks.status, "ACTIVE"), eq(schema.faculty.verificationStatus, "VERIFIED"), sql`${schema.faculty.pcpId} <> 'PCP-FAC-000001'`, sql`${schema.faculty.designation} <> 'Professor'`))
    .orderBy(asc(schema.faculty.id))
    .limit(1);
  const ladder = ["Lecturer", "Assistant Professor", "Associate Professor", "Professor"];
  const to = ladder[Math.min(ladder.indexOf(target.designation) + 1, ladder.length - 1)];
  await db.insert(schema.facultyChangeRequests).values({
    ref: "FCR-2026-0003",
    facultyId: target.id,
    linkId: target.linkId,
    institutionId: inst.RUH.id,
    kind: "CHANGE_DESIGNATION",
    details: { changes: { designation: { from: target.designation, to } } },
    reason: "Promoted by the selection board on 12 September 2026",
    requestedBy: "ruh.poc",
    createdAt: new Date("2026-09-30T11:15:00Z"),
  });

  // 4. Annual faculty update: everyone confirmed 2025; two institutions have already confirmed 2026.
  const activeBy = await db
    .select({ institutionId: schema.facultyLinks.institutionId, n: sql<number>`count(*)::int` })
    .from(schema.facultyLinks)
    .where(eq(schema.facultyLinks.status, "ACTIVE"))
    .groupBy(schema.facultyLinks.institutionId);
  const active = (s: string) => activeBy.find((a) => a.institutionId === inst[s].id)?.n ?? 0;
  const confirmations = [
    ...Object.keys(inst).map((s) => ({ institutionId: inst[s].id, year: 2025, activeCount: Math.max(0, active(s) - 1), confirmedBy: `${s.toLowerCase()}.poc`, confirmedAt: new Date(`2025-12-${10 + (s.charCodeAt(0) % 15)}T09:00:00Z`) })),
    { institutionId: inst.RBU.id, year: 2026, activeCount: active("RBU"), confirmedBy: "rbu.poc", confirmedAt: new Date("2026-09-15T09:00:00Z") },
    { institutionId: inst.SCU.id, year: 2026, activeCount: active("SCU"), confirmedBy: "scu.poc", confirmedAt: new Date("2026-09-22T09:00:00Z") },
  ];
  await db.insert(schema.facultyAnnualConfirmations).values(confirmations);

  await db.insert(schema.notifications).values([
    { audience: "role:pcp_verification", title: "Faculty link request FCR-2026-0002", body: "RBU asks to link Dr. Hina Shafiq to its Pharmacy Technician programme.", link: "/pcp/verification?tab=links" },
    { audience: "role:pcp_verification", title: "Faculty change request FCR-2026-0003", body: `RUH: change designation for ${target.pcpId} to ${to}.`, link: "/pcp/verification?tab=changes" },
  ]);
  for (const [ref, pcpId, action] of [
    ["FCR-2026-0001", farhan.pcpId, "faculty.change.approved"],
    ["FCR-2026-0002", hina.pcpId, "faculty.link.requested"],
    ["FCR-2026-0003", target.pcpId, "faculty.change.requested"],
  ])
    await audit(db, { actor: "system", action, entity: "faculty", entityId: pcpId, details: { ref, seeded: true } });

  return `3 free or requested people (${farhan.pcpId}..${hina.pcpId}), 3 change requests (1 link request and 1 change pending), ${confirmations.length} annual confirmations`;
}
