// Seed data for the onboarding module. Runs after the core seed (see scripts/seed/index.ts).
// Reference rules (provinces, universities, required documents), one request waiting for PCP
// (Indus Valley College of Pharmacy, applicant ivc.applicant) and one returned request (data only).
import { eq } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db, schema } from "../../src/db";
import type { OnboardingCampus, OnboardingProfile, OnboardingProgramme } from "../../src/db/modules/onboarding";
import { audit } from "../../src/lib/audit";
import { addRealmRole, findUser, leaveAllGroups, realmRolesOf, removeRealmRole } from "../../src/lib/keycloak-admin";
import { fileDocument } from "../../src/lib/letters";
import { sendEmail } from "../../src/lib/messages";
import { INST_ROLES } from "../../src/lib/roles";

const PROVINCES = ["Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan", "Islamabad Capital Territory", "Gilgit-Baltistan", "Azad Jammu and Kashmir"];

// Degree-awarding universities a pharmacy college may be affiliated with (HEC-recognised names),
// plus the fictional universities of the demo registry.
const UNIVERSITIES = [
  "University of Karachi",
  "Dow University of Health Sciences, Karachi",
  "Jinnah Sindh Medical University, Karachi",
  "Hamdard University, Karachi",
  "Ziauddin University, Karachi",
  "Baqai Medical University, Karachi",
  "University of Sindh, Jamshoro",
  "Liaquat University of Medical and Health Sciences, Jamshoro",
  "Shah Abdul Latif University, Khairpur",
  "Peoples University of Medical and Health Sciences for Women, Nawabshah",
  "University of the Punjab, Lahore",
  "University of Health Sciences, Lahore",
  "University of Lahore",
  "Lahore College for Women University",
  "Government College University, Faisalabad",
  "University of Sargodha",
  "Bahauddin Zakariya University, Multan",
  "Islamia University of Bahawalpur",
  "Riphah International University, Islamabad",
  "Quaid-i-Azam University, Islamabad",
  "University of Peshawar",
  "Khyber Medical University, Peshawar",
  "Gomal University, Dera Ismail Khan",
  "Kohat University of Science and Technology",
  "Hazara University, Mansehra",
  "University of Balochistan, Quetta",
  "Karakoram International University, Gilgit",
  "University of Azad Jammu and Kashmir, Muzaffarabad",
  // Fictional universities of the demo registry
  "Riverside University of Health Sciences",
  "Ravi Bank University",
  "Sindh Coastal University",
  "Bolan Valley University",
  "Five Rivers University",
];

const REQUIRED_V1 = ["Registration or charter certificate", "Affiliation or HEC recognition letter", "Building ownership or lease"];
const REQUIRED_V2 = [...REQUIRED_V1, "Head of institution appointment letter"];

const daysAgo = (d: number, h = 10) => {
  const t = new Date();
  t.setDate(t.getDate() - d);
  t.setHours(h, 15, 0, 0);
  return t;
};

async function legalPdf(org: string, city: string, title: string, lines: string[]) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({ x: 0, y: 782, width: 595, height: 60, color: rgb(0.13, 0.2, 0.36) });
  page.drawText(org, { x: 40, y: 810, size: 14, font: bold, color: rgb(1, 1, 1) });
  page.drawText(city, { x: 40, y: 794, size: 10, font, color: rgb(0.85, 0.88, 0.95) });
  page.drawText("DEMO DOCUMENT - fictional data", { x: 40, y: 752, size: 9, font, color: rgb(0.7, 0.1, 0.1) });
  page.drawText(title, { x: 40, y: 712, size: 18, font: bold });
  lines.forEach((l, i) => page.drawText(l, { x: 40, y: 676 - i * 20, size: 11, font }));
  return Buffer.from(await pdf.save());
}

type Seed = {
  ref: string;
  status: string;
  username: string;
  name: string;
  designation: string;
  email: string;
  mobile: string;
  profile: OnboardingProfile;
  campuses: OnboardingCampus[];
  programmes: OnboardingProgramme[];
  createdDaysAgo: number;
  submittedDaysAgo: number;
};

const IVC: Seed = {
  ref: "REG-2026-0001",
  status: "SUBMITTED",
  username: "ivc.applicant",
  name: "Rehana Baloch",
  designation: "Principal",
  email: "ivc.applicant@demo.pcp.local",
  mobile: "0333-7241186",
  profile: {
    name: "Indus Valley College of Pharmacy",
    shortCode: "IVC",
    sector: "Private",
    province: "Sindh",
    city: "Sukkur",
    address: "Plot 7, Military Road, near Sukkur IBA, Sukkur",
    phone: "071-5631240",
    website: "www.ivcp.demo",
    establishedYear: 2024,
    affiliationType: "Affiliated college",
    affiliatedUniversity: "Shah Abdul Latif University, Khairpur",
  },
  campuses: [
    { name: "Main campus, Sukkur", city: "Sukkur", province: "Sindh", address: "Plot 7, Military Road, Sukkur", isMain: true },
    { name: "Larkana campus", city: "Larkana", province: "Sindh", address: "VIP Road, near Chandka Medical College, Larkana", isMain: false },
  ],
  programmes: [{ type: "PHARMD", campus: "Main campus, Sukkur", plannedIntake: 50, startYear: 2027 }],
  createdDaysAgo: 12,
  submittedDaysAgo: 2,
};

