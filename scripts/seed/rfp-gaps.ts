// Seed data for the RFP gap module (Oct 2026):
// - rules inspection.team (automated team suggestion) and committee.quorum (meeting quorum)
// - six more inspection panel members as staff rows (not Keycloak users), some on open visits, one with a
//   declared conflict, so the team suggestion has real choices to make
// - the Council and committee members register (Annexure-III "Members Ledger"): 13 members, seats, terms and
//   declared conflicts, including external members who do not sign in
// - attendance and recusals for the two closed meetings, with their minutes re-rendered to show them
import { and, eq } from "drizzle-orm";
import { db, schema } from "../../src/db";
import { audit } from "../../src/lib/audit";
import { renderMinutes } from "../../src/lib/council";
import { DEFAULT_TEAM_RULE } from "../../src/lib/inspection-team";
import { DEFAULT_QUORUM, recordRecusals } from "../../src/lib/members";
import { putFileAt } from "../../src/lib/storage";

const INSPECTORS: [string, string, string][] = [
  ["pcp.inspector3", "Dr. Farah Naz Baloch", "Balochistan"],
  ["pcp.inspector4", "Dr. Imtiaz Ali Memon", "Sindh"],
  ["pcp.inspector5", "Dr. Sadaf Iqbal", "Islamabad Capital Territory"],
  ["pcp.inspector6", "Dr. Shabbir Hussain Turi", "Gilgit-Baltistan"],
  ["pcp.inspector7", "Dr. Gul Rukh Afridi", "Khyber Pakhtunkhwa"],
  ["pcp.inspector8", "Dr. Asma Rizvi", "Punjab"],
];

type Seat = { committee: string; role: "CHAIR" | "VICE_CHAIR" | "MEMBER" | "SECRETARY"; start: string; end: string | null; ended?: { on: string; reason: string } };
type MemberSeed = {
  username?: string;
  honorific?: string;
  name?: string;
  designation: string;
  body: string;
  category: "NOMINATED" | "ELECTED" | "EX_OFFICIO" | "CO_OPTED";
  province?: string;
  email?: string;
  mobile?: string;
  seats: Seat[];
  conflicts?: [string, string][]; // institution short code, reason
};

const COUNCIL = (role: Seat["role"] = "MEMBER"): Seat => ({ committee: "Council", role, start: "2024-03-01", end: "2029-02-28" });
const CMT = (committee: string, role: Seat["role"] = "MEMBER", end = "2027-06-30"): Seat => ({ committee, role, start: "2025-07-01", end });

