"use server";
// Accounts officer (reconciliation, dues) and institution Finance officer (pay a due or a challan).
// Everything about money is simulated: the "bank" is this server.
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { demoStatementLines, dueRef, ignoreLine, importStatement, manualMatch, type StatementLineInput } from "@/lib/accounts";
import { requireOtp } from "@/lib/otp";
import { METHOD_LABELS, confirmPayment, createChallan } from "@/lib/payments";
import { can } from "@/lib/roles";
import { getUser, requireInstitution } from "@/lib/session";
import { notify } from "@/lib/util";
import type { ActionResult } from "./faculty";

const today = () => new Date().toISOString().slice(0, 10);
const rs = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;
const lineCount = (n: number) => `${n} line${n === 1 ? "" : "s"}`;

async function accountsOfficer() {
  const user = await getUser();
  return user && can(user.roles, "pcp.accounts.manage") ? user : null;
}
const NOT_ACCOUNTS: ActionResult = { ok: false, level: "error", message: "Only the Accounts officer can do this. Ask Accounts, PCP." };

function refresh() {
  revalidatePath("/pcp/accounts");
  revalidatePath("/institution/payments");
}

// ---------- Bank statement ----------

export async function generateTodaysStatement(): Promise<ActionResult> {
  const user = await accountsOfficer();
  if (!user) return NOT_ACCOUNTS;
  const r = await db.transaction(async (tx) => importStatement(tx, { source: "DEMO", statementDate: today(), lines: await demoStatementLines(tx), actor: user.username }));
  refresh();
  return {
    ok: true,
    level: r.unmatched ? "warning" : "success",
    message: `Imported ${r.ref}: ${lineCount(r.lines)}. ${r.matched} matched and reconciled${r.unmatched ? `, ${r.unmatched} need${r.unmatched === 1 ? "s" : ""} your attention below` : ""}.`,
  };
}

const CHANNELS = ["RAAST", "1LINK", "BRANCH"];
const CsvRow = z.object({
  date: z.string().optional(),
  psid: z.string().optional(),
  amount: z.string().regex(/^\s*[\d,]+(\.0+)?\s*$/, "amount must be a whole number of rupees"),
  bank_ref: z.string().trim().min(3, "bank_ref is missing"),
  channel: z.string().optional(),
  narration: z.string().optional(),
});

/** Rows parsed in the browser (papaparse). Every row is checked first; nothing is saved if any row fails. */
export async function importStatementCsv(fileName: string, raw: Record<string, string>[]): Promise<ActionResult> {
  const user = await accountsOfficer();
  if (!user) return NOT_ACCOUNTS;
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, level: "error", message: "The file has no rows. Use the sample CSV for the column layout." };
  if (raw.length > 2000) return { ok: false, level: "error", message: "A statement can have at most 2,000 lines. Split the file and import each part." };
  const alias: Record<string, string> = { value_date: "date", bankref: "bank_ref", reference: "bank_ref", ref: "bank_ref", description: "narration", details: "narration" };
  const errors: string[] = [];
  const lines: StatementLineInput[] = [];
  let date: string | null = null;
  raw.forEach((r, i) => {
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(r ?? {})) {
      const key = k.trim().toLowerCase().replace(/\s+/g, "_");
      row[alias[key] ?? key] = String(v ?? "").trim();
    }
    const p = CsvRow.safeParse({ amount: "", bank_ref: "", ...row });
    if (!p.success) return void errors.push(`Row ${i + 2}: ${p.error.issues.map((x) => x.message).join("; ")}`);
    const amount = Math.round(Number(p.data.amount.replace(/,/g, "")));
    if (amount <= 0) return void errors.push(`Row ${i + 2}: amount must be more than zero`);
    const ch = (p.data.channel ?? "").toUpperCase().replace(/\s+/g, "");
    if (!date && p.data.date && /^\d{4}-\d{2}-\d{2}$/.test(p.data.date)) date = p.data.date;
    lines.push({ psid: p.data.psid || null, amount, bankRef: p.data.bank_ref.slice(0, 40), channel: CHANNELS.includes(ch) ? ch : "BRANCH", narration: p.data.narration?.slice(0, 200) || null });
  });
  if (errors.length)
    return { ok: false, level: "error", message: `Nothing was imported. Fix ${errors.length === 1 ? "this row" : `these ${errors.length} rows`} and try again: ${errors.slice(0, 4).join(" · ")}${errors.length > 4 ? " …" : ""}` };
  const r = await db.transaction((tx) => importStatement(tx, { source: "CSV", fileName: fileName.slice(0, 120), statementDate: date ?? today(), lines, actor: user.username }));
  refresh();
  return { ok: true, level: r.unmatched ? "warning" : "success", message: `Imported ${r.ref} from ${fileName}: ${lineCount(r.lines)}. ${r.matched} matched and reconciled${r.unmatched ? `, ${r.unmatched} need${r.unmatched === 1 ? "s" : ""} your attention` : ""}.` };
}

