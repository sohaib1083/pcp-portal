"use server";
// Institution onboarding (guide section 3): self-registration, the applicant's checklist and PCP's review.
import { cookies } from "next/headers";
import { and, eq, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { OnboardingCampus, OnboardingProfile, OnboardingProgramme } from "@/db/modules/onboarding";
import { audit } from "@/lib/audit";
import {
  addRealmRole,
  createInstitutionGroup,
  createUserWithPassword,
  deleteUserById,
  emailInUse,
  findUser,
  joinInstitutionGroup,
  removeRealmRole,
} from "@/lib/keycloak-admin";
import { sendEmail, sendSms } from "@/lib/messages";
import { hashCode, logEvent, newCode, nextInstitutionCode, nextRegRef, requiredDocs, ruleList } from "@/lib/onboarding";
import { latestDocs, onboardingSteps } from "@/lib/onboarding-steps";
import { requireOtp } from "@/lib/otp";
import { requirePermission } from "@/lib/session";
import { notify } from "@/lib/util";
import type { ActionResult } from "./faculty";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Request = typeof schema.onboardingRequests.$inferSelect;

const CODE_MINUTES = 30;
const MAX_ATTEMPTS = 5;

async function wrap<T extends ActionResult>(fn: () => Promise<T>): Promise<T | ActionResult> {
  try {
    return await fn();
  } catch (e) {
    // Next's redirect() (e.g. from requirePermission) must keep propagating.
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
    if (e instanceof z.ZodError) return { ok: false, level: "error", message: e.issues.map((i) => i.message).join(". ") };
    return { ok: false, level: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** In-app notice on the applicant's own screen plus an email to the address on the request. */
async function tellApplicant(exec: typeof db | Tx, req: Request, title: string, body: string) {
  await exec.insert(schema.notifications).values({ audience: `user:${req.applicantUsername}`, title, body, link: "/onboarding" });
  await sendEmail(exec, { to: req.email, toName: req.applicantName, subject: title, body, entity: "onboarding", entityRef: req.ref, link: "/onboarding" });
}

async function sendCodes(exec: typeof db | Tx, req: Pick<Request, "id" | "ref" | "email" | "mobile" | "applicantName" | "emailVerifiedAt" | "mobileVerifiedAt">) {
  const emailCode = newCode();
  const mobileCode = newCode();
  await exec
    .update(schema.onboardingRequests)
    .set({
      emailCodeHash: hashCode(req.ref, "email", emailCode),
      mobileCodeHash: hashCode(req.ref, "mobile", mobileCode),
      codesExpireAt: new Date(Date.now() + CODE_MINUTES * 60_000),
      codeAttempts: 0,
    })
    .where(eq(schema.onboardingRequests.id, req.id));
  if (!req.emailVerifiedAt)
    await sendEmail(exec, {
      to: req.email,
      toName: req.applicantName,
      subject: "Your PCP verification code",
      body: `Dear ${req.applicantName},\n\nYour email verification code for registration ${req.ref} is ${emailCode}. It is valid for ${CODE_MINUTES} minutes.\n\nIf you did not register an institution with the Pharmacy Council of Pakistan, ignore this email.`,
      entity: "onboarding",
      entityRef: req.ref,
    });
  if (!req.mobileVerifiedAt)
    await sendSms(exec, {
      to: req.mobile,
      toName: req.applicantName,
      body: `PCP verification code ${mobileCode} for ${req.ref}. Valid ${CODE_MINUTES} minutes. Do not share it.`,
      entity: "onboarding",
      entityRef: req.ref,
    });
}

// ======================= Public: create the account =======================

const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{2,40}$/, "Username: 3 to 41 lowercase letters, digits, dots or dashes, starting with a letter or digit");

const RegisterInput = z
  .object({
    fullName: z.string().trim().min(3, "Enter your full name"),
    designation: z.string().trim().min(2, "Enter your designation"),
    email: z.string().trim().toLowerCase().email("Enter a valid official email address"),
    mobile: z.string().trim().regex(/^03\d{2}-\d{7}$/, "Enter the mobile number as 03xx-xxxxxxx"),
    username: Username,
    password: z
      .string()
      .min(8, "The password needs at least 8 characters")
      .regex(/[A-Za-z]/, "The password needs at least one letter")
      .regex(/\d/, "The password needs at least one digit"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "The two passwords do not match", path: ["confirm"] });

/** Create the applicant's account: a Keycloak user (inst_applicant), a directory row and a draft request. */
export async function registerInstitution(raw: unknown): Promise<ActionResult & { ref?: string }> {
  return wrap(async () => {
    const v = RegisterInput.parse(raw);
    if (await db.query.staff.findFirst({ where: eq(schema.staff.username, v.username) })) throw new Error(`The username ${v.username} is taken. Choose another one.`);
    if (await db.query.onboardingRequests.findFirst({ where: eq(schema.onboardingRequests.applicantUsername, v.username) })) throw new Error(`The username ${v.username} is taken. Choose another one.`);
    if (await findUser(v.username)) throw new Error(`The username ${v.username} is taken. Choose another one.`);
    if (await emailInUse(v.email)) throw new Error(`An account with ${v.email} already exists. Sign in with it, or use another official email.`);

    const { id: kcId } = await createUserWithPassword({ username: v.username, email: v.email, fullName: v.fullName, role: "inst_applicant", password: v.password });
    try {
      const ref = await db.transaction(async (tx) => {
        const ref = await nextRegRef(tx);
        await tx.insert(schema.staff).values({ username: v.username, displayName: v.fullName, email: v.email, role: "inst_applicant", createdBy: "self-registration" });
        const [req] = await tx
          .insert(schema.onboardingRequests)
          .values({ ref, status: "DRAFT", applicantUsername: v.username, applicantName: v.fullName, applicantDesignation: v.designation, email: v.email, mobile: v.mobile })
          .returning();
        await logEvent(tx, req.id, null, "DRAFT", v.username, "Account created");
        await sendCodes(tx, req);
        await audit(tx, { actor: v.username, action: "onboarding.registered", entity: "onboarding", entityId: ref, details: { email: v.email, mobile: v.mobile } });
        return ref;
      });
      // Marks this browser as the one that registered, so the public verify page may show the username.
      (await cookies()).set("pcp_reg", ref, { httpOnly: true, sameSite: "lax", path: "/register", maxAge: 24 * 60 * 60 });
      return { ok: true, level: "success" as const, message: `Account created. We sent a code to ${v.email} and another to ${v.mobile}.`, ref };
    } catch (e) {
      await deleteUserById(kcId).catch(() => undefined);
      throw e;
    }
  });
}

/** Check the email and mobile codes. Each channel is marked verified on its own. */
export async function verifyAccount(ref: string, emailCode: string, mobileCode: string): Promise<ActionResult & { emailOk?: boolean; mobileOk?: boolean }> {
  return wrap(async () => {
    const req = await db.query.onboardingRequests.findFirst({ where: eq(schema.onboardingRequests.ref, ref) });
    if (!req) throw new Error("We could not find that registration. Check the link or register again.");
    if (req.emailVerifiedAt && req.mobileVerifiedAt) return { ok: true, level: "success" as const, message: "Your email and mobile number are already verified.", emailOk: true, mobileOk: true };
    if (req.codeAttempts >= MAX_ATTEMPTS) throw new Error("Too many wrong codes. Press “Send new codes” and use the new ones.");
    if (!req.codesExpireAt || req.codesExpireAt < new Date()) throw new Error("These codes have expired. Press “Send new codes” and use the new ones.");

    const emailOk = !!req.emailVerifiedAt || (!!req.emailCodeHash && hashCode(ref, "email", String(emailCode ?? "")) === req.emailCodeHash);
    const mobileOk = !!req.mobileVerifiedAt || (!!req.mobileCodeHash && hashCode(ref, "mobile", String(mobileCode ?? "")) === req.mobileCodeHash);
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(schema.onboardingRequests)
        .set({
          emailVerifiedAt: emailOk ? (req.emailVerifiedAt ?? now) : null,
          mobileVerifiedAt: mobileOk ? (req.mobileVerifiedAt ?? now) : null,
          codeAttempts: emailOk && mobileOk ? req.codeAttempts : req.codeAttempts + 1,
          updatedAt: now,
        })
        .where(eq(schema.onboardingRequests.id, req.id));
      if (emailOk && !req.emailVerifiedAt) await audit(tx, { actor: req.applicantUsername, action: "onboarding.email.verified", entity: "onboarding", entityId: ref });
      if (mobileOk && !req.mobileVerifiedAt) await audit(tx, { actor: req.applicantUsername, action: "onboarding.mobile.verified", entity: "onboarding", entityId: ref });
    });
    if (emailOk && mobileOk) return { ok: true, level: "success" as const, message: "Email and mobile verified. Sign in to continue your registration.", emailOk, mobileOk };
    const wrong = !emailOk && !mobileOk ? "Both codes are wrong" : !emailOk ? "The email code is wrong" : "The mobile code is wrong";
    const left = MAX_ATTEMPTS - req.codeAttempts - 1;
    return { ok: false, level: "error" as const, message: `${wrong}${emailOk !== mobileOk ? "; the other one is now verified" : ""}. Check the latest message and try again (${left} ${left === 1 ? "try" : "tries"} left).`, emailOk, mobileOk };
  });
}

export async function resendCodes(ref: string): Promise<ActionResult> {
  return wrap(async () => {
    const req = await db.query.onboardingRequests.findFirst({ where: eq(schema.onboardingRequests.ref, ref) });
    if (!req) throw new Error("We could not find that registration.");
    if (req.emailVerifiedAt && req.mobileVerifiedAt) return { ok: true, message: "Already verified. Sign in to continue." };
    await db.transaction(async (tx) => {
      await sendCodes(tx, req);
      await audit(tx, { actor: req.applicantUsername, action: "onboarding.codes.resent", entity: "onboarding", entityId: ref });
    });
    return { ok: true, level: "success", message: "New codes sent. The earlier codes no longer work." };
  });
}

// ======================= Applicant: the checklist =======================

async function myRequest() {
  const user = await requirePermission("applicant.self");
  const req = await db.query.onboardingRequests.findFirst({ where: eq(schema.onboardingRequests.applicantUsername, user.username) });
  if (!req) throw new Error("No registration is linked to your account.");
  return { user, req };
}

function ensureEditable(req: Request) {
  if (req.status === "SUBMITTED") throw new Error("Your request is with PCP. You can change it only if PCP returns it to you.");
  if (req.status === "APPROVED" || req.status === "REJECTED") throw new Error("This request is closed and cannot be changed.");
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const optional = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (blank(v) ? undefined : v), s.optional());

const ProfileInput = z.object({
  name: optional(z.string().trim().min(4, "The institution name needs at least 4 characters").max(120)),
  shortCode: optional(z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}$/, "The short code is 2 to 6 capital letters, e.g. IVC")),
  sector: optional(z.enum(["Public", "Private"])),
  province: optional(z.string()),
  city: optional(z.string().trim().min(2, "Enter the city")),
  address: optional(z.string().trim().min(5, "Enter the full postal address")),
  phone: optional(z.string().trim().regex(/^0\d{2,4}-\d{6,8}$/, "Enter the phone number as 0xx-xxxxxxx, e.g. 071-5630000")),
  website: optional(z.string().trim().regex(/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i, "Enter a website address such as www.example.edu.pk")),
  establishedYear: optional(z.coerce.number().int().min(1900, "Enter a year from 1900").max(new Date().getFullYear(), "The year cannot be in the future")),
  affiliationType: optional(z.enum(["University", "Affiliated college", "Constituent college"])),
  affiliatedUniversity: optional(z.string()),
});

