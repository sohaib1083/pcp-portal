import Papa from "papaparse";
import { db } from "@/db";
import { demoStatementLines } from "@/lib/accounts";
import { audit } from "@/lib/audit";
import { can } from "@/lib/roles";
import { getUser } from "@/lib/session";

/** A sample bank statement CSV built from today's paid challans (demo), in the layout the importer reads. */
export async function GET() {
  const user = await getUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  if (!can(user.roles, "pcp.accounts.view")) return new Response("Your role cannot download bank statements", { status: 403 });
  const day = new Date().toISOString().slice(0, 10);
  const lines = await demoStatementLines(db);
  const csv = Papa.unparse({
    fields: ["date", "psid", "amount", "bank_ref", "channel", "narration"],
    data: lines.map((l) => [day, l.psid ?? "", l.amount, l.bankRef, l.channel, l.narration ?? ""]),
  });
  await audit(db, { actor: user.username, action: "bank.statement.sample.downloaded", entity: "bank_statement", entityId: day, details: { lines: lines.length } });
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="bank-statement-${day}.csv"`, "Cache-Control": "private, no-store" },
  });
}
