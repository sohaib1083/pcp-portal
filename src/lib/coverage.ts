// What the demo covers, point by point, against PCP's working guide "PCP digitisation" (sections 1 to 14).
// Shown on the public page /coverage. Keep each line true: change it when the feature changes.

/** built: works end to end. simulated: works, with the outside party (bank, NADRA, HEC, SMS, email) simulated.
 *  golive: needs production infrastructure or an agreement. rollout: a rollout activity, not software. */
export type CoverageStatus = "built" | "simulated" | "golive" | "rollout";

/** Where "Try it" goes: signed in as a demo user (`as`), or a public page anyone can open. */
export type TryIt = { as: string; to: string } | { open: string };

export type CoverageItem = { req: string; how: string; status: CoverageStatus; try?: TryIt };
export type CoverageSection = { n: number; title: string; items: CoverageItem[] };

export const STATUS_LABEL: Record<CoverageStatus, string> = {
  built: "Built",
  simulated: "Built, simulated link",
  golive: "At go-live",
  rollout: "Rollout step",
};

export const STATUS_HELP: Record<CoverageStatus, string> = {
  built: "Works end to end in this demo.",
  simulated: "Works end to end; the outside party (bank, NADRA, HEC, SMS or email) is simulated.",
  golive: "Needs production infrastructure or an agreement; the place for it is built.",
  rollout: "Done during rollout by people, not by software; the tools for it are built.",
};

