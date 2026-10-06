// Accounts: bank statement import and reconciliation (guide section 14), dues, and the read-only data
// feed keys. Everything about money is simulated: no real bank is called.
import { createHash, randomInt } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "./audit";
import { confirmPayment } from "./payments";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

/** "NOC fee · PharmD · NOC-2026-0001" -> "NOC fee". Used to filter the ledger by purpose. */
export function purposeCategory(purpose: string) {
  return purpose.split(" · ")[0].trim() || purpose;
}

/** Public pages show a payer only as initials plus dots: "Riverside University" -> "Ri••••••• Un••••••••". */
export function maskName(name: string | null | undefined) {
  if (!name) return "Not recorded";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 2 ? w : w.slice(0, 2) + "•".repeat(Math.min(w.length - 2, 8))))
    .join(" ");
}

export const dueRef = (id: number) => `DUE-${String(id).padStart(5, "0")}`;

export const CHANNEL_BY_METHOD: Record<string, string> = { RAAST_QR: "RAAST", INTERNET_BANKING: "1LINK", BANK_BRANCH: "BRANCH" };
export const METHOD_BY_CHANNEL: Record<string, string> = { RAAST: "RAAST_QR", "1LINK": "INTERNET_BANKING", BRANCH: "BANK_BRANCH" };
export const CHANNEL_LABELS: Record<string, string> = { RAAST: "Raast", "1LINK": "1Link (internet banking)", BRANCH: "Bank branch" };

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

async function nextStatementRef(exec: Executor) {
  const year = new Date().getFullYear();
  const [{ n }] = await exec.select({ n: sql<number>`count(*)::int` }).from(schema.bankStatements).where(sql`${schema.bankStatements.ref} like ${`STMT-${year}-%`}`);
  return `STMT-${year}-${String(n + 1).padStart(4, "0")}`;
}

export type StatementLineInput = { psid: string | null; amount: number; bankRef: string; channel: string; narration?: string | null };

/** Mark a paid payment RECONCILED against a bank line. */
async function reconcile(exec: Executor, paymentId: number, lineId: number, actor: string, matchType: "AUTO" | "MANUAL", note?: string | null) {
  const now = new Date();
  await exec.update(schema.payments).set({ status: "RECONCILED", reconciledBy: actor, reconciledAt: now }).where(eq(schema.payments.id, paymentId));
  await exec
    .update(schema.bankStatementLines)
    .set({ status: "MATCHED", matchedPaymentId: paymentId, matchType, reason: null, ...(matchType === "MANUAL" ? { resolvedBy: actor, resolvedAt: now, note: note ?? null } : {}) })
    .where(eq(schema.bankStatementLines.id, lineId));
}

/**
 * Import a statement and auto-match each credit by PSID and amount.
 * A match marks the payment RECONCILED; anything else stays UNMATCHED with the reason in plain words.
 */
export async function importStatement(exec: Executor, o: { source: "DEMO" | "CSV"; fileName?: string | null; statementDate: string; lines: StatementLineInput[]; actor: string }) {
  const ref = await nextStatementRef(exec);
  const [stmt] = await exec
    .insert(schema.bankStatements)
    .values({ ref, statementDate: o.statementDate, source: o.source, fileName: o.fileName ?? null, lineCount: o.lines.length, importedBy: o.actor })
    .returning();
  let matched = 0;
  for (const l of o.lines) {
    const psid = digits(l.psid) || null;
    const [line] = await exec
      .insert(schema.bankStatementLines)
      .values({ statementId: stmt.id, statementDate: o.statementDate, psid, amount: l.amount, bankRef: l.bankRef, channel: l.channel, narration: l.narration ?? null, importedBy: o.actor })
      .returning();
    let reason: string | null = null;
    if (!psid) reason = "No PSID quoted on the credit. Match it by hand if you can identify the payer, or ignore it.";
    else {
      const pay = await exec.query.payments.findFirst({ where: eq(schema.payments.psid, psid) });
      if (!pay) reason = "No challan has this PSID. It may be mistyped; match it by hand or ignore it.";
      else if (pay.status === "RECONCILED") reason = `Challan already reconciled${pay.receiptNo ? ` (receipt ${pay.receiptNo})` : ""}. This may be a duplicate credit.`;
      else if (pay.status === "CANCELLED") reason = "The challan was cancelled. Refund or ignore the credit.";
      else if (pay.amount !== l.amount) reason = `Amount differs: bank Rs ${l.amount.toLocaleString("en-PK")}, challan Rs ${pay.amount.toLocaleString("en-PK")}.`;
      else if (pay.status === "PENDING") reason = "The bank credited this challan but its confirmation never reached the portal. Match it by hand to confirm it and issue the receipt.";
      else {
        await reconcile(exec, pay.id, line.id, o.actor, "AUTO");
        matched++;
        continue;
      }
    }
    await exec.update(schema.bankStatementLines).set({ reason }).where(eq(schema.bankStatementLines.id, line.id));
  }
  await exec.update(schema.bankStatements).set({ matchedCount: matched }).where(eq(schema.bankStatements.id, stmt.id));
  await audit(exec, { actor: o.actor, action: "bank.statement.imported", entity: "bank_statement", entityId: ref, details: { source: o.source, fileName: o.fileName ?? null, lines: o.lines.length, matched, unmatched: o.lines.length - matched } });
  return { ref, lines: o.lines.length, matched, unmatched: o.lines.length - matched };
}

