// Seed data for the pharmacists module. Runs after the core seed (see scripts/seed/index.ts).
// About 150 FICTIONAL pharmacists, loaded as if each provincial council had sent its register file.
// PCP does not license pharmacists; this is an index of the councils' registers (guide section 9).
import { eq } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db, schema } from "../../src/db";
import { audit } from "../../src/lib/audit";
import { fileDocument } from "../../src/lib/letters";
import { notify } from "../../src/lib/util";
import { COUNCIL_INFO, COUNCILS, DESIGNATIONS, type Council } from "../../src/lib/register";

let seed = 20261006;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(a: readonly T[]) => a[Math.floor(rand() * a.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pad = (n: number, w: number) => String(n).padStart(w, "0");

const MALE = ["Ahmed", "Ali", "Hamza", "Bilal", "Usman", "Hassan", "Faisal", "Imran", "Kashif", "Saad", "Waqas", "Zeeshan", "Adnan", "Asad", "Junaid", "Rizwan", "Shahid", "Tahir", "Naveed", "Owais", "Danish", "Fahad", "Arsalan", "Shoaib", "Yasir", "Sohail", "Mudassir", "Wajid"];
const FEMALE = ["Ayesha", "Fatima", "Sana", "Hira", "Maryam", "Zainab", "Amna", "Rabia", "Saba", "Nida", "Iqra", "Mehwish", "Sadia", "Kiran", "Hafsa", "Noor", "Shehla", "Mahnoor", "Areej", "Sidra", "Javeria", "Bushra"];
const LAST: Record<Council, string[]> = {
  Punjab: ["Butt", "Chaudhry", "Malik", "Javed", "Aslam", "Iqbal", "Rana", "Cheema", "Bajwa", "Gondal", "Raza", "Qureshi", "Ahmed", "Sheikh"],
  Sindh: ["Memon", "Shaikh", "Soomro", "Siddiqui", "Abbasi", "Jatoi", "Channa", "Qureshi", "Ansari", "Rajput", "Baloch", "Junejo"],
  "Khyber Pakhtunkhwa": ["Khan", "Yousafzai", "Durrani", "Afridi", "Khattak", "Shah", "Marwat", "Bangash", "Orakzai", "Swati"],
  Balochistan: ["Baloch", "Kakar", "Achakzai", "Mengal", "Bugti", "Raisani", "Tareen", "Jamali", "Marri"],
  "Gilgit-Baltistan": ["Baig", "Shah", "Hunzai", "Karim", "Ali", "Abbas", "Nagri", "Balti"],
};
const CITIES: Record<Council, string[]> = {
  Punjab: ["Lahore", "Multan", "Faisalabad", "Rawalpindi", "Gujranwala", "Bahawalpur", "Sialkot"],
  Sindh: ["Karachi", "Hyderabad", "Sukkur", "Larkana", "Mirpurkhas"],
  "Khyber Pakhtunkhwa": ["Peshawar", "Abbottabad", "Mardan", "Swat", "Kohat", "Dera Ismail Khan"],
  Balochistan: ["Quetta", "Turbat", "Khuzdar", "Gwadar", "Sibi"],
  "Gilgit-Baltistan": ["Gilgit", "Skardu", "Hunza", "Ghizer"],
};
const AREAS = ["Model Town", "Gulshan", "Satellite Town", "Civil Lines", "University Road", "Cantonment", "Garden Colony", "New City"];
const PLACE_KINDS = [
  (c: string) => `${pick(["Al-Shifa", "City Care", "Crescent", "Green Valley", "Indus", "Mercy", "Noor", "Rehmat", "Sunrise", "Unity"])} Hospital Pharmacy, ${c}`,
  (c: string) => `${pick(["Faisal", "Kausar", "Madina", "Mehran", "Nishat", "Shifa", "Tariq", "Zam Zam"])} Pharmacy, ${pick(AREAS)}, ${c}`,
  (c: string) => `${pick(["District Headquarters Hospital", "Tehsil Headquarters Hospital", "Rural Health Centre"])}, ${c}`,
  (c: string) => `${pick(["Avicenna", "Helix", "Medora", "Pharmaline", "Zenith"])} Pharmaceuticals (production unit), ${c}`,
];
const TECH_DESIGNATIONS = ["Pharmacy Technician", "Dispensing Technician", "Store Officer"];
const PHARMD_DESIGNATIONS = DESIGNATIONS.filter((d) => !TECH_DESIGNATIONS.includes(d));

const usedCnic = new Set<string>();
function cnic(council: Council, female: boolean) {
  for (;;) {
    // Last digit: odd for men, even for women (as on a real CNIC).
    const last = female ? pick([2, 4, 6, 8]) : pick([1, 3, 5, 7, 9]);
    const c = `${COUNCIL_INFO[council].cnicPrefix}-${int(1_000_000, 9_999_999)}-${last}`;
    if (!usedCnic.has(c)) {
      usedCnic.add(c);
      return c;
    }
  }
}

const usedReg = new Set<string>();
function regNo(council: Council, cat: string, issueYear: number) {
  for (;;) {
    const y = issueYear - 2005;
    const n =
      council === "Punjab"
        ? `PPC-${cat}-${pad(8000 + y * 3100 + int(0, 3000), 6)}`
        : council === "Sindh"
          ? `SPC-${cat}-${issueYear}-${pad(int(20, 1900), 5)}`
          : council === "Khyber Pakhtunkhwa"
            ? `KPPC-${cat}-${pad(400 + y * 160 + int(0, 150), 5)}`
            : council === "Balochistan"
              ? `BPC-${cat}-${pad(60 + y * 45 + int(0, 40), 4)}`
              : `GBPC-${cat}-${pad(10 + y * 12 + int(0, 10), 4)}`;
    if (!usedReg.has(n)) {
      usedReg.add(n);
      return n;
    }
  }
}

async function letterPdf(title: string, lines: string[]) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({ x: 0, y: 792, width: 595, height: 50, color: rgb(0.05, 0.36, 0.27) });
  page.drawText("DEMO DOCUMENT - fictional data", { x: 40, y: 810, size: 12, font: bold, color: rgb(1, 1, 1) });
  page.drawText(title, { x: 40, y: 740, size: 18, font: bold });
  lines.forEach((l, i) => page.drawText(l, { x: 40, y: 700 - i * 20, size: 11, font }));
  return Buffer.from(await pdf.save());
}

type Row = typeof schema.pharmacists.$inferInsert & { _events?: { kind: string; from?: string; to?: string; note: string; actor: string; at: Date }[] };

// Records the demo and the module test rely on. Numbers match COUNCIL_INFO examples.
const FIXED: (Omit<Row, "council" | "cnic"> & { council: Council })[] = [
  { regNo: "PPC-A-031457", fullName: "Ali Raza", fatherName: "Muhammad Raza", gender: "M", category: "A", council: "Punjab", university: "Ravi Bank University", graduationYear: 2016, issueDate: "2017-02-14", validUntil: "2027-12-31", status: "ACTIVE", practicePlace: "Ravi Hospital Pharmacy, Lahore", designation: "Hospital Pharmacist", practiceConfirmed: true, practiceConfirmedAt: new Date("2026-09-18T10:00:00Z"), mobile: "0321-4567891", email: "pharm.ali@demo.pcp.local", address: "House 18, Street 7, Model Town, Lahore", username: "pharm.ali" },
  { regNo: "SPC-A-2019-00412", fullName: "Sana Memon", fatherName: "Abdul Sattar Memon", gender: "F", category: "A", council: "Sindh", university: "Sindh Coastal University", graduationYear: 2018, issueDate: "2019-03-11", validUntil: "2028-06-30", status: "ACTIVE", mobile: "0333-2145876", email: "pharm.sana@demo.pcp.local", address: "Flat 4B, Block 5, Clifton, Karachi", username: "pharm.sana" },
  {
    regNo: "SPC-A-2014-00187", fullName: "Kashif Shaikh", fatherName: "Nadeem Shaikh", gender: "M", category: "A", council: "Sindh", university: "Sindh Coastal University", graduationYear: 2013, issueDate: "2014-01-20", validUntil: "2024-06-30", status: "DORMANT", mobile: "0300-3344556", email: "kashif.shaikh@mail.demo", address: "House 9, Latifabad Unit 7, Hyderabad",
    _events: [{ kind: "STATUS", from: "ACTIVE", to: "DORMANT", note: "Not renewed by 30 Jun 2024. Marked dormant in the Sindh Pharmacy Council's file of August 2024.", actor: "Sindh Pharmacy Council", at: new Date("2024-08-19T09:30:00Z") }],
  },
  {
    regNo: "PPC-B-052310", fullName: "Hira Butt", fatherName: "Tariq Butt", gender: "F", category: "B", council: "Punjab", university: "Five Rivers University", graduationYear: 2019, issueDate: "2020-01-08", validUntil: "2027-09-30", status: "SUSPENDED", mobile: "0345-7788990", email: "hira.butt@mail.demo", address: "House 3, Gulgasht Colony, Multan",
    _events: [{ kind: "STATUS", from: "ACTIVE", to: "SUSPENDED", note: "Suspended by the Punjab Pharmacy Council pending a disciplinary inquiry (letter PPC/DC/2026/118).", actor: "Punjab Pharmacy Council", at: new Date("2026-07-02T11:00:00Z") }],
  },
  {
    regNo: "KPPC-A-01562", fullName: "Imran Yousafzai", fatherName: "Gul Muhammad Yousafzai", gender: "M", category: "A", council: "Khyber Pakhtunkhwa", university: "Riverside University of Health Sciences", graduationYear: 2011, issueDate: "2012-04-02", validUntil: "2025-12-31", status: "CANCELLED", mobile: "0315-9090123", email: "imran.y@mail.demo", address: "House 41, Hayatabad Phase 3, Peshawar",
    _events: [{ kind: "STATUS", from: "ACTIVE", to: "CANCELLED", note: "Cancelled by the Khyber Pakhtunkhwa Pharmacy Council: degree could not be verified with the university (letter KPPC/REG/2025/77).", actor: "Khyber Pakhtunkhwa Pharmacy Council", at: new Date("2025-11-14T08:00:00Z") }],
  },
  { regNo: "KPPC-A-02118", fullName: "Zainab Durrani", fatherName: "Shahid Durrani", gender: "F", category: "A", council: "Khyber Pakhtunkhwa", university: "Riverside University of Health Sciences", graduationYear: 2017, issueDate: "2018-02-26", validUntil: "2029-12-31", status: "ACTIVE", practicePlace: "Crescent Hospital Pharmacy, Peshawar", designation: "Clinical Pharmacist", practiceConfirmed: true, practiceConfirmedAt: new Date("2026-09-24T10:00:00Z"), mobile: "0334-5566778", email: "zainab.durrani@mail.demo", address: "House 7, University Town, Peshawar" },
  { regNo: "BPC-A-0391", fullName: "Abdul Wahid Kakar", fatherName: "Haji Abdul Qadir Kakar", gender: "M", category: "A", council: "Balochistan", university: "Bolan Valley University", graduationYear: 2010, issueDate: "2011-05-16", validUntil: "2028-12-31", status: "ACTIVE", mobile: "0331-8123456", email: "wahid.kakar@mail.demo", address: "House 22, Jinnah Town, Quetta" },
  { regNo: "GBPC-A-0107", fullName: "Shehla Baig", fatherName: "Sher Baz Baig", gender: "F", category: "A", council: "Gilgit-Baltistan", university: "Riverside University of Health Sciences", graduationYear: 2012, issueDate: "2013-07-01", validUntil: "2026-12-31", status: "ACTIVE", practicePlace: "District Headquarters Hospital, Gilgit", designation: "Hospital Pharmacist", practiceConfirmed: true, practiceConfirmedAt: new Date("2026-09-29T10:00:00Z"), mobile: "0355-4123987", email: "shehla.baig@mail.demo", address: "Jutial, Gilgit" },
];

const PER_COUNCIL: Record<Council, number> = { Punjab: 50, Sindh: 36, "Khyber Pakhtunkhwa": 30, Balochistan: 19, "Gilgit-Baltistan": 15 };

export default async function seedPharmacists(): Promise<string | void> {
  for (const f of FIXED) usedReg.add(f.regNo);

  // Universities: the registry's own institutions, by programme type and province.
  const insts = await db.select().from(schema.institutions);
  const progs = await db.select().from(schema.programs);
  const offering = (type: string) => insts.filter((i) => progs.some((p) => p.institutionId === i.id && p.type === type));
  const university = (council: Council, cat: string) => {
    const list = offering(cat === "A" ? "PHARMD" : "TECH");
    const local = list.filter((i) => i.province === council);
    return (local.length && rand() < 0.8 ? pick(local) : pick(list)).name;
  };

  const rows: Row[] = [];
  for (const council of COUNCILS) {
    const fixed = FIXED.filter((f) => f.council === council);
    for (const f of fixed) rows.push({ ...f, cnic: cnic(council, f.gender === "F") });
    for (let i = fixed.length; i < PER_COUNCIL[council]; i++) {
      const female = rand() < 0.48;
      const first = female ? pick(FEMALE) : pick(MALE);
      const last = pick(LAST[council]);
      const cat = rand() < 0.7 ? "A" : "B";
      const gradYear = int(2006, 2024);
      const issueYear = gradYear + 1;
      const issueDate = `${issueYear}-${pad(int(1, 12), 2)}-${pad(int(1, 28), 2)}`;
      const r = rand();
      const status = r < 0.78 ? "ACTIVE" : r < 0.9 ? "DORMANT" : r < 0.94 ? "SUSPENDED" : "CANCELLED";
      const validUntil =
        status === "ACTIVE" || status === "SUSPENDED"
          ? `${int(2026, 2030)}-12-31`
          : status === "DORMANT"
            ? `${Math.max(issueYear + 1, int(2019, 2025))}-06-30`
            : `${Math.max(issueYear + 1, int(2020, 2025))}-12-31`;
      const city = pick(CITIES[council]);
      const confirmed = status === "ACTIVE" && rand() < 0.45;
      const at = new Date(Date.UTC(int(2023, 2026), int(0, 6), int(1, 28), 9)); // a council decision before the initial load
      const confirmedAt = new Date(Date.UTC(2026, 8, int(8, 28), 9)); // verified in the portal after the load
      const events: Row["_events"] = [];
      if (status === "DORMANT")
        events.push({ kind: "STATUS", from: "ACTIVE", to: "DORMANT", note: `Not renewed by ${validUntil.slice(0, 4)}. Marked dormant in the council's file.`, actor: COUNCIL_INFO[council].name, at: new Date(`${validUntil.slice(0, 4)}-08-01T09:00:00Z`) });
      if (status === "SUSPENDED")
        events.push({ kind: "STATUS", from: "ACTIVE", to: "SUSPENDED", note: `Suspended by the ${COUNCIL_INFO[council].name} pending an inquiry into dispensing without a prescription.`, actor: COUNCIL_INFO[council].name, at });
      if (status === "CANCELLED")
        events.push({ kind: "STATUS", from: "ACTIVE", to: "CANCELLED", note: pick([`Cancelled at the pharmacist's own request (moved abroad).`, `Cancelled by the ${COUNCIL_INFO[council].name} after a disciplinary hearing.`, "Cancelled: registered person deceased (council file)."]), actor: COUNCIL_INFO[council].name, at });
      rows.push({
        regNo: regNo(council, cat, issueYear),
        fullName: `${first}${rand() < 0.25 ? " " + pick((female ? FEMALE : MALE).filter((x) => x !== first)) : ""} ${last}`,
        fatherName: `${pick(MALE)} ${last}`,
        cnic: cnic(council, female),
        gender: female ? "F" : "M",
        university: university(council, cat),
        graduationYear: gradYear,
        category: cat,
        council,
        issueDate,
        validUntil,
        status,
        practicePlace: confirmed ? pick(PLACE_KINDS)(city) : null,
        designation: confirmed ? pick(cat === "A" ? PHARMD_DESIGNATIONS : TECH_DESIGNATIONS) : null,
        practiceConfirmed: confirmed,
        practiceConfirmedAt: confirmed ? confirmedAt : null,
        mobile: `03${int(0, 4)}${int(0, 9)}-${int(1_000_000, 9_999_999)}`,
        email: `${first.toLowerCase()}.${last.toLowerCase()}${int(1, 99)}@mail.demo`,
        address: `House ${int(1, 250)}, Street ${int(1, 30)}, ${pick(AREAS)}, ${city}`,
        _events: events,
      });
    }
  }

  // One import per council: the initial load of its register, as received under the agreement.
  const importIds: Record<string, number> = {};
  let n = 0;
  for (const council of COUNCILS) {
    n++;
    const count = rows.filter((r) => r.council === council).length;
    const errors =
      council === "Punjab"
        ? [
            { row: 17, regNo: "PPC-A-02331", errors: ["Registration number does not match the Punjab format PPC-A-123456"] },
            { row: 42, regNo: "PPC-A-047120", errors: ["CNIC is missing"] },
          ]
        : council === "Sindh"
          ? [{ row: 9, regNo: "SPC-B-2016-00451", errors: ["Same CNIC as row 3"] }]
          : [];
    const [imp] = await db
      .insert(schema.pharmacistImports)
      .values({ ref: `IMP-2026-${pad(n, 4)}`, council, fileName: `${COUNCIL_INFO[council].code.toLowerCase()}-register-2026-09.csv`, totalRows: count + errors.length, importedRows: count, errorRows: errors.length, errors, importedBy: "pcp.registration", createdAt: new Date(`2026-09-${pad(n + 1, 2)}T10:00:00Z`) })
      .returning();
    importIds[council] = imp.id;
    await audit(db, { actor: "pcp.registration", action: "pharmacist.import.completed", entity: "pharmacist_import", entityId: imp.ref, details: { council, imported: count, errors: errors.length } });
  }

  const inserted = await db
    .insert(schema.pharmacists)
    .values(rows.map(({ _events, ...r }) => ({ ...r, importId: importIds[r.council] })))
    .returning();
  const byReg = Object.fromEntries(inserted.map((p) => [p.regNo, p]));

  // History: the import, status decisions and confirmed practice details.
  const events: (typeof schema.pharmacistEvents.$inferInsert)[] = [];
  for (const r of rows) {
    const p = byReg[r.regNo];
    const impRef = `IMP-2026-${pad(COUNCILS.indexOf(r.council as Council) + 1, 4)}`;
    events.push({ pharmacistId: p.id, kind: "IMPORTED", toStatus: r.status, note: `Loaded from the ${COUNCIL_INFO[r.council as Council].name} register (${impRef}).`, actor: "pcp.registration", createdAt: new Date(`2026-09-0${COUNCILS.indexOf(r.council as Council) + 2}T10:00:00Z`) });
    for (const e of r._events ?? []) events.push({ pharmacistId: p.id, kind: e.kind, fromStatus: e.from, toStatus: e.to, note: e.note, actor: e.actor, createdAt: e.at });
  }
  await db.insert(schema.pharmacistEvents).values(events);

  // Earlier practice updates: verified ones behind every confirmed record, and one rejected.
  const confirmed = inserted.filter((p) => p.practiceConfirmed);
  await db.insert(schema.practiceUpdates).values(
    confirmed.map((p) => ({ pharmacistId: p.id, practicePlace: p.practicePlace!, designation: p.designation!, status: "VERIFIED", submittedAt: new Date((p.practiceConfirmedAt ?? new Date()).getTime() - 3 * 86400000), reviewedBy: "pcp.registration", reviewedAt: p.practiceConfirmedAt, reviewNote: "Appointment letter checked against the employer." })),
  );
  await db.insert(schema.pharmacistEvents).values(confirmed.map((p) => ({ pharmacistId: p.id, kind: "PRACTICE", note: `Practice details verified: ${p.designation}, ${p.practicePlace}.`, actor: "pcp.registration", createdAt: p.practiceConfirmedAt ?? new Date() })));
  const rejectedFor = inserted.find((p) => p.council === "Khyber Pakhtunkhwa" && p.status === "ACTIVE" && !p.practiceConfirmed && !p.username)!;
  await db.insert(schema.practiceUpdates).values({ pharmacistId: rejectedFor.id, practicePlace: "Swat Medical Store, Mingora", designation: "Pharmacist in charge (proprietor)", status: "REJECTED", submittedAt: new Date("2026-08-20T09:00:00Z"), reviewedBy: "pcp.registration", reviewedAt: new Date("2026-08-22T12:00:00Z"), reviewNote: "The evidence is a shop rent agreement, not a drug sale licence. Upload the licence that names you as the pharmacist in charge." });

  // Sana Memon has told PCP where she now works; PCP has not verified it yet.
  const sana = byReg["SPC-A-2019-00412"];
  const evidence = await fileDocument(db, {
    pharmacistId: sana.id,
    folder: "practice-updates",
    docType: "Practice evidence",
    fileName: "appointment-letter-clifton-community-pharmacy.pdf",
    bytes: await letterPdf("Appointment letter", ["Clifton Community Pharmacy, Block 5, Clifton, Karachi", "Ms Sana Memon (SPC-A-2019-00412) is appointed Community Pharmacist", "with effect from 1 September 2026.", "Signed: Proprietor (demo)"]),
    uploadedBy: "pharm.sana",
    verificationStatus: "PENDING",
  });
  const sentAt = new Date(Date.now() - 2 * 86400000);
  await db.update(schema.documents).set({ uploadedAt: sentAt }).where(eq(schema.documents.id, evidence.id));
  await db.insert(schema.practiceUpdates).values({ pharmacistId: sana.id, practicePlace: "Clifton Community Pharmacy, Karachi", designation: "Community Pharmacist", evidenceDocumentId: evidence.id, status: "PENDING", submittedAt: sentAt });
  await db.insert(schema.pharmacistEvents).values({ pharmacistId: sana.id, kind: "PRACTICE", note: "Practice update sent for verification: Community Pharmacist, Clifton Community Pharmacy, Karachi.", actor: "pharm.sana", createdAt: sentAt });
  await notify(db, "role:pcp_registration", "Practice update waiting: Sana Memon", "SPC-A-2019-00412 reported a new practice place with evidence. Verify or reject it.", "/pcp/pharmacists?tab=updates");

  const by = (s: string) => inserted.filter((p) => p.status === s).length;
  return `${inserted.length} pharmacists (${by("ACTIVE")} active, ${by("DORMANT")} dormant, ${by("SUSPENDED")} suspended, ${by("CANCELLED")} cancelled), 1 practice update pending`;
}