const CHOLISTAN: Seed = {
  ref: "REG-2026-0002",
  status: "RETURNED",
  username: "ccp.applicant", // not a Keycloak account: data only
  name: "Dr. Faisal Bhatti",
  designation: "Director",
  email: "faisal.bhatti@cholistan-pharmacy.demo",
  mobile: "0302-6187730",
  profile: {
    name: "Cholistan College of Pharmacy",
    shortCode: "CHP",
    sector: "Private",
    province: "Punjab",
    city: "Bahawalpur",
    address: "Model Town B, Bahawalpur",
    phone: "062-2884410",
    website: "www.cholistan-pharmacy.demo",
    establishedYear: 2025,
    affiliationType: "Affiliated college",
    affiliatedUniversity: "Islamia University of Bahawalpur",
  },
  campuses: [{ name: "Main campus, Bahawalpur", city: "Bahawalpur", province: "Punjab", address: "Model Town B, Bahawalpur", isMain: true }],
  programmes: [
    { type: "TECH", campus: "Main campus, Bahawalpur", plannedIntake: 40, startYear: 2027 },
    { type: "PHARMD", campus: "Main campus, Bahawalpur", plannedIntake: 60, startYear: 2028 },
  ],
  createdDaysAgo: 20,
  submittedDaysAgo: 9,
};

const RETURN_REASON =
  "1. The building lease is not signed by the owner and is not on stamp paper. Upload the signed, stamped lease.\n2. The affiliation letter from the Islamia University of Bahawalpur expired in 2025. Upload the current letter.";

async function insertRequest(s: Seed) {
  const [req] = await db
    .insert(schema.onboardingRequests)
    .values({
      ref: s.ref,
      status: s.status,
      applicantUsername: s.username,
      applicantName: s.name,
      applicantDesignation: s.designation,
      email: s.email,
      mobile: s.mobile,
      emailVerifiedAt: daysAgo(s.createdDaysAgo, 10),
      mobileVerifiedAt: daysAgo(s.createdDaysAgo, 10),
      profile: s.profile,
      campuses: s.campuses,
      programmes: s.programmes,
      submittedAt: daysAgo(s.submittedDaysAgo, 14),
      createdAt: daysAgo(s.createdDaysAgo, 9),
      updatedAt: daysAgo(s.submittedDaysAgo, 14),
    })
    .returning();
  await db.insert(schema.onboardingEvents).values([
    { requestId: req.id, fromStatus: null, toStatus: "DRAFT", actor: s.username, note: "Account created", createdAt: daysAgo(s.createdDaysAgo, 9) },
    { requestId: req.id, fromStatus: "DRAFT", toStatus: "SUBMITTED", actor: s.username, note: "Submitted to PCP", createdAt: daysAgo(s.submittedDaysAgo, 14) },
  ]);
  await audit(db, { actor: s.username, action: "onboarding.registered", entity: "onboarding", entityId: s.ref, details: { email: s.email } });
  await audit(db, { actor: s.username, action: "onboarding.submitted", entity: "onboarding", entityId: s.ref });
  return req;
}

async function attach(reqId: number, s: Seed, docType: string, lines: string[], status = "PENDING") {
  const name = docType.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + ".pdf";
  const doc = await fileDocument(db, {
    onboardingId: reqId,
    folder: "legal-documents",
    docType,
    fileName: name,
    bytes: await legalPdf(s.profile.name!, `${s.profile.city}, ${s.profile.province}`, docType, lines),
    uploadedBy: s.username,
    verificationStatus: status,
  });
  await db.update(schema.documents).set({ uploadedAt: daysAgo(s.submittedDaysAgo + 1, 12) }).where(eq(schema.documents.id, doc.id));
  await audit(db, { actor: s.username, action: "document.uploaded", entity: "document", entityId: doc.id, details: { onboarding: s.ref, docType, version: doc.version } });
}

/** If an earlier demo approved IVC, Keycloak still has ivc.applicant as a Head; put it back to an applicant. */
async function restoreApplicantInKeycloak(username: string) {
  try {
    if (!(await findUser(username))) return ` (${username} is not in Keycloak)`;
    const roles = await realmRolesOf(username);
    const inst = roles.filter((r) => (INST_ROLES as readonly string[]).includes(r));
    if (roles.includes("inst_applicant") && inst.length === 0) return "";
    if (!roles.includes("inst_applicant")) await addRealmRole(username, "inst_applicant");
    for (const r of inst) await removeRealmRole(username, r);
    await leaveAllGroups(username);
    return ` (restored ${username} to an applicant in Keycloak)`;
  } catch (e) {
    return ` (Keycloak not checked: ${e instanceof Error ? e.message.slice(0, 60) : e})`;
  }
}

