"use server";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { maskCnic, normalizeCnic, normalizeName } from "@/lib/names";
import { requireOtp } from "@/lib/otp";
import { availabilityFor, isVerifiedLink, linksFor, nextYearRef, notifyVerifiers, thisYear, today, type Availability, type Executor } from "@/lib/registry";
import { CHANGE_KIND_LABELS, DESIGNATIONS, QUALIFICATIONS } from "@/lib/registry-shared";
import { requireInstitution, requirePermission } from "@/lib/session";
import { notify } from "@/lib/util";
import { PROGRAM_LABELS } from "@/lib/workflow";

export type ActionResult = { ok: boolean; message: string; level?: "success" | "warning" | "error" };

/** A possible existing record for the person being added ("Did you mean PCP-FAC-000458?"). */
export type FacultySuggestion = {
  facultyId: number;
  pcpId: string;
  fullName: string;
  fatherName: string;
  qualification: string;
  specialization: string;
  designation: string;
  verificationStatus: string;
  match: "CNIC" | "REGNO" | "NAME";
  reason: string;
  score: number;
  availability: Availability;
};
export type AddFacultyResult = ActionResult & { suggestions?: FacultySuggestion[]; pcpId?: string };

export type FacultySearchResult = {
  facultyId: number;
  pcpId: string;
  fullName: string;
  qualification: string;
  specialization: string;
  designation: string;
  verificationStatus: string;
  cnic: string | null; // masked, and only when the search was by CNIC
  availability: Availability;
};

const FacultyInput = z.object({
  cnic: z.string().min(13),
  fullName: z.string().trim().min(3),
  fatherName: z.string().trim().min(3),
  qualification: z.enum(["PhD", "MPhil", "PharmD", "M.Pharm"]),
  specialization: z.string().min(2),
  designation: z.string().min(2),
  pcpRegNo: z.string().optional().nullable(),
  programType: z.enum(["PHARMD", "TECH"]),
});
type FacultyInputT = z.infer<typeof FacultyInput>;