/** Save the profile. A draft may be partial; `complete` also checks that every required field is filled. */
export async function saveProfile(raw: unknown, complete = false): Promise<ActionResult> {
  return wrap(async () => {
    const { user, req } = await myRequest();
    ensureEditable(req);
    const v = ProfileInput.parse(raw) as OnboardingProfile;
    const provinces = await ruleList("ref.provinces");
    const universities = await ruleList("ref.universities");
    if (v.province && !provinces.includes(v.province)) throw new Error("Choose the province from the list");
    if (v.affiliationType === "University") v.affiliatedUniversity = undefined;
    if (v.affiliatedUniversity && universities.length && !universities.includes(v.affiliatedUniversity)) throw new Error("Choose the affiliated university from the list. If it is missing, ask PCP to add it to the reference list.");
    if (v.shortCode) {
      const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.shortCode, v.shortCode) });
      if (inst) throw new Error(`The short code ${v.shortCode} already belongs to ${inst.name}. Choose another one.`);
      const other = await db.query.onboardingRequests.findFirst({
        where: and(ne(schema.onboardingRequests.id, req.id), notInArray(schema.onboardingRequests.status, ["REJECTED", "APPROVED"]), sql`${schema.onboardingRequests.profile}->>'shortCode' = ${v.shortCode}`),
      });
      if (other) throw new Error(`The short code ${v.shortCode} is already requested by another institution. Choose another one.`);
    }
    const profile = Object.fromEntries(Object.entries(v).filter(([, x]) => !blank(x))) as OnboardingProfile;
    if (complete) {
      const step = onboardingSteps({ ...req, profile, docs: [], requiredDocs: [] }).find((s) => s.key === "profile")!;
      if (!step.done) throw new Error(`Fill in: ${step.missing.join(", ")}. Or press “Save draft” to finish later.`);
    }
    await db.transaction(async (tx) => {
      await tx.update(schema.onboardingRequests).set({ profile, updatedAt: new Date() }).where(eq(schema.onboardingRequests.id, req.id));
      await audit(tx, { actor: user.username, action: "onboarding.profile.saved", entity: "onboarding", entityId: req.ref, details: { complete } });
    });
    return { ok: true, level: "success", message: complete ? "Profile saved and complete." : "Draft saved. You can come back to it any time." };
  });
}

