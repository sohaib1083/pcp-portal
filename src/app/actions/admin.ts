"use server";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { createInstitutionGroup, createUser, findUser, resetPassword, setEnabled } from "@/lib/keycloak-admin";
import { INST_ROLES, PCP_ROLES } from "@/lib/roles";
import { requirePermission } from "@/lib/session";
import { notify } from "@/lib/util";

export type AdminResult = { ok: boolean; message: string; credentials?: { username: string; password: string } };

const PROVINCES = ["Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan", "Gilgit-Baltistan", "Islamabad Capital Territory", "Azad Jammu and Kashmir"] as const;

const UserInput = z.object({
  fullName: z.string().min(3),
  email: z.string().email(),
  username: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,40}$/, "lowercase letters, digits, dot, dash"),
});

async function wrap(fn: () => Promise<AdminResult>): Promise<AdminResult> {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

async function ensureUsernameFree(username: string) {
  if (await db.query.staff.findFirst({ where: eq(schema.staff.username, username) })) throw new Error(`Username ${username} is already taken`);
  if (await findUser(username)) throw new Error(`Username ${username} already exists in Keycloak`);
}

/** One active POC per institution. */
async function ensureNoActivePoc(institutionId: number) {
  const poc = await db.query.staff.findFirst({ where: and(eq(schema.staff.institutionId, institutionId), eq(schema.staff.role, "inst_poc"), eq(schema.staff.active, true)) });
  if (poc) throw new Error(`This institution already has an active POC (${poc.username}). Disable it first to hand over.`);
}

const TenantInput = z.object({
  name: z.string().min(4),
  shortCode: z.string().regex(/^[A-Z]{2,6}$/, "2–6 capital letters"),
  city: z.string().min(2),
  province: z.enum(PROVINCES),
  sector: z.enum(["Public", "Private"]),
  affiliatedUniversity: z.string().optional(),
  poc: UserInput,
});

/** Onboard a new institution (tenant): PCP ID + Keycloak group + its single POC account. */
export async function onboardInstitution(raw: unknown): Promise<AdminResult> {
  const admin = await requirePermission("pcp.users.manage");
  return wrap(async () => {
    const v = TenantInput.parse(raw);
    if (await db.query.institutions.findFirst({ where: eq(schema.institutions.shortCode, v.shortCode) })) throw new Error(`Short code ${v.shortCode} is already used`);
    await ensureUsernameFree(v.poc.username);
    const [{ max }] = await db.select({ max: sql<number>`coalesce(max(substring(code from 9)::int), 100)` }).from(schema.institutions);
    const code = `PCP-UNI-${String(Number(max) + 1).padStart(6, "0")}`;

    await createInstitutionGroup(code);
    const inst = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.institutions)
        .values({ code, shortCode: v.shortCode, name: v.name, city: v.city, province: v.province, sector: v.sector, affiliatedUniversity: v.affiliatedUniversity || null, establishedYear: new Date().getFullYear(), status: "ACTIVE" })
        .returning();
      await audit(tx, { actor: admin.username, action: "institution.onboarded", entity: "institution", entityId: code, details: { name: v.name, province: v.province } });
      return row;
    });
    const { password } = await createUser({ username: v.poc.username, email: v.poc.email, fullName: v.poc.fullName, role: "inst_poc", institutionCode: code });
    await db.transaction(async (tx) => {
      await tx.insert(schema.staff).values({ username: v.poc.username, displayName: v.poc.fullName, email: v.poc.email, role: "inst_poc", institutionId: inst.id, createdBy: admin.username });
      await notify(tx, `inst:${code}`, "Welcome to the PCP Digital Portal", `${v.name} is registered as ${code}. Start by adding your faculty, then apply for a NOC.`, "/institution");
      await audit(tx, { actor: admin.username, action: "user.created", entity: "user", entityId: v.poc.username, details: { role: "inst_poc", institution: code } });
    });
    revalidatePath("/pcp/admin");
    return { ok: true, message: `${v.name} onboarded as ${code}. POC account created.`, credentials: { username: v.poc.username, password } };
  });
}

// Every PCP role, plus the six institution roles for a chosen institution (guide section 2).
const StaffInput = UserInput.extend({
  role: z.enum([...PCP_ROLES, ...INST_ROLES]),
  institutionCode: z.string().optional(),
  province: z.enum(PROVINCES).optional(),
});

export async function createAccount(raw: unknown): Promise<AdminResult> {
  const admin = await requirePermission("pcp.users.manage");
  return wrap(async () => {
    const v = StaffInput.parse(raw);
    await ensureUsernameFree(v.username);
    let institutionId: number | null = null;
    const instRole = (INST_ROLES as readonly string[]).includes(v.role);
    if (instRole) {
      const inst = v.institutionCode ? await db.query.institutions.findFirst({ where: eq(schema.institutions.code, v.institutionCode) }) : null;
      if (!inst) throw new Error(`Choose the institution for this ${v.role === "inst_poc" ? "POC" : "user"}`);
      if (v.role === "inst_poc") await ensureNoActivePoc(inst.id);
      institutionId = inst.id;
    }
    if (v.role === "pcp_inspector" && !v.province) throw new Error("Inspectors need a home province (used for the conflict-of-interest rule)");
    const { password } = await createUser({ username: v.username, email: v.email, fullName: v.fullName, role: v.role, institutionCode: instRole ? v.institutionCode : null });
    await db.transaction(async (tx) => {
      await tx.insert(schema.staff).values({ username: v.username, displayName: v.fullName, email: v.email, role: v.role, province: v.province ?? null, institutionId, createdBy: admin.username });
      await audit(tx, { actor: admin.username, action: "user.created", entity: "user", entityId: v.username, details: { role: v.role, institution: v.institutionCode ?? null } });
    });
    revalidatePath("/pcp/admin");
    return { ok: true, message: `Account ${v.username} created.`, credentials: { username: v.username, password } };
  });
}

export async function setAccountActive(username: string, active: boolean): Promise<AdminResult> {
  const admin = await requirePermission("pcp.users.manage");
  return wrap(async () => {
    if (username === admin.username) throw new Error("You cannot disable your own account");
    const row = await db.query.staff.findFirst({ where: eq(schema.staff.username, username) });
    if (!row) throw new Error("Unknown user");
    if (active && row.role === "inst_poc" && row.institutionId) await ensureNoActivePoc(row.institutionId);
    await setEnabled(username, active);
    await db.transaction(async (tx) => {
      await tx.update(schema.staff).set({ active }).where(eq(schema.staff.username, username));
      await audit(tx, { actor: admin.username, action: active ? "user.enabled" : "user.disabled", entity: "user", entityId: username });
    });
    revalidatePath("/pcp/admin");
    return { ok: true, message: active ? `${username} enabled.` : `${username} disabled and signed out everywhere.` };
  });
}

export async function resetAccountPassword(username: string): Promise<AdminResult> {
  const admin = await requirePermission("pcp.users.manage");
  return wrap(async () => {
    const password = await resetPassword(username);
    await audit(db, { actor: admin.username, action: "user.password.reset", entity: "user", entityId: username });
    return { ok: true, message: `Temporary password issued for ${username}.`, credentials: { username, password } };
  });
}