const MEMBERS: MemberSeed[] = [
  { honorific: "Prof. Dr.", name: "Shahid Mahmood Ansari", designation: "President, Pharmacy Council of Pakistan", body: "Federal Government (Ministry of National Health Services)", category: "NOMINATED", province: "Islamabad Capital Territory", email: "president@pcp-council.example.pk", mobile: "0300-5551001", seats: [COUNCIL("CHAIR")] },
  { honorific: "Dr.", name: "Shahnaz Qadir", designation: "Vice President, Pharmacy Council of Pakistan", body: "Elected by the Council", category: "ELECTED", province: "Sindh", email: "shahnaz.qadir@example.pk", mobile: "0321-5551002", seats: [COUNCIL("VICE_CHAIR")] },
  { username: "pcp.secretary", designation: "Secretary, Pharmacy Council of Pakistan", body: "PCP secretariat", category: "EX_OFFICIO", seats: [COUNCIL("SECRETARY"), CMT("Accreditation Committee", "CHAIR"), CMT("Appeals Committee", "CHAIR"), CMT("Finance Committee")] },
  { honorific: "Prof. Dr.", name: "Ghulam Murtaza Khan", designation: "Dean, Faculty of Pharmacy, Ravi Bank University", body: "Universities of Punjab (nominated by the vice chancellors)", category: "NOMINATED", province: "Punjab", email: "gm.khan@rbu.example.edu.pk", mobile: "0333-5551004", seats: [COUNCIL(), CMT("Accreditation Committee")], conflicts: [["RBU", "Dean of the Faculty of Pharmacy at Ravi Bank University"]] },
  { honorific: "Prof. Dr.", name: "Meher Afroz", designation: "Director, Quality Assurance, Higher Education Commission", body: "Higher Education Commission", category: "NOMINATED", province: "Islamabad Capital Territory", email: "meher.afroz@hec.example.gov.pk", mobile: "0300-5551005", seats: [COUNCIL(), CMT("Accreditation Committee")] },
  { honorific: "Dr.", name: "Saeeda Jamali", designation: "Director, Pharmacy Services, Drug Regulatory Authority of Pakistan", body: "Drug Regulatory Authority of Pakistan", category: "NOMINATED", province: "Islamabad Capital Territory", email: "saeeda.jamali@drap.example.gov.pk", mobile: "0345-5551006", seats: [COUNCIL(), CMT("Inspection Committee")] },
  { honorific: "Prof. Dr.", name: "Abdul Wahab Kakar", designation: "Professor of Pharmacology (retired), Quetta", body: "Government of Balochistan", category: "NOMINATED", province: "Balochistan", email: "aw.kakar@example.pk", mobile: "0301-5551007", seats: [COUNCIL()], conflicts: [["BVU", "Visiting professor at Bolan Valley University"]] },
  { honorific: "Dr.", name: "Farzana Shaikh", designation: "Chief Pharmacist, Civil Hospital Karachi", body: "Elected by registered pharmacists, Sindh", category: "ELECTED", province: "Sindh", email: "farzana.shaikh@example.pk", mobile: "0322-5551008", seats: [COUNCIL()], conflicts: [["CCP", "Spouse sits on the board of governors of Clifton College of Pharmacy"]] },
  { honorific: "Dr.", name: "Haroon Khan Yousafzai", designation: "Deputy Director Health (Pharmacy), Khyber Pakhtunkhwa", body: "Government of Khyber Pakhtunkhwa", category: "NOMINATED", province: "Khyber Pakhtunkhwa", email: "haroon.yousafzai@health.example.gov.pk", mobile: "0311-5551009", seats: [COUNCIL()] },
  { honorific: "Mr.", name: "Asif Rasheed", designation: "Joint Secretary, Ministry of National Health Services", body: "Federal Government (Ministry of National Health Services)", category: "NOMINATED", province: "Islamabad Capital Territory", email: "asif.rasheed@nhsrc.example.gov.pk", mobile: "0300-5551010", seats: [COUNCIL(), CMT("Finance Committee")] },
  { honorific: "Dr.", name: "Lubna Sheikh", designation: "Hospital pharmacist, Lahore", body: "Elected by registered pharmacists, Punjab", category: "ELECTED", province: "Punjab", email: "lubna.sheikh@example.pk", mobile: "0331-5551011", seats: [COUNCIL()], conflicts: [["FRU", "Taught at Five Rivers University until 2024"]] },
  { honorific: "Dr.", name: "Arif Hussain Shigri", designation: "Director Health Services, Gilgit-Baltistan", body: "Government of Gilgit-Baltistan", category: "NOMINATED", province: "Gilgit-Baltistan", email: "arif.shigri@example.gov.pk", mobile: "0355-5551012", seats: [COUNCIL()] },
  { honorific: "Dr.", name: "Tahira Saleem", designation: "Former member; community pharmacist, Peshawar", body: "Elected by registered pharmacists, Khyber Pakhtunkhwa", category: "ELECTED", province: "Khyber Pakhtunkhwa", email: "tahira.saleem@example.pk", mobile: "0312-5551013", seats: [{ committee: "Council", role: "MEMBER", start: "2019-03-01", end: "2024-02-29", ended: { on: "2024-02-29", reason: "Term completed" } }] },
  { honorific: "Mr.", name: "Aftab Ahmed Qureshi", designation: "Advocate Supreme Court, legal member", body: "Co-opted by the Council", category: "CO_OPTED", province: "Islamabad Capital Territory", email: "aftab.qureshi@law.example.pk", mobile: "0300-5551014", seats: [{ committee: "Appeals Committee", role: "MEMBER", start: "2024-12-01", end: "2026-11-30" }] },
  // PCP officers who sit on committees (they sign in; the register links them by username)
  { username: "pcp.technical", designation: "Technical officer, PCP", body: "PCP secretariat", category: "EX_OFFICIO", seats: [CMT("Accreditation Committee")] },
  { username: "pcp.officer", designation: "Case officer, PCP", body: "PCP secretariat", category: "EX_OFFICIO", seats: [CMT("Accreditation Committee"), CMT("Inspection Committee")] },
  { username: "pcp.verification", designation: "Verification officer, PCP", body: "PCP secretariat", category: "EX_OFFICIO", seats: [CMT("Accreditation Committee")] },
  { username: "pcp.coordinator", designation: "Inspection coordinator, PCP", body: "PCP secretariat", category: "EX_OFFICIO", seats: [CMT("Inspection Committee", "CHAIR")] },
  { username: "pcp.inspector", designation: "Inspection panel member, Punjab", body: "PCP inspection panel", category: "EX_OFFICIO", seats: [CMT("Inspection Committee")] },
  { username: "pcp.inspector2", designation: "Inspection panel member, Khyber Pakhtunkhwa", body: "PCP inspection panel", category: "EX_OFFICIO", seats: [CMT("Inspection Committee")] },
  { username: "pcp.legal", designation: "Legal officer, PCP", body: "PCP secretariat", category: "EX_OFFICIO", seats: [CMT("Appeals Committee")] },
  { username: "pcp.registration", designation: "Registration officer, PCP", body: "PCP secretariat", category: "EX_OFFICIO", seats: [CMT("Appeals Committee")] },
  { username: "pcp.accounts", designation: "Accounts officer, PCP", body: "PCP secretariat", category: "EX_OFFICIO", seats: [CMT("Finance Committee", "CHAIR")] },
  { username: "pcp.admin", designation: "Super administrator, PCP Digital Portal", body: "PCP secretariat", category: "EX_OFFICIO", seats: [CMT("Finance Committee")] },
];