export default async function seedOnboarding(): Promise<string | void> {
  await db.insert(schema.rules).values([
    { key: "onboarding.requiredDocs", version: 1, effectiveFrom: "2026-01-01", description: "Legal documents an institution uploads before PCP verifies its registration", value: REQUIRED_V1 },
    { key: "onboarding.requiredDocs", version: 2, effectiveFrom: "2026-07-01", description: "Added the Head of institution appointment letter", value: REQUIRED_V2 },
    { key: "ref.provinces", version: 1, effectiveFrom: "2026-01-01", description: "Provinces and regions (drop-down reference list)", value: PROVINCES },
    { key: "ref.universities", version: 1, effectiveFrom: "2026-01-01", description: "Degree-awarding universities for affiliation (drop-down reference list)", value: UNIVERSITIES },
  ]);
  for (const r of ["onboarding.requiredDocs@v1", "onboarding.requiredDocs@v2", "ref.provinces@v1", "ref.universities@v1"])
    await audit(db, { actor: "system", action: "rule.versioned", entity: "rule", entityId: r });

  // 1. Waiting for PCP: Indus Valley College of Pharmacy (ivc.applicant signs in to see it)
  const ivc = await insertRequest(IVC);
  await attach(ivc.id, IVC, "Registration or charter certificate", ["Registered under the Societies Registration Act, 1860.", "Registration no. SKR/2024/0412, Sukkur.", "Indus Valley Education Society, Sukkur."]);
  await attach(ivc.id, IVC, "Affiliation or HEC recognition letter", ["Provisional affiliation for the Doctor of Pharmacy programme.", "Shah Abdul Latif University, Khairpur. Letter no. SALU/AFF/2025/118.", "Valid until 30 June 2028."]);
  await attach(ivc.id, IVC, "Building ownership or lease", ["Lease of Plot 7, Military Road, Sukkur, for 15 years.", "Covered area 42,000 sq ft. Registered with the Sub-Registrar, Sukkur."]);
  await attach(ivc.id, IVC, "Head of institution appointment letter", ["Ms Rehana Baloch is appointed Principal with effect from 1 March 2025.", "Signed: Chairman, Board of Governors."]);
  await db.insert(schema.notifications).values({
    audience: "role:pcp_registration",
    title: `New institution registration ${IVC.ref}`,
    body: `${IVC.profile.name} (Sukkur, Sindh) is waiting for verification.`,
    link: `/pcp/onboarding/${IVC.ref}`,
    createdAt: daysAgo(IVC.submittedDaysAgo, 14),
  });

  // 2. Returned with a reason: Cholistan College of Pharmacy (applicant account not in Keycloak, data only)
  const chp = await insertRequest(CHOLISTAN);
  await attach(chp.id, CHOLISTAN, "Registration or charter certificate", ["Registered with the Registrar of Firms, Bahawalpur.", "Registration no. BWP/2025/0077."], "VERIFIED");
  await attach(chp.id, CHOLISTAN, "Affiliation or HEC recognition letter", ["Affiliation letter, Islamia University of Bahawalpur, 2019."], "REJECTED");
  await attach(chp.id, CHOLISTAN, "Building ownership or lease", ["Unsigned draft lease, Model Town B, Bahawalpur."], "REJECTED");
  await attach(chp.id, CHOLISTAN, "Head of institution appointment letter", ["Dr. Faisal Bhatti is appointed Director."], "VERIFIED");
  const returnedAt = daysAgo(5, 11);
  await db
    .update(schema.onboardingRequests)
    .set({ status: "RETURNED", reviewNote: RETURN_REASON, reviewedBy: "pcp.registration", reviewedAt: returnedAt, updatedAt: returnedAt })
    .where(eq(schema.onboardingRequests.id, chp.id));
  await db.insert(schema.onboardingEvents).values({ requestId: chp.id, fromStatus: "SUBMITTED", toStatus: "RETURNED", actor: "pcp.registration", note: RETURN_REASON, createdAt: returnedAt });
  await sendEmail(db, {
    to: CHOLISTAN.email,
    toName: CHOLISTAN.name,
    subject: `Registration ${CHOLISTAN.ref} returned for changes`,
    body: `PCP returned your registration with this reason:\n\n${RETURN_REASON}\n\nMake the changes on your checklist and resubmit.`,
    entity: "onboarding",
    entityRef: CHOLISTAN.ref,
    link: "/onboarding",
  });
  await audit(db, { actor: "pcp.registration", action: "onboarding.returned", entity: "onboarding", entityId: CHOLISTAN.ref, details: { reason: RETURN_REASON } });

  const kc = await restoreApplicantInKeycloak(IVC.username);
  return `4 reference rules; ${IVC.ref} waiting for PCP (${IVC.profile.name}); ${CHOLISTAN.ref} returned${kc}`;
}
