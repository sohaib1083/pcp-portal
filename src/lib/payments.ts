// Fees: PSID challan (1Link) or Raast QR, a bank confirmation (simulated in the demo), and an automatic
// receipt (guide section 14). The Accounts officer reconciles payments against the bank statement.
import { randomInt } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "./audit";
import { fileDocument, publicUrl, renderLetter } from "./letters";
import { notify } from "./util";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export const METHOD_LABELS: Record<string, string> = {
  RAAST_QR: "Raast QR",
  BANK_BRANCH: "Bank branch (PSID challan)",
  INTERNET_BANKING: "Internet banking (1Link PSID)",
};

function newPsid() {
  // 17 digits like a 1Link PSID; a real one comes from the sponsor bank.
  return `2026${String(randomInt(0, 1e9)).padStart(9, "0")}${String(randomInt(0, 1e4)).padStart(4, "0")}`;
}

/** Create (or reuse) the pending challan for a case or a due. */
export async function createChallan(
  exec: Executor,
  o: { institutionId?: number | null; onboardingId?: number | null; applicationId?: number | null; purpose: string; amount: number; createdBy: string },
) {
  if (o.applicationId) {
    const open = await exec.query.payments.findFirst({ where: and(eq(schema.payments.applicationId, o.applicationId), inArray(schema.payments.status, ["PENDING", "PAID", "RECONCILED"])) });
    if (open) return open;
  }
  const [row] = await exec
    .insert(schema.payments)
    .values({ psid: newPsid(), institutionId: o.institutionId ?? null, onboardingId: o.onboardingId ?? null, applicationId: o.applicationId ?? null, purpose: o.purpose, amount: o.amount, createdBy: o.createdBy })
    .returning();
  if (o.applicationId) await exec.update(schema.applications).set({ feePsid: row.psid, feeAmount: o.amount, updatedAt: new Date() }).where(eq(schema.applications.id, o.applicationId));
  return row;
}

async function nextReceiptNo(exec: Executor) {
  const year = new Date().getFullYear();
  const [{ n }] = await exec.select({ n: sql<number>`count(*)::int` }).from(schema.payments).where(sql`${schema.payments.receiptNo} like ${`RCPT-${year}-%`}`);
  return `RCPT-${year}-${String(n + 1).padStart(6, "0")}`;
}

/**
 * The bank confirms a payment (demo: a button; production: the 1Link/Raast callback).
 * Marks it paid, issues the receipt PDF, updates the case and tells Accounts and the institution.
 */
export async function confirmPayment(exec: Executor, o: { psid: string; method: keyof typeof METHOD_LABELS | string; payerName: string; actor: string; bankRef?: string }) {
  const pay = await exec.query.payments.findFirst({ where: eq(schema.payments.psid, o.psid) });
  if (!pay) throw new Error("No challan with that PSID");
  if (pay.status !== "PENDING") return pay;
  const receiptNo = await nextReceiptNo(exec);
  const paidAt = new Date();
  const bankRef = o.bankRef ?? `RAAST${String(randomInt(0, 1e10)).padStart(10, "0")}`;
  const app = pay.applicationId ? await exec.query.applications.findFirst({ where: eq(schema.applications.id, pay.applicationId) }) : null;
  const inst = pay.institutionId ? await exec.query.institutions.findFirst({ where: eq(schema.institutions.id, pay.institutionId) }) : null;

  const pdf = await renderLetter({
    kind: "Payment receipt",
    refNo: receiptNo,
    date: paidAt,
    to: inst ? { name: inst.name, lines: [inst.code, `${inst.city}, ${inst.province}`] } : { name: o.payerName },
    subject: `Receipt for ${pay.purpose}`,
    paragraphs: ["The Pharmacy Council of Pakistan acknowledges the payment below. This receipt was generated automatically when the bank confirmed the payment."],
    table: [
      ["Receipt no.", receiptNo],
      ["PSID", pay.psid],
      ["Amount", `Rs ${pay.amount.toLocaleString("en-PK")}`],
      ["Purpose", pay.purpose],
      ["Case", app?.ref ?? "-"],
      ["Paid by", o.payerName],
      ["Method", METHOD_LABELS[o.method] ?? o.method],
      ["Bank reference", bankRef],
      ["Paid at", paidAt.toISOString().replace("T", " ").slice(0, 16) + " UTC"],
    ],
    signatory: { name: "Accounts, PCP", title: "System-generated receipt", signedAt: paidAt },
    qrUrl: publicUrl(`/verify/receipt/${receiptNo}`),
    qrCaption: "Scan to confirm this receipt",
  });
  const doc = pay.institutionId
    ? await fileDocument(exec, { institutionId: pay.institutionId, folder: "payments/receipts", docType: "Payment receipt", fileName: `${receiptNo}.pdf`, bytes: pdf, applicationId: pay.applicationId, uploadedBy: "system" })
    : null;

  const [updated] = await exec
    .update(schema.payments)
    .set({ status: "PAID", receiptNo, method: o.method, payerName: o.payerName, paidAt, bankRef, receiptDocumentId: doc?.id ?? null })
    .where(eq(schema.payments.id, pay.id))
    .returning();
  if (app) {
    await exec
      .update(schema.applications)
      .set({ feePaidAt: paidAt, feePaidBy: o.actor, feeMethod: METHOD_LABELS[o.method] ?? o.method, updatedAt: new Date() })
      .where(eq(schema.applications.id, app.id));
  }
  await exec.update(schema.dues).set({ status: "PAID" }).where(eq(schema.dues.paymentId, pay.id));
  await audit(exec, { actor: o.actor, action: "payment.confirmed", entity: "payment", entityId: pay.psid, details: { receiptNo, amount: pay.amount, method: o.method, case: app?.ref ?? null } });
  await notify(exec, "role:pcp_accounts", `Payment received: ${receiptNo}`, `Rs ${pay.amount.toLocaleString("en-PK")} for ${pay.purpose}${inst ? ` from ${inst.shortCode}` : ""}. Reconcile it against the bank statement.`, "/pcp/accounts");
  if (inst) await notify(exec, `inst:${inst.code}`, `Receipt ${receiptNo}`, `Your payment of Rs ${pay.amount.toLocaleString("en-PK")} for ${pay.purpose} is confirmed.`, app ? `/institution/applications/${app.ref}` : "/institution/payments");
  return updated;
}

/** Dues that block a new submission until paid or waived. */
export async function outstandingDues(exec: Executor, institutionId: number) {
  return exec.select().from(schema.dues).where(and(eq(schema.dues.institutionId, institutionId), eq(schema.dues.status, "OUTSTANDING")));
}

/**
 * Plain-English reason a submission is blocked by dues, or null when nothing is owed (guide section 4).
 * For the case builder's checks, e.g. "Outstanding dues of Rs 60,000 (DUE-00001). Pay them under Payments & dues, or ask PCP Accounts to review."
 */
export async function duesBlock(exec: Executor, institutionId: number) {
  const due = await outstandingDues(exec, institutionId);
  if (!due.length) return null;
  const amount = due.reduce((a, d) => a + d.amount, 0);
  const refs = due.map((d) => `DUE-${String(d.id).padStart(5, "0")}`);
  return {
    amount,
    refs,
    message: `Outstanding dues of Rs ${amount.toLocaleString("en-PK")} (${refs.join(", ")}). Pay them under Payments & dues, or ask PCP Accounts to review.`,
  };
}
