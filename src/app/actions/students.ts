"use server";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { normalizeCnic } from "@/lib/names";
import { requireInstitution } from "@/lib/session";
import type { ActionResult } from "./faculty";

const StudentInput = z.object({
  cnic: z.string().min(13),
  fullName: z.string().min(3),
  fatherName: z.string().min(3),
  mobile: z.string().optional(),
  email: z.string().optional(),
  shift: z.enum(["Morning", "Evening", "Self-finance"]),
  programType: z.enum(["PHARMD", "TECH"]),
  enrollmentYear: z.coerce.number().int().min(2015).max(2030),
});

export async function addStudent(raw: unknown): Promise<ActionResult> {
  const { user, inst } = await requireInstitution("inst.students.edit");
  const parsed = StudentInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Please complete all required fields.", level: "error" };
  const s = parsed.data;
  const cnic = normalizeCnic(s.cnic);
  if (!cnic) return { ok: false, message: "CNIC / B-Form must have 13 digits.", level: "error" };

  const program = await db.query.programs.findFirst({ where: and(eq(schema.programs.institutionId, inst.id), eq(schema.programs.type, s.programType)) });
  if (!program || program.nocStatus !== "APPROVED")
    return { ok: false, message: "You can enrol students only in a program with an approved NOC.", level: "error" };

  const existing = await db.query.students.findFirst({ where: eq(schema.students.cnic, cnic) });
  if (existing) {
    return {
      ok: false,
      level: "error",
      message:
        existing.institutionId === inst.id
          ? `Already enrolled at your institution as ${existing.pcpId}.`
          : "This CNIC is already enrolled at another institution. A student can hold only one active PCP student ID.",
    };
  }

  const prefix = `PCP-${inst.shortCode}-${s.enrollmentYear}-`;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.students).where(sql`pcp_id like ${prefix + "%"}`);
  const pcpId = `${prefix}${String(n + 1 + (s.programType === "TECH" ? 5000 : 0)).padStart(8, "0")}`;
  const enrolledThisYear = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.students)
    .where(and(eq(schema.students.institutionId, inst.id), eq(schema.students.programType, s.programType), eq(schema.students.enrollmentYear, s.enrollmentYear)));
  const overIntake = enrolledThisYear[0].n + 1 > program.approvedIntake;

  await db.transaction(async (tx) => {
    await tx.insert(schema.students).values({
      pcpId,
      institutionId: inst.id,
      programType: s.programType,
      cnic,
      fullName: s.fullName.trim(),
      fatherName: s.fatherName.trim(),
      mobile: s.mobile || null,
      email: s.email || null,
      shift: s.shift,
      enrollmentYear: s.enrollmentYear,
      currentYear: 1,
      status: "ENROLLED",
    });
    await audit(tx, { actor: user.username, action: "student.enrolled", entity: "student", entityId: pcpId, details: { institution: inst.code, overIntake } });
  });
  revalidatePath("/institution/students");
  return overIntake
    ? { ok: true, level: "warning", message: `Enrolled as ${pcpId}. Note: ${s.enrollmentYear} enrolment now exceeds the approved intake of ${program.approvedIntake}; PCP's dashboard will flag this.` }
    : { ok: true, level: "success", message: `Enrolled. PCP student ID: ${pcpId}` };
}
