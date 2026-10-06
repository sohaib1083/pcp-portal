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
  { username: "ruh.poc", name: "Prof. Ayesha Khan", role: "Institution focal person", org: "Riverside University of Health Sciences", side: "institution", blurb: "Applies for a NOC, links faculty by ID, pays the fee, submits, starts renewals" },
  { username: "nhc.poc", name: "Dr. Tariq Mehmood", role: "Institution focal person", org: "Northern Hills College of Pharmacy", side: "institution", blurb: "A second institution: proves tenants can't see each other's data" },
  { username: "pcp.officer", name: "Usman Farooq", role: "PCP Officer", org: "Registration & scrutiny", side: "pcp", blurb: "Scrutiny, technical review, deficiencies, duplicate checks, inspection teams" },
  { username: "pcp.inspector", name: "Dr. Kamran Javed", role: "PCP Inspector · Punjab", org: "Inspection panel", side: "pcp", blurb: "Fills the on-site checklist for assigned inspections only" },
  { username: "pcp.inspector2", name: "Dr. Zainab Qureshi", role: "PCP Inspector · KP", org: "Inspection panel", side: "pcp", blurb: "Blocked from KP institutions by the conflict-of-interest rule" },
  { username: "pcp.secretary", name: "Dr. Nadia Hussain", role: "PCP Secretary", org: "Council secretariat", side: "pcp", blurb: "Records council decisions with a one-time code and issues QR-signed certificates" },
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
      "You are the Head of Riverside University.",
      "Point out the programme cards (NOC, accreditation history, **Start renewal**), **Action required** and the renewal countdown.",
    ],
    say: "Each institution sees only its own data. The PharmD accreditation expires within 180 days, so the renewal alert has already fired and the renewal file is one click away.",
  },
  {
    act: ACTS[0],
    title: "Start a Pharmacy Technician NOC",
    as: "ruh.poc",
    path: "/institution/applications",
    do: [
      "Click **New NOC application** → **New Pharmacy Technician NOC application**.",
      "Click **Fill demo values** (campus first: Hayatabad campus), then **Save and run checks**.",
      "Under **Faculty linked by Faculty ID** click **Link by specialisation**, or find each teacher by Faculty ID, CNIC or name and pick a subject.",
      "Attach the 3 required documents with **Attach sample PDF**.",
    ],
    say: "The institution does not retype its profile: it picks the campus and fills only what is new. Teachers are linked by their PCP Faculty ID, never typed in. The check names the line and the rule: \"Pharmacology: 1 teacher linked, 2 required for intake 60.\" The Pay button stays locked until every check passes.",
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
    act: ACTS[1],
    title: "Resolve the possible duplicate",
    as: "pcp.officer",
    path: "/pcp/verification",
    do: ["Find the pair for **Dr. Mohammad Ali Khan**, compare the records side by side, then click **Different people: clear flag**."],
    say: "Duplicate detection only raises a signal; a PCP officer decides with the evidence side by side. In production a NADRA CNIC check settles most of these automatically.",
  },
  {
    act: ACTS[1],
    title: "Link the teacher, pay, then submit",
    as: "ruh.poc",
    path: "/institution/applications/{ref}",
    fallback: "/institution/applications",
    do: [
      "In the faculty picker search `Mohammad Ali`, choose **Pharmacology**, click **Link teacher**: every check passes.",
      "In the **Fee** card click **Pay fee: generate challan**, then **Simulate bank confirmation (demo)** and confirm the one-time code.",
      "Click **Submit application**.",
    ],
    say: "Checks pass, then the challan, then the bank confirms with a one-time code, then the Head or Principal submits. A data-entry officer sees \"Ask your Head or Principal to submit\": nothing reaches PCP without a second check.",
  },
  {
    act: ACTS[1],
    title: "Scrutiny and a formal deficiency",
    as: "pcp.officer",
    path: "/pcp/applications/{ref}",
    fallback: "/pcp/applications",
    do: ["Click **Start scrutiny (assign to me)**.", "Under **Raise a formal deficiency** click **Fill demo values**, then **Raise deficiency**."],
    say: "Every deficiency has an ID, a deadline and the exact evidence required. Both sides see who holds the file and the clock for the stage.",
  },
  {
    act: ACTS[1],
    title: "The institution responds",
    as: "ruh.poc",
    path: "/institution/applications/{ref}",
    fallback: "/institution/applications",
    do: ["In the deficiency card click **Fill demo values**, **Attach sample PDF** as evidence, then **Submit response**."],
    say: "Responses and evidence are versioned and fingerprinted (SHA-256). Every email about the case is listed under Messages on the case itself.",
  },
  {
    act: ACTS[1],
    title: "Technical review and the inspection team",
    as: "pcp.officer",
    path: "/pcp/applications/{ref}",
    fallback: "/pcp/applications",
    do: [
      "Click **Accept** on the deficiency response, then **Pass scrutiny: start technical review**.",
      "Under **Technical review** click **Fill demo values**, then **Record review: ready for inspection**.",
      "Under **Assign the inspection team** pick **Dr. Zainab Qureshi · Khyber Pakhtunkhwa** as lead, then **Schedule and notify**: blocked.",
      "Pick **Dr. Kamran Javed · Punjab**, then **Schedule and notify**.",
    ],
    say: "The technical review is the academic check against PCP's standards. Then a team is assigned: no member inspects an institution in their own province or one they declared a conflict with. The institution is told the date, what to prepare and the team size.",
  },
  {
    act: ACTS[1],
    title: "On-site inspection checklist",
    as: "pcp.inspector",
    path: "/pcp/inspections",
    do: ["Click **Open checklist**, then **Fill demo values** (or mark each criterion yourself).", "Click **Submit inspection report**."],
    say: "Team members see only their visits; the lead submits the checklist. In production this runs offline in ODK with geotagged photos; the report PDF is filed in the institution's folder.",
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
    do: [
      "Keep **Approve**, add a condition, click **Record approval** and confirm the one-time code. The decision letter is generated and filed.",
      "Click **Issue NOC certificate (QR + signed PDF)**, confirm the code, then **View / print certificate**.",
    ],
    say: "Defer needs a reason and a return date; reject states its grounds. Every outcome produces a standard decision letter, and every decision needs a one-time code. The certificate carries a QR code and a SHA-256 fingerprint.",
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
    title: "PCP's work, then the live picture",
    as: "pcp.officer",
    path: "/pcp",
    do: [
      "**My work** comes first: what is due, what is blocked or overdue (NOC-2026-0001 has passed its time limit and was escalated), and what was decided.",
      "Click any figure, for example **Inspections this month** or **Awaiting a decision**: it opens the list behind it.",
    ],
    say: "Every stage has a time limit with a clock both sides can see. A late case gets a reminder, then one escalation to the supervisor. Charts sit below the task list, not above it.",
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
    do: ["Every action from this demo is here, including who opened each case, hash-chained. The banner reads **Chain intact**."],
    say: "Editing or deleting any past entry, even directly in the database, breaks the chain from that point. No niche ledger product needed (AWS shut QLDB down in 2025).",
  },
];
