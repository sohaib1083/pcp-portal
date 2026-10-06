import { desc, eq } from "drizzle-orm";
import AccountsView from "@/components/AccountsView";
import { db, schema } from "@/db";
import { dueRef, purposeCategory } from "@/lib/accounts";
import { paymentRows } from "@/lib/reports";
import { can } from "@/lib/roles";
import { requirePermission } from "@/lib/session";
import { iso } from "@/lib/util";

export const metadata = { title: "Payments & reconciliation" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string }> }) {
  const user = await requirePermission("pcp.accounts.view");
  const sp = await searchParams;
  const pays = await paymentRows();
  const statements = await db.select().from(schema.bankStatements).orderBy(desc(schema.bankStatements.id));
  const lines = await db.select().from(schema.bankStatementLines).orderBy(desc(schema.bankStatementLines.id)).limit(500);
  const dues = await db
    .select({ d: schema.dues, inst: schema.institutions, pay: schema.payments })
    .from(schema.dues)
    .innerJoin(schema.institutions, eq(schema.institutions.id, schema.dues.institutionId))
    .leftJoin(schema.payments, eq(schema.payments.id, schema.dues.paymentId))
    .orderBy(desc(schema.dues.createdAt));
  const insts = await db.select({ code: schema.institutions.code, name: schema.institutions.name, shortCode: schema.institutions.shortCode }).from(schema.institutions).orderBy(schema.institutions.name);
  const payById = new Map(pays.map(({ p }) => [p.id, p]));
  const stmtById = new Map(statements.map((s) => [s.id, s]));

  return (
    <AccountsView
      canManage={can(user.roles, "pcp.accounts.manage")}
      initialTab={sp.tab}
      initialStatus={sp.status}
      institutions={insts}
      payments={pays.map(({ p, inst, ref }) => ({
        id: p.id,
        psid: p.psid,
        receiptNo: p.receiptNo,
        institutionCode: inst?.code ?? null,
        institutionName: inst?.name ?? "Not linked to an institution",
        institutionShort: inst?.shortCode ?? "-",
        purpose: p.purpose,
        category: purposeCategory(p.purpose),
        caseRef: ref,
        amount: p.amount,
        status: p.status,
        method: p.method,
        paidAt: iso(p.paidAt),
        createdAt: iso(p.createdAt)!,
        reconciledBy: p.reconciledBy,
        reconciledAt: iso(p.reconciledAt),
        receiptDocumentId: p.receiptDocumentId,
      }))}
      statements={statements.map((s) => {
        const mine = lines.filter((l) => l.statementId === s.id);
        return {
          id: s.id,
          ref: s.ref,
          statementDate: s.statementDate,
          source: s.source,
          fileName: s.fileName,
          lineCount: s.lineCount,
          matched: mine.filter((l) => l.status === "MATCHED").length,
          unmatched: mine.filter((l) => l.status === "UNMATCHED").length,
          ignored: mine.filter((l) => l.status === "IGNORED").length,
          importedBy: s.importedBy,
          createdAt: iso(s.createdAt)!,
        };
      })}
      lines={lines.map((l) => {
        const pay = l.matchedPaymentId ? payById.get(l.matchedPaymentId) : null;
        return {
          id: l.id,
          statementId: l.statementId,
          statementRef: l.statementId ? stmtById.get(l.statementId)?.ref ?? null : null,
          statementDate: l.statementDate,
          psid: l.psid,
          amount: l.amount,
          bankRef: l.bankRef,
          channel: l.channel,
          narration: l.narration,
          status: l.status,
          reason: l.reason,
          matchType: l.matchType,
          matchedReceipt: pay?.receiptNo ?? null,
          matchedPsid: pay?.psid ?? null,
          resolvedBy: l.resolvedBy,
          resolvedAt: iso(l.resolvedAt),
          note: l.note,
        };
      })}
      dues={dues.map(({ d, inst, pay }) => ({
        id: d.id,
        ref: dueRef(d.id),
        institutionCode: inst.code,
        institutionName: inst.name,
        institutionShort: inst.shortCode,
        description: d.description,
        amount: d.amount,
        dueDate: d.dueDate,
        status: d.status,
        waivedBy: d.waivedBy,
        note: d.note,
        createdAt: iso(d.createdAt)!,
        receiptNo: pay?.receiptNo ?? null,
        receiptDocumentId: pay?.receiptDocumentId ?? null,
        challanStatus: pay?.status ?? null,
      }))}
    />
  );
}
