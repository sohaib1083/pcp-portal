"use server";
// Help desk and complaints (guide section 14): every question or complaint is a ticket with a reference,
// a time limit of 5 working days, and replies that reach the requester by email.
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { TICKET_SLA_DAYS, addWorkingDays, fmtDay, nextModuleRef, notifyOn } from "@/lib/council";
import { sendEmail } from "@/lib/messages";
import { can } from "@/lib/roles";
import { requirePermission, requireUser, type CurrentUser } from "@/lib/session";
import type { ActionResult } from "./faculty";

const CATEGORIES = ["Question", "Complaint", "Technical issue", "Data correction"] as const;
const fail = (message: string): ActionResult => ({ ok: false, message, level: "error" });
const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Check the form.";
/** Turn an error into a message, but let Next.js redirects (e.g. signed out) through. */
function caught(e: unknown): ActionResult {
  unstable_rethrow(e);
  return fail(e instanceof Error ? e.message : String(e));
}

function refresh(ref?: string) {
  revalidatePath("/pcp/helpdesk");
  if (ref) revalidatePath(`/pcp/helpdesk/${ref}`);
  for (const p of ["/institution/help", "/student/help", "/pharmacist/help"]) revalidatePath(p);
}

const subjectFrom = (category: string, body: string) => {
  const s = body.replace(/\s+/g, " ").trim();
  return s.length > 70 ? `${s.slice(0, 67).replace(/\s+\S*$/, "")}...` : s || category;
};

// ---------- Public form ----------

const PublicInput = z.object({
  name: z.string().trim().min(3, "Enter your full name."),
  email: z.string().trim().email("Enter a valid email address, for example name@example.com."),
  mobile: z
    .string()
    .trim()
    .regex(/^(\+92|0)3\d{2}[\s-]?\d{7}$/, "Enter a Pakistani mobile number, for example 0300 1234567.")
    .or(z.literal("")),
  category: z.enum(CATEGORIES, { message: "Choose what this is about." }),
  institutionId: z.coerce.number().int().positive().optional().nullable(),
  message: z.string().trim().min(15, "Describe your question or complaint in at least 15 characters.").max(4000, "Keep the message under 4,000 characters."),
});

export async function createPublicTicket(raw: unknown): Promise<ActionResult & { ref?: string; dueAt?: string }> {
  const parsed = PublicInput.safeParse(raw);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;
  const inst = v.institutionId ? await db.query.institutions.findFirst({ where: eq(schema.institutions.id, v.institutionId) }) : null;
  const now = new Date();
  const due = addWorkingDays(now, TICKET_SLA_DAYS);
  const ref = await db.transaction(async (tx) => {
    const r = await nextModuleRef(tx, "tickets", "TKT", 4);
    await tx.insert(schema.tickets).values({
      ref: r,
      source: "PUBLIC",
      category: v.category,
      subject: subjectFrom(v.category, v.message),
      body: v.message,
      contactName: v.name,
      contactEmail: v.email,
      contactMobile: v.mobile || null,
      institutionId: inst?.id ?? null,
      slaDueAt: due,
    });
    await sendEmail(tx, {
      to: v.email,
      toName: v.name,
      subject: `We received your ${v.category.toLowerCase()}: ${r}`,
      body: `Dear ${v.name},\n\nThank you for contacting the Pharmacy Council of Pakistan. Your reference is ${r}.\nWe aim to resolve it within ${TICKET_SLA_DAYS} working days, by ${fmtDay(due)}. Replies will come to this email address; quote ${r} if you write again.\n\nYour message:\n${v.message}`,
      entity: "ticket",
      entityRef: r,
    });
    await notifyOn(tx, "role:pcp_officer", `New ${v.category.toLowerCase()} ${r}`, `From ${v.name} (public)${inst ? ` about ${inst.shortCode}` : ""}. Resolve by ${fmtDay(due)}.`, `/pcp/helpdesk/${r}`, "ticket", r);
    await audit(tx, { actor: "public", action: "ticket.created", entity: "ticket", entityId: r, details: { source: "PUBLIC", category: v.category, institution: inst?.code ?? null } });
    return r;
  });
  refresh(ref);
  return { ok: true, message: `Ticket ${ref} created. We emailed an acknowledgement to ${v.email}.`, level: "success", ref, dueAt: due.toISOString() };
}

// ---------- Signed-in requesters ----------

const SOURCE_BY_KIND: Record<string, string> = { institution: "INSTITUTION", student: "STUDENT", pharmacist: "PHARMACIST" };

async function requester(): Promise<{ user: CurrentUser; source: string; institutionId: number | null; email: string | null }> {
  const user = await requireUser();
  const source = SOURCE_BY_KIND[user.kind];
  if (!source) throw new Error("The help desk here is for institutions, students and pharmacists. PCP staff answer tickets under Help desk.");
  if (user.kind === "institution" && !can(user.roles, "inst.helpdesk")) throw new Error("Your role cannot raise tickets.");
  const dir = await db.query.staff.findFirst({ where: eq(schema.staff.username, user.username) });
  let institutionId: number | null = null;
  if (user.kind === "institution" && user.institutionCode) {
    const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.code, user.institutionCode) });
    institutionId = inst?.id ?? null;
  }
  return { user, source, institutionId, email: dir?.email ?? null };
}