const CampusInput = z.object({
  name: z.string().trim().min(3, "Enter the campus name"),
  city: z.string().trim().min(2, "Enter the city"),
  province: z.string().min(2, "Choose the province"),
  address: optional(z.string().trim().min(5, "Enter the full address")),
  isMain: z.boolean().optional(),
});

/** Add (index null) or edit a campus. The first campus is the main campus; other campuses are child records. */
export async function saveCampus(index: number | null, raw: unknown): Promise<ActionResult> {
  return wrap(async () => {
    const { user, req } = await myRequest();
    ensureEditable(req);
    const v = CampusInput.parse(raw);
    if (!(await ruleList("ref.provinces")).includes(v.province)) throw new Error("Choose the province from the list");
    const campuses: OnboardingCampus[] = [...req.campuses];
    let programmes: OnboardingProgramme[] = [...req.programmes];
    if (campuses.some((c, i) => i !== index && c.name.toLowerCase() === v.name.toLowerCase())) throw new Error(`There is already a campus called ${v.name}.`);
    const campus: OnboardingCampus = { name: v.name, city: v.city, province: v.province, address: v.address, isMain: campuses.length === 0 || (index !== null && campuses.length === 1) ? true : !!v.isMain };
    if (index === null) campuses.push(campus);
    else {
      const old = campuses[index];
      if (!old) throw new Error("That campus no longer exists. Reload the page.");
      if (old.isMain && !campus.isMain) throw new Error("One campus must be the main campus. Mark another campus as main instead.");
      if (old.name !== campus.name) programmes = programmes.map((p) => (p.campus === old.name ? { ...p, campus: campus.name } : p));
      campuses[index] = campus;
    }
    if (campus.isMain) for (const c of campuses) if (c !== campus) c.isMain = false;
    await db.transaction(async (tx) => {
      await tx.update(schema.onboardingRequests).set({ campuses, programmes, updatedAt: new Date() }).where(eq(schema.onboardingRequests.id, req.id));
      await audit(tx, { actor: user.username, action: index === null ? "onboarding.campus.added" : "onboarding.campus.changed", entity: "onboarding", entityId: req.ref, details: { campus: campus.name } });
    });
    return { ok: true, level: "success", message: `${campus.name} saved${campus.isMain ? " as the main campus" : ""}.` };
  });
}

