import { desc, eq } from "drizzle-orm";
import InstitutionPaymentsView from "@/components/InstitutionPaymentsView";
import { db, schema } from "@/db";
import { dueRef, purposeCategory } from "@/lib/accounts";
import { can } from "@/lib/roles";
import { requireInstitution } from "@/lib/session";
import { iso } from "@/lib/util";

export const metadata = { title: "Payments & dues" };

/** Institution: pending challans, receipts and dues. Only the institution's own records. */
export default async function InstitutionPaymentsPage() {
  const { user, inst } = await requireInstitution("inst.app.view");
  const pays = await db
    .select({ p: schema.payments, ref: schema.applications.ref })
    .from(schema.payments)
    .leftJoin(schema.applications, eq(schema.applications.id, schema.payments.applicationId))
    .where(eq(schema.payments.institutionId, inst.id))
    .orderBy(desc(schema.payments.createdAt), desc(schema.payments.id));
  const dues = await db
    .select({ d: schema.dues, pay: schema.payments })
    .from(schema.dues)
    .leftJoin(schema.payments, eq(schema.payments.id, schema.dues.paymentId))
    .where(eq(schema.dues.institutionId, inst.id))
    .orderBy(desc(schema.dues.createdAt));
  return (
    <InstitutionPaymentsView
      institution={{ name: inst.name, code: inst.code, shortCode: inst.shortCode }}
      canPay={can(user.roles, "inst.fee.pay")}
      payments={pays.map(({ p, ref }) => ({
        id: p.id,
        psid: p.psid,
        receiptNo: p.receiptNo,
        purpose: p.purpose,
        category: purposeCategory(p.purpose),
        caseRef: ref,
        amount: p.amount,
        status: p.status,
        method: p.method,
        paidAt: iso(p.paidAt),
        createdAt: iso(p.createdAt)!,
        reconciledAt: iso(p.reconciledAt),
        receiptDocumentId: p.receiptDocumentId,
      }))}
      dues={dues.map(({ d, pay }) => ({
        id: d.id,
        ref: dueRef(d.id),
        description: d.description,
        amount: d.amount,
        dueDate: d.dueDate,
        status: d.status,
        note: d.note,
        createdAt: iso(d.createdAt)!,
        psid: pay?.status === "PENDING" ? pay.psid : null,
        receiptNo: pay?.receiptNo ?? null,
        receiptDocumentId: pay?.receiptDocumentId ?? null,
      }))}
    />
  );
}
