// Identity check shapes and badge wording, shared by server and client. Pure: no imports.

export type IdentityEntity = "faculty" | "student" | "pharmacist";

/** The simulated NADRA rule (src/lib/nadra.ts), for screen guides, so a presenter can show all three outcomes. */
export const NADRA_RULE_TEXT =
  "Simulated NADRA check, by the last four digits of the CNIC: **0000** is not found at NADRA (e.g. 17301-1230000-0), **1111** comes back with a different spelling of the name (e.g. 17301-1231111-1), and any other CNIC matches.";

/** The latest NADRA check on a record, as the badge shows it. */
export type IdentityBadge = {
  checkId: number;
  status: "MATCH" | "NAME_MISMATCH" | "NOT_FOUND";
  nadraName: string | null;
  nameSent: string;
  txnId: string;
  checkedAt: string;
  checkedBy: string;
  reviewStatus: string | null; // OPEN | RESOLVED
  reviewOutcome: string | null;
  reviewNote: string | null;
};

/** "06 Oct 2026" */
export function nadraDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export type BadgeTone = "good" | "warn" | "bad" | "neutral" | "info";

/** Badge text for a record: "NADRA verified · 06 Oct 2026", "Name differs at NADRA: …", "Not found at NADRA". */
export function badgeFor(b: IdentityBadge | null | undefined): { tone: BadgeTone; label: string; title: string } {
  if (!b) return { tone: "neutral", label: "Not checked with NADRA", title: "No CNIC check with NADRA (simulated) has run for this record yet." };
  const when = nadraDate(b.checkedAt);
  const resolved = b.reviewStatus === "RESOLVED";
  const how = `Simulated NADRA check on ${when}, transaction ${b.txnId}`;
  if (b.status === "MATCH") return { tone: "good", label: `NADRA verified · ${when}`, title: `${how}: CNIC and name match.` };
  if (b.status === "NAME_MISMATCH")
    return {
      tone: resolved ? "info" : "warn",
      label: `Name differs at NADRA: ${b.nadraName ?? "—"}${resolved ? " · resolved" : ""}`,
      title: `${how}: NADRA holds the name as "${b.nadraName}"; PCP's record says "${b.nameSent}".${resolved ? ` Resolved by PCP: ${b.reviewNote ?? ""}` : " PCP's verification officer reviews it."}`,
    };
  return {
    tone: resolved ? "info" : "bad",
    label: `Not found at NADRA${resolved ? " · resolved" : ""}`,
    title: `${how}: NADRA has no record of this CNIC.${resolved ? ` Resolved by PCP: ${b.reviewNote ?? ""}` : " PCP's verification officer reviews it."}`,
  };
}

export const ENTITY_LABELS: Record<IdentityEntity, string> = { faculty: "Faculty", student: "Student", pharmacist: "Pharmacist" };