export async function removeCampus(index: number): Promise<ActionResult> {
  return wrap(async () => {
    const { user, req } = await myRequest();
    ensureEditable(req);
    const c = req.campuses[index];
    if (!c) throw new Error("That campus no longer exists. Reload the page.");
    if (req.programmes.some((p) => p.campus === c.name)) throw new Error(`Remove the programmes at ${c.name} first.`);
    if (c.isMain && req.campuses.length > 1) throw new Error("Mark another campus as the main campus before removing this one.");
    const campuses = req.campuses.filter((_, i) => i !== index);
    await db.transaction(async (tx) => {
      await tx.update(schema.onboardingRequests).set({ campuses, updatedAt: new Date() }).where(eq(schema.onboardingRequests.id, req.id));
      await audit(tx, { actor: user.username, action: "onboarding.campus.removed", entity: "onboarding", entityId: req.ref, details: { campus: c.name } });
    });
    return { ok: true, level: "success", message: `${c.name} removed.` };
  });
}

const year = new Date().getFullYear();
const ProgrammeInput = z.object({
  type: z.enum(["PHARMD", "TECH"], { message: "Choose the programme" }),
  campus: z.string().min(1, "Choose the campus"),
  plannedIntake: z.coerce.number().int().min(10, "Planned intake is at least 10 students").max(500, "Planned intake is at most 500 students"),
  startYear: optional(z.coerce.number().int().min(year, `The first intake is ${year} or later`).max(year + 5, `The first intake is ${year + 5} at the latest`)),
});

