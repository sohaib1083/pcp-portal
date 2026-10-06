// Seed data for the accounts module. Runs after the core seed (see scripts/seed/index.ts).
// Payments with receipts for the cases that are already paid, a reconciled statement with one unmatched
// line, dues (one outstanding for SCU that blocks it, one waived, one paid) and the data feed keys.
import { eq, isNotNull } from "drizzle-orm";
import { db, schema } from "../../src/db";
import { audit } from "../../src/lib/audit";
import { DEMO_FEED_KEY, FEED_RULE, dueRef, hashFeedKey, type FeedKeysRule } from "../../src/lib/accounts";
import { fileDocument, publicUrl, renderLetter } from "../../src/lib/letters";
import { METHOD_LABELS } from "../../src/lib/payments";
import { notify } from "../../src/lib/util";

type Inst = typeof schema.institutions.$inferSelect;
type Spec = { inst: Inst; applicationId: number | null; caseRef: string | null; purpose: string; amount: number; paidAt: Date; psid: string; dueId?: number };

// Statement STMT-2026-0001 was imported on this date; every 2026 payment made before it is reconciled.
const STATEMENT_DAY = "2026-08-12";
const STATEMENT_AT = new Date(`${STATEMENT_DAY}T10:30:00Z`);
const PSID_BASE = 2026080000000000;

let seq = 7;
const bankRef = (prefix: string) => `${prefix}${String((seq = (seq * 7919 + 104729) % 9999999967)).padStart(10, "0")}`;

function receiptPdf(s: Spec, receiptNo: string, ref: string) {
  // Same layout and wording as confirmPayment() in src/lib/payments.ts.
  return renderLetter({
    kind: "Payment receipt",
    refNo: receiptNo,
    date: s.paidAt,
    to: { name: s.inst.name, lines: [s.inst.code, `${s.inst.city}, ${s.inst.province}`] },
    subject: `Receipt for ${s.purpose}`,
    paragraphs: ["The Pharmacy Council of Pakistan acknowledges the payment below. This receipt was generated automatically when the bank confirmed the payment."],
    table: [
      ["Receipt no.", receiptNo],
      ["PSID", s.psid],
      ["Amount", `Rs ${s.amount.toLocaleString("en-PK")}`],
      ["Purpose", s.purpose],
      ["Case", s.caseRef ?? "-"],
      ["Paid by", s.inst.name],
      ["Method", METHOD_LABELS.RAAST_QR],
      ["Bank reference", ref],
      ["Paid at", s.paidAt.toISOString().replace("T", " ").slice(0, 16) + " UTC"],
    ],
    signatory: { name: "Accounts, PCP", title: "System-generated receipt", signedAt: s.paidAt },
    qrUrl: publicUrl(`/verify/receipt/${receiptNo}`),
    qrCaption: "Scan to confirm this receipt",
  });
}

