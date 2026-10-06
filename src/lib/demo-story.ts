// The presentation script: who signs in, where to go, what to click and what to say.
// Shared by the sign-in page and the presenter guide. Pure data, safe on client and server.
// In "do" lines, **bold** marks a button or label to click and `code` is a value the guide copies on click.

export type Persona = {
  username: string;
  name: string;
  role: string;
  org: string;
  side: "institution" | "pcp" | "external";
  blurb: string;
};

export const PERSONAS: Persona[] = [
  { username: "ruh.poc", name: "Prof. Ayesha Khan", role: "Institution focal person", org: "Riverside University of Health Sciences", side: "institution", blurb: "Applies for a NOC, adds faculty, pays the fee, answers deficiencies" },
  { username: "nhc.poc", name: "Dr. Tariq Mehmood", role: "Institution focal person", org: "Northern Hills College of Pharmacy", side: "institution", blurb: "A second institution: proves tenants can't see each other's data" },
  { username: "pcp.officer", name: "Usman Farooq", role: "PCP Officer", org: "Registration & scrutiny", side: "pcp", blurb: "Scrutiny, deficiencies, duplicate checks, inspection scheduling" },
  { username: "pcp.inspector", name: "Dr. Kamran Javed", role: "PCP Inspector · Punjab", org: "Inspection panel", side: "pcp", blurb: "Fills the on-site checklist for assigned inspections only" },
  { username: "pcp.inspector2", name: "Dr. Zainab Qureshi", role: "PCP Inspector · KP", org: "Inspection panel", side: "pcp", blurb: "Blocked from KP institutions by the conflict-of-interest rule" },
  { username: "pcp.secretary", name: "Dr. Nadia Hussain", role: "PCP Secretary", org: "Council secretariat", side: "pcp", blurb: "Records council decisions and issues QR-signed certificates" },
  { username: "pcp.admin", name: "Super Admin", role: "PCP Super Admin", org: "System administration", side: "pcp", blurb: "Onboards institutions, manages users, reads the audit log" },
];

/** Every other demo account, by job (guide section 2). Shown on the sign-in page under "More roles". */
export const MORE_PERSONAS: Persona[] = [
  { username: "ruh.dean", name: "Dr. Imran Shah", role: "Principal or Dean", org: "Riverside University", side: "institution", blurb: "Confirms programme data, responds to deficiencies, submits" },
  { username: "ruh.admin", name: "Saba Qureshi", role: "Department administrator", org: "Riverside University", side: "institution", blurb: "Maintains campuses, laboratories and library" },
  { username: "ruh.entry", name: "Junaid Akhtar", role: "Data-entry officer", org: "Riverside University", side: "institution", blurb: "Enters faculty and student drafts; cannot submit" },
  { username: "ruh.exam", name: "Nida Farooq", role: "Examination officer", org: "Riverside University", side: "institution", blurb: "Files the annual student return and results" },
  { username: "ruh.finance", name: "Waqas Butt", role: "Finance officer", org: "Riverside University", side: "institution", blurb: "Pays fees and sees dues" },
  { username: "pcp.registration", name: "Hina Malik", role: "Registration officer", org: "PCP", side: "pcp", blurb: "Approves institution onboarding, scrutinises cases, keeps the pharmacist register" },
  { username: "pcp.coordinator", name: "Bilal Ahmed", role: "Inspection coordinator", org: "PCP", side: "pcp", blurb: "Assigns inspection teams with the conflict check" },
  { username: "pcp.accounts", name: "Sadia Raza", role: "Accounts officer", org: "PCP", side: "pcp", blurb: "Receipts, reconciliation and outstanding dues" },
  { username: "pcp.verification", name: "Kashif Iqbal", role: "Verification officer", org: "PCP", side: "pcp", blurb: "Documents, faculty qualifications, duplicates, annual returns" },
  { username: "student.ruh", name: "Areeba Noor", role: "Student", org: "Riverside University · PharmD", side: "external", blurb: "Sees her PCP student ID, enrolment and result status" },
  { username: "pharm.ali", name: "Ali Raza", role: "Registered pharmacist", org: "Punjab Pharmacy Council", side: "external", blurb: "Sees his registration, updates his practice place" },
  { username: "ivc.applicant", name: "Rehana Baloch", role: "Institution applicant", org: "Indus Valley College (onboarding)", side: "external", blurb: "Mid-way through self-registration; nothing else opens until PCP approves" },
];

