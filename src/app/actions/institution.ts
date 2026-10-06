"use server";
// The institution's own profile, campuses and users (guide sections 2 and 3).
// Every action is scoped to the signed-in user's institution.
import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { createUser, findUser, resetPassword, setEnabled } from "@/lib/keycloak-admin";
import { ruleList } from "@/lib/onboarding";
import { INST_ROLES, ROLE_LABELS } from "@/lib/roles";
import { requireInstitution } from "@/lib/session";
import { notify } from "@/lib/util";
import type { ActionResult } from "./faculty";

export type UserActionResult = ActionResult & { credentials?: { username: string; password: string } };

async function wrap<T extends ActionResult>(fn: () => Promise<T>): Promise<T | ActionResult> {
  try {
    return await fn();
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
    if (e instanceof z.ZodError) return { ok: false, level: "error", message: e.issues.map((i) => i.message).join(". ") };
    return { ok: false, level: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const optional = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (blank(v) ? undefined : v), s.optional());

// ---------- Profile ----------

const ContactInput = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid official email address"),
  phone: z.string().trim().regex(/^0\d{2,4}-\d{6,8}$/, "Enter the phone number as 0xx-xxxxxxx"),
  address: z.string().trim().min(5, "Enter the full postal address"),
  website: optional(z.string().trim().regex(/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i, "Enter a website address such as www.example.edu.pk")),
});

/** Contact details the institution keeps up to date. Legal name, sector and affiliation change only through PCP. */
export async function updateInstitutionContact(raw: unknown): Promise<ActionResult> {
  return wrap(async () => {
    const { user, inst } = await requireInstitution("inst.profile.edit");
    const v = ContactInput.parse(raw);
    const before = { email: inst.email, phone: inst.phone, address: inst.address, website: inst.website };
    const after = { email: v.email, phone: v.phone, address: v.address, website: v.website ?? null };
    await db.transaction(async (tx) => {
      await tx.update(schema.institutions).set(after).where(eq(schema.institutions.id, inst.id));
      await audit(tx, { actor: user.username, action: "institution.contact.changed", entity: "institution", entityId: inst.code, details: { before, after } });
    });
    revalidatePath("/institution/profile");
    return { ok: true, level: "success", message: "Contact details saved." };
  });
}

const CampusInput = z.object({
  name: z.string().trim().min(3, "Enter the campus name"),
  city: z.string().trim().min(2, "Enter the city"),
  province: z.string().min(2, "Choose the province"),
  address: optional(z.string().trim().min(5, "Enter the full address")),
  isMain: z.boolean().optional(),
});

/** Add (id null) or edit a campus. A campus is a child record of the institution, never a second account. */
export async function saveInstitutionCampus(id: number | null, raw: unknown): Promise<ActionResult> {
  return wrap(async () => {
    const { user, inst } = await requireInstitution("inst.profile.edit");
    const v = CampusInput.parse(raw);
    if (!(await ruleList("ref.provinces")).includes(v.province)) throw new Error("Choose the province from the list");
    const campuses = await db.select().from(schema.campuses).where(eq(schema.campuses.institutionId, inst.id));
    if (campuses.some((c) => c.id !== id && c.name.toLowerCase() === v.name.toLowerCase())) throw new Error(`There is already a campus called ${v.name}.`);
    const current = id === null ? null : campuses.find((c) => c.id === id);
    if (id !== null && !current) throw new Error("That campus is not part of your institution.");
    const isMain = campuses.length === 0 ? true : !!v.isMain;
    if (current?.isMain && !isMain) throw new Error("One campus must be the main campus. Mark another campus as main instead.");
    await db.transaction(async (tx) => {
      if (isMain) await tx.update(schema.campuses).set({ isMain: false }).where(and(eq(schema.campuses.institutionId, inst.id), ...(id ? [ne(schema.campuses.id, id)] : [])));
      const values = { name: v.name, city: v.city, province: v.province, address: v.address ?? null, isMain };
      if (current) await tx.update(schema.campuses).set(values).where(eq(schema.campuses.id, current.id));
      else await tx.insert(schema.campuses).values({ ...values, institutionId: inst.id });
      await audit(tx, { actor: user.username, action: current ? "campus.changed" : "campus.added", entity: "institution", entityId: inst.code, details: { campus: v.name, before: current ? { name: current.name, city: current.city, isMain: current.isMain } : null, isMain } });
    });
    revalidatePath("/institution/profile");
    return { ok: true, level: "success", message: `${v.name} saved${isMain ? " as the main campus" : ""}.` };
  });
}