export default async function seedAccounts(): Promise<string | void> {
  const insts = await db.select().from(schema.institutions);
  const byShort = Object.fromEntries(insts.map((i) => [i.shortCode, i]));
  const byId = new Map(insts.map((i) => [i.id, i]));

  // ---- Dues: SCU owes a late-enrolment fee (blocks new submissions); FRU's late-filing fee was waived; BVU paid one.
  const [scuDue] = await db
    .insert(schema.dues)
    .values({ institutionId: byShort.SCU.id, description: "Late student-enrolment fee: 2025 intake, 12 students enrolled after the deadline", amount: 60000, dueDate: "2026-09-30", createdAt: new Date("2026-09-01T09:00:00Z") })
    .returning();
  const [fruDue] = await db
    .insert(schema.dues)
    .values({
      institutionId: byShort.FRU.id,
      description: "Annual return late-filing fee, 2025",
      amount: 25000,
      dueDate: "2026-03-31",
      status: "WAIVED",
      waivedBy: "pcp.accounts",
      note: "Waived on Council decision CM-2026-03: the delay came from the provincial examination board, not the institution.",
      createdAt: new Date("2026-02-16T09:00:00Z"),
    })
    .returning();
  const [bvuDue] = await db
    .insert(schema.dues)
    .values({ institutionId: byShort.BVU.id, description: "Inspection re-visit fee, NOC-2026-0005", amount: 40000, dueDate: "2026-07-15", createdAt: new Date("2026-06-25T09:00:00Z") })
    .returning();

  // ---- Payments for every case whose fee is already paid (same PSID as the case), plus BVU's due.
  const apps = await db.select().from(schema.applications).where(isNotNull(schema.applications.feePaidAt));
  const specs: Spec[] = apps.map((a) => {
    const inst = byId.get(a.institutionId)!;
    const kind = a.kind === "NOC" ? "NOC" : a.kind === "RENEWAL" ? "Renewal" : "Accreditation";
    return {
      inst,
      applicationId: a.id,
      caseRef: a.ref,
      purpose: `${kind} fee · ${a.programType === "PHARMD" ? "PharmD" : "Pharmacy Technician"} · ${a.ref}`,
      amount: a.feeAmount,
      paidAt: a.feePaidAt!,
      psid: a.feePsid ?? String(PSID_BASE + a.id),
    };
  });
  specs.push({ inst: byShort.BVU, applicationId: null, caseRef: null, purpose: `Dues · ${bvuDue.description}`, amount: bvuDue.amount, paidAt: new Date("2026-07-05T08:40:00Z"), psid: String(PSID_BASE + 9001), dueId: bvuDue.id });
  specs.sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());

  const perYear: Record<number, number> = {};
  const onStatement: { id: number; psid: string; amount: number; bankRef: string }[] = [];
  let reconciledCount = 0;
  for (const s of specs) {
    const year = s.paidAt.getUTCFullYear();
    perYear[year] = (perYear[year] ?? 0) + 1;
    const receiptNo = `RCPT-${year}-${String(perYear[year]).padStart(6, "0")}`;
    const ref = bankRef("RAAST");
    const doc = await fileDocument(db, { institutionId: s.inst.id, folder: "payments/receipts", docType: "Payment receipt", fileName: `${receiptNo}.pdf`, bytes: await receiptPdf(s, receiptNo, ref), applicationId: s.applicationId, uploadedBy: "system" });
    const reconciled = s.paidAt < STATEMENT_AT;
    const reconciledAt = year < 2026 ? new Date(s.paidAt.getTime() + 2 * 86400000) : STATEMENT_AT;
    const [p] = await db
      .insert(schema.payments)
      .values({
        psid: s.psid,
        receiptNo,
        institutionId: s.inst.id,
        applicationId: s.applicationId,
        purpose: s.purpose,
        amount: s.amount,
        status: reconciled ? "RECONCILED" : "PAID",
        method: "RAAST_QR",
        payerName: s.inst.name,
        paidAt: s.paidAt,
        bankRef: ref,
        receiptDocumentId: doc.id,
        reconciledBy: reconciled ? "pcp.accounts" : null,
        reconciledAt: reconciled ? reconciledAt : null,
        createdBy: `${s.inst.shortCode.toLowerCase()}.poc`,
        createdAt: new Date(s.paidAt.getTime() - 3 * 3600000),
      })
      .returning();
    if (s.dueId) await db.update(schema.dues).set({ status: "PAID", paymentId: p.id }).where(eq(schema.dues.id, s.dueId));
    if (reconciled) reconciledCount++;
    if (reconciled && year === 2026) onStatement.push({ id: p.id, psid: p.psid, amount: p.amount, bankRef: ref });
    await audit(db, { actor: `${s.inst.shortCode.toLowerCase()}.poc`, action: "payment.confirmed", entity: "payment", entityId: p.psid, details: { receiptNo, amount: p.amount, method: "RAAST_QR", case: s.caseRef, seeded: true } });
    if (reconciled) await audit(db, { actor: "pcp.accounts", action: "payment.reconciled", entity: "payment", entityId: p.psid, details: { receiptNo, seeded: true } });
  }

  // ---- One imported statement: the 2026 payments made before it matched, one cash deposit nobody can place.
  const [stmt] = await db
    .insert(schema.bankStatements)
    .values({ ref: "STMT-2026-0001", statementDate: STATEMENT_DAY, source: "CSV", fileName: `hbl-settlement-${STATEMENT_DAY}.csv`, lineCount: onStatement.length + 1, matchedCount: onStatement.length, importedBy: "pcp.accounts", createdAt: STATEMENT_AT })
    .returning();
  for (const p of onStatement)
    await db.insert(schema.bankStatementLines).values({ statementId: stmt.id, statementDate: STATEMENT_DAY, psid: p.psid, amount: p.amount, bankRef: p.bankRef, channel: "RAAST", narration: `PCP FEE PSID ${p.psid}`, status: "MATCHED", matchedPaymentId: p.id, matchType: "AUTO", importedBy: "pcp.accounts", createdAt: STATEMENT_AT });
  await db.insert(schema.bankStatementLines).values({
    statementId: stmt.id,
    statementDate: STATEMENT_DAY,
    psid: null,
    amount: 50000,
    bankRef: "BR2026081100417",
    channel: "BRANCH",
    narration: "CASH DEPOSIT KARACHI CLIFTON BR - NO PSID QUOTED",
    reason: "No PSID quoted on the credit. Match it by hand if you can identify the payer, or ignore it.",
    importedBy: "pcp.accounts",
    createdAt: STATEMENT_AT,
  });
  await audit(db, { actor: "pcp.accounts", action: "bank.statement.imported", entity: "bank_statement", entityId: stmt.ref, details: { source: "CSV", lines: onStatement.length + 1, matched: onStatement.length, unmatched: 1, seeded: true } });

  // ---- Dues audit trail and the alert SCU sees.
  await audit(db, { actor: "pcp.accounts", action: "due.added", entity: "due", entityId: dueRef(scuDue.id), details: { institution: byShort.SCU.code, amount: scuDue.amount, seeded: true } });
  await audit(db, { actor: "pcp.accounts", action: "due.waived", entity: "due", entityId: dueRef(fruDue.id), details: { institution: byShort.FRU.code, amount: fruDue.amount, note: fruDue.note, seeded: true } });
  await notify(
    db,
    `inst:${byShort.SCU.code}`,
    `Outstanding due: Rs ${scuDue.amount.toLocaleString("en-PK")}`,
    `${scuDue.description}. It was due on ${scuDue.dueDate}. Until it is paid or waived, PCP cannot accept new submissions from your institution.`,
    "/institution/payments",
  );

  // ---- Read-only data feed keys (guide section 14): named, revocable, only hashes kept.
  const feed: FeedKeysRule = {
    keys: [
      {
        id: "moh",
        name: "Ministry of National Health Services, Regulations and Coordination",
        audience: "Ministry",
        prefix: DEMO_FEED_KEY.slice(0, 14),
        sha256: hashFeedKey(DEMO_FEED_KEY),
        active: true,
        issuedAt: "2026-07-01T09:00:00.000Z",
        issuedBy: "pcp.admin",
        demoKey: DEMO_FEED_KEY,
      },
      { id: "punjab-pc", name: "Punjab Pharmacy Council", audience: "Provincial council", prefix: "pcpfeed_punjab", sha256: hashFeedKey("pcpfeed_punjab_demo_not_shown"), active: true, issuedAt: "2026-07-15T09:00:00.000Z", issuedBy: "pcp.admin" },
      {
        id: "sindh-pc-2025",
        name: "Sindh Pharmacy Council (2025 key)",
        audience: "Provincial council",
        prefix: "pcpfeed_sindhp",
        sha256: hashFeedKey("pcpfeed_sindhpc_2025_revoked"),
        active: false,
        issuedAt: "2025-09-01T09:00:00.000Z",
        issuedBy: "pcp.admin",
        revokedAt: "2026-06-30T09:00:00.000Z",
        revokedBy: "pcp.admin",
      },
    ],
  };
  await db.insert(schema.rules).values({ key: FEED_RULE, version: 1, value: feed, effectiveFrom: "2026-07-01", description: "Read-only data feed keys for the Ministry and provincial councils. Only key hashes are kept; revoking a key writes a new version." });

  return `${specs.length} payments with receipts (${reconciledCount} reconciled, ${specs.length - reconciledCount} awaiting reconciliation), statement ${stmt.ref} with 1 unmatched line, 3 dues (SCU outstanding), ${feed.keys.length} feed keys`;
}