export async function saveProgramme(index: number | null, raw: unknown): Promise<ActionResult> {
  return wrap(async () => {
    const { user, req } = await myRequest();
    ensureEditable(req);
    const v = ProgrammeInput.parse(raw) as OnboardingProgramme;
    if (!req.campuses.some((c) => c.name === v.campus)) throw new Error("Choose one of your campuses. Add the campus first if it is missing.");
    const programmes = [...req.programmes];
    if (programmes.some((p, i) => i !== index && p.type === v.type && p.campus === v.campus)) throw new Error(`This programme is already listed at ${v.campus}.`);
    if (index === null) programmes.push(v);
    else if (!programmes[index]) throw new Error("That programme no longer exists. Reload the page.");
    else programmes[index] = v;
    await db.transaction(async (tx) => {
      await tx.update(schema.onboardingRequests).set({ programmes, updatedAt: new Date() }).where(eq(schema.onboardingRequests.id, req.id));
      await audit(tx, { actor: user.username, action: "onboarding.programme.saved", entity: "onboarding", entityId: req.ref, details: v });
    });
    return { ok: true, level: "success", message: "Programme saved." };
  });
}

export async function removeProgramme(index: number): Promise<ActionResult> {
  return wrap(async () => {
    const { user, req } = await myRequest();
    ensureEditable(req);
    const p = req.programmes[index];
    if (!p) throw new Error("That programme no longer exists. Reload the page.");
    await db.transaction(async (tx) => {
      await tx.update(schema.onboardingRequests).set({ programmes: req.programmes.filter((_, i) => i !== index), updatedAt: new Date() }).where(eq(schema.onboardingRequests.id, req.id));
      await audit(tx, { actor: user.username, action: "onboarding.programme.removed", entity: "onboarding", entityId: req.ref, details: p });
    });
    return { ok: true, level: "success", message: "Programme removed." };
  });
}

/** Send codes again from inside the checklist (the applicant signed in before verifying). */
export async function resendMyCodes(): Promise<ActionResult> {
  return wrap(async () => {
    const { req } = await myRequest();
    return resendCodes(req.ref);
  });
}