function trigrams(s: string) {
  const t = new Set<string>();
  for (const w of s.split(" ").filter(Boolean)) {
    const p = `  ${w} `;
    for (let i = 0; i < p.length - 2; i++) t.add(p.slice(i, i + 3));
  }
  return t;
}
function similarity(a: string, b: string) {
  const A = trigrams(a);
  const B = trigrams(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

type FacultyRow = typeof schema.faculty.$inferSelect;
const suggestion = (p: FacultyRow, match: FacultySuggestion["match"], reason: string, score: number, availability: Availability): FacultySuggestion => ({
  facultyId: p.id,
  pcpId: p.pcpId,
  fullName: p.fullName,
  fatherName: p.fatherName,
  qualification: p.qualification,
  specialization: p.specialization,
  designation: p.designation,
  verificationStatus: p.verificationStatus,
  match,
  reason,
  score,
  availability,
});

/** The duplicate rule set: registration number, then name plus father's name after normalisation (trigram similarity). */
async function duplicateCandidates(f: FacultyInputT, institutionId: number): Promise<FacultySuggestion[]> {
  const found = new Map<number, { match: FacultySuggestion["match"]; reason: string; score: number }>();
  const reg = f.pcpRegNo?.trim();
  if (reg) {
    const same = await db
      .select({ id: schema.faculty.id })
      .from(schema.faculty)
      .where(and(sql`lower(trim(${schema.faculty.pcpRegNo})) = ${reg.toLowerCase()}`, ne(schema.faculty.verificationStatus, "REJECTED")));
    for (const r of same) found.set(r.id, { match: "REGNO", reason: `Same registration number (${reg})`, score: 1 });
  }
  const norm = normalizeName(f.fullName);
  const fatherNorm = normalizeName(f.fatherName);
  const candidates = await db.execute(sql`
    select id, father_name, similarity(name_norm, ${norm}) as s
    from faculty where verification_status <> 'REJECTED' and similarity(name_norm, ${norm}) > 0.55 order by s desc limit 5`);
  for (const c of candidates.rows as { id: number; father_name: string; s: number }[]) {
    const fs = similarity(fatherNorm, normalizeName(c.father_name));
    const score = Number((0.7 * Number(c.s) + 0.3 * fs).toFixed(2));
    if (score < 0.6 || found.has(c.id)) continue;
    found.set(c.id, { match: "NAME", reason: `Name ${Math.round(Number(c.s) * 100)}% alike after normalisation, father's name ${Math.round(fs * 100)}% alike`, score });
  }
  if (!found.size) return [];
  const ids = [...found.keys()];
  const people = await db.select().from(schema.faculty).where(inArray(schema.faculty.id, ids));
  const links = await linksFor(db, ids);
  return people
    .map((p) => {
      const m = found.get(p.id)!;
      return suggestion(p, m.match, m.reason, m.score, availabilityFor(p, links.filter((l) => l.facultyId === p.id), institutionId));
    })
    .sort((a, b) => (a.match === "REGNO" ? -1 : b.match === "REGNO" ? 1 : b.score - a.score));
}

async function nextFacultyId(exec: Executor) {
  const res = await exec.execute(sql`select coalesce(max(split_part(pcp_id, '-', 3)::int), 0) as n from faculty`);
  return `PCP-FAC-${String(Number((res.rows[0] as { n: number }).n) + 1).padStart(6, "0")}`;
}

async function institutionProgrammes(institutionId: number) {
  return (await db.select({ type: schema.programs.type }).from(schema.programs).where(eq(schema.programs.institutionId, institutionId))).map((p) => p.type);
}

function revalidateFaculty() {
  revalidatePath("/institution/faculty");
  revalidatePath("/pcp/verification");
}

/**
 * Add a faculty member. Before a new person is created the duplicate check runs on CNIC, registration
 * number and name plus father's name. A match comes back as a suggestion ("Did you mean ...?") and nothing
 * is saved; the institution then links the existing person, or confirms a different person
 * (`decision = "DIFFERENT"`), which creates the record and flags it for PCP.
 */
export async function addFaculty(raw: unknown, decision?: "DIFFERENT"): Promise<AddFacultyResult> {
  const { user, inst } = await requireInstitution("inst.faculty.edit");
  const parsed = FacultyInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Please complete all required fields.", level: "error" };
  const f = parsed.data;
  const cnic = normalizeCnic(f.cnic);
  if (!cnic) return { ok: false, message: "CNIC must have 13 digits (e.g. 17301-1234567-1).", level: "error" };

  // 1. Same CNIC already in the central registry: it is the same person.
  const existing = await db.query.faculty.findFirst({ where: eq(schema.faculty.cnic, cnic) });
  if (existing) {
    const av = availabilityFor(existing, await linksFor(db, [existing.id]), inst.id);
    if (av.state === "ELSEWHERE") {
      await audit(db, { actor: user.username, action: "faculty.link.blocked", entity: "faculty", entityId: existing.pcpId, details: { reason: "active at another institution" } });
      // Privacy: never reveal where the person is active.
      return {
        ok: false,
        level: "error",
        message:
          "Blocked: this person (by CNIC) is already active at another institution. A faculty member can be active at only one institution. Ask them to end that appointment first, or contact PCP.",
      };
    }
    if (av.state === "MINE") return { ok: false, level: "warning", message: `${existing.fullName} (${existing.pcpId}) is already on your faculty list.` };
    if (av.state === "REQUESTED_MINE") return { ok: false, level: "warning", message: `Your request to link ${existing.fullName} (${existing.pcpId}) is already with PCP.` };
    if (av.state === "REQUESTED_ELSEWHERE")
      return { ok: false, level: "error", message: "Blocked: another institution has already asked PCP to link this person (by CNIC). PCP decides that request first." };
    if (av.state === "DEACTIVATED") return { ok: false, level: "error", message: "This CNIC belongs to a record PCP deactivated as a duplicate. Contact PCP's verification desk." };
    return {
      ok: false,
      level: "warning",
      message: `Did you mean ${existing.pcpId}? This CNIC is already in the PCP registry. Link the existing record instead of creating a second one. Nothing has been saved.`,
      suggestions: [suggestion(existing, "CNIC", "Same CNIC", 1, av)],
    };
  }

  // 2. Registration number, then name plus father's name.
  const matches = await duplicateCandidates(f, inst.id);
  if (matches.length && decision !== "DIFFERENT") {
    await audit(db, { actor: user.username, action: "faculty.duplicate.suggested", entity: "faculty", entityId: matches[0].pcpId, details: { typed: f.fullName, institution: inst.code, matches: matches.map((m) => m.pcpId) } });
    const top = matches[0];
    return {
      ok: false,
      level: "warning",
      message: `Did you mean ${top.pcpId}? ${top.fullName} (father: ${top.fatherName}) is already in the PCP registry. Nothing has been saved.`,
      suggestions: matches,
    };
  }

  const norm = normalizeName(f.fullName);
  let pcpId = "";
  try {
    await db.transaction(async (tx) => {
      pcpId = await nextFacultyId(tx);
      const [row] = await tx
        .insert(schema.faculty)
        .values({
          pcpId,
          cnic,
          fullName: f.fullName.trim(),
          fatherName: f.fatherName.trim(),
          nameNorm: norm,
          qualification: f.qualification,
          specialization: f.specialization,
          designation: f.designation,
          pcpRegNo: f.pcpRegNo?.trim() || null,
          verificationStatus: matches.length ? "FLAGGED" : "PENDING",
        })
        .returning();
      await tx.insert(schema.facultyLinks).values({ facultyId: row.id, institutionId: inst.id, programType: f.programType, status: "ACTIVE", startDate: today(), createdBy: user.username });
      for (const m of matches) {
        await tx.insert(schema.duplicateFlags).values({
          entity: "faculty",
          recordId: row.id,
          matchRecordId: m.facultyId,
          score: m.score,
          reason: `${m.reason}; different CNIC. ${inst.shortCode} said this is a different person.`,
        });
      }
      if (matches.length) await notifyVerifiers(tx, "Possible duplicate faculty", `${row.fullName} (${inst.shortCode}) may match ${matches[0].fullName} (${matches[0].pcpId}). The institution says it is a different person.`, "/pcp/verification");
      await audit(tx, { actor: user.username, action: matches.length ? "faculty.created.flagged" : "faculty.created", entity: "faculty", entityId: pcpId, details: { institution: inst.code, matches: matches.map((m) => m.pcpId) } });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("one_active_institution")) return { ok: false, level: "error", message: "Blocked by the database: this person is already active at another institution." };
    throw e;
  }
  revalidateFaculty();
  if (matches.length)
    return {
      ok: true,
      level: "warning",
      pcpId,
      message: `Saved as ${pcpId}, but flagged as a possible duplicate of ${matches[0].pcpId} (score ${matches[0].score}). PCP's verification officer will review it before it counts towards any application.`,
    };
  return { ok: true, level: "success", pcpId, message: `Saved as ${pcpId}. Awaiting PCP verification.` };
}

/** Search the whole registry by PCP-FAC ID, CNIC or name. Shows only what an outside institution may see. */
export async function searchFaculty(q: string): Promise<{ ok: boolean; message?: string; by?: "ID" | "CNIC" | "NAME"; results: FacultySearchResult[] }> {
  const { user, inst } = await requireInstitution("inst.faculty.view");
  const term = String(q ?? "").trim();
  if (term.length < 3) return { ok: false, message: "Type at least 3 characters: a PCP-FAC ID, a CNIC or a name.", results: [] };
  const digits = term.replace(/\D/g, "");
  let by: "ID" | "CNIC" | "NAME";
  let people: FacultyRow[] = [];
  if (/^(pcp-)?fac-?\s*\d{1,6}$/i.test(term) || /^\d{1,6}$/.test(term)) {
    by = "ID";
    people = await db.select().from(schema.faculty).where(eq(schema.faculty.pcpId, `PCP-FAC-${digits.padStart(6, "0")}`));
  } else if (digits.length === 13 && /^[\d\s-]+$/.test(term)) {
    by = "CNIC";
    people = await db.select().from(schema.faculty).where(eq(schema.faculty.cnic, normalizeCnic(term)!));
  } else {
    by = "NAME";
    const norm = normalizeName(term);
    if (!norm) return { ok: false, message: "Type a name, a PCP-FAC ID or a CNIC.", results: [] };
    const res = await db.execute(sql`
      select id from faculty
      where similarity(name_norm, ${norm}) > 0.3 or name_norm like ${"%" + norm + "%"}
      order by similarity(name_norm, ${norm}) desc limit 10`);
    const ids = (res.rows as { id: number }[]).map((r) => r.id);
    if (ids.length) {
      const rows = await db.select().from(schema.faculty).where(inArray(schema.faculty.id, ids));
      people = ids.map((id) => rows.find((r) => r.id === id)!).filter(Boolean);
    }
  }
  people = people.filter((p) => p.verificationStatus !== "REJECTED");
  const links = await linksFor(db, people.map((p) => p.id));
  await audit(db, { actor: user.username, action: "faculty.searched", entity: "faculty", entityId: "registry", details: { by, term: by === "CNIC" ? maskCnic(normalizeCnic(term)!) : term, results: people.length } });
  return {
    ok: true,
    by,
    results: people.map((p) => ({
      facultyId: p.id,
      pcpId: p.pcpId,
      fullName: p.fullName,
      qualification: p.qualification,
      specialization: p.specialization,
      designation: p.designation,
      verificationStatus: p.verificationStatus,
      cnic: by === "CNIC" ? maskCnic(p.cnic) : null,
      availability: availabilityFor(p, links.filter((l) => l.facultyId === p.id), inst.id),
    })),
  };
}

const LinkInput = z.object({ facultyId: z.coerce.number().int().positive(), programType: z.enum(["PHARMD", "TECH"]), designation: z.string().min(2) });

/** Link an existing person by ID. The link starts as REQUESTED; PCP verifies it before it becomes Active. */
export async function requestFacultyLink(raw: unknown): Promise<ActionResult & { ref?: string }> {
  const { user, inst } = await requireInstitution("inst.faculty.edit");
  const parsed = LinkInput.safeParse(raw);
  if (!parsed.success) return { ok: false, level: "error", message: "Choose the programme and the designation." };
  const v = parsed.data;
  if (!DESIGNATIONS.includes(v.designation)) return { ok: false, level: "error", message: "Choose a designation from the list." };
  if (!(await institutionProgrammes(inst.id)).includes(v.programType)) return { ok: false, level: "error", message: `Your institution has no ${PROGRAM_LABELS[v.programType]} programme on record.` };
  const person = await db.query.faculty.findFirst({ where: eq(schema.faculty.id, v.facultyId) });
  if (!person) return { ok: false, level: "error", message: "That faculty record no longer exists." };
  const av = availabilityFor(person, await linksFor(db, [person.id]), inst.id);
  if (av.state === "ELSEWHERE") {
    await audit(db, { actor: user.username, action: "faculty.link.blocked", entity: "faculty", entityId: person.pcpId, details: { reason: "active at another institution" } });
    return { ok: false, level: "error", message: `${person.pcpId} is active at another institution. They can be linked only after that appointment ends.` };
  }
  if (av.state !== "FREE") return { ok: false, level: "error", message: `${person.pcpId}: ${av.label}.` };

  let ref = "";
  try {
    await db.transaction(async (tx) => {
      const [link] = await tx
        .insert(schema.facultyLinks)
        .values({ facultyId: person.id, institutionId: inst.id, programType: v.programType, status: "REQUESTED", startDate: today(), createdBy: user.username })
        .returning();
      ref = await nextYearRef(tx, "FCR");
      const changes: Record<string, { from: string | null; to: string | null }> = { programType: { from: null, to: v.programType } };
      if (v.designation !== person.designation) changes.designation = { from: person.designation, to: v.designation };
      await tx.insert(schema.facultyChangeRequests).values({
        ref,
        facultyId: person.id,
        linkId: link.id,
        institutionId: inst.id,
        kind: "NEW_LINK",
        details: { changes },
        reason: `New appointment as ${v.designation}, ${PROGRAM_LABELS[v.programType]}`,
        requestedBy: user.username,
      });
      await notifyVerifiers(tx, `Faculty link request ${ref}`, `${inst.shortCode} asks to link ${person.fullName} (${person.pcpId}) to its ${PROGRAM_LABELS[v.programType]} programme.`, "/pcp/verification?tab=links");
      await audit(tx, { actor: user.username, action: "faculty.link.requested", entity: "faculty", entityId: person.pcpId, details: { ref, institution: inst.code, programType: v.programType } });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, level: "error", message: `Could not request the link: ${msg}` };
  }
  revalidateFaculty();
  return { ok: true, level: "success", ref, message: `Link request ${ref} sent to PCP. ${person.fullName} (${person.pcpId}) shows as Requested until PCP verifies the link.` };
}

/** Withdraw a link request PCP has not decided yet. */
export async function withdrawLinkRequest(linkId: number): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.faculty.edit");
  const link = await db.query.facultyLinks.findFirst({ where: and(eq(schema.facultyLinks.id, linkId), eq(schema.facultyLinks.institutionId, inst.id)) });
  if (!link || link.status !== "REQUESTED") return { ok: false, level: "error", message: "Only a link request that PCP has not decided can be withdrawn." };
  const person = await db.query.faculty.findFirst({ where: eq(schema.faculty.id, link.facultyId) });
  await db.transaction(async (tx) => {
    await tx.update(schema.facultyLinks).set({ status: "WITHDRAWN", endDate: today() }).where(eq(schema.facultyLinks.id, link.id));
    await tx
      .update(schema.facultyChangeRequests)
      .set({ status: "WITHDRAWN", decidedBy: user.username, decidedAt: new Date(), decisionNote: "Withdrawn by the institution" })
      .where(and(eq(schema.facultyChangeRequests.linkId, link.id), eq(schema.facultyChangeRequests.status, "PENDING")));
    await audit(tx, { actor: user.username, action: "faculty.link.withdrawn", entity: "faculty", entityId: person?.pcpId ?? link.id, details: { institution: inst.code } });
  });
  revalidateFaculty();
  return { ok: true, level: "success", message: "Link request withdrawn. Nothing changed on the person's record." };
}

const reason = z.string().trim().min(5, "Give a reason of at least 5 characters.");
const ChangeInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("END_LINK"), reason, endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), category: z.string().optional() }),
  z.object({ kind: z.literal("CHANGE_PROGRAMME"), reason, programType: z.enum(["PHARMD", "TECH"]) }),
  z.object({ kind: z.literal("CHANGE_DESIGNATION"), reason, designation: z.string().min(2) }),
  z.object({
    kind: z.literal("CORRECT_DETAILS"),
    reason,
    fullName: z.string().trim().min(3).optional(),
    fatherName: z.string().trim().min(3).optional(),
    qualification: z.string().optional(),
    specialization: z.string().optional(),
    pcpRegNo: z.string().trim().optional(),
  }),
]);
type Changes = Record<string, { from: string | null; to: string | null }>;