export const personaFor = (username: string | null | undefined) => [...PERSONAS, ...MORE_PERSONAS].find((p) => p.username === username);

export type Step = {
  act: string;
  title: string;
  /** username to be signed in as, or "public" for pages anyone can open */
  as: string;
  /** {ref} = the Pharmacy Technician NOC created in step 2, {cert} = its certificate number */
  path: string;
  fallback?: string;
  do: string[];
  say: string;
};

export const ACTS = ["I · The institution applies", "II · PCP processes the case", "III · Decision and public trust", "IV · Oversight"];

export const STORY: Step[] = [
  {
    act: ACTS[0],
    title: "Meet the institution's portal",
    as: "ruh.poc",
    path: "/institution",
    do: [
      "You are the single focal person (POC) of Riverside University.",
      "Point out the program tree, **Action required** and the accreditation renewal countdown.",
    ],
    say: "Each institution sees only its own data. One accountable focal person per institution, created by PCP's Super Admin; there is no self-registration.",
  },
  {
    act: ACTS[0],
    title: "Start a Pharmacy Technician NOC",
    as: "ruh.poc",
    path: "/institution/applications",
    do: [
      "Click **New NOC application** → **New Pharmacy Technician NOC application**.",
      "Click **Fill demo values**, then **Save and run checks**.",
      "Attach the 3 required documents with **Attach sample PDF** (or upload your own).",
    ],
    say: "The checks come from PCP's own draft (faculty ratio, intake, labs, library, documents) and live in a versioned rules table, so PCP can change them without a developer. Note that the faculty check fails: 3 technician faculty, 4 needed.",
  },
  {
    act: ACTS[0],
    title: "One person, one institution",
    as: "ruh.poc",
    path: "/institution/faculty",
    do: [
      "Click **Add faculty member** → **Try: active elsewhere** → **Save and run checks**. It is blocked, and the other institution is not named.",
      "Click **Try: near-duplicate** → **Save and run checks**. It asks \"Did you mean PCP-FAC-000001?\" (Mohammad vs Muhammad Ali Khan). Click **No, a different person**: it is saved but flagged for PCP.",
    ],
    say: "CNIC is the hard key (NADRA Verisys in production). Names are compared after normalising spellings like Muhammad/Mohammad and Mehmood/Mahmood, so a teacher can't be counted at two colleges.",
  },
  {
    act: ACTS[0],
    title: "Pay the fee: PSID and Raast QR",
    as: "ruh.poc",
    path: "/institution/applications/{ref}",
    fallback: "/institution/applications",
    do: ["In the **Fee** card click **Generate challan**: a PSID and a Raast QR appear.", "Click **Simulate bank confirmation (demo)**."],
    say: "Raast carries a 0% merchant fee and the State Bank wants government payments on Raast. In production the sponsor bank confirms through 1Link automatically.",
  },
  {
    act: ACTS[1],
    title: "Resolve the possible duplicate",
    as: "pcp.officer",
    path: "/pcp/verification",
    do: ["Find the pair for **Dr. Mohammad Ali Khan**, compare the records side by side, then click **Different people: clear flag**."],
    say: "Duplicate detection only raises a signal; a PCP officer decides with the evidence side by side. In production a NADRA CNIC check settles most of these automatically.",
  },
  {
    act: ACTS[1],
    title: "Submit only when everything passes",
    as: "ruh.poc",
    path: "/institution/applications/{ref}",
    fallback: "/institution/applications",
    do: ["Click **Re-run** on the automatic checks: all pass now.", "Click **Submit application**."],
    say: "Submission stays locked until every check passes and the fee is paid, so PCP never receives an incomplete file.",
  },
  {
    act: ACTS[1],
    title: "Scrutiny and a formal deficiency",
    as: "pcp.officer",
    path: "/pcp/applications/{ref}",
    fallback: "/pcp/applications",
    do: ["Click **Start scrutiny (assign to me)**.", "Under **Raise a formal deficiency** click **Fill demo values**, then **Raise deficiency**."],
    say: "Every deficiency has an ID, a deadline and the exact evidence required. The institution always sees who holds its file; HEC's attestation system drew complaints because applicants couldn't.",
  },
  {
    act: ACTS[1],
    title: "The institution responds",
    as: "ruh.poc",
    path: "/institution/applications/{ref}",
    fallback: "/institution/applications",
    do: ["In the deficiency card click **Fill demo values**, **Attach sample PDF** as evidence, then **Submit response**."],
    say: "Responses and evidence are versioned and fingerprinted (SHA-256). Nothing travels by letter or email.",
  },
  {
    act: ACTS[1],
    title: "Inspection with a conflict-of-interest guard",
    as: "pcp.officer",
    path: "/pcp/applications/{ref}",
    fallback: "/pcp/applications",
    do: [
      "Click **Accept** on the deficiency response.",
      "Under **Schedule inspection** pick **Dr. Zainab Qureshi · Khyber Pakhtunkhwa**, then **Schedule and notify**: blocked.",
      "Pick **Dr. Kamran Javed · Punjab**, then **Schedule and notify**.",
    ],
    say: "PCP's draft says no inspector inspects an institution in their own province. The system enforces it instead of relying on memory.",
  },
  {
    act: ACTS[1],
    title: "On-site inspection checklist",
    as: "pcp.inspector",
    path: "/pcp/inspections",
    do: ["Click **Open checklist**, then **Fill demo values** (or mark each criterion yourself).", "Click **Submit inspection report**."],
    say: "Inspectors see only their assigned visits, which suits a third-party inspection firm (the March 2025 reform). In production this runs offline in ODK with geotagged photos; the report PDF is filed in the institution's folder.",
  },
  {
    act: ACTS[1],
    title: "Forward to the council",
    as: "pcp.officer",
    path: "/pcp/applications/{ref}",
    fallback: "/pcp/applications",
    do: ["Review the inspection report, write a recommendation (or **Fill demo values**), then click **Forward to council agenda**."],
    say: "Separation of duties: whoever processes a case is never the one who decides it.",
  },
  {
    act: ACTS[2],
    title: "Council decision and certificate",
    as: "pcp.secretary",
    path: "/pcp/applications/{ref}",
    fallback: "/pcp/applications",
    do: ["Click **Approved**.", "Click **Issue NOC certificate (QR + signed PDF)**, then **View / print certificate**."],
    say: "The certificate carries a QR code and a SHA-256 fingerprint. E-signatures are valid under the Electronic Transactions Ordinance 2002 (a NIFT certificate in production).",
  },
  {
    act: ACTS[2],
    title: "Anyone can verify it",
    as: "public",
    path: "/verify/certificate/{cert}",
    fallback: "/verify",
    do: ["This is what a student, employer or HEC sees after scanning the QR.", "Then open a forged number: `/verify/certificate/NOC-TECH-2026-9999`."],
    say: "Fake certificates are sold in Facebook and WhatsApp groups. A public QR check makes a forgery obvious in seconds.",
  },
  {
    act: ACTS[2],
    title: "Institutions can't see each other",
    as: "nhc.poc",
    path: "/institution/applications/{ref}",
    fallback: "/institution/applications",
    do: ["Signed in as a different institution, open Riverside's application link: the system answers **404**."],
    say: "All tenants share one database, but every query is scoped by the institution's Keycloak group. Document downloads are permission-checked too.",
  },
  {
    act: ACTS[3],
    title: "PCP's live picture",
    as: "pcp.admin",
    path: "/pcp",
    do: ["Walk through the KPIs, the pipeline and enrolment against approved intake, all live from the registry."],
    say: "This answers the National Assembly committee's criticism that PCP keeps no reliable records of institutes, enrolment or graduates.",
  },
  {
    act: ACTS[3],
    title: "Onboard a new institution in seconds",
    as: "pcp.admin",
    path: "/pcp/admin",
    do: [
      "Click **Onboard institution** → **Fill demo values** → **Onboard institution**. The PCP ID, Keycloak group and POC account are created, and the temporary password is shown once.",
      "On the `nhc.poc` row click **Disable**: that user is locked out at once.",
    ],
    say: "Only the Super Admin creates accounts. Handing over to a new POC disables the old account and keeps its history.",
  },
  {
    act: ACTS[3],
    title: "Tamper-evident audit log",
    as: "pcp.admin",
    path: "/pcp/audit",
    do: ["Every action from this demo is here, hash-chained. The banner reads **Chain intact**."],
    say: "Editing or deleting any past entry, even directly in the database, breaks the chain from that point. No niche ledger product needed (AWS shut QLDB down in 2025).",
  },
];
