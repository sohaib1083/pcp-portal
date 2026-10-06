// Standard decision letters from one template per outcome, so wording is consistent across cases
// (guide section 14). Approval, deferral and rejection each produce a signed PDF with a QR code.
import { publicUrl, renderLetter } from "./letters";
import { KIND_LABELS, PROGRAM_LABELS } from "./workflow";

type Input = {
  decision: "APPROVED" | "DEFERRED" | "REJECTED";
  ref: string;
  kind: string;
  programType: string;
  intake: number;
  campus?: string | null;
  inst: { name: string; code: string; city: string; province: string };
  note?: string | null;
  grounds?: string | null;
  deferUntil?: string | null;
  period?: { from: number; until: number } | null;
  signedBy: string;
  at?: Date;
};

const long = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function decisionLetter(o: Input) {
  const at = o.at ?? new Date();
  const prog = PROGRAM_LABELS[o.programType] ?? o.programType;
  const kind = KIND_LABELS[o.kind] ?? o.kind;
  const what = o.kind === "NOC" ? `a No Objection Certificate to offer the ${prog} programme${o.campus ? ` at ${o.campus}` : ""}` : `${o.kind === "RENEWAL" ? "renewal of accreditation" : "accreditation"} of the ${prog} programme`;
  const term = o.period ? `${o.period.from}-${o.period.until}` : null;
  let subject = "";
  const paragraphs: string[] = [];
  if (o.decision === "APPROVED") {
    subject = `Council decision on ${o.ref}: ${prog} ${kind.toLowerCase()} approved`;
    paragraphs.push(
      o.kind === "NOC"
        ? `The Council of the Pharmacy Council of Pakistan considered your application ${o.ref} for ${what}, and approved it for an annual intake of ${o.intake} students.`
        : `The Council of the Pharmacy Council of Pakistan considered your application ${o.ref} for ${what}, and approved accreditation for ${term} for an annual intake of ${o.intake} students.`,
    );
    if (o.note) paragraphs.push(`Conditions: ${o.note}`);
    paragraphs.push(
      `The ${o.kind === "NOC" ? "NOC" : "accreditation"} certificate will be issued in the portal with a QR code that anyone can scan to confirm it. The ${o.kind === "NOC" ? "approved intake" : "accreditation term and intake"} is now recorded on your programme card.`,
    );
  } else if (o.decision === "DEFERRED") {
    subject = `Council decision on ${o.ref}: deferred until ${long(o.deferUntil!)}`;
    paragraphs.push(`The Council considered your application ${o.ref} for ${what} and deferred its decision. A deferral is not a refusal: the case returns to the Council agenda after the date below.`);
    paragraphs.push(`Reason: ${o.grounds}`);
    paragraphs.push(`Please address the points above and upload the evidence in the portal by ${long(o.deferUntil!)}. PCP will tell you when the case is back on the agenda.`);
  } else {
    subject = `Council decision on ${o.ref}: rejected`;
    paragraphs.push(`The Council considered your application ${o.ref} for ${what} and rejected it on the grounds below.`);
    paragraphs.push(`Grounds: ${o.grounds}`);
    paragraphs.push(`You may appeal within 30 days from the Appeals page in the portal, with evidence that addresses these grounds. A new ${prog} application opens 12 months after this decision unless an appeal is upheld.`);
  }
  const table: [string, string][] = [
    ["Case", o.ref],
    ["Institution", `${o.inst.name} (${o.inst.code})`],
    ["Programme", `${prog} · ${kind}`],
    ["Decision", o.decision === "APPROVED" ? "Approved" : o.decision === "DEFERRED" ? "Deferred" : "Rejected"],
    ["Decided on", long(at.toISOString().slice(0, 10))],
  ];
  if (o.decision === "APPROVED") table.push([o.kind === "NOC" ? "Approved intake" : "Accredited intake", `${o.intake} students per year`]);
  if (o.decision === "APPROVED" && term) table.push(["Accreditation term", term]);
  if (o.decision === "DEFERRED") table.push(["Return date", long(o.deferUntil!)]);
  return renderLetter({
    kind: "Decision letter",
    refNo: `${o.ref}/DL`,
    date: at,
    to: { name: o.inst.name, lines: [o.inst.code, `${o.inst.city}, ${o.inst.province}`] },
    subject,
    paragraphs,
    table,
    signatory: { name: o.signedBy, title: "Secretary, Pharmacy Council of Pakistan", signedAt: at },
    qrUrl: publicUrl(`/institution/applications/${o.ref}`),
    qrCaption: "Scan to open the case in the portal (sign-in required)",
  });
}
