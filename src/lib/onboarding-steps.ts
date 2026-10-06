// The onboarding checklist (guide section 3): what each step needs before the request can be submitted.
// Pure functions, safe on the client and the server.
import type { OnboardingCampus, OnboardingProfile, OnboardingProgramme } from "@/db/modules/onboarding";

export type StepKey = "account" | "profile" | "campus" | "documents";
export type StepState = { key: StepKey; title: string; done: boolean; missing: string[]; summary: string };
export type DocLite = { docType: string; version: number; verificationStatus: string };

export const ONBOARDING_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Waiting for PCP",
  RETURNED: "Returned for changes",
  REJECTED: "Rejected",
  APPROVED: "Approved",
};

export const ONBOARDING_STATUS_TONE: Record<string, "neutral" | "info" | "warn" | "bad" | "good"> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  RETURNED: "warn",
  REJECTED: "bad",
  APPROVED: "good",
};

export const AFFILIATION_TYPES = ["University", "Affiliated college", "Constituent college"] as const;
export const PROGRAMME_LABELS: Record<string, string> = { PHARMD: "Doctor of Pharmacy (PharmD)", TECH: "Pharmacy Technician" };

export const PROFILE_FIELDS: [keyof OnboardingProfile, string][] = [
  ["name", "Institution name"],
  ["shortCode", "Short code"],
  ["sector", "Sector"],
  ["province", "Province"],
  ["city", "City"],
  ["address", "Address"],
  ["phone", "Phone"],
  ["establishedYear", "Year established"],
  ["affiliationType", "Affiliation type"],
];

/** The latest version of each document type. A version PCP marked as rejected must be replaced. */
export function latestDocs<T extends DocLite>(docs: T[]) {
  const latest = new Map<string, T>();
  for (const d of docs) {
    const cur = latest.get(d.docType);
    if (!cur || d.version > cur.version) latest.set(d.docType, d);
  }
  return latest;
}

export function onboardingSteps(o: {
  emailVerifiedAt: string | Date | null;
  mobileVerifiedAt: string | Date | null;
  profile: OnboardingProfile;
  campuses: OnboardingCampus[];
  programmes: OnboardingProgramme[];
  docs: DocLite[];
  requiredDocs: string[];
}): StepState[] {
  const account: string[] = [];
  if (!o.emailVerifiedAt) account.push("Email not verified");
  if (!o.mobileVerifiedAt) account.push("Mobile not verified");

  const p = o.profile ?? {};
  const profile = PROFILE_FIELDS.filter(([k]) => p[k] === undefined || p[k] === null || String(p[k]).trim() === "").map(([, label]) => label);
  if (p.affiliationType && p.affiliationType !== "University" && !p.affiliatedUniversity) profile.push("Affiliated university");

  const campus: string[] = [];
  const main = o.campuses.find((c) => c.isMain);
  if (!main) campus.push("Main campus");
  if (o.programmes.length === 0) campus.push("At least one programme");
  const names = new Set(o.campuses.map((c) => c.name));
  if (o.programmes.some((x) => !names.has(x.campus))) campus.push("A programme points to a campus that no longer exists");

  const latest = latestDocs(o.docs);
  const documents = o.requiredDocs
    .filter((r) => !latest.has(r) || latest.get(r)!.verificationStatus === "REJECTED")
    .map((r) => (latest.has(r) ? `${r} (PCP did not accept it)` : r));

  const progs = o.programmes.length;
  return [
    { key: "account", title: "Account", done: account.length === 0, missing: account, summary: account.length ? "Verify your email and mobile number" : "Email and mobile verified" },
    {
      key: "profile",
      title: "Profile and affiliation",
      done: profile.length === 0,
      missing: profile,
      summary: profile.length ? `${PROFILE_FIELDS.length + (p.affiliationType && p.affiliationType !== "University" ? 1 : 0) - profile.length} of ${PROFILE_FIELDS.length + (p.affiliationType && p.affiliationType !== "University" ? 1 : 0)} required fields filled` : `${p.name} · ${p.city}, ${p.province}`,
    },
    {
      key: "campus",
      title: "Campus and programmes",
      done: campus.length === 0,
      missing: campus,
      summary: o.campuses.length ? `${o.campuses.length} campus${o.campuses.length === 1 ? "" : "es"} · ${progs} programme${progs === 1 ? "" : "s"}` : "Add your main campus first",
    },
    {
      key: "documents",
      title: "Legal documents",
      done: documents.length === 0,
      missing: documents,
      summary: `${o.requiredDocs.length - documents.length} of ${o.requiredDocs.length} required documents attached`,
    },
  ];
}