const OwnInput = z.object({
  category: z.enum(CATEGORIES, { message: "Choose what this is about." }),
  subject: z.string().trim().min(5, "Give the ticket a subject of at least 5 characters.").max(120, "Keep the subject under 120 characters."),
  message: z.string().trim().min(15, "Describe your question or complaint in at least 15 characters.").max(4000, "Keep the message under 4,000 characters."),
});

export async function createTicket(raw: unknown): Promise<ActionResult & { ref?: string }> {
  try {
    const { user, source, institutionId, email } = await requester();
    const parsed = OwnInput.safeParse(raw);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    const v = parsed.data;
    const due = addWorkingDays(new Date(), TICKET_SLA_DAYS);
    const ref = await db.transaction(async (tx) => {
      const r = await nextModuleRef(tx, "tickets", "TKT", 4);
      await tx.insert(schema.tickets).values({ ref: r, source, category: v.category, subject: v.subject, body: v.message, contactName: user.name, contactEmail: email, institutionId, username: user.username, slaDueAt: due });
      await notifyOn(tx, `user:${user.username}`, `Ticket ${r} received`, `We aim to resolve "${v.subject}" within ${TICKET_SLA_DAYS} working days, by ${fmtDay(due)}.`, `/${user.kind}/help#${r}`, "ticket", r);
      await notifyOn(tx, "role:pcp_officer", `New ${v.category.toLowerCase()} ${r}`, `From ${user.name} (${source.toLowerCase()}). Resolve by ${fmtDay(due)}.`, `/pcp/helpdesk/${r}`, "ticket", r);
      await audit(tx, { actor: user.username, action: "ticket.created", entity: "ticket", entityId: r, details: { source, category: v.category } });
      return r;
    });
    refresh(ref);
    return { ok: true, message: `Ticket ${ref} created. We aim to resolve it by ${fmtDay(due)}.`, level: "success", ref };
  } catch (e) {
    return caught(e);
  }
}

/** The requester adds information to their own ticket; a resolved ticket opens again. */
export async function followUpTicket(ref: string, body: string): Promise<ActionResult> {
  try {
    const { user, institutionId } = await requester();
    const t = await db.query.tickets.findFirst({ where: eq(schema.tickets.ref, ref) });
    const mine = t && (t.username === user.username || (user.kind === "institution" && institutionId != null && t.institutionId === institutionId && t.source === "INSTITUTION"));
    if (!t || !mine) return fail("Ticket not found among your tickets.");
    if (t.status === "CLOSED") return fail(`${t.ref} is closed. Raise a new ticket and mention ${t.ref}.`);
    const text = body.trim();
    if (text.length < 2) return fail("Write your reply first.");
    await db.transaction(async (tx) => {
      await tx.insert(schema.ticketReplies).values({ ticketId: t.id, author: user.username, body: text });
      if (t.status === "RESOLVED") await tx.update(schema.tickets).set({ status: "IN_PROGRESS", resolvedAt: null }).where(eq(schema.tickets.id, t.id));
      await notifyOn(tx, t.assignedTo ? `user:${t.assignedTo}` : "role:pcp_officer", `Reply from the requester on ${t.ref}`, text.slice(0, 160), `/pcp/helpdesk/${t.ref}`, "ticket", t.ref);
      await audit(tx, { actor: user.username, action: t.status === "RESOLVED" ? "ticket.reopened" : "ticket.followup", entity: "ticket", entityId: t.ref });
    });
    refresh(t.ref);
    return { ok: true, message: t.status === "RESOLVED" ? `Reply sent and ${t.ref} is open again.` : "Reply sent to the PCP help desk.", level: "success" };
  } catch (e) {
    return caught(e);
  }
}

// ---------- PCP help desk ----------

async function pcpTicket(ref: string) {
  const user = await requirePermission("pcp.helpdesk");
  const t = await db.query.tickets.findFirst({ where: eq(schema.tickets.ref, ref) });
  if (!t) throw new Error(`Ticket ${ref} was not found.`);
  return { user, t };
}

/** Tell the requester: email to a public requester, in-app alert and email to a signed-in one. */
async function tellRequester(exec: Parameters<typeof notifyOn>[0], t: typeof schema.tickets.$inferSelect, subject: string, body: string) {
  if (t.username) {
    const dir = await exec.query.staff.findFirst({ where: eq(schema.staff.username, t.username) });
    const kind = dir?.role === "student" ? "student" : dir?.role === "pharmacist" ? "pharmacist" : "institution";
    await notifyOn(exec, `user:${t.username}`, subject, body, `/${kind}/help#${t.ref}`, "ticket", t.ref);
  } else if (t.contactEmail) {
    await sendEmail(exec, { to: t.contactEmail, toName: t.contactName ?? undefined, subject, body: `Dear ${t.contactName ?? "applicant"},\n\n${body}\n\nReference: ${t.ref}. Reply quoting this reference if you need more help.`, entity: "ticket", entityRef: t.ref });
  }
}