/** Apply an approved (or not-yet-verified) change. The link is never edited in place: a programme change ends it and opens a new one. */
async function applyChange(tx: Executor, c: { kind: string; facultyId: number; linkId: number | null; institutionId: number; details: Record<string, unknown> }, actor: string) {
  const changes = ((c.details.changes as Changes | undefined) ?? {}) as Changes;
  const link = c.linkId ? await tx.query.facultyLinks.findFirst({ where: eq(schema.facultyLinks.id, c.linkId) }) : null;
  if (c.kind === "END_LINK") {
    if (!link || link.status !== "ACTIVE") throw new Error("The appointment is no longer active.");
    await tx.update(schema.facultyLinks).set({ status: "ENDED", endDate: changes.endDate?.to ?? today() }).where(eq(schema.facultyLinks.id, link.id));
  } else if (c.kind === "CHANGE_PROGRAMME") {
    if (!link || link.status !== "ACTIVE") throw new Error("The appointment is no longer active.");
    await tx.update(schema.facultyLinks).set({ status: "ENDED", endDate: today() }).where(eq(schema.facultyLinks.id, link.id));
    await tx.insert(schema.facultyLinks).values({ facultyId: c.facultyId, institutionId: c.institutionId, programType: changes.programType!.to!, status: "ACTIVE", startDate: today(), createdBy: actor });
  } else if (c.kind === "CHANGE_DESIGNATION") {
    await tx.update(schema.faculty).set({ designation: changes.designation!.to! }).where(eq(schema.faculty.id, c.facultyId));
  } else if (c.kind === "CORRECT_DETAILS") {
    const set: Partial<typeof schema.faculty.$inferInsert> = {};
    for (const [k, v] of Object.entries(changes)) {
      if (k === "fullName") Object.assign(set, { fullName: v.to!, nameNorm: normalizeName(v.to!) });
      else if (k === "fatherName") set.fatherName = v.to!;
      else if (k === "qualification") set.qualification = v.to!;
      else if (k === "specialization") set.specialization = v.to!;
      else if (k === "pcpRegNo") set.pcpRegNo = v.to || null;
    }
    if (Object.keys(set).length) await tx.update(schema.faculty).set(set).where(eq(schema.faculty.id, c.facultyId));
  } else if (c.kind === "NEW_LINK") {
    if (!link || link.status !== "REQUESTED") throw new Error("The link request is no longer open.");
    await tx.update(schema.facultyLinks).set({ status: "ACTIVE", startDate: today() }).where(eq(schema.facultyLinks.id, link.id));
    if (changes.designation?.to) await tx.update(schema.faculty).set({ designation: changes.designation.to }).where(eq(schema.faculty.id, c.facultyId));
    // PCP verifies the link and, with it, the person's qualification.
    await tx.update(schema.faculty).set({ verificationStatus: "VERIFIED" }).where(and(eq(schema.faculty.id, c.facultyId), eq(schema.faculty.verificationStatus, "PENDING")));
  }
}