function bankRef(prefix: string) {
  return `${prefix}${String(randomInt(0, 1e9)).padStart(9, "0")}${String(randomInt(0, 100)).padStart(2, "0")}`;
}

/** Swap two middle digits so the PSID no longer matches: the classic branch typing error. */
function mistype(psid: string) {
  const a = psid.split("");
  for (let i = 8; i < a.length - 1; i++) {
    if (a[i] !== a[i + 1]) {
      [a[i], a[i + 1]] = [a[i + 1], a[i]];
      return a.join("");
    }
  }
  a[a.length - 1] = a[a.length - 1] === "9" ? "0" : String(Number(a[a.length - 1]) + 1);
  return a.join("");
}

/** The lines the sponsor bank would send today: every paid, unreconciled challan, plus credits PCP cannot place. */
export async function demoStatementLines(exec: Executor) {
  const open = await exec
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.status, "PAID"))
    .orderBy(schema.payments.paidAt);
  const lines: StatementLineInput[] = open.map((p) => ({
    psid: p.psid,
    amount: p.amount,
    bankRef: p.bankRef ?? bankRef("RAAST"),
    channel: CHANNEL_BY_METHOD[p.method ?? ""] ?? "RAAST",
    narration: `PCP FEE PSID ${p.psid}`,
  }));
  if (lines.length >= 2) {
    // One branch deposit quoted the PSID wrongly: it will need a manual match.
    const last = lines[lines.length - 1];
    last.psid = mistype(last.psid!);
    last.channel = "BRANCH";
    last.bankRef = bankRef("BR");
    last.narration = `BRANCH DEPOSIT PSID ${last.psid}`;
  }
  lines.push({ psid: null, amount: 25000, bankRef: bankRef("BR"), channel: "BRANCH", narration: "CASH DEPOSIT HYDERABAD MAIN BR - NO PSID QUOTED" });
  if (open.length < 2) lines.push({ psid: null, amount: 10000, bankRef: bankRef("RAAST"), channel: "RAAST", narration: "RAAST P2P FROM 0300-XXXXXXX REF PCP" });
  return lines;
}

/** Match an unmatched line to a payment by hand. A pending challan is confirmed first (receipt issued). */
export async function manualMatch(exec: Executor, o: { lineId: number; paymentId: number; actor: string; note?: string | null }) {
  const line = await exec.query.bankStatementLines.findFirst({ where: eq(schema.bankStatementLines.id, o.lineId) });
  if (!line) throw new Error("That statement line no longer exists.");
  if (line.status !== "UNMATCHED") throw new Error("That line is already matched or ignored.");
  const pay = await exec.query.payments.findFirst({ where: eq(schema.payments.id, o.paymentId) });
  if (!pay) throw new Error("That payment no longer exists.");
  if (pay.status === "RECONCILED") throw new Error(`Payment ${pay.receiptNo ?? pay.psid} is already reconciled.`);
  if (pay.status === "CANCELLED") throw new Error("That challan was cancelled.");
  if (pay.amount !== line.amount)
    throw new Error(`Amounts differ: bank Rs ${line.amount.toLocaleString("en-PK")}, challan Rs ${pay.amount.toLocaleString("en-PK")}. Ignore the credit and raise a due or a refund instead.`);
  if (pay.status === "PENDING") {
    const inst = pay.institutionId ? await exec.query.institutions.findFirst({ where: eq(schema.institutions.id, pay.institutionId) }) : null;
    await confirmPayment(exec, { psid: pay.psid, method: METHOD_BY_CHANNEL[line.channel] ?? "BANK_BRANCH", payerName: inst?.name ?? "Unknown payer", actor: o.actor, bankRef: line.bankRef });
  }
  await reconcile(exec, pay.id, line.id, o.actor, "MANUAL", o.note);
  await recountStatement(exec, line.statementId);
  await audit(exec, { actor: o.actor, action: "bank.line.matched", entity: "payment", entityId: pay.psid, details: { line: line.id, bankRef: line.bankRef, amount: line.amount, statementPsid: line.psid, note: o.note ?? null } });
  return pay;
}