export async function assignTicket(ref: string, assignee: string): Promise<ActionResult> {
  try {
    const { user, t } = await pcpTicket(ref);
    if (t.status === "CLOSED") return fail(`${t.ref} is closed.`);
    const member = await db.query.staff.findFirst({ where: and(eq(schema.staff.username, assignee), eq(schema.staff.active, true)) });
    if (!member || !can([member.role], "pcp.helpdesk")) return fail("Choose an active PCP help desk member.");
    await db.transaction(async (tx) => {
      await tx.update(schema.tickets).set({ assignedTo: assignee, status: t.status === "OPEN" ? "IN_PROGRESS" : t.status }).where(eq(schema.tickets.id, t.id));
      if (assignee !== user.username) await notifyOn(tx, `user:${assignee}`, `Ticket ${t.ref} assigned to you`, `${t.subject}. Assigned by ${user.name}.`, `/pcp/helpdesk/${t.ref}`, "ticket", t.ref);
      await audit(tx, { actor: user.username, action: "ticket.assigned", entity: "ticket", entityId: t.ref, details: { to: assignee } });
    });
    refresh(t.ref);
    return { ok: true, message: assignee === user.username ? `${t.ref} is assigned to you.` : `${t.ref} assigned to ${member.displayName}; they are notified.`, level: "success" };
  } catch (e) {
    return caught(e);
  }
}

export async function replyTicket(ref: string, body: string, internal: boolean): Promise<ActionResult> {
  try {
    const { user, t } = await pcpTicket(ref);
    if (t.status === "CLOSED") return fail(`${t.ref} is closed.`);
    const text = body.trim();
    if (text.length < 2) return fail("Write the reply first.");
    if (!internal && !t.username && !t.contactEmail) return fail("This requester left no email address. Add an internal note instead.");
    await db.transaction(async (tx) => {
      await tx.insert(schema.ticketReplies).values({ ticketId: t.id, author: user.username, body: text, internal });
      const set: Partial<typeof schema.tickets.$inferInsert> = {};
      if (t.status === "OPEN") set.status = "IN_PROGRESS";
      if (!t.assignedTo) set.assignedTo = user.username;
      if (Object.keys(set).length) await tx.update(schema.tickets).set(set).where(eq(schema.tickets.id, t.id));
      if (!internal) await tellRequester(tx, t, `Reply to your ticket ${t.ref}`, text);
      await audit(tx, { actor: user.username, action: internal ? "ticket.note" : "ticket.replied", entity: "ticket", entityId: t.ref });
    });
    refresh(t.ref);
    return { ok: true, message: internal ? "Internal note added. The requester does not see it." : `Reply sent to ${t.contactEmail ?? t.contactName ?? "the requester"} (email${t.username ? " and in-app alert" : ""}).`, level: "success" };
  } catch (e) {
    return caught(e);
  }
}

export async function resolveTicket(ref: string, resolution: string): Promise<ActionResult> {
  try {
    const { user, t } = await pcpTicket(ref);
    if (!["OPEN", "IN_PROGRESS"].includes(t.status)) return fail(`${t.ref} is already ${t.status.toLowerCase()}.`);
    const text = resolution.trim();
    if (text.length < 10) return fail("Tell the requester how it was resolved (at least 10 characters).");
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.insert(schema.ticketReplies).values({ ticketId: t.id, author: user.username, body: text });
      await tx.update(schema.tickets).set({ status: "RESOLVED", resolvedAt: now, assignedTo: t.assignedTo ?? user.username }).where(eq(schema.tickets.id, t.id));
      await tellRequester(tx, t, `Your ticket ${t.ref} is resolved`, `${text}\n\nIf this does not answer your question, reply and the ticket opens again.`);
      await audit(tx, { actor: user.username, action: "ticket.resolved", entity: "ticket", entityId: t.ref, details: { withinServiceLevel: t.slaDueAt ? now <= t.slaDueAt : null } });
    });
    refresh(t.ref);
    const late = t.slaDueAt && now > t.slaDueAt;
    return { ok: true, message: `${t.ref} resolved${late ? " (after its time limit)" : " within its time limit"}. The requester is told.`, level: late ? "warning" : "success" };
  } catch (e) {
    return caught(e);
  }
}

export async function closeTicket(ref: string): Promise<ActionResult> {
  try {
    const { user, t } = await pcpTicket(ref);
    if (t.status !== "RESOLVED") return fail("Resolve the ticket before closing it.");
    await db.transaction(async (tx) => {
      await tx.update(schema.tickets).set({ status: "CLOSED" }).where(eq(schema.tickets.id, t.id));
      await audit(tx, { actor: user.username, action: "ticket.closed", entity: "ticket", entityId: t.ref });
    });
    refresh(t.ref);
    return { ok: true, message: `${t.ref} closed. It can no longer be reopened by the requester.`, level: "success" };
  } catch (e) {
    return caught(e);
  }
}