/**
 * Change an appointment. Once PCP has verified the link, the change becomes a change request
 * (FCR-YYYY-NNNN) and nothing is edited until PCP approves it. Before verification it applies at once.
 */
export async function requestFacultyChange(linkId: number, raw: unknown): Promise<ActionResult & { ref?: string }> {
  const { user, inst } = await requireInstitution("inst.faculty.edit");
  const parsed = ChangeInput.safeParse(raw);
  if (!parsed.success) return { ok: false, level: "error", message: parsed.error.issues[0]?.message ?? "Complete the change and give a reason." };
  const v = parsed.data;
  const link = await db.query.facultyLinks.findFirst({ where: and(eq(schema.facultyLinks.id, linkId), eq(schema.facultyLinks.institutionId, inst.id)) });
  if (!link) return { ok: false, level: "error", message: "Appointment not found." };
  if (link.status !== "ACTIVE") return { ok: false, level: "error", message: "Only an active appointment can be changed." };
  const person = await db.query.faculty.findFirst({ where: eq(schema.faculty.id, link.facultyId) });
  if (!person) return { ok: false, level: "error", message: "Faculty record not found." };
  const open = await db.query.facultyChangeRequests.findFirst({ where: and(eq(schema.facultyChangeRequests.linkId, link.id), eq(schema.facultyChangeRequests.status, "PENDING")) });
  if (open) return { ok: false, level: "error", message: `Change request ${open.ref} for this appointment is already with PCP. Wait for PCP's decision, then try again.` };

  const changes: Changes = {};
  let category: string | undefined;
  if (v.kind === "END_LINK") {
    const end = v.endDate ?? today();
    if (end < link.startDate) return { ok: false, level: "error", message: "The end date is before the appointment started." };
    changes.status = { from: "ACTIVE", to: "ENDED" };
    changes.endDate = { from: null, to: end };
    category = v.category;
  } else if (v.kind === "CHANGE_PROGRAMME") {
    if (v.programType === link.programType) return { ok: false, level: "error", message: "Choose a different programme." };
    if (!(await institutionProgrammes(inst.id)).includes(v.programType)) return { ok: false, level: "error", message: `Your institution has no ${PROGRAM_LABELS[v.programType]} programme on record.` };
    changes.programType = { from: link.programType, to: v.programType };
  } else if (v.kind === "CHANGE_DESIGNATION") {
    if (!DESIGNATIONS.includes(v.designation)) return { ok: false, level: "error", message: "Choose a designation from the list." };
    if (v.designation === person.designation) return { ok: false, level: "error", message: "Choose a different designation." };
    changes.designation = { from: person.designation, to: v.designation };
  } else {
    if (v.qualification && !QUALIFICATIONS.includes(v.qualification)) return { ok: false, level: "error", message: "Choose a qualification from the list." };
    const cur: Record<string, string | null> = { fullName: person.fullName, fatherName: person.fatherName, qualification: person.qualification, specialization: person.specialization, pcpRegNo: person.pcpRegNo };
    for (const k of ["fullName", "fatherName", "qualification", "specialization", "pcpRegNo"] as const) {
      const to = v[k];
      if (to !== undefined && (to || null) !== (cur[k] ?? null)) changes[k] = { from: cur[k] ?? null, to: to || null };
    }
    if (!Object.keys(changes).length) return { ok: false, level: "error", message: "Nothing changed. Edit at least one detail." };
  }

  const verified = isVerifiedLink(link, person);
  let ref = "";
  try {
    await db.transaction(async (tx) => {
      ref = await nextYearRef(tx, "FCR");
      const details = { changes, ...(category ? { category } : {}) };
      await tx.insert(schema.facultyChangeRequests).values({
        ref,
        facultyId: person.id,
        linkId: link.id,
        institutionId: inst.id,
        kind: v.kind,
        details,
        reason: v.reason,
        requestedBy: user.username,
        ...(verified ? {} : { status: "APPLIED", decidedBy: user.username, decidedAt: new Date(), decisionNote: "Applied at once: PCP had not yet verified this appointment" }),
      });
      if (verified) {
        await notifyVerifiers(tx, `Faculty change request ${ref}`, `${inst.shortCode}: ${CHANGE_KIND_LABELS[v.kind].toLowerCase()} for ${person.fullName} (${person.pcpId}). Reason: ${v.reason}`, "/pcp/verification?tab=changes");
        await audit(tx, { actor: user.username, action: "faculty.change.requested", entity: "faculty", entityId: person.pcpId, details: { ref, kind: v.kind, changes, reason: v.reason } });
      } else {
        await applyChange(tx, { kind: v.kind, facultyId: person.id, linkId: link.id, institutionId: inst.id, details }, user.username);
        await audit(tx, { actor: user.username, action: "faculty.change.applied", entity: "faculty", entityId: person.pcpId, details: { ref, kind: v.kind, changes, reason: v.reason, verified: false } });
      }
    });
  } catch (e) {
    return { ok: false, level: "error", message: e instanceof Error ? e.message : String(e) };
  }
  revalidateFaculty();
  return verified
    ? { ok: true, level: "success", ref, message: `Change request ${ref} sent to PCP. The appointment stays as it is until PCP approves it.` }
    : { ok: true, level: "success", ref, message: `${CHANGE_KIND_LABELS[v.kind]} applied (${ref}). PCP had not verified this appointment yet, so no approval was needed. The history is kept.` };
}

