import { db } from "@/db";
import { audit } from "@/lib/audit";
import { tablePdf, tableXlsx, type ExportTable } from "@/lib/exports";
import { loadCorrespondence, loadCourtCases } from "@/lib/governance-data";
import { COURT_STATUS, LETTER_STATUS, MODE_LABELS, NATURE_LABELS } from "@/lib/governance-shared";
import { can } from "@/lib/roles";
import { getActiveUser } from "@/lib/session";

const TYPES = { xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pdf: "application/pdf" } as const;

/** Export the court case ledger or a correspondence register as Excel or PDF. Permission-checked and audited. */
export async function GET(req: Request) {
  const user = await getActiveUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  const url = new URL(req.url);
  const what = url.searchParams.get("what");
  const format = (url.searchParams.get("format") ?? "xlsx") as keyof typeof TYPES;
  if (!(format in TYPES)) return new Response("Format must be xlsx or pdf", { status: 400 });
  let table: ExportTable;
  let filters = "none";
  if (what === "litigation") {
    if (!can(user.roles, "pcp.litigation.view")) return new Response("Your role cannot export the court case ledger", { status: 403 });
    const scope = url.searchParams.get("scope") ?? "all";
    const d = await loadCourtCases();
    const rows = d.cases.filter((c) => (scope === "open" ? c.open : scope === "closed" ? !c.open : true));
    filters = scope === "open" ? "open cases" : scope === "closed" ? "disposed or withdrawn" : "all cases";
    table = {
      title: "Court case ledger",
      sub: "Cases PCP is party to, with the next hearing and any stay order in force",
      columns: [
        { key: "ref", title: "Ledger ref", type: "code" },
        { key: "court", title: "Court" },
        { key: "caseNumber", title: "Case number", type: "code" },
        { key: "title", title: "Title" },
        { key: "nature", title: "Nature" },
        { key: "linked", title: "Linked to" },
        { key: "counsel", title: "PCP counsel" },
        { key: "filed", title: "Filed", type: "date" },
        { key: "next", title: "Next hearing", type: "date" },
        { key: "stay", title: "Stay in force" },
        { key: "status", title: "Status" },
      ],
      rows: rows.map((c) => ({
        flag: c.stay ? ("bad" as const) : null,
        cells: {
          ref: c.ref,
          court: c.court,
          caseNumber: c.caseNumber,
          title: c.title,
          nature: NATURE_LABELS[c.nature] ?? c.nature,
          linked: [c.inst?.shortCode, c.linkedRef].filter(Boolean).join(" · ") || null,
          counsel: c.counsel,
          filed: c.filedDate,
          next: c.nextHearing?.date ?? null,
          stay: c.stay ? `Until ${c.stay.until ?? "further orders"}` : null,
          status: COURT_STATUS[c.status]?.label ?? c.status,
        },
      })),
      notes: ["Rows shaded red have a stay order in force: council decisions on the linked case are blocked until it is lifted."],
    };
  } else if (what === "correspondence") {
    if (!can(user.roles, "pcp.correspondence.view")) return new Response("Your role cannot export the registers", { status: 403 });
    const dir = url.searchParams.get("dir") === "OUT" ? "OUT" : "IN";
    const d = await loadCorrespondence(user.username);
    const rows = d.letters.filter((l) => l.direction === dir);
    filters = dir === "IN" ? "inward (diary)" : "outward (dispatch)";
    table = {
      title: dir === "IN" ? "Inward register (diary)" : "Outward register (dispatch)",
      sub: dir === "IN" ? "Letters received, who they are marked to and the action due" : "Letters sent by PCP and when they were dispatched",
      columns: [
        { key: "ref", title: dir === "IN" ? "Diary no." : "Dispatch no.", type: "code" },
        { key: "date", title: "Letter date", type: "date" },
        { key: "party", title: dir === "IN" ? "From" : "To" },
        { key: "subject", title: "Subject" },
        { key: "mode", title: "Mode" },
        { key: "linked", title: "Linked to" },
        ...(dir === "IN"
          ? [
              { key: "marked", title: "Marked to" },
              { key: "due", title: "Action due", type: "date" as const },
            ]
          : [{ key: "dispatched", title: "Dispatched", type: "date" as const }]),
        { key: "status", title: "Status" },
      ],
      rows: rows.map((l) => ({
        flag: l.overdue ? ("warn" as const) : null,
        cells: {
          ref: l.ref,
          date: l.date,
          party: l.party,
          subject: l.subject,
          mode: MODE_LABELS[l.mode] ?? l.mode,
          linked: l.linkedRef,
          marked: l.markedToName,
          due: l.actionDue,
          dispatched: l.dispatchedAt ? l.dispatchedAt.slice(0, 10) : null,
          status: l.direction === "OUT" && !l.dispatchedAt && l.status !== "CLOSED" ? "Draft" : (LETTER_STATUS[l.status]?.label ?? l.status),
        },
      })),
      notes: dir === "IN" ? ["Rows shaded amber are open past their action date."] : [],
    };
  } else return new Response("Export what: litigation or correspondence", { status: 404 });

  const meta = { filters, generatedBy: `${user.name} (${user.username})`, generatedAt: new Date() };
  const body = format === "xlsx" ? await tableXlsx(table, meta) : await tablePdf(table, meta);
  await audit(db, { actor: user.username, action: "governance.exported", entity: "report", entityId: what, details: { format, filters, rows: table.rows.length } });
  const name = `pcp-${what}${what === "correspondence" ? `-${url.searchParams.get("dir") === "OUT" ? "outward" : "inward"}` : ""}-${new Date().toISOString().slice(0, 10)}.${format}`;
  return new Response(new Uint8Array(body), { headers: { "Content-Type": TYPES[format], "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" } });
}
