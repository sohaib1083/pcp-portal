// Bulk load of a provincial council's register file (guide section 14: "bulk upload templates ...
// with a row-by-row error report before anything is saved"; "mandatory fields, format checks").
import Papa from "papaparse";
import { inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { normalizeCnic } from "./names";
import { COUNCIL_INFO, councilOfRegNo, normalizeRegNo, validityLapsed, type Council } from "./register";

export const IMPORT_COLUMNS = ["registration_no", "full_name", "father_name", "cnic", "gender", "category", "university", "graduation_year", "issue_date", "valid_until", "status", "mobile", "email", "address"] as const;
const REQUIRED = ["registration_no", "full_name", "father_name", "cnic", "category", "university", "graduation_year", "issue_date"] as const;
const LABEL: Record<string, string> = {
  registration_no: "Registration number",
  full_name: "Full name",
  father_name: "Father's name",
  cnic: "CNIC",
  category: "Category",
  university: "University",
  graduation_year: "Graduation year",
  issue_date: "Issue date",
};
const ALIASES: Record<string, string> = { reg_no: "registration_no", registration_number: "registration_no", reg_number: "registration_no", name: "full_name", father: "father_name", fathers_name: "father_name", grad_year: "graduation_year", issued: "issue_date", expiry: "valid_until", expiry_date: "valid_until", phone: "mobile" };
export const MAX_ROWS = 1000;

export type ImportRow = {
  row: number; // line in the file (the header is line 1)
  regNo: string;
  name: string;
  errors: string[];
  warnings: string[];
  data?: typeof schema.pharmacists.$inferInsert;
};
export type ImportReport = { ok: boolean; message?: string; council: Council; fileName: string; rows: ImportRow[]; total: number; ready: number; withErrors: number; withWarnings: number };

function parseDate(v: string): string | null {
  const s = v.trim();
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const STATUS_WORDS: Record<string, string> = { active: "ACTIVE", dormant: "DORMANT", suspended: "SUSPENDED", cancelled: "CANCELLED", canceled: "CANCELLED" };
const CATEGORY_WORDS: Record<string, string> = { a: "A", "pharm-d": "A", pharmd: "A", "pharm.d": "A", b: "B", technician: "B", "pharmacy technician": "B" };

/** Parse and check every row. Nothing is saved here. */
export async function checkImportFile(council: Council, fileName: string, text: string): Promise<ImportReport> {
  const base = { council, fileName, rows: [] as ImportRow[], total: 0, ready: 0, withErrors: 0, withWarnings: 0 };
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => {
      const k = h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      return ALIASES[k] ?? k;
    },
  });
  const fields = parsed.meta.fields ?? [];
  const missingCols = REQUIRED.filter((c) => !fields.includes(c));
  if (missingCols.length) return { ...base, ok: false, message: `The file is missing these columns: ${missingCols.join(", ")}. Download the template to see the expected columns.` };
  const data = parsed.data;
  if (data.length === 0) return { ...base, ok: false, message: "The file has a header row but no pharmacists. Add one row per pharmacist." };
  if (data.length > MAX_ROWS) return { ...base, ok: false, message: `The file has ${data.length.toLocaleString()} rows. Split it into files of ${MAX_ROWS.toLocaleString()} rows or fewer.` };

  const info = COUNCIL_INFO[council];
  const regNos = data.map((r) => normalizeRegNo(r.registration_no ?? "")).filter(Boolean);
  const cnics = data.map((r) => normalizeCnic(r.cnic ?? "")).filter((c): c is string => !!c);
  const existingReg = regNos.length ? await db.select({ regNo: schema.pharmacists.regNo, createdAt: schema.pharmacists.createdAt }).from(schema.pharmacists).where(inArray(schema.pharmacists.regNo, regNos)) : [];
  const existingCnic = cnics.length ? await db.select({ cnic: schema.pharmacists.cnic, regNo: schema.pharmacists.regNo }).from(schema.pharmacists).where(inArray(schema.pharmacists.cnic, cnics)) : [];
  const universities = new Set((await db.select({ name: schema.institutions.name }).from(schema.institutions)).map((i) => i.name.toLowerCase()));
  const seenReg = new Map<string, number>();
  const seenCnic = new Map<string, number>();
  const thisYear = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);

  const rows: ImportRow[] = data.map((raw, i) => {
    const line = i + 2;
    const v = (k: string) => String(raw[k] ?? "").trim();
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const c of REQUIRED) if (!v(c)) errors.push(`${LABEL[c]} is missing`);

    // Registration number: this council's format, and the category letter inside it
    const regNo = normalizeRegNo(v("registration_no"));
    let letter: string | null = null;
    if (regNo) {
      const m = info.format.exec(regNo);
      if (m) letter = m[1];
      else {
        const other = councilOfRegNo(regNo);
        errors.push(other && other !== council ? `${regNo} is a ${other} number; this file is from the ${info.name}` : `Registration number ${regNo} does not match the ${council} format ${info.pattern}`);
      }
      if (seenReg.has(regNo)) errors.push(`Same registration number as row ${seenReg.get(regNo)}`);
      else seenReg.set(regNo, line);
      const ex = existingReg.find((e) => e.regNo === regNo);
      if (ex) errors.push(`Already on the register since ${ex.createdAt.toISOString().slice(0, 10)}. Change its status on the record instead of importing it again`);
    }

    // Category
    let category: string | null = null;
    if (v("category")) {
      category = CATEGORY_WORDS[v("category").toLowerCase()] ?? null;
      if (!category) errors.push("Category must be A (Pharm-D) or B (Pharmacy Technician)");
      else if (letter && letter !== category) errors.push(`Category ${category} does not match the letter ${letter} in the registration number`);
    }

    // CNIC
    let cnic: string | null = null;
    if (v("cnic")) {
      cnic = normalizeCnic(v("cnic"));
      if (!cnic) errors.push("CNIC must have 13 digits, e.g. 42101-1234567-1");
      else {
        if (seenCnic.has(cnic)) errors.push(`Same CNIC as row ${seenCnic.get(cnic)}`);
        else seenCnic.set(cnic, line);
        const ex = existingCnic.find((e) => e.cnic === cnic);
        if (ex && ex.regNo !== regNo) errors.push(`This CNIC is already registered as ${ex.regNo}`);
      }
    }

    // Names
    for (const k of ["full_name", "father_name"] as const) {
      const s = v(k);
      if (s && (s.replace(/[^A-Za-z]/g, "").length < 3 || /[^A-Za-z .'-]/.test(s))) errors.push(`${LABEL[k]} must be at least 3 letters, without digits or symbols`);
    }

    // Dates and years
    const gy = Number(v("graduation_year"));
    if (v("graduation_year") && (!Number.isInteger(gy) || gy < 1960 || gy > thisYear)) errors.push(`Graduation year must be a year between 1960 and ${thisYear}`);
    const issue = v("issue_date") ? parseDate(v("issue_date")) : null;
    if (v("issue_date") && !issue) errors.push("Issue date must be a date like 2019-03-11 or 11/03/2019");
    if (issue && issue > today) errors.push("Issue date is in the future");
    if (issue && Number.isInteger(gy) && Number(issue.slice(0, 4)) < gy) errors.push("Issue date is before the graduation year");
    const valid = v("valid_until") ? parseDate(v("valid_until")) : null;
    if (v("valid_until") && !valid) errors.push("Valid-until date must be a date like 2028-06-30");
    if (valid && issue && valid < issue) errors.push("Valid-until date is before the issue date");

    // Status
    const status = v("status") ? (STATUS_WORDS[v("status").toLowerCase()] ?? null) : "ACTIVE";
    if (!status) errors.push("Status must be Active, Dormant, Suspended or Cancelled");

    // Optional contact fields
    const g = v("gender").toUpperCase();
    const gender = !g ? null : g === "M" || g === "MALE" ? "M" : g === "F" || g === "FEMALE" ? "F" : undefined;
    if (gender === undefined) errors.push("Gender must be M or F (or left empty)");
    let mobile: string | null = null;
    if (v("mobile")) {
      const d = v("mobile").replace(/\D/g, "").replace(/^92/, "0");
      if (/^03\d{9}$/.test(d)) mobile = `${d.slice(0, 4)}-${d.slice(4)}`;
      else errors.push("Mobile must look like 0300-1234567");
    }
    const email = v("email") || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Email address is not valid");

    // Warnings: imported, but worth a look
    if (v("university") && !universities.has(v("university").toLowerCase())) warnings.push("University is not in PCP's list of institutions; check the spelling");
    if (status === "ACTIVE" && valid && validityLapsed(valid)) warnings.push("Status is Active but the validity has ended; the public check will say the registration period ended");
    if (status === "ACTIVE" && !valid && v("valid_until") === "") warnings.push("No valid-until date");

    const row: ImportRow = { row: line, regNo: regNo || "(none)", name: v("full_name") || "(no name)", errors, warnings };
    if (!errors.length)
      row.data = {
        regNo,
        fullName: v("full_name"),
        fatherName: v("father_name"),
        cnic: cnic!,
        gender: gender ?? null,
        university: v("university"),
        graduationYear: gy,
        category: category!,
        council,
        issueDate: issue!,
        validUntil: valid,
        status: status!,
        mobile,
        email,
        address: v("address") || null,
      };
    return row;
  });

  const ready = rows.filter((r) => !r.errors.length).length;
  return { ...base, ok: true, rows, total: rows.length, ready, withErrors: rows.length - ready, withWarnings: rows.filter((r) => !r.errors.length && r.warnings.length).length };
}

/** A small file in the council's format with fresh numbers and a few deliberate mistakes, for the demo. */
export async function sampleImportFile(council: Council) {
  const info = COUNCIL_INFO[council];
  const taken = new Set((await db.select({ regNo: schema.pharmacists.regNo }).from(schema.pharmacists)).map((r) => r.regNo));
  const existing = (await db.select({ regNo: schema.pharmacists.regNo, cnic: schema.pharmacists.cnic }).from(schema.pharmacists)).find((r) => councilOfRegNo(r.regNo) === council);
  const rnd = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
  const fresh = (cat: string) => {
    for (;;) {
      const year = rnd(2021, 2025);
      const n =
        council === "Punjab"
          ? `PPC-${cat}-${String(rnd(60000, 99999)).padStart(6, "0")}`
          : council === "Sindh"
            ? `SPC-${cat}-${year}-${String(rnd(2000, 9999)).padStart(5, "0")}`
            : council === "Khyber Pakhtunkhwa"
              ? `KPPC-${cat}-${String(rnd(4000, 9999)).padStart(5, "0")}`
              : council === "Balochistan"
                ? `BPC-${cat}-${String(rnd(1100, 9999)).padStart(4, "0")}`
                : `GBPC-${cat}-${String(rnd(400, 9999)).padStart(4, "0")}`;
      if (!taken.has(n)) {
        taken.add(n);
        return n;
      }
    }
  };
  const cnic = () => `${info.cnicPrefix}-${rnd(1000000, 9999999)}-${rnd(1, 9)}`;
  const uni = (await db.select({ name: schema.institutions.name, province: schema.institutions.province }).from(schema.institutions)).find((i) => i.province === council)?.name ?? "Riverside University of Health Sciences";
  const dupCnic = cnic();
  const rows: string[][] = [
    [fresh("A"), "Mahnoor Tariq", "Tariq Mehmood", dupCnic, "F", "A", uni, "2022", "2023-02-14", "2028-12-31", "Active", "0301-2345678", "mahnoor.t@mail.demo", ""],
    [fresh("A"), "Danish Iqbal", "Muhammad Iqbal", cnic(), "M", "A", uni, "2021", "2022-03-01", "2027-12-31", "Active", "0333-1112223", "", ""],
    [fresh("B"), "Sidra Naz", "Abdul Ghafoor", cnic(), "F", "B", uni, "2023", "2024-01-20", "2029-06-30", "Active", "", "", ""],
    [fresh("A"), "Fahad Rasheed", "Abdul Rasheed", cnic(), "M", "A", "Hyderabad Institute of Pharmacy", "2020", "2021-07-05", "2026-12-31", "Active", "0345-9988776", "", ""],
    [fresh("B"), "Areej Fatima", "Ghulam Abbas", cnic(), "F", "B", uni, "2019", "2020-05-10", "2024-06-30", "Dormant", "", "", ""],
    [`${info.code}-A-19-12`, "Owais Qadir", "Abdul Qadir", cnic(), "M", "A", uni, "2019", "2020-01-15", "2027-12-31", "Active", "", "", ""],
    [fresh("A"), "Javeria Anwar", "Muhammad Anwar", "4210-1234-1", "F", "A", uni, "2022", "2023-03-03", "2028-12-31", "Active", "", "", ""],
    [existing?.regNo ?? fresh("A"), "Repeat Entry", "Same Person", existing?.cnic ?? cnic(), "M", "A", uni, "2015", "2016-02-02", "2027-12-31", "Active", "", "", ""],
    [fresh("A"), "Yasir Hameed", "Abdul Hameed", dupCnic, "M", "A", uni, "2021", "2022-04-04", "2027-12-31", "Active", "", "", ""],
    [fresh("A"), "Bushra Kanwal", "", cnic(), "F", "B", uni, "2023", "2031-01-01", "", "Active", "12345", "", ""],
  ];
  const csv = Papa.unparse({ fields: [...IMPORT_COLUMNS], data: rows });
  return { fileName: `${info.code.toLowerCase()}-register-sample-${new Date().toISOString().slice(0, 10)}.csv`, csv };
}