export async function submitOnboarding(): Promise<ActionResult> {
  return wrap(async () => {
    const { user, req } = await myRequest();
    ensureEditable(req);
    const docs = await db.select().from(schema.documents).where(eq(schema.documents.onboardingId, req.id));
    const steps = onboardingSteps({ ...req, docs, requiredDocs: await requiredDocs() });
    const open = steps.filter((s) => !s.done);
    if (open.length) throw new Error(`Complete these steps first: ${open.map((s) => `${s.title} (${s.missing.join(", ")})`).join("; ")}.`);
    const resubmit = req.status === "RETURNED";
    await db.transaction(async (tx) => {
      await tx.update(schema.onboardingRequests).set({ status: "SUBMITTED", submittedAt: new Date(), updatedAt: new Date() }).where(eq(schema.onboardingRequests.id, req.id));
      await logEvent(tx, req.id, req.status, "SUBMITTED", user.username, resubmit ? "Resubmitted after changes" : "Submitted to PCP");
      const title = `${resubmit ? "Resubmitted" : "New"} institution registration ${req.ref}`;
      const body = `${req.profile.name} (${req.profile.city}, ${req.profile.province}) is waiting for verification.`;
      await notify(tx, "role:pcp_registration", title, body, `/pcp/onboarding/${req.ref}`);
      await notify(tx, "role:pcp_officer", title, body, `/pcp/onboarding/${req.ref}`);
      await tellApplicant(tx, req, `Registration ${req.ref} received`, `PCP received the registration of ${req.profile.name}. A registration officer will check it and reply by email. You can follow the status on your checklist.`);
      await audit(tx, { actor: user.username, action: resubmit ? "onboarding.resubmitted" : "onboarding.submitted", entity: "onboarding", entityId: req.ref });
    });
    return { ok: true, level: "success", message: `Submitted to PCP. We emailed a receipt to ${req.email}.` };
  });
}

// ======================= PCP: verification and decision =======================

async function reviewable(ref: string) {
  const user = await requirePermission("pcp.onboarding.review");
  const req = await db.query.onboardingRequests.findFirst({ where: eq(schema.onboardingRequests.ref, ref) });
  if (!req) throw new Error("Registration not found");
  if (req.status !== "SUBMITTED") throw new Error(`This request is ${req.status.toLowerCase()} and has no decision waiting.`);
  return { user, req };
}

export async function returnOnboarding(ref: string, reason: string): Promise<ActionResult> {
  return wrap(async () => {
    const { user, req } = await reviewable(ref);
    const note = String(reason ?? "").trim();
    if (note.length < 10) throw new Error("Write the reason for returning (at least 10 characters). The applicant sees it word for word.");
    await db.transaction(async (tx) => {
      await tx.update(schema.onboardingRequests).set({ status: "RETURNED", reviewNote: note, reviewedBy: user.username, reviewedAt: new Date(), updatedAt: new Date() }).where(eq(schema.onboardingRequests.id, req.id));
      await logEvent(tx, req.id, req.status, "RETURNED", user.username, note);
      await tellApplicant(tx, req, `Registration ${req.ref} returned for changes`, `PCP returned your registration with this reason:\n\n${note}\n\nMake the changes on your checklist and resubmit.`);
      await audit(tx, { actor: user.username, action: "onboarding.returned", entity: "onboarding", entityId: req.ref, details: { reason: note } });
    });
    return { ok: true, level: "success", message: `Returned to ${req.applicantName} with your reason.` };
  });
}

export async function rejectOnboarding(ref: string, reason: string, otp?: string): Promise<ActionResult> {
  return wrap(async () => {
    const { user, req } = await reviewable(ref);
    const note = String(reason ?? "").trim();
    if (note.length < 10) throw new Error("Write the grounds for rejection (at least 10 characters). They go into the decision email.");
    await requireOtp(user.username, `decision:${ref}`, otp);
    await db.transaction(async (tx) => {
      await tx.update(schema.onboardingRequests).set({ status: "REJECTED", reviewNote: note, reviewedBy: user.username, reviewedAt: new Date(), updatedAt: new Date() }).where(eq(schema.onboardingRequests.id, req.id));
      await logEvent(tx, req.id, req.status, "REJECTED", user.username, note);
      await tellApplicant(tx, req, `Registration ${req.ref} rejected`, `PCP rejected the registration of ${req.profile.name ?? "your institution"} on these grounds:\n\n${note}\n\nYou may appeal or register again once the grounds are resolved.`);
      await audit(tx, { actor: user.username, action: "onboarding.rejected", entity: "onboarding", entityId: req.ref, details: { grounds: note } });
    });
    return { ok: true, level: "success", message: `Rejected. ${req.applicantName} has been emailed the grounds.` };
  });
}

