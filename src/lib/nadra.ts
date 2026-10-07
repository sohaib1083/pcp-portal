// CNIC check against NADRA (guide section 14: "CNIC check against NADRA at registration of faculty,
// students, and pharmacists, where an agreement allows it").
//
// SIMULATED. Nothing leaves the server and no NADRA system is called. In production this would call
// NADRA's verification service (e.g. Verisys) under PCP's agreement. The simulation is deterministic so a
// presenter can show every outcome, by the LAST FOUR DIGITS of the 13-digit CNIC:
//   ends in 0000  -> NOT_FOUND       e.g. 17301-1230000-0
//   ends in 1111  -> NAME_MISMATCH   e.g. 17301-1231111-1 (NADRA returns a different spelling of the name)
//   anything else -> MATCH
import { randomBytes } from "node:crypto";

export type NadraStatus = "MATCH" | "NAME_MISMATCH" | "NOT_FOUND";
export type NadraResult = { status: NadraStatus; nadraName: string | null; txnId: string; checkedAt: string; simulated: true };

// The same rule in plain words for screens: NADRA_RULE_TEXT in src/lib/identity-shared.ts.

const TITLES = /^(dr|prof|professor|mr|mrs|ms|miss|engr|hafiz|haji)\.?\s+/i;

/** NADRA holds names without titles. */
export function withoutTitle(name: string) {
  let s = name.trim();
  while (TITLES.test(s)) s = s.replace(TITLES, "");
  return s.replace(/\s+/g, " ");
}

// Spellings NADRA might hold for a common name (the other way round from the one typed).
const SPELLING: Record<string, string> = {
  muhammad: "Mohammad",
  mohammad: "Muhammad",
  mohammed: "Muhammad",
  ahmed: "Ahmad",
  ahmad: "Ahmed",
  hussain: "Husain",
  husain: "Hussain",
  hassan: "Hasan",
  hasan: "Hassan",
  ayesha: "Aisha",
  aisha: "Ayesha",
  fatima: "Fatimah",
  zainab: "Zaynab",
  yousaf: "Yousuf",
  yousuf: "Yousaf",
  umar: "Umer",
  umer: "Umar",
  usman: "Osman",
  iqbal: "Ikbal",
  qureshi: "Qurashi",
  siddiqui: "Siddiqi",
  mehmood: "Mahmood",
  mahmood: "Mehmood",
  rehman: "Rahman",
  rahman: "Rehman",
  sana: "Sanaa",
  hira: "Heera",
  bilal: "Bilaal",
};

/** A different spelling of the same name, the way NADRA's record might hold it. */
export function nadraSpelling(name: string) {
  const words = withoutTitle(name).split(" ");
  const i = words.findIndex((w) => SPELLING[w.toLowerCase()]);
  if (i >= 0) {
    words[i] = SPELLING[words[i].toLowerCase()];
    return words.join(" ");
  }
  // No known variant: lengthen the first vowel of the first name (Kashif -> Kaashif).
  const first = words[0] ?? name;
  const m = /[aeiou]/i.exec(first.slice(1));
  words[0] = m ? first.slice(0, m.index + 1) + m[0] + first.slice(m.index + 1) : `${first}h`;
  return words.join(" ");
}

export function cnicDigits(cnic: string) {
  return cnic.replace(/\D/g, "");
}

/** The deterministic outcome for a CNIC (no delay, no randomness except the transaction id). */
export function simulateNadra(input: { cnic: string; name: string }): NadraResult {
  const last4 = cnicDigits(input.cnic).slice(-4);
  const status: NadraStatus = last4 === "0000" ? "NOT_FOUND" : last4 === "1111" ? "NAME_MISMATCH" : "MATCH";
  const nadraName = status === "NOT_FOUND" ? null : status === "NAME_MISMATCH" ? nadraSpelling(input.name) : withoutTitle(input.name);
  const now = new Date();
  return { status, nadraName, txnId: `SIM-NADRA-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${randomBytes(4).toString("hex").toUpperCase()}`, checkedAt: now.toISOString(), simulated: true };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Check one CNIC with NADRA (simulated): answers after about a second, like a real round trip.
 * `fatherName` is accepted because the production service matches on it too; the simulation ignores it.
 */
export async function verifyCnic({ cnic, name, fatherName }: { cnic: string; name: string; fatherName?: string }): Promise<NadraResult> {
  void fatherName;
  await wait(900 + Math.floor(Math.random() * 300));
  return simulateNadra({ cnic, name });
}

/** Check a batch (bulk import): one round trip for the whole file, as NADRA's bulk service would. */
export async function verifyCnicBatch(items: { cnic: string; name: string; fatherName?: string }[]): Promise<NadraResult[]> {
  if (!items.length) return [];
  await wait(Math.min(2500, 900 + items.length * 40));
  return items.map((x) => simulateNadra(x));
}