// ---------- Users ----------

const ASSIGNABLE = INST_ROLES.filter((r) => r !== "inst_poc") as [string, ...string[]];

const UserInput = z.object({
  role: z.enum(ASSIGNABLE, { message: "Choose one of the institution roles" }),
  fullName: z.string().trim().min(3, "Enter the person's full name"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9._-]{2,40}$/, "Username: 3 or more lowercase letters, digits, dots or dashes"),
});

async function sameInstitutionUser(username: string, institutionId: number) {
  const row = await db.query.staff.findFirst({ where: eq(schema.staff.username, username) });
  if (!row || row.institutionId !== institutionId) throw new Error("That user is not part of your institution.");
  return row;
}

/** The Head adds a person with one job (role). Keycloak user in the institution's group, temporary password shown once. */
export async function addInstitutionUser(raw: unknown): Promise<UserActionResult> {
  return wrap(async () => {
    const { user, inst } = await requireInstitution("inst.users.manage");
    const v = UserInput.parse(raw);
    if (await db.query.staff.findFirst({ where: eq(schema.staff.username, v.username) })) throw new Error(`The username ${v.username} is taken. Choose another one.`);
    if (await findUser(v.username)) throw new Error(`The username ${v.username} is taken. Choose another one.`);
    let password: string;
    try {
      ({ password } = await createUser({ username: v.username, email: v.email, fullName: v.fullName, role: v.role, institutionCode: inst.code }));
    } catch (e) {
      if (e instanceof Error && e.message.includes("(409)")) throw new Error(`An account with ${v.email} or ${v.username} already exists. Use another email or username.`);
      throw e;
    }
    await db.transaction(async (tx) => {
      await tx.insert(schema.staff).values({ username: v.username, displayName: v.fullName, email: v.email, role: v.role, institutionId: inst.id, createdBy: user.username });
      await audit(tx, { actor: user.username, action: "user.created", entity: "user", entityId: v.username, details: { role: v.role, institution: inst.code } });
      await notify(
        tx,
        `user:${v.username}`,
        "Your PCP Digital Portal account",
        `${user.name} added you to ${inst.name} as ${ROLE_LABELS[v.role]}. Your username is ${v.username}. The temporary password reaches you separately; you set your own at first sign-in.`,
        "/institution",
      );
    });
    revalidatePath("/institution/users");
    return { ok: true, level: "success", message: `${v.fullName} added as ${ROLE_LABELS[v.role]}.`, credentials: { username: v.username, password } };
  });
}

export async function setInstitutionUserActive(username: string, active: boolean): Promise<UserActionResult> {
  return wrap(async () => {
    const { user, inst } = await requireInstitution("inst.users.manage");
    if (username === user.username) throw new Error("You cannot disable your own account. Ask PCP to hand the Head account over.");
    const row = await sameInstitutionUser(username, inst.id);
    if (row.role === "inst_poc") throw new Error("The Head of institution account is managed by PCP.");
    await setEnabled(username, active);
    await db.transaction(async (tx) => {
      await tx.update(schema.staff).set({ active }).where(eq(schema.staff.username, username));
      await audit(tx, { actor: user.username, action: active ? "user.enabled" : "user.disabled", entity: "user", entityId: username, details: { institution: inst.code } });
    });
    revalidatePath("/institution/users");
    return { ok: true, level: "success", message: active ? `${row.displayName} can sign in again.` : `${row.displayName} is disabled and signed out everywhere.` };
  });
}

export async function resetInstitutionUserPassword(username: string): Promise<UserActionResult> {
  return wrap(async () => {
    const { user, inst } = await requireInstitution("inst.users.manage");
    const row = await sameInstitutionUser(username, inst.id);
    if (!row.active) throw new Error("Enable the account before resetting its password.");
    const password = await resetPassword(username);
    await audit(db, { actor: user.username, action: "user.password.reset", entity: "user", entityId: username, details: { institution: inst.code } });
    return { ok: true, level: "success", message: `Temporary password issued for ${row.displayName}.`, credentials: { username, password } };
  });
}
