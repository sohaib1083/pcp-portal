import { eq } from "drizzle-orm";
import ReceiptVerify from "@/components/ReceiptVerify";
import { db, schema } from "@/db";
import { maskName, purposeCategory } from "@/lib/accounts";
import { audit } from "@/lib/audit";

export const metadata = { title: "Receipt check" };

/** The page a receipt's QR code opens. Public: amount, date, purpose and a masked payer name; no personal data. */
export default async function VerifyReceiptPage({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  const receiptNo = decodeURIComponent(no).trim().toUpperCase().slice(0, 40);
  const pay = /^RCPT-\d{4}-\d{6}$/.test(receiptNo) ? await db.query.payments.findFirst({ where: eq(schema.payments.receiptNo, receiptNo) }) : null;
  const doc = pay?.receiptDocumentId ? await db.query.documents.findFirst({ where: eq(schema.documents.id, pay.receiptDocumentId) }) : null;
  await audit(db, { actor: "public", action: "receipt.checked", entity: "payment", entityId: receiptNo, details: { found: !!pay } });
  // Purpose without the case reference: "NOC fee · PharmD".
  const purpose = pay ? pay.purpose.split(" · ").filter((x) => !/^[A-Z]{2,4}-\d{4}-\d{3,}$/.test(x)).join(" · ") || purposeCategory(pay.purpose) : null;
  return (
    <ReceiptVerify
      no={receiptNo}
      found={
        pay && pay.paidAt
          ? { amount: pay.amount, paidAt: pay.paidAt.toISOString(), purpose: purpose!, payer: maskName(pay.payerName), reconciled: pay.status === "RECONCILED", cancelled: pay.status === "CANCELLED", sha256: doc?.sha256 ?? null }
          : null
      }
    />
  );
}