export const COVERAGE: CoverageSection[] = [
  {
    n: 1,
    title: "What the system is for",
    items: [
      { req: "One register for institutions, programmes, faculty, students, inspections and pharmacists", how: "Every record hangs off an ID: PCP-UNI, PCP-FAC, the student ID and the pharmacist registration number.", status: "built", try: { as: "pcp.officer", to: "/pcp/institutions" } },
      { req: "Pharm.D and Pharmacy Technician are two programme types on one institution record", how: "Programme cards on the institution profile; one institution can hold both.", status: "built", try: { as: "ruh.poc", to: "/institution/profile" } },
      { req: "The home screen answers what is due, what is blocked and what was decided", how: "Task-first dashboards for institutions and for PCP officers.", status: "built", try: { as: "ruh.poc", to: "/institution" } },
      { req: "Can this college start Pharm.D?", how: "Institution profile, then the NOC case, then the decision letter.", status: "built", try: { as: "pcp.officer", to: "/pcp/applications" } },
      { req: "Is accreditation still valid?", how: "Programme card: status, valid until, intake, and the history rows.", status: "built", try: { as: "ruh.poc", to: "/institution/profile" } },
      { req: "Is this teacher already claimed?", how: "Faculty ID search before linking; someone active elsewhere shows as taken.", status: "built", try: { as: "ruh.entry", to: "/institution/faculty" } },
      { req: "Did this student finish?", how: "Student record: year, result, graduation and degree check.", status: "built", try: { as: "ruh.exam", to: "/institution/students" } },
      { req: "Is this person a registered pharmacist?", how: "Public search by registration number, no sign-in.", status: "built", try: { open: "/verify" } },
    ],
  },
  {
    n: 2,
    title: "Three kinds of user",
    items: [
      { req: "One account and Institution ID per institution; people have jobs, not a shared password", how: "Six institution roles, each person with their own sign-in. The Head adds, disables and resets users.", status: "built", try: { as: "ruh.poc", to: "/institution/users" } },
      { req: "Head of institution: submit applications, see decisions", how: "Only the Head or the Principal can submit; others see \"Ask your Head or Principal to submit\".", status: "built", try: { as: "ruh.poc", to: "/institution/applications" } },
      { req: "Principal or Dean: confirm programme data, respond to deficiencies", how: "Same case screen, with the submit and respond rights.", status: "built", try: { as: "ruh.dean", to: "/institution/applications" } },
      { req: "Department administrator: campus, labs, library; cannot issue an NOC", how: "Edits the profile and campuses; no decision rights anywhere.", status: "built", try: { as: "ruh.admin", to: "/institution/profile" } },
      { req: "Data-entry officer: faculty and student drafts; cannot submit without a second check", how: "Can enter and save; the submit button is replaced by a request to the Head.", status: "built", try: { as: "ruh.entry", to: "/institution/faculty" } },
      { req: "Examination officer: annual results and evidence; cannot change a locked year", how: "Files the annual return; a locked year only takes a correction request.", status: "built", try: { as: "ruh.exam", to: "/institution/annual-returns" } },
      { req: "Finance officer: pay fees, see dues; cannot alter academic records", how: "Payments and dues only.", status: "simulated", try: { as: "ruh.finance", to: "/institution/payments" } },
      { req: "A verified faculty link is changed only through a change request; the old link stays visible", how: "Ending, moving or correcting a verified link opens a request that PCP approves with a one-time code.", status: "built", try: { as: "pcp.verification", to: "/pcp/verification" } },
      { req: "Super administrator: users, roles, reference rules; not case decisions", how: "Users and institutions, every PCP and institution role, versioned reference rules.", status: "built", try: { as: "pcp.admin", to: "/pcp/admin" } },
      { req: "Secretary: Council agenda, decisions, certificates", how: "Council meetings built from cases that are ready; decisions with a one-time code.", status: "built", try: { as: "pcp.secretary", to: "/pcp/council" } },
      { req: "Registration officer: institution onboarding and the pharmacist register", how: "Onboarding review queue and the register.", status: "built", try: { as: "pcp.registration", to: "/pcp/onboarding" } },
      { req: "Inspection coordinator: teams, conflict check, schedule, report receipt", how: "Assigns a lead and members; each passes the conflict check.", status: "built", try: { as: "pcp.coordinator", to: "/pcp/inspections" } },
      { req: "Panel member: checklist, photos, remarks; own assigned visits only", how: "An inspector sees only the visits they are assigned to.", status: "built", try: { as: "pcp.inspector", to: "/pcp/inspections" } },
      { req: "Accounts officer: fees and outstanding dues that block submission", how: "Ledger, bank reconciliation and dues.", status: "simulated", try: { as: "pcp.accounts", to: "/pcp/accounts" } },
      { req: "Verification officer: documents, faculty qualifications, duplicate checks", how: "Data verification queue: duplicates, link and change requests, identity checks.", status: "built", try: { as: "pcp.verification", to: "/pcp/verification" } },
      { req: "Students see their own ID, enrolment and result status; they edit nothing", how: "Read-only student portal.", status: "built", try: { as: "student.ruh", to: "/student" } },
      { req: "Registered pharmacists update their own practice details, subject to verification", how: "The update waits until PCP verifies it.", status: "built", try: { as: "pharm.ali", to: "/pharmacist" } },
      { req: "The public verifies an institution or a pharmacist; no CNIC, phone or email shown", how: "Public verify page and certificate check.", status: "built", try: { open: "/verify" } },
    ],
  },
  {
    n: 3,
    title: "Institution onboarding",
    items: [
      { req: "Create account; the system sends an email and a mobile code", how: "Self-registration with both codes (shown on screen in the demo).", status: "simulated", try: { open: "/register" } },
      { req: "Profile and affiliation save as a draft to return to later", how: "A four-step checklist, not a long form.", status: "built", try: { as: "ivc.applicant", to: "/onboarding" } },
      { req: "One campus, then programmes under it", how: "Campus and programme step of the checklist.", status: "built", try: { as: "ivc.applicant", to: "/onboarding" } },
      { req: "Legal documents: missing items are marked before submit", how: "Submit stays locked until every step is complete.", status: "built", try: { as: "ivc.applicant", to: "/onboarding" } },
      { req: "PCP verification: accept, return or reject with a reason", how: "Each document verified or marked not acceptable; return and reject need a reason.", status: "built", try: { as: "pcp.registration", to: "/pcp/onboarding" } },
      { req: "Approval issues PCP-UNI-000123 and unlocks applications", how: "Approval with a one-time code creates the institution, its ID and the Head's access.", status: "built", try: { as: "pcp.registration", to: "/pcp/onboarding" } },
      { req: "A second campus is a child record, not a second account", how: "Riverside University has two campuses under one ID.", status: "built", try: { as: "ruh.admin", to: "/institution/profile" } },
    ],
  },
  {
    n: 4,
    title: "Pharm.D NOC as a case file",
    items: [
      { req: "Pick the campus and fill only what is new: intake, faculty links, labs, library, documents", how: "The approved profile is reused; nothing is retyped.", status: "built", try: { as: "ruh.poc", to: "/institution/applications" } },
      { req: "Faculty are linked by Faculty ID, never typed freehand", how: "A picker searches the institution's own faculty by ID, CNIC or name.", status: "built", try: { as: "ruh.poc", to: "/institution/applications" } },
      { req: "Pay stays locked until every rule passes, each failure naming the item and the rule", how: "For example \"Pharmacology: 1 teacher linked, 2 required for intake 50\", with a Fix link to that line.", status: "built", try: { as: "ruh.poc", to: "/institution/applications" } },
      { req: "Faculty load, outstanding dues and a previous regulatory bar block the case", how: "Checked with the other rules before Pay opens.", status: "built", try: { as: "ruh.poc", to: "/institution/applications" } },
      { req: "Stages: initial scrutiny, deficiency, technical review, inspection, Council, outcome", how: "The case header shows the stage and who holds the file.", status: "built", try: { as: "pcp.officer", to: "/pcp/applications" } },
      { req: "Defer has a reason and a return date; reject states the grounds", how: "Both are required fields; each produces a decision letter.", status: "built", try: { as: "pcp.secretary", to: "/pcp/council" } },
      { req: "Approve generates the NOC and writes the intake on the programme card; the record locks", how: "NOC number, letter and QR certificate; the programme card updates.", status: "built", try: { as: "ruh.poc", to: "/institution/profile" } },
    ],
  },
  {
    n: 5,
    title: "Accreditation and renewal",
    items: [
      { req: "Accreditation reads the same records; the institution updates what changed and files a self-assessment", how: "Started from the programme card; the file is prepared from existing records.", status: "built", try: { as: "ruh.poc", to: "/institution/profile" } },
      { req: "History stays on the programme card; old rows are not overwritten", how: "Each accreditation is a history row; an open renewal shows as pending.", status: "built", try: { as: "ruh.poc", to: "/institution/profile" } },
      { req: "Renewal starts itself at 180, 120, 90, 60 and 30 days and on the expiry date", how: "A daily job puts \"Renewal due\" on the dashboard and emails the institution once per step.", status: "simulated", try: { as: "ruh.poc", to: "/institution" } },
      { req: "Inspection and Council follow the same path as a first accreditation", how: "Same pipeline, same screens.", status: "built", try: { as: "pcp.officer", to: "/pcp/applications" } },
    ],
  },
  {
    n: 6,
    title: "Pharmacy Technician",
    items: [
      { req: "Programme type is asked first; checklist, faculty rules, lab rules and fee load for that type", how: "Choosing Pharmacy Technician loads its own rules and fee.", status: "built", try: { as: "ruh.poc", to: "/institution/applications" } },
      { req: "A college can hold both; the status of one does not hide the other", how: "Separate programme cards on the same institution.", status: "built", try: { as: "ruh.poc", to: "/institution/profile" } },
    ],
  },
  {
    n: 7,
    title: "Faculty: one person, one ID",
    items: [
      { req: "One record per person (PCP-FAC-000458); institutions link the ID to a programme", how: "Institutions link people; they never create a second record for the same person.", status: "built", try: { as: "ruh.entry", to: "/institution/faculty" } },
      { req: "Applied path: registered, qualification checked, link requested, PCP verifies, Active", how: "A link by ID starts as requested and becomes Active when PCP approves it.", status: "built", try: { as: "pcp.verification", to: "/pcp/verification" } },
      { req: "Annual update is a task", how: "\"Confirm faculty list for 2026\" on the dashboard, confirmed by the Head or the Principal.", status: "built", try: { as: "ruh.poc", to: "/institution/faculty" } },
      { req: "Transfer, resignation or retirement closes the link and keeps the history", how: "Through a change request; past NOCs and inspections still show the old link.", status: "built", try: { as: "ruh.poc", to: "/institution/faculty" } },
      { req: "Duplicate check on registration number, CNIC and name plus institution", how: "Checked before a record is created; near matches go to PCP.", status: "built", try: { as: "pcp.verification", to: "/pcp/verification" } },
      { req: "A spelling variant offers \"Did you mean PCP-FAC-000458?\"", how: "Shown before a new person is created.", status: "built", try: { as: "ruh.entry", to: "/institution/faculty" } },
    ],
  },
  {
    n: 8,
    title: "Students and the annual return",
    items: [
      { req: "Student ID from institution initials, year and serial, stored with the Institution ID", how: "Generated on enrolment and shown with the PCP prefix.", status: "built", try: { as: "ruh.exam", to: "/institution/students" } },
      { req: "Minimum fields: name, father's name, CNIC, mobile, email, programme, session, year, result, status", how: "Required fields with format checks.", status: "built", try: { as: "ruh.entry", to: "/institution/students" } },
      { req: "Life of the record: enrol, validate, progress, result, promote or repeat, graduate, degree check, eligible", how: "Each step on the student record; the degree check is simulated.", status: "simulated", try: { as: "ruh.exam", to: "/institution/students" } },
      { req: "PCP counts entrants, graduates, failures and late completers by institution and year", how: "Reports with drill-down to the list.", status: "built", try: { as: "pcp.officer", to: "/pcp/reports" } },
      { req: "Annual student update filed by the examination officer, with evidence", how: "Figures prefilled from student records; evidence attached.", status: "built", try: { as: "ruh.exam", to: "/institution/annual-returns" } },
      { req: "After PCP accepts, the year locks; a later change is a correction request and the original stays visible", how: "Correction requests carry a reason and evidence; both sets of figures are shown.", status: "built", try: { as: "pcp.verification", to: "/pcp/annual-returns" } },
    ],
  },
  {
    n: 9,
    title: "Pharmacist register and public check",
    items: [
      { req: "Register: personal data, university, graduation year, number, issue date, issuing council, status", how: "150 fictional pharmacists across the five provincial councils.", status: "built", try: { as: "pcp.registration", to: "/pcp/pharmacists" } },
      { req: "Practice place and designation shown only once the pharmacist has confirmed them", how: "The pharmacist sends an update; PCP verifies it.", status: "built", try: { as: "pharm.ali", to: "/pharmacist" } },
      { req: "Public search returns name, number, category, status and validity; never CNIC, phone, email or address", how: "Exact-number lookup.", status: "built", try: { open: "/verify" } },
      { req: "A dormant or cancelled registration says so in plain words", how: "For example: \"This registration is dormant. The pharmacist may not practise until it is renewed.\"", status: "built", try: { open: "/verify" } },
    ],
  },
  {
    n: 10,
    title: "Inspection and deficiencies",
    items: [
      { req: "One inspection module reused by NOC, accreditation and renewal", how: "Same scheduling and checklist for every case type.", status: "built", try: { as: "pcp.coordinator", to: "/pcp/inspections" } },
      { req: "The coordinator assigns a team; no member inspects an institution in their own province", how: "Same-province rule plus declared conflicts, checked for every member.", status: "built", try: { as: "pcp.coordinator", to: "/pcp/inspections" } },
      { req: "The institution is told the date and the scope", how: "Alert and email with the date, what to prepare and the team size.", status: "simulated", try: { as: "ruh.poc", to: "/institution/messages" } },
      { req: "Tablet checklist: compliant, partly, non-compliant or not applicable, with remark, photo and document", how: "The report is part of the case file, not an email attachment.", status: "built", try: { as: "pcp.inspector", to: "/pcp/inspections" } },
      { req: "A deficiency is a task: number, area, deadline, evidence needed", how: "For example DF-2026-00452; the institution uploads evidence and PCP accepts or returns it.", status: "built", try: { as: "ruh.dean", to: "/institution/applications" } },
      { req: "The dashboard counts outstanding deficiencies", how: "Tile that opens the list.", status: "built", try: { as: "pcp.officer", to: "/pcp" } },
    ],
  },
  {
    n: 11,
    title: "What each dashboard shows",
    items: [
      { req: "PCP officer: counts that open a list when clicked", how: "Institutions, Pharm.D and technician programmes, pharmacists, pending NOCs and accreditations, renewals inside 90 days, inspections this month, deficiencies, cases awaiting decision.", status: "built", try: { as: "pcp.officer", to: "/pcp" } },
      { req: "Charts by province, sector, enrolment, graduates, faculty and accreditation sit below the task list", how: "Task list first, charts underneath.", status: "built", try: { as: "pcp.officer", to: "/pcp" } },
      { req: "Institution: each programme's status and every action required, each line opening its task", how: "Programme lines and an action list (annual result, faculty update, renewal, deficiencies).", status: "built", try: { as: "ruh.poc", to: "/institution" } },
    ],
  },
  {
    n: 12,
    title: "Messages, files and access",
    items: [
      { req: "Email and a dashboard alert fire together for every case event, and every message is stored on the case", how: "Submission, receipt, return, deficiency, inspection date, decision, NOC, accreditation, expiry and annual return. In the demo, emails are stored under Messages and not sent.", status: "simulated", try: { as: "ruh.poc", to: "/institution/messages" } },
      { req: "Files sit under the institution by folder, with version, date, uploader, type, verification, expiry and hash", how: "Replacing a file adds a version; the previous one is kept.", status: "built", try: { as: "ruh.poc", to: "/institution/documents" } },
      { req: "A one-time code for anyone submitting a decision or a payment", how: "Every decision and payment asks for a code (filled in for you in the demo).", status: "simulated", try: { as: "pcp.secretary", to: "/pcp/council" } },
      { req: "A one-time code at sign-in for officers", how: "Keycloak's two-factor sign-in is switched on for PCP roles at go-live; it is off here so anyone can try every role in one click.", status: "golive" },
      { req: "An institution sees only itself; an officer sees their cases; a super administrator sees the system", how: "Checked on every page and download, not just hidden in the menu.", status: "built", try: { as: "nhc.poc", to: "/institution" } },
      { req: "Session timeout on shared office computers", how: "Signed out after 30 minutes without activity, with a one-minute warning.", status: "built" },
    ],
  },
  {
    n: 13,
    title: "Suggested build order",
    items: [
      { req: "Phases 1 to 8: onboarding, Faculty ID, NOC, inspection, accreditation alerts, student return, pharmacist register, technician rules", how: "All eight are in this demo. The delivery plan takes them live in short phases, onboarding first.", status: "built", try: { as: "pcp.officer", to: "/pcp" } },
    ],
  },
  {
    n: 14,
    title: "Further digitisation points",
    items: [
      { req: "CNIC check against NADRA at registration of faculty, students and pharmacists", how: "Runs on registration and on demand; mismatches go to PCP's verification queue.", status: "simulated", try: { as: "pcp.verification", to: "/pcp/verification" } },
      { req: "Degree and result check against the university or HEC before a student is eligible", how: "Run from the student record.", status: "simulated", try: { as: "ruh.exam", to: "/institution/students" } },
      { req: "One duplicate rule set with a merge screen that keeps both histories", how: "Faculty duplicates are merged on the verification screen; students and pharmacists are checked on import.", status: "built", try: { as: "pcp.verification", to: "/pcp/verification" } },
      { req: "Drop-down reference lists so data is not typed freehand", how: "Provinces, universities and programmes are versioned reference rules.", status: "built", try: { as: "pcp.admin", to: "/pcp/rules" } },
      { req: "Bulk upload templates with a row-by-row error report before anything is saved", how: "Students from universities and pharmacists from provincial councils.", status: "built", try: { as: "ruh.exam", to: "/institution/students" } },
      { req: "Every NOC, certificate and registration card carries a QR code to the live status page", how: "Scan any letter or card to open its live status.", status: "built", try: { open: "/verify" } },
      { req: "Digital signature and seal for the Secretary and Registrar, with who signed and when", how: "Letters carry the signatory and time, recorded in the audit log. At go-live the signature uses a licensed certificate (for example NIFT).", status: "golive", try: { as: "pcp.secretary", to: "/pcp/council" } },
      { req: "Online fee payment through bank or Raast, automatic receipt, reconciliation by Accounts", how: "Challan with PSID and Raast QR, receipt PDF, statement matching by PSID.", status: "simulated", try: { as: "pcp.accounts", to: "/pcp/accounts" } },
      { req: "Council agenda built from cases that are ready, with case file, inspection report and draft decision", how: "The Secretary builds the agenda in one step.", status: "built", try: { as: "pcp.secretary", to: "/pcp/council" } },
      { req: "Standard decision letters from templates", how: "Approval, deferral, rejection and appeal letters.", status: "built", try: { as: "pcp.secretary", to: "/pcp/council" } },
      { req: "A time limit on every stage, with the clock visible to both sides", how: "\"Scrutiny, 4 days left\" or \"2 days overdue\" on the case header.", status: "built", try: { as: "pcp.officer", to: "/pcp/applications" } },
      { req: "Automatic reminder, then escalation to the supervisor", how: "Daily job: a reminder to the officer, then one escalation.", status: "built", try: { as: "pcp.officer", to: "/pcp/applications" } },
      { req: "Appeal and grievance case type linked to the original decision", how: "Filed by the Head or Principal; reviewed and heard at Council.", status: "built", try: { as: "pcp.officer", to: "/pcp/appeals" } },
      { req: "Complete audit trail: who viewed, changed, approved or downloaded, and when", how: "Tamper-evident: each entry is chained to the one before.", status: "built", try: { as: "pcp.admin", to: "/pcp/audit" } },
      { req: "Conflict-of-interest check for inspectors and panel members, beyond the same-province rule", how: "Declared conflicts block the assignment.", status: "built", try: { as: "pcp.coordinator", to: "/pcp/inspections" } },
      { req: "Quarterly review of who holds which role", how: "Access review: keep or remove each user, recorded with a one-time code.", status: "built", try: { as: "pcp.admin", to: "/pcp/admin" } },
      { req: "Encryption in storage and in transit; CNIC masked except for authorised officers", how: "HTTPS everywhere; encrypted disks; CNIC masked on screen for other roles.", status: "built" },
      { req: "Daily backups, a tested restore and a disaster recovery site", how: "Daily backups with a restore test run on the hosted demo. A second-region recovery site is set up at go-live.", status: "golive" },
      { req: "Retention: records kept, temporary drafts cleared on a schedule", how: "A retention rule and a daily clean-up that never touches submitted records.", status: "built", try: { as: "pcp.admin", to: "/pcp/admin" } },
      { req: "Privacy policy approved by the Council before public search goes live", how: "A draft notice is ready for the Council.", status: "rollout", try: { open: "/privacy" } },
      { req: "Standard reports: by province and sector, intake against enrolment, graduates, faculty ratio, licence validity", how: "Each with a chart and a table.", status: "built", try: { as: "pcp.officer", to: "/pcp/reports" } },
      { req: "Early-warning list: repeated deficiencies, late annual returns, falling faculty", how: "One of the standard reports.", status: "built", try: { as: "pcp.officer", to: "/pcp/reports" } },
      { req: "Export to Excel and PDF, and a read-only data feed for the Ministry and provincial councils", how: "Every report exports; the feed needs a key the Super administrator issues.", status: "built", try: { as: "pcp.admin", to: "/pcp/accounts" } },
      { req: "Every dashboard figure opens the underlying list", how: "Click any number.", status: "built", try: { as: "pcp.officer", to: "/pcp" } },
      { req: "Tablet inspection app that works offline and syncs", how: "The checklist keeps answers on the tablet and submits when the connection returns.", status: "built", try: { as: "pcp.inspector", to: "/pcp/inspections" } },
      { req: "Mobile-friendly screens for students and pharmacists; SMS fallback", how: "Phone layouts; SMS copies of key messages (stored, not sent, in the demo).", status: "simulated", try: { as: "student.ruh", to: "/student" } },
      { req: "English and Urdu on public screens and letters", how: "Public screens switch to Urdu. Letters and cards are English for now; Urdu letters need a font-shaping library.", status: "built", try: { open: "/verify" } },
      { req: "Help desk and ticketing, with a short user guide on each screen", how: "Public and signed-in tickets with a 5-working-day clock; \"How this screen works\" on each screen.", status: "built", try: { open: "/help" } },
      { req: "Scan and index existing files by Institution ID; load current NOCs, accreditations and the register first", how: "Document folders and bulk imports are ready; the scanning is done during rollout.", status: "rollout" },
      { req: "Data cleaning before import: duplicate faculty, missing CNIC, inconsistent names", how: "The duplicate and NADRA checks flag these on import.", status: "rollout" },
      { req: "Pilot with a few institutions per province, role-based training, paper and system side by side", how: "Part of the rollout plan.", status: "rollout" },
      { req: "Measures of success: days to decide an NOC, share returned for deficiency, annual returns on time", how: "A report with a target beside each measure.", status: "built", try: { as: "pcp.officer", to: "/pcp/reports" } },
    ],
  },
];