export async function matchLine(lineId: number, paymentId: number, note: string, otp: string): Promise<ActionResult> {
  const user = await accountsOfficer();
  if (!user) return NOT_ACCOUNTS;
  try {
    await requireOtp(user.username, `reconcile:line-${lineId}`, otp);
    const pay = await db.transaction((tx) => manualMatch(tx, { lineId: Number(lineId), paymentId: Number(paymentId), actor: user.username, note: note?.trim().slice(0, 300) || null }));
    const after = await db.query.payments.findFirst({ where: eq(schema.payments.id, pay.id) });
    refresh();
    return { ok: true, level: "success", message: `Matched by hand. ${after?.receiptNo ?? pay.psid} is reconciled.` };
  } catch (e) {
    return { ok: false, level: "error", message: (e as Error).message };
  }
}

export async function ignoreStatementLine(lineId: number, note: string): Promise<ActionResult> {
  const user = await accountsOfficer();
  if (!user) return NOT_ACCOUNTS;
  if (!note || note.trim().length < 5) return { ok: false, level: "error", message: "Say why the line is ignored (for example: refunded to the depositor)." };
  try {
    await db.transaction((tx) => ignoreLine(tx, { lineId: Number(lineId), actor: user.username, note: note.trim().slice(0, 300) }));
  } catch (e) {
    return { ok: false, level: "error", message: (e as Error).message };
  }
  refresh();
  return { ok: true, level: "success", message: "Line ignored. The note is kept on the statement." };
}

// ---------- Dues ----------

const DueInput = z.object({
  institutionCode: z.string().min(3),
  description: z.string().trim().min(5, "Describe the due"),
  amount: z.coerce.number().int().min(100, "Amount must be at least Rs 100").max(50_000_000),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a due date"),
});

export async function addDue(raw: unknown): Promise<ActionResult> {
  const user = await accountsOfficer();
  if (!user) return NOT_ACCOUNTS;
  const p = DueInput.safeParse(raw);
  if (!p.success) return { ok: false, level: "error", message: p.error.issues[0]?.message ?? "Complete every field." };
  const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.code, p.data.institutionCode) });
  if (!inst) return { ok: false, level: "error", message: "Pick an institution from the list." };
  const due = await db.transaction(async (tx) => {
    const [d] = await tx.insert(schema.dues).values({ institutionId: inst.id, description: p.data.description, amount: p.data.amount, dueDate: p.data.dueDate }).returning();
    await audit(tx, { actor: user.username, action: "due.added", entity: "due", entityId: dueRef(d.id), details: { institution: inst.code, amount: d.amount, description: d.description, dueDate: d.dueDate } });
    await notify(
      tx,
      `inst:${inst.code}`,
      `New due: ${rs(d.amount)}`,
      `${d.description}. Due by ${d.dueDate}. Until it is paid or waived, PCP cannot accept new submissions from your institution. Pay it under Payments & dues.`,
      "/institution/payments",
    );
    return d;
  });
  refresh();
  return { ok: true, level: "success", message: `${dueRef(due.id)} added for ${inst.shortCode}: ${rs(due.amount)}. It blocks new submissions until paid or waived.` };
}