/** "Dr. Nadia Hussain" -> ["Dr.", "Nadia Hussain"]. */
function splitName(full: string): [string | null, string] {
  const m = /^((?:Prof\.\s+)?(?:Dr\.|Mr\.|Ms\.|Prof\.))\s+(.*)$/.exec(full);
  return m ? [m[1], m[2]] : [null, full];
}

export default async function seedRfpGaps(): Promise<string | void> {
  const insts = await db.select().from(schema.institutions);
  const by = (s: string) => insts.find((i) => i.shortCode === s);
  if (!by("RUH")) return "core institutions missing; skipped";

  // ---- Rules ----
  const haveRule = async (key: string) => !!(await db.query.rules.findFirst({ where: eq(schema.rules.key, key) }));
  if (!(await haveRule("inspection.team")))
    await db.insert(schema.rules).values({
      key: "inspection.team",
      version: 1,
      effectiveFrom: "2026-01-01",
      description: "Automated inspection team suggestion: a lead plus members, the notice the institution gets, the visit's service level from the technical review, the open-visit limit per panel member and the lead's experience",
      value: DEFAULT_TEAM_RULE,
    });
  if (!(await haveRule("committee.quorum")))
    await db.insert(schema.rules).values({
      key: "committee.quorum",
      version: 1,
      effectiveFrom: "2026-01-01",
      description: "Quorum for Council and committee meetings: a share of the voting members, with a minimum (the Secretary does not vote)",
      value: DEFAULT_QUORUM,
    });
  for (const r of ["inspection.team@v1", "committee.quorum@v1"]) await audit(db, { actor: "system", action: "rule.seeded", entity: "rule", entityId: r });

  // ---- Inspection panel: six more members (database staff rows; add them to Keycloak to let them sign in) ----
  for (const [username, name, province] of INSPECTORS)
    await db.insert(schema.staff).values({ username, displayName: name, email: `${username}@demo.pcp.local`, role: "pcp_inspector", province, createdBy: "system" }).onConflictDoNothing();
  // Workload: two of them are already members of open visits (never in the institution's own province).
  const open = await db.select({ id: schema.inspections.id, ref: schema.applications.ref }).from(schema.inspections).innerJoin(schema.applications, eq(schema.applications.id, schema.inspections.applicationId)).where(eq(schema.inspections.status, "SCHEDULED"));
  const visit = (ref: string) => open.find((o) => o.ref === ref)?.id;
  const extra: [string, string][] = [
    ["NOC-2026-0003", "pcp.inspector4"], // Five Rivers (Punjab); member from Sindh
    ["NOC-2026-0004", "pcp.inspector3"], // Sindh Coastal (Sindh); member from Balochistan
  ];
  for (const [ref, username] of extra) {
    const id = visit(ref);
    if (id) await db.insert(schema.inspectionTeam).values({ inspectionId: id, username, role: "MEMBER" });
  }
  // A declared conflict: the Islamabad panel member taught at Riverside (Khyber Pakhtunkhwa) last session.
  await db.insert(schema.conflictDeclarations).values({ username: "pcp.inspector5", institutionId: by("RUH")!.id, reason: "Visiting faculty at Riverside University in the 2025-26 session", createdAt: new Date(Date.now() - 40 * 86400000) });
  await audit(db, { actor: "pcp.coordinator", action: "inspection.conflict.declared", entity: "staff", entityId: "pcp.inspector5", details: { institution: by("RUH")!.code, seeded: true } });

  // ---- Members register ----
  const staff = await db.select().from(schema.staff);
  let n = 0;
  const memberIds: Record<string, number> = {};
  for (const m of MEMBERS) {
    const s = m.username ? staff.find((x) => x.username === m.username) : null;
    if (m.username && !s) continue;
    const [honorific, name] = s ? splitName(s.displayName) : [m.honorific ?? null, m.name!];
    const ref = `MBR-${String(++n).padStart(4, "0")}`;
    const [row] = await db
      .insert(schema.councilMembers)
      .values({ ref, honorific, name, designation: m.designation, nominatingBody: m.body, category: m.category, province: m.province ?? s?.province ?? null, email: m.email ?? s?.email ?? null, mobile: m.mobile ?? (s ? `0300-55${String(1100 + n).padStart(5, "0")}` : null), username: m.username ?? null, createdBy: "pcp.secretary", createdAt: new Date("2024-03-01T05:00:00Z") })
      .returning();
    memberIds[m.username ?? name] = row.id;
    for (const seat of m.seats)
      await db.insert(schema.committeeSeats).values({ memberId: row.id, committee: seat.committee, role: seat.role, termStart: seat.start, termEnd: seat.end, status: seat.ended ? "ENDED" : "ACTIVE", endedOn: seat.ended?.on ?? null, endReason: seat.ended?.reason ?? null, createdBy: "pcp.secretary" });
    for (const [code, reason] of m.conflicts ?? []) {
      const inst = by(code);
      if (inst) await db.insert(schema.memberConflicts).values({ memberId: row.id, institutionId: inst.id, reason, recordedBy: "pcp.secretary", createdAt: new Date("2025-07-01T05:00:00Z") });
    }
  }
  await audit(db, { actor: "pcp.secretary", action: "council.register.seeded", entity: "council_member", entityId: "register", details: { members: n, seeded: true } });

  // ---- Attendance and recusals at the closed meetings; their minutes are re-rendered (same document) to show them ----
  const absent: Record<string, string[]> = { Council: ["Arif Hussain Shigri", "Asif Rasheed"], "Accreditation Committee": ["pcp.verification"] };
  const closed = await db.select().from(schema.councilMeetings).where(eq(schema.councilMeetings.status, "CLOSED"));
  let recusals = 0;
  for (const m of closed) {
    const seats = (await db.select().from(schema.committeeSeats).where(eq(schema.committeeSeats.committee, m.committee))).filter((s) => s.termStart <= m.meetingDate && (!s.termEnd || s.termEnd >= m.meetingDate) && s.status === "ACTIVE");
    if (!seats.length) continue;
    const away = new Set((absent[m.committee] ?? []).map((k) => memberIds[k]).filter(Boolean));
    await db.insert(schema.meetingAttendance).values(seats.map((s) => ({ meetingId: m.id, memberId: s.memberId, present: !away.has(s.memberId), recordedBy: "pcp.secretary", recordedAt: m.startedAt ?? m.createdAt }))).onConflictDoNothing();
    recusals += (await recordRecusals(db, m.id)).length;
    if (m.minutesDocumentId) {
      const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, m.minutesDocumentId) });
      if (doc) {
        const { bytes } = await renderMinutes(db, m.id, { username: "pcp.secretary", name: "Dr. Nadia Hussain" });
        const stored = await putFileAt("misc", doc.folder, doc.version, doc.fileName, bytes);
        if (stored.key === doc.storageKey) await db.update(schema.documents).set({ sha256: stored.sha256, sizeBytes: bytes.length }).where(and(eq(schema.documents.id, doc.id)));
      }
    }
  }
  return `rules inspection.team and committee.quorum; ${INSPECTORS.length} more inspectors (${INSPECTORS.map((i) => i[0]).join(", ")}; staff rows only); register of ${n} members; attendance at ${closed.length} closed meetings with ${recusals} recusals`;
}
