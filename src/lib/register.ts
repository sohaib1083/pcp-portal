// Reference data for the pharmacist register (guide section 9). Pure: safe in client components.
// PCP does not license pharmacists. The provincial councils do; PCP keeps an index of their registers,
// loaded from the files each council sends under agreement.

export const COUNCILS = ["Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan", "Gilgit-Baltistan"] as const;
export type Council = (typeof COUNCILS)[number];

/** Each council numbers its register its own way. The category letter is part of the number. */
export const COUNCIL_INFO: Record<Council, { name: string; code: string; format: RegExp; pattern: string; example: string; cnicPrefix: string; registrar: string }> = {
  Punjab: { name: "Punjab Pharmacy Council", code: "PPC", format: /^PPC-([AB])-\d{6}$/, pattern: "PPC-A-123456", example: "PPC-A-031457", cnicPrefix: "35202", registrar: "registrar@punjab-pharmacy-council.demo" },
  Sindh: { name: "Sindh Pharmacy Council", code: "SPC", format: /^SPC-([AB])-(\d{4})-\d{5}$/, pattern: "SPC-A-2019-01234", example: "SPC-A-2019-00412", cnicPrefix: "42101", registrar: "registrar@sindh-pharmacy-council.demo" },
  "Khyber Pakhtunkhwa": { name: "Khyber Pakhtunkhwa Pharmacy Council", code: "KPPC", format: /^KPPC-([AB])-\d{5}$/, pattern: "KPPC-A-12345", example: "KPPC-A-02118", cnicPrefix: "17301", registrar: "registrar@kp-pharmacy-council.demo" },
  Balochistan: { name: "Balochistan Pharmacy Council", code: "BPC", format: /^BPC-([AB])-\d{4}$/, pattern: "BPC-A-1234", example: "BPC-A-0391", cnicPrefix: "54400", registrar: "registrar@balochistan-pharmacy-council.demo" },
  "Gilgit-Baltistan": { name: "Gilgit-Baltistan Pharmacy Council", code: "GBPC", format: /^GBPC-([AB])-\d{4}$/, pattern: "GBPC-A-1234", example: "GBPC-A-0107", cnicPrefix: "71501", registrar: "registrar@gb-pharmacy-council.demo" },
};

export const isCouncil = (v: string): v is Council => (COUNCILS as readonly string[]).includes(v);

/** The council a registration number belongs to, from its prefix. */
export function councilOfRegNo(regNo: string): Council | null {
  const code = regNo.trim().toUpperCase().split("-")[0];
  return COUNCILS.find((c) => COUNCIL_INFO[c].code === code) ?? null;
}

/** Upper-case, trim, and turn spaces or slashes into hyphens, so "spc a 2019 412" style typing still matches. */
export function normalizeRegNo(v: string) {
  return v.trim().toUpperCase().replace(/[\s/_]+/g, "-").replace(/-+/g, "-");
}

export const CATEGORIES = ["A", "B"] as const;
export const CATEGORY_LABELS: Record<string, string> = { A: "Category A · Pharm-D", B: "Category B · Pharmacy Technician" };
export const CATEGORY_SHORT: Record<string, string> = { A: "A · Pharm-D", B: "B · Technician" };

export const STATUSES = ["ACTIVE", "DORMANT", "SUSPENDED", "CANCELLED"] as const;
export type RegStatus = (typeof STATUSES)[number];
export const STATUS_LABELS: Record<string, string> = { ACTIVE: "Active", DORMANT: "Dormant", SUSPENDED: "Suspended", CANCELLED: "Cancelled" };
export const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "neutral"> = { ACTIVE: "good", DORMANT: "warn", SUSPENDED: "bad", CANCELLED: "bad" };

export const DESIGNATIONS = [
  "Hospital Pharmacist",
  "Clinical Pharmacist",
  "Community Pharmacist",
  "Pharmacist in charge (proprietor)",
  "Production Pharmacist",
  "Quality Control Pharmacist",
  "Regulatory Affairs Officer",
  "Medical Information Officer",
  "Lecturer",
  "Pharmacy Technician",
  "Dispensing Technician",
  "Store Officer",
];

/** True when the registration's validity date has passed. */
export function validityLapsed(validUntil: string | null | undefined, today = new Date()) {
  if (!validUntil) return false;
  return new Date(validUntil + "T23:59:59").getTime() < today.getTime();
}