/** End an appointment (transfer, resignation, retirement). On a verified link this opens a change request. */
export async function endFacultyLink(linkId: number, reasonText: string, endDate?: string, category?: string): Promise<ActionResult & { ref?: string }> {
  return requestFacultyChange(linkId, { kind: "END_LINK", reason: reasonText, endDate: endDate || undefined, category });
}

/** PCP decision on a faculty link request or change request. Approve applies it; reject keeps the original. */
export async function decideFacultyChange(id: number, approve: boolean, note: string, otp?: string): Promise<ActionResult> {
  const user = await requirePermission("pcp.faculty.verify");
  try {
    const fcr = await db.query.facultyChangeRequests.findFirst({ where: eq(schema.facultyChangeRequests.id, id) });
    if (!fcr) throw new Error("Change request not found.");
    if (fcr.status !== "PENDING") throw new Error(`${fcr.ref} is already ${fcr.status.toLowerCase()}.`);
    if (!approve && (note ?? "").trim().length < 5) throw new Error("Give the reason for rejecting, so the institution knows what to fix.");
    await requireOtp(user.username, `decision:${fcr.ref}`, otp);
    const person = await db.query.faculty.findFirst({ where: eq(schema.faculty.id, fcr.facultyId) });
    const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, fcr.institutionId) });
    if (!person || !inst) throw new Error("Record not found.");
    if (approve && fcr.kind === "NEW_LINK") {
      const flags = await db.select({ id: schema.duplicateFlags.id }).from(schema.duplicateFlags).where(and(eq(schema.duplicateFlags.recordId, person.id), eq(schema.duplicateFlags.status, "OPEN")));
      if (flags.length) throw new Error("Resolve the open duplicate flag on this person first.");
      const active = await db.query.facultyLinks.findFirst({ where: and(eq(schema.facultyLinks.facultyId, person.id), eq(schema.facultyLinks.status, "ACTIVE")) });
      if (active) throw new Error(`${person.pcpId} is already active at an institution. Decline this request, or end that appointment first.`);
    }
    const label = CHANGE_KIND_LABELS[fcr.kind] ?? fcr.kind;
    await db.transaction(async (tx) => {
      if (approve) await applyChange(tx, fcr, fcr.requestedBy);
      else if (fcr.kind === "NEW_LINK" && fcr.linkId) await tx.update(schema.facultyLinks).set({ status: "DECLINED", endDate: today() }).where(eq(schema.facultyLinks.id, fcr.linkId));
      await tx
        .update(schema.facultyChangeRequests)
        .set({ status: approve ? "APPROVED" : "REJECTED", decidedBy: user.username, decidedAt: new Date(), decisionNote: note?.trim() || null })
        .where(eq(schema.facultyChangeRequests.id, fcr.id));
      await notify(
        tx,
        `inst:${inst.code}`,
        `${label} ${fcr.ref} ${approve ? "approved" : "rejected"}`,
        approve
          ? `PCP approved the ${label.toLowerCase()} for ${person.fullName} (${person.pcpId}).${fcr.kind === "NEW_LINK" ? " The appointment is now active." : ""}`
          : `PCP rejected the ${label.toLowerCase()} for ${person.fullName} (${person.pcpId}): ${note.trim()}. The record stays as it was.`,
        "/institution/faculty",
      );
      await audit(tx, { actor: user.username, action: approve ? "faculty.change.approved" : "faculty.change.rejected", entity: "faculty", entityId: person.pcpId, details: { ref: fcr.ref, kind: fcr.kind, note } });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, level: "error", message: msg.includes("one_active_institution") ? "This person is already active at an institution." : msg };
  }
  revalidateFaculty();
  return { ok: true, level: "success", message: approve ? "Approved and applied. The institution is notified." : "Rejected. The original record is kept and the institution is notified." };
}