/**
 * Approve: issue the next PCP-UNI ID, create the institution with its campuses and programmes, create its
 * Keycloak group, and turn the applicant into the institution's Head (inst_applicant -> inst_poc).
 */
export async function approveOnboarding(ref: string, otp?: string): Promise<ActionResult & { code?: string }> {
  return wrap(async () => {
    const { user, req } = await reviewable(ref);
    const p = req.profile;
    const docs = await db.select().from(schema.documents).where(eq(schema.documents.onboardingId, req.id));
    const required = await requiredDocs();
    const open = onboardingSteps({ ...req, docs, requiredDocs: required }).filter((s) => !s.done);
    if (open.length) throw new Error(`The request is incomplete (${open.map((s) => s.title).join(", ")}). Return it to the applicant instead.`);
    const latest = latestDocs(docs);
    const unchecked = required.filter((r) => latest.get(r)?.verificationStatus !== "VERIFIED");
    if (unchecked.length) throw new Error(`Verify every legal document before approving. Not yet verified: ${unchecked.join(", ")}.`);
    const clash = await db.query.institutions.findFirst({ where: eq(schema.institutions.shortCode, p.shortCode!) });
    if (clash) throw new Error(`The short code ${p.shortCode} already belongs to ${clash.name}. Return the request and ask for another short code.`);
    if (!(await findUser(req.applicantUsername))) throw new Error(`The applicant account ${req.applicantUsername} does not exist in Keycloak, so it cannot become the Head of institution.`);
    await requireOtp(user.username, `decision:${ref}`, otp);

    const code = await nextInstitutionCode(db);
    await createInstitutionGroup(code);
    await db.transaction(async (tx) => {
      const [inst] = await tx
        .insert(schema.institutions)
        .values({
          code,
          shortCode: p.shortCode!,
          name: p.name!,
          province: p.province!,
          city: p.city!,
          sector: p.sector!,
          status: "ACTIVE",
          affiliatedUniversity: p.affiliationType === "University" ? null : (p.affiliatedUniversity ?? null),
          establishedYear: p.establishedYear ?? null,
          email: req.email,
          phone: p.phone ?? null,
          address: p.address ?? null,
          website: p.website ?? null,
          onboardingId: req.id,
        })
        .returning();
      const main = req.campuses.find((c) => c.isMain);
      const ordered = [...(main ? [main] : []), ...req.campuses.filter((c) => c !== main)];
      await tx.insert(schema.campuses).values(ordered.map((c) => ({ institutionId: inst.id, name: c.name, city: c.city, province: c.province, address: c.address ?? null, isMain: c.isMain })));
      // One programme record per type; the campus is chosen on each NOC case.
      const types = [...new Set(req.programmes.map((x) => x.type))];
      if (types.length) await tx.insert(schema.programs).values(types.map((type) => ({ institutionId: inst.id, type, nocStatus: "NONE", approvedIntake: 0, accreditationStatus: "NONE" })));
      await tx.update(schema.documents).set({ institutionId: inst.id }).where(eq(schema.documents.onboardingId, req.id));
      await tx.update(schema.staff).set({ role: "inst_poc", institutionId: inst.id }).where(eq(schema.staff.username, req.applicantUsername));
      await tx
        .update(schema.onboardingRequests)
        .set({ status: "APPROVED", institutionId: inst.id, reviewNote: null, reviewedBy: user.username, reviewedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.onboardingRequests.id, req.id));
      await logEvent(tx, req.id, req.status, "APPROVED", user.username, `Institution ID ${code} issued`);
      await tx.insert(schema.notifications).values({ audience: `inst:${code}`, title: "Welcome to the PCP Digital Portal", body: `${p.name} is registered as ${code}. Add your staff under Users & roles, add faculty, then apply for a NOC.`, link: "/institution" });
      await tellApplicant(
        tx,
        req,
        `Registration ${req.ref} approved: ${code}`,
        `PCP approved the registration of ${p.name}. Your Institution ID is ${code}. Sign out and sign in again to open your institution portal, where you are the Head of institution.`,
      );
      await audit(tx, { actor: user.username, action: "onboarding.approved", entity: "onboarding", entityId: req.ref, details: { institution: code } });
      await audit(tx, { actor: user.username, action: "institution.created", entity: "institution", entityId: code, details: { name: p.name, province: p.province, campuses: ordered.length, programmes: types } });
      await audit(tx, { actor: user.username, action: "user.role.changed", entity: "user", entityId: req.applicantUsername, details: { from: "inst_applicant", to: "inst_poc", institution: code } });

      // Keycloak last: if it fails, the database changes roll back. Undo partial Keycloak changes too.
      try {
        await addRealmRole(req.applicantUsername, "inst_poc");
        await joinInstitutionGroup(req.applicantUsername, code);
        await removeRealmRole(req.applicantUsername, "inst_applicant");
      } catch (e) {
        await removeRealmRole(req.applicantUsername, "inst_poc").catch(() => undefined);
        await addRealmRole(req.applicantUsername, "inst_applicant").catch(() => undefined);
        throw e;
      }
    });
    return { ok: true, level: "success", message: `Approved. ${p.name} is ${code}; ${req.applicantName} is now its Head of institution.`, code };
  });
}