export async function waiveDue(dueId: number, note: string, otp: string): Promise<ActionResult> {
  const user = await accountsOfficer();
  if (!user) return NOT_ACCOUNTS;
  if (!note || note.trim().length < 10) return { ok: false, level: "error", message: "Give the reason for the waiver (at least 10 characters), for example the Council decision." };
  const due = await db.query.dues.findFirst({ where: eq(schema.dues.id, Number(dueId)) });
  if (!due) return { ok: false, level: "error", message: "That due no longer exists." };
  if (due.status !== "OUTSTANDING") return { ok: false, level: "error", message: `${dueRef(due.id)} is already ${due.status.toLowerCase()}.` };
  try {
    await requireOtp(user.username, `waive:${dueRef(due.id)}`, otp);
  } catch (e) {
    return { ok: false, level: "error", message: (e as Error).message };
  }
  const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, due.institutionId) });
  await db.transaction(async (tx) => {
    await tx.update(schema.dues).set({ status: "WAIVED", waivedBy: user.username, note: note.trim().slice(0, 500) }).where(eq(schema.dues.id, due.id));
    // An unpaid challan for a waived due must not be paid any more.
    if (due.paymentId) await tx.update(schema.payments).set({ status: "CANCELLED" }).where(and(eq(schema.payments.id, due.paymentId), eq(schema.payments.status, "PENDING")));
    await audit(tx, { actor: user.username, action: "due.waived", entity: "due", entityId: dueRef(due.id), details: { institution: inst?.code, amount: due.amount, note: note.trim() } });
    if (inst) await notify(tx, `inst:${inst.code}`, `Due waived: ${dueRef(due.id)}`, `PCP waived ${rs(due.amount)} (${due.description}). Reason: ${note.trim()}`, "/institution/payments");
  });
  refresh();
  return { ok: true, level: "success", message: `${dueRef(due.id)} waived. ${inst?.shortCode ?? "The institution"} has been told.` };
}

// ---------- Institution: pay a due or a pending challan ----------

export type ChallanInfo = { psid: string; amount: number; purpose: string };
export type ReceiptInfo = { receiptNo: string; documentId: number | null; amount: number; purpose: string; psid: string; paidAt: string; method: string; bankRef: string | null };

export async function startDuePayment(dueId: number): Promise<ActionResult & { challan?: ChallanInfo }> {
  const { user, inst } = await requireInstitution("inst.fee.pay");
  const due = await db.query.dues.findFirst({ where: and(eq(schema.dues.id, Number(dueId)), eq(schema.dues.institutionId, inst.id)) });
  if (!due) return { ok: false, level: "error", message: "That due is not on your institution's account." };
  if (due.status !== "OUTSTANDING") return { ok: false, level: "error", message: `This due is already ${due.status.toLowerCase()}.` };
  const pay = await db.transaction(async (tx) => {
    if (due.paymentId) {
      const open = await tx.query.payments.findFirst({ where: eq(schema.payments.id, due.paymentId) });
      if (open?.status === "PENDING") return open;
    }
    const p = await createChallan(tx, { institutionId: inst.id, purpose: `Dues · ${due.description}`, amount: due.amount, createdBy: user.username });
    await tx.update(schema.dues).set({ paymentId: p.id }).where(eq(schema.dues.id, due.id));
    await audit(tx, { actor: user.username, action: "due.challan.generated", entity: "due", entityId: dueRef(due.id), details: { psid: p.psid, amount: p.amount } });
    return p;
  });
  refresh();
  return { ok: true, level: "success", message: `Challan ready. PSID ${pay.psid}`, challan: { psid: pay.psid, amount: pay.amount, purpose: pay.purpose } };
}

export async function payChallan(psid: string, method: string, otp: string): Promise<ActionResult & { receipt?: ReceiptInfo }> {
  const { user, inst } = await requireInstitution("inst.fee.pay");
  const pay = await db.query.payments.findFirst({ where: and(eq(schema.payments.psid, String(psid)), eq(schema.payments.institutionId, inst.id)) });
  if (!pay) return { ok: false, level: "error", message: "That challan is not on your institution's account." };
  if (pay.status !== "PENDING") return { ok: false, level: "error", message: pay.status === "CANCELLED" ? "This challan was cancelled (the due was waived)." : "This challan is already paid." };
  try {
    await requireOtp(user.username, `payment:${pay.psid}`, otp);
  } catch (e) {
    return { ok: false, level: "error", message: (e as Error).message };
  }
  const m = method in METHOD_LABELS ? method : "RAAST_QR";
  const paid = await db.transaction((tx) => confirmPayment(tx, { psid: pay.psid, method: m, payerName: inst.name, actor: user.username }));
  refresh();
  if (pay.applicationId) {
    const app = await db.query.applications.findFirst({ where: eq(schema.applications.id, pay.applicationId) });
    if (app) revalidatePath(`/institution/applications/${app.ref}`);
  }
  return {
    ok: true,
    level: "success",
    message: `Payment confirmed by the bank (simulated). Receipt ${paid.receiptNo}.`,
    receipt: { receiptNo: paid.receiptNo!, documentId: paid.receiptDocumentId, amount: paid.amount, purpose: paid.purpose, psid: paid.psid, paidAt: paid.paidAt!.toISOString(), method: METHOD_LABELS[m] ?? m, bankRef: paid.bankRef },
  };
}