/** The annual faculty update: the Head of institution or Principal confirms the faculty list for the year. */
export async function confirmFacultyList(note?: string): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.app.submit");
  const year = thisYear();
  const done = await db.query.facultyAnnualConfirmations.findFirst({ where: and(eq(schema.facultyAnnualConfirmations.institutionId, inst.id), eq(schema.facultyAnnualConfirmations.year, year)) });
  if (done) return { ok: false, level: "warning", message: `The faculty list for ${year} was already confirmed by ${done.confirmedBy}.` };
  const counts = await db
    .select({ status: schema.facultyLinks.status, n: sql<number>`count(*)::int` })
    .from(schema.facultyLinks)
    .where(eq(schema.facultyLinks.institutionId, inst.id))
    .groupBy(schema.facultyLinks.status);
  const active = counts.find((c) => c.status === "ACTIVE")?.n ?? 0;
  const requested = counts.find((c) => c.status === "REQUESTED")?.n ?? 0;
  await db.transaction(async (tx) => {
    await tx.insert(schema.facultyAnnualConfirmations).values({ institutionId: inst.id, year, activeCount: active, note: note?.trim() || null, confirmedBy: user.username });
    await notify(tx, `inst:${inst.code}`, `Faculty list confirmed for ${year}`, `${user.name} confirmed ${active} active faculty members for ${year}.${requested ? ` ${requested} link request(s) are still with PCP.` : ""}`, "/institution/faculty");
    await notifyVerifiers(tx, `${inst.shortCode} confirmed its faculty list for ${year}`, `${inst.name}: ${active} active faculty members confirmed by ${user.name}.`, "/pcp/verification");
    await audit(tx, { actor: user.username, action: "faculty.annual.confirmed", entity: "institution", entityId: inst.code, details: { year, active, requested, note } });
  });
  revalidateFaculty();
  return { ok: true, level: "success", message: `Faculty list for ${year} confirmed: ${active} active faculty members. PCP is notified.` };
}