/** Mark one uploaded document as checked, or as not acceptable (the applicant must replace it). */
export async function setOnboardingDocumentStatus(documentId: number, status: "VERIFIED" | "REJECTED"): Promise<ActionResult> {
  return wrap(async () => {
    const user = await requirePermission("pcp.onboarding.review");
    const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, documentId) });
    if (!doc?.onboardingId) throw new Error("Document not found");
    const req = await db.query.onboardingRequests.findFirst({ where: eq(schema.onboardingRequests.id, doc.onboardingId) });
    if (!req || req.status !== "SUBMITTED") throw new Error("Documents can be checked only while the request is waiting for PCP.");
    await db.transaction(async (tx) => {
      await tx.update(schema.documents).set({ verificationStatus: status }).where(eq(schema.documents.id, documentId));
      await audit(tx, { actor: user.username, action: status === "VERIFIED" ? "document.verified" : "document.rejected", entity: "document", entityId: documentId, details: { onboarding: req.ref, docType: doc.docType } });
    });
    return { ok: true, level: "success", message: `${doc.docType}: ${status === "VERIFIED" ? "verified" : "marked as not acceptable"}.` };
  });
}

/** Mark the latest version of every required document as verified (after the officer has opened them). */
export async function verifyAllOnboardingDocuments(ref: string): Promise<ActionResult> {
  return wrap(async () => {
    const { user, req } = await reviewable(ref);
    const docs = await db.select().from(schema.documents).where(eq(schema.documents.onboardingId, req.id));
    const latest = latestDocs(docs);
    const todo = (await requiredDocs()).map((r) => latest.get(r)).filter((d): d is (typeof docs)[number] => !!d && d.verificationStatus === "PENDING");
    if (!todo.length) return { ok: true, message: "No document is waiting to be verified." };
    await db.transaction(async (tx) => {
      for (const d of todo) {
        await tx.update(schema.documents).set({ verificationStatus: "VERIFIED" }).where(eq(schema.documents.id, d.id));
        await audit(tx, { actor: user.username, action: "document.verified", entity: "document", entityId: d.id, details: { onboarding: req.ref, docType: d.docType } });
      }
    });
    return { ok: true, level: "success", message: `${todo.length} document${todo.length === 1 ? "" : "s"} verified.` };
  });
}
