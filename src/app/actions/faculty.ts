"use server";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { normalizeCnic, normalizeName } from "@/lib/names";
import { requireInstitution } from "@/lib/session";
import { notify } from "@/lib/util";

export type ActionResult = { ok: boolean; message: string; level?: "success" | "warning" | "error" };

const FacultyInput = z.object({
  cnic: z.string().min(13),
  fullName: z.string().min(3),
  fatherName: z.string().min(3),
  qualification: z.enum(["PhD", "MPhil", "PharmD", "M.Pharm"]),
  specialization: z.string().min(2),
  designation: z.string().min(2),
  pcpRegNo: z.string().optional(),
  programType: z.enum(["PHARMD", "TECH"]),
});

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

export async function addFaculty(raw: unknown): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.faculty.edit");
  const parsed = FacultyInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Please complete all required fields.", level: "error" };
  const f = parsed.data;
  const cnic = normalizeCnic(f.cnic);
  if (!cnic) return { ok: false, message: "CNIC must have 13 digits (e.g. 17301-1234567-1).", level: "error" };

  // 1. Same CNIC already in the central registry?
  const existing = await db.query.faculty.findFirst({ where: eq(schema.faculty.cnic, cnic) });
  if (existing) {
    const active = await db.query.facultyLinks.findFirst({
      where: and(eq(schema.facultyLinks.facultyId, existing.id), eq(schema.facultyLinks.status, "ACTIVE")),
    });
    if (active && active.institutionId !== inst.id) {
      await audit(db, { actor: user.username, action: "faculty.link.blocked", entity: "faculty", entityId: existing.pcpId, details: { reason: "active at another institution" } });
      // Privacy: never reveal where the person is active.
      return {
        ok: false,
        level: "error",
        message:
          "Blocked: this person (by CNIC) is already active at another institution. A faculty member can be active at only one institution. Ask them to end that appointment first, or contact PCP.",
      };
    }
    if (active) return { ok: false, level: "warning", message: `${existing.fullName} (${existing.pcpId}) is already on your faculty list.` };
    await db.transaction(async (tx) => {
      await tx.insert(schema.facultyLinks).values({ facultyId: existing.id, institutionId: inst.id, programType: f.programType, status: "ACTIVE", startDate: new Date().toISOString().slice(0, 10), createdBy: user.username });
      await audit(tx, { actor: user.username, action: "faculty.linked", entity: "faculty", entityId: existing.pcpId, details: { institution: inst.code } });
    });
    revalidatePath("/institution/faculty");
    return { ok: true, level: "success", message: `Existing PCP faculty record ${existing.pcpId} linked to your institution. History is kept.` };
  }

  // 2. Fuzzy match on normalised name (catches Muhammad/Mohammad, Umer/Umar ...)
  const norm = normalizeName(f.fullName);
  const fatherNorm = normalizeName(f.fatherName);
  const candidates = await db.execute(sql`
    select id, pcp_id, full_name, father_name, similarity(name_norm, ${norm}) as s
    from faculty where similarity(name_norm, ${norm}) > 0.55 order by s desc limit 5`);
  const matches = (candidates.rows as { id: number; pcp_id: string; full_name: string; father_name: string; s: number }[])
    .map((c) => {
      const fs = similarity(fatherNorm, normalizeName(c.father_name));
      return { ...c, score: Number((0.7 * Number(c.s) + 0.3 * fs).toFixed(2)), fs };
    })
    .filter((c) => c.score >= 0.6);

  const count = await db.select({ n: sql<number>`count(*)::int` }).from(schema.faculty);
  const pcpId = `PCP-FAC-${String(count[0].n + 1).padStart(6, "0")}`;
  try {
    await db.transaction(async (tx) => {
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
          pcpRegNo: f.pcpRegNo || null,
          verificationStatus: matches.length ? "FLAGGED" : "PENDING",
        })
        .returning();
      await tx.insert(schema.facultyLinks).values({ facultyId: row.id, institutionId: inst.id, programType: f.programType, status: "ACTIVE", startDate: new Date().toISOString().slice(0, 10), createdBy: user.username });
      for (const m of matches) {
        await tx.insert(schema.duplicateFlags).values({
          entity: "faculty",
          recordId: row.id,
          matchRecordId: m.id,
          score: m.score,
          reason: `Name similarity ${Math.round(Number(m.s) * 100)}% after normalisation; father's name similarity ${Math.round(m.fs * 100)}%; different CNIC`,
        });
      }
      if (matches.length) await notify(tx, "role:pcp_officer", "Possible duplicate faculty", `${row.fullName} (${inst.shortCode}) may match ${matches[0].full_name}.`, "/pcp/verification");
      await audit(tx, { actor: user.username, action: matches.length ? "faculty.created.flagged" : "faculty.created", entity: "faculty", entityId: pcpId, details: { institution: inst.code, matches: matches.map((m) => m.pcp_id) } });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("one_active_institution")) return { ok: false, level: "error", message: "Blocked by the database: this person is already active at another institution." };
    throw e;
  }
  revalidatePath("/institution/faculty");
  if (matches.length)
    return {
      ok: true,
      level: "warning",
      message: `Saved as ${pcpId}, but flagged as a possible duplicate of an existing PCP faculty record (score ${matches[0].score}). PCP's data verification officer will review it before it counts towards any application.`,
    };
  return { ok: true, level: "success", message: `Saved as ${pcpId}. Awaiting PCP verification.` };
}

export async function endFacultyLink(linkId: number, reason: string): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.faculty.edit");
  if (!reason || reason.length < 3) return { ok: false, message: "Give a reason (transfer, resignation, retirement ...).", level: "error" };
  const link = await db.query.facultyLinks.findFirst({ where: and(eq(schema.facultyLinks.id, linkId), eq(schema.facultyLinks.institutionId, inst.id)) });
  if (!link) return { ok: false, message: "Not found.", level: "error" };
  const fac = await db.query.faculty.findFirst({ where: eq(schema.faculty.id, link.facultyId) });
  await db.transaction(async (tx) => {
    await tx.update(schema.facultyLinks).set({ status: "ENDED", endDate: new Date().toISOString().slice(0, 10) }).where(eq(schema.facultyLinks.id, linkId));
    await notify(tx, "role:pcp_officer", "Faculty change request", `${inst.shortCode} ended the appointment of ${fac?.fullName} (${fac?.pcpId}): ${reason}`, "/pcp/verification");
    await audit(tx, { actor: user.username, action: "faculty.link.ended", entity: "faculty", entityId: fac?.pcpId ?? linkId, details: { institution: inst.code, reason } });
  });
  revalidatePath("/institution/faculty");
  return { ok: true, level: "success", message: "Appointment ended. The record and its history are kept, and PCP is notified." };
}