export async function ignoreLine(exec: Executor, o: { lineId: number; actor: string; note: string }) {
  const line = await exec.query.bankStatementLines.findFirst({ where: eq(schema.bankStatementLines.id, o.lineId) });
  if (!line) throw new Error("That statement line no longer exists.");
  if (line.status !== "UNMATCHED") throw new Error("That line is already matched or ignored.");
  await exec.update(schema.bankStatementLines).set({ status: "IGNORED", resolvedBy: o.actor, resolvedAt: new Date(), note: o.note }).where(eq(schema.bankStatementLines.id, line.id));
  await audit(exec, { actor: o.actor, action: "bank.line.ignored", entity: "bank_statement_line", entityId: line.id, details: { bankRef: line.bankRef, amount: line.amount, note: o.note } });
}

async function recountStatement(exec: Executor, statementId: number | null) {
  if (!statementId) return;
  const [{ n }] = await exec
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.bankStatementLines)
    .where(and(eq(schema.bankStatementLines.statementId, statementId), eq(schema.bankStatementLines.status, "MATCHED")));
  await exec.update(schema.bankStatements).set({ matchedCount: n }).where(eq(schema.bankStatements.id, statementId));
}

// ---------- Read-only data feed keys (rule "feed.keys", versioned like every reference rule) ----------

export const FEED_RULE = "feed.keys";
/** The demo key shown on the Reports page. A real key is shown once, when it is issued, and only its hash is kept. */
export const DEMO_FEED_KEY = "pcpfeed_demo_moh_7c41e2b9d05a";

export type FeedKey = {
  id: string;
  name: string; // who holds it, e.g. "Ministry of National Health Services"
  audience: string; // Ministry | Provincial council
  prefix: string; // first characters, to recognise a key without storing it
  sha256: string;
  active: boolean;
  issuedAt: string;
  issuedBy: string;
  revokedAt?: string | null;
  revokedBy?: string | null;
  demoKey?: string; // demo only: the plain key, so the presenter can copy it
};
export type FeedKeysRule = { keys: FeedKey[] };

export const hashFeedKey = (k: string) => createHash("sha256").update(`pcp-feed:${k}`).digest("hex");

export function newFeedKey(id: string) {
  const plain = `pcpfeed_${id.replace(/[^a-z0-9]/g, "").slice(0, 10)}_${randomInt(0, 2 ** 40).toString(16).padStart(10, "0")}${randomInt(0, 2 ** 16).toString(16).padStart(4, "0")}`;
  return { plain, prefix: plain.slice(0, 14), sha256: hashFeedKey(plain) };
}

export async function getFeedKeys(exec: Executor = db): Promise<{ value: FeedKeysRule; version: number }> {
  const row = await exec.query.rules.findFirst({ where: eq(schema.rules.key, FEED_RULE), orderBy: desc(schema.rules.version) });
  return row ? { value: row.value as FeedKeysRule, version: row.version } : { value: { keys: [] }, version: 0 };
}

/** Writes a new version of the rule; old versions stay for the record. */
export async function saveFeedKeys(exec: Executor, value: FeedKeysRule, description: string) {
  const { version } = await getFeedKeys(exec);
  await exec.insert(schema.rules).values({ key: FEED_RULE, version: version + 1, value, description, effectiveFrom: new Date().toISOString().slice(0, 10) });
}

export async function verifyFeedKey(plain: string | null): Promise<FeedKey | null> {
  if (!plain) return null;
  const h = hashFeedKey(plain.trim());
  const { value } = await getFeedKeys();
  return value.keys.find((k) => k.sha256 === h && k.active) ?? null;
}

/** Payments the Accounts officer can match a line to: paid but not reconciled, or still pending. */
export async function matchCandidates(exec: Executor = db) {
  return exec.select().from(schema.payments).where(inArray(schema.payments.status, ["PAID", "PENDING"])).orderBy(desc(schema.payments.createdAt));
}
