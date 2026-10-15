// Seed data for the governance module (RFP Oct 2026): court cases, the correspondence register and committees.
// - ref.courts and ref.committees reference rules
// - 5 court cases across courts and statuses; LIT-<year>-0001 has a stay order on the seeded renewal RNW-2026-0001,
//   with a hearing within the week (its reminder is sent by the reminder job at the end)
// - 12 inward and 8 outward letters, some marked to officers, one past its action date, two outward drafts
// - ACM-<year>-01: a closed Accreditation Committee meeting with recommendations, action points and minutes;
//   ACM-<year>-02: the next one, planned
import { eq } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db, schema } from "../../src/db";
import { audit } from "../../src/lib/audit";
import { fileMinutes } from "../../src/lib/council";
import { DEFAULT_COMMITTEES, DEFAULT_COURTS, pkToday } from "../../src/lib/governance-shared";
import { fileCourtDocument, fileLetterDocument, renderOutwardLetter, runGovernanceReminders, shortDay } from "../../src/lib/governance";
import { emailAudience } from "../../src/lib/messages";

const DAY = 86400000;
const now = Date.now();
const at = (days: number, hour = 10) => {
  const d = new Date(now + days * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};
const ymd = (days: number) => pkToday(new Date(now + days * DAY)); // dates as on a calendar in Pakistan
const YEAR = new Date(now).getUTCFullYear();

/** A plain PDF standing in for a paper that came from outside PCP (a court order, a scanned letter). */
async function paperPdf(header: string, title: string, lines: string[], tone: [number, number, number] = [0.25, 0.25, 0.3]) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({ x: 0, y: 782, width: 595, height: 60, color: rgb(...tone) });
  page.drawText(header, { x: 40, y: 806, size: 13, font: bold, color: rgb(1, 1, 1) });
  page.drawText("DEMO DOCUMENT - fictional data", { x: 40, y: 760, size: 9, font, color: rgb(0.7, 0.1, 0.1) });
  page.drawText(title, { x: 40, y: 720, size: 15, font: bold });
  let y = 690;
  for (const l of lines) {
    const words = l.split(" ");
    let line = "";
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(t, 11) > 515) {
        page.drawText(line, { x: 40, y, size: 11, font });
        y -= 16;
        line = w;
      } else line = t;
    }
    if (line) page.drawText(line, { x: 40, y, size: 11, font });
    y -= 24;
  }
  return Buffer.from(await pdf.save());
}

type CourtSeed = {
  court: string;
  caseNumber: string;
  petitioner: string;
  respondent: string;
  nature: string;
  inst?: string;
  linkedRef?: string;
  counsel: string;
  counselEmail: string;
  filed: number; // days from now (negative: past)
  status: string;
  summary: string;
  hearings: { day: number; bench: string; purpose: string; outcome?: string; next?: number }[];
  orders: { kind: string; day: number; summary: string; stayUntil?: number; lifted?: { day: number; note: string } }[];
  papers: { docType: string; title: string; lines: string[] }[];
};

export default async function seedGovernance(): Promise<string | void> {
  const insts = await db.select().from(schema.institutions);
  const by = (s: string) => insts.find((i) => i.shortCode === s);
  if (!by("FRU") || !by("GMI")) return "core institutions missing; skipped";
  const apps = await db.select().from(schema.applications);
  const appRef = (ref: string) => apps.find((a) => a.ref === ref)?.ref;

  // ---- Reference rules: courts and committees ----
  const haveRule = async (key: string) => !!(await db.query.rules.findFirst({ where: eq(schema.rules.key, key) }));
  if (!(await haveRule("ref.courts")))
    await db.insert(schema.rules).values({ key: "ref.courts", version: 1, effectiveFrom: "2026-01-01", description: "Courts for the litigation ledger (drop-down reference list)", value: DEFAULT_COURTS });
  if (!(await haveRule("ref.committees")))
    await db.insert(schema.rules).values({ key: "ref.committees", version: 1, effectiveFrom: "2026-01-01", description: "Council and committees, with chair and members (usernames) and reference prefix", value: DEFAULT_COMMITTEES.map(({ decides: _d, ...c }) => c) });
  for (const r of ["ref.courts@v1", "ref.committees@v1"]) await audit(db, { actor: "system", action: "rule.seeded", entity: "rule", entityId: r });

  // ---- Court cases ----
  const fru = by("FRU")!;
  const gmi = by("GMI")!;
  const scu = by("SCU")!;
  const nhc = by("NHC")!;
  const cases: (CourtSeed & { ref: string })[] = [
    {
      ref: `LIT-${YEAR}-0001`,
      court: "Lahore High Court",
      caseNumber: "WP 2214/2026",
      petitioner: fru.name,
      respondent: "Pharmacy Council of Pakistan",
      nature: "WRIT",
      inst: "FRU",
      linkedRef: appRef("RNW-2026-0001"),
      counsel: "Ms. Rabia Anwar, Advocate High Court",
      counselEmail: "rabia.anwar@example.com",
      filed: -26,
      status: "STAY_GRANTED",
      summary: "The university challenges the deferral of its Technician renewal and asks that its accreditation not lapse while the safety audit is completed. Filed at the Multan Bench.",
      hearings: [
        { day: -21, bench: "Justice A. Rehman (Multan Bench)", purpose: "Notice and interim relief", outcome: "Notice issued to PCP. Interim relief granted: no further action on the renewal till the next date. Comments called within three weeks." },
        { day: 6, bench: "Justice A. Rehman (Multan Bench)", purpose: "Comments of the respondents and arguments on the stay" },
      ],
      orders: [{ kind: "STAY", day: -21, stayUntil: 28, summary: "Notice issued. Till the next date of hearing, the respondents shall not take any further action on the renewal of the petitioner's Pharmacy Technician programme (RNW-2026-0001)." }],
      papers: [
        { docType: "Petition", title: "Writ Petition No. 2214 of 2026", lines: ["Five Rivers University v. Pharmacy Council of Pakistan", "Petition under Article 199 of the Constitution against the deferral of the renewal of the Pharmacy Technician programme.", "Prayer: suspend the deferral and restrain the respondents from lapsing the accreditation."] },
      ],
    },
    {
      ref: `LIT-${YEAR}-0002`,
      court: "Islamabad High Court",
      caseNumber: "WP 3102/2026",
      petitioner: gmi.name,
      respondent: "Pharmacy Council of Pakistan and another",
      nature: "WRIT",
      inst: "GMI",
      linkedRef: appRef("NOC-2026-0006"),
      counsel: "Barrister Saad Hashmi",
      counselEmail: "saad.hashmi@example.com",
      filed: -9,
      status: "PENDING",
      summary: "The institute challenges the rejection of its Pharm.D NOC, arguing the inspection was done before its new faculty joined. The appeal to the council is pending alongside.",
      hearings: [{ day: 12, bench: "Justice S. Kazmi", purpose: "Notice to the respondents" }],
      orders: [],
      papers: [{ docType: "Petition", title: "Writ Petition No. 3102 of 2026", lines: ["Gilgit Mountain Institute of Pharmacy v. Pharmacy Council of Pakistan and another", "Petition against the rejection of the Pharm.D NOC (NOC-2026-0006)."] }],
    },
    {
      ref: `LIT-${YEAR - 1}-0004`,
      court: "Sindh High Court",
      caseNumber: "CP D-1187/2025",
      petitioner: scu.name,
      respondent: "Pharmacy Council of Pakistan",
      nature: "WRIT",
      inst: "SCU",
      linkedRef: appRef("NOC-2025-0003"),
      counsel: "Mr. Asif Memon, Advocate",
      counselEmail: "asif.memon@example.com",
      filed: -240,
      status: "DISPOSED_FAVOUR",
      summary: "Challenge to the rejection of the Technician NOC for want of laboratories. Dismissed: the council acted within its regulations.",
      hearings: [
        { day: -230, bench: "Divisional Bench (Hyderabad)", purpose: "Notice", outcome: "Notice issued; comments called." },
        { day: -150, bench: "Divisional Bench (Hyderabad)", purpose: "Arguments", outcome: "Arguments heard; judgment reserved." },
      ],
      orders: [{ kind: "FINAL", day: -120, summary: "Petition dismissed. The council's decision was taken under its regulations after inspection; no ground for interference." }],
      papers: [{ docType: "Judgment", title: "Judgment in CP D-1187 of 2025", lines: ["Sindh Coastal University v. Pharmacy Council of Pakistan", "For the reasons recorded, the petition is dismissed with no order as to costs."] }],
    },
    {
      ref: `LIT-${YEAR}-0003`,
      court: "Supreme Court of Pakistan",
      caseNumber: "CPLA 412/2026",
      petitioner: "Pharmacy Council of Pakistan",
      respondent: nhc.name,
      nature: "APPEAL",
      inst: "NHC",
      linkedRef: appRef("NOC-2025-0002"),
      counsel: "Mr. Kamran Butt, Advocate Supreme Court",
      counselEmail: "kamran.butt@example.com",
      filed: -70,
      status: "INTERIM_ORDER",
      summary: "PCP's petition for leave to appeal against the Peshawar High Court judgment that set aside the rejection of NHC's Pharm.D NOC.",
      hearings: [
        { day: -40, bench: "Three-member bench (Justice M. Qureshi presiding)", purpose: "Leave", outcome: "Leave granted. Parties to maintain status quo. Paper books to be prepared." },
        { day: 25, bench: "Three-member bench (Justice M. Qureshi presiding)", purpose: "Regular hearing" },
      ],
      orders: [{ kind: "INTERIM", day: -40, summary: "Leave to appeal granted. Till the appeal is decided, the parties shall maintain status quo regarding admissions." }],
      papers: [],
    },
    {
      ref: `LIT-${YEAR}-0004`,
      court: "Civil court",
      caseNumber: "Civil Suit 77/2026 (Civil Judge, Islamabad)",
      petitioner: "Muhammad Tariq",
      respondent: "Pharmacy Council of Pakistan",
      nature: "SERVICE",
      counsel: "Mr. Usman Ghani, Advocate",
      counselEmail: "usman.ghani@example.com",
      filed: -110,
      status: "WITHDRAWN",
      summary: "A former contract employee's suit for regularisation. Withdrawn by the plaintiff after a settlement of dues.",
      hearings: [{ day: -90, bench: "Civil Judge, Islamabad", purpose: "Written statement", outcome: "Written statement filed. Plaintiff sought time." }],
      orders: [{ kind: "OTHER", day: -60, summary: "Suit dismissed as withdrawn on the plaintiff's statement." }],
      papers: [],
    },
  ];

  const courtIds: Record<string, number> = {};
  for (const c of cases) {
    const [row] = await db
      .insert(schema.courtCases)
      .values({
        ref: c.ref,
        court: c.court,
        caseNumber: c.caseNumber,
        title: `${c.petitioner} v. ${c.respondent}`,
        petitioner: c.petitioner,
        respondent: c.respondent,
        nature: c.nature,
        institutionId: c.inst ? by(c.inst)!.id : null,
        linkedRef: c.linkedRef ?? null,
        counsel: c.counsel,
        counselEmail: c.counselEmail,
        filedDate: ymd(c.filed),
        status: c.status,
        summary: c.summary,
        createdBy: "pcp.legal",
        createdAt: at(c.filed + 2),
        updatedAt: at(Math.min(-1, c.filed + 30)),
      })
      .returning();
    courtIds[c.ref] = row.id;
    await audit(db, { actor: "pcp.legal", action: "litigation.case.created", entity: "court_case", entityId: c.ref, details: { court: c.court, caseNumber: c.caseNumber, seeded: true } });
    for (const h of c.hearings)
      await db.insert(schema.courtHearings).values({
        courtCaseId: row.id,
        hearingDate: ymd(h.day),
        bench: h.bench,
        purpose: h.purpose,
        outcome: h.outcome ?? null,
        nextDate: h.outcome ? (c.hearings.find((x) => x.day > h.day) ? ymd(c.hearings.find((x) => x.day > h.day)!.day) : null) : null,
        status: h.outcome ? "HELD" : "SCHEDULED",
        recordedBy: h.outcome ? "pcp.legal" : null,
        recordedAt: h.outcome ? at(h.day, 15) : null,
        createdBy: "pcp.legal",
        createdAt: at(Math.min(h.day - 14, c.filed + 2)),
      });
    for (const o of c.orders) {
      const pdf = await paperPdf(c.court.toUpperCase(), `${o.kind === "STAY" ? "Order (stay)" : o.kind === "FINAL" ? "Final order" : "Order"} in ${c.caseNumber}`, [`${c.petitioner} v. ${c.respondent}`, `Order dated ${ymd(o.day)}.`, o.summary], [0.2, 0.15, 0.1]);
      const doc = await fileCourtDocument(db, { ref: c.ref, docType: `${o.kind === "STAY" ? "Stay order" : o.kind === "FINAL" ? "Judgment" : "Order"} of ${shortDay(ymd(o.day))}`, fileName: `${c.ref}-order-${ymd(o.day)}.pdf`, bytes: pdf, uploadedBy: "pcp.legal" });
      await db.insert(schema.courtOrders).values({
        courtCaseId: row.id,
        kind: o.kind,
        orderDate: ymd(o.day),
        summary: o.summary,
        stayUntil: o.stayUntil ? ymd(o.stayUntil) : null,
        liftedAt: o.lifted ? at(o.lifted.day) : null,
        liftedBy: o.lifted ? "pcp.legal" : null,
        liftNote: o.lifted?.note ?? null,
        documentId: doc.id,
        createdBy: "pcp.legal",
        createdAt: at(o.day, 16),
      });
      await audit(db, { actor: "pcp.legal", action: "litigation.order.recorded", entity: "court_case", entityId: c.ref, details: { kind: o.kind, date: ymd(o.day), seeded: true } });
    }
    for (const p of c.papers) await fileCourtDocument(db, { ref: c.ref, docType: p.docType, fileName: `${c.ref}-${p.docType.toLowerCase().replace(/\s+/g, "-")}.pdf`, bytes: await paperPdf(c.court.toUpperCase(), p.title, p.lines, [0.2, 0.15, 0.1]), uploadedBy: "pcp.legal" });
  }
  // The stay on RNW-2026-0001 was reported to the Secretary and the case officer when it was recorded.
  const stayed = cases[0];
  if (stayed.linkedRef)
    await db.insert(schema.notifications).values([
      { audience: "role:pcp_secretary", title: `Stay order on ${stayed.linkedRef}`, body: `Stay order by LHC in ${stayed.caseNumber}: no further action until ${ymd(28)}. Council decisions on ${stayed.linkedRef} are blocked until the stay is lifted.`, link: `/pcp/applications/${stayed.linkedRef}`, createdAt: at(-21, 16) },
      { audience: "user:pcp.officer", title: `Stay order on ${stayed.linkedRef}`, body: `Stay order by LHC in ${stayed.caseNumber}. No further action on ${stayed.linkedRef} until it is lifted.`, link: `/pcp/applications/${stayed.linkedRef}`, createdAt: at(-21, 16) },
    ]);

  // ---- Correspondence ----
  type L = { dir: "IN" | "OUT"; day: number; inst?: string; party?: string; email?: string; subject: string; mode: string; linkedRef?: string; markedTo?: string; due?: number; status: string; note?: string; body?: string; dispatched?: boolean; replyTo?: number; lines?: string[] }; // replyTo: 1-based position in the inward list
  const nocCcp = appRef("NOC-2026-0002");
  const inward: L[] = [
    { dir: "IN", day: -18, inst: "CCP", subject: "Request for extension of the deficiency deadline for laboratory equipment", mode: "COURIER", linkedRef: nocCcp, markedTo: "pcp.officer", due: -3, status: "OPEN", lines: ["The college requests 30 more days to install the dissolution apparatus ordered in August.", "Copies of the purchase order are enclosed."] },
    { dir: "IN", day: -16, party: "Higher Education Commission, Islamabad", email: "accreditation@hec.example.pk", subject: "Recognition status of affiliating universities for 2026-27 admissions", mode: "EMAIL", markedTo: "pcp.registration", due: 9, status: "OPEN", lines: ["HEC shares the updated list of recognised affiliating universities.", "PCP is asked to confirm the pharmacy programmes it has approved."] },
    { dir: "IN", day: -15, party: "Registrar, Lahore High Court (Multan Bench)", subject: "Notice of hearing in WP 2214/2026", mode: "HAND", linkedRef: cases[0].ref, markedTo: "pcp.legal", status: "ACTIONED", note: "Counsel engaged and the case entered in the ledger.", lines: ["Notice is given that the above petition is fixed for hearing.", "The respondents are directed to file comments."] },
    { dir: "IN", day: -14, inst: "FRU", subject: "Safety audit of the dispensing laboratory under way", mode: "POST", linkedRef: appRef("RNW-2026-0001"), markedTo: "pcp.officer", due: 14, status: "OPEN", lines: ["The university informs PCP that the safety audit has been commissioned and will be filed on completion."] },
    { dir: "IN", day: -12, party: "Ministry of National Health Services, Regulations and Coordination", email: "so.pharmacy@nhsrc.example.pk", subject: "Data on pharmacy graduates for the national health workforce plan", mode: "EMAIL", markedTo: "pcp.verification", due: 2, status: "OPEN", lines: ["The Ministry asks for the number of pharmacy graduates by province for the last three years."] },
    { dir: "IN", day: -11, inst: "GMI", subject: "Copy of writ petition and request to defer action on the appeal", mode: "COURIER", linkedRef: appRef("NOC-2026-0006"), markedTo: "pcp.legal", due: 5, status: "OPEN", lines: ["The institute encloses a copy of WP 3102/2026 filed before the Islamabad High Court."] },
    { dir: "IN", day: -9, party: "Drug Regulatory Authority of Pakistan", subject: "Nomination of a PCP member to the pharmacy practice working group", mode: "POST", markedTo: "pcp.registration", status: "CLOSED", note: "Nomination sent by OUT letter; filed.", lines: ["DRAP invites PCP to nominate one member to its working group on pharmacy practice standards."] },
    { dir: "IN", day: -7, inst: "RBU", subject: "Submission of self-assessment evidence for accreditation", mode: "HAND", linkedRef: appRef("ACC-2026-0001"), markedTo: "pcp.technical", due: 10, status: "OPEN", lines: ["The university submits a bound copy of its self-assessment evidence for the Pharm.D accreditation."] },
    { dir: "IN", day: -6, party: "Ayesha Khan (student, Clifton College of Pharmacy)", email: "ayesha.k@example.com", subject: "Complaint about withheld degree transcript", mode: "EMAIL", markedTo: "pcp.registration", due: 8, status: "OPEN", lines: ["The student says the college has withheld her transcript over a fee dispute."] },
    { dir: "IN", day: -4, inst: "BVU", subject: "Request for an early council date for the pending NOC", mode: "POST", linkedRef: appRef("NOC-2026-0005"), status: "OPEN", lines: ["The university requests that its pending NOC be placed before the next council meeting."] },
    { dir: "IN", day: -3, party: "Punjab Health Department", subject: "Hospital attachment arrangements for pharmacy students", mode: "POST", markedTo: "pcp.officer", status: "ACTIONED", note: "Forwarded to institutions in Punjab for comments.", lines: ["The department proposes a common hospital attachment template for pharmacy students."] },
    { dir: "IN", day: -1, inst: "SCU", subject: "Change of principal and updated contact details", mode: "EMAIL", status: "OPEN", lines: ["The university informs PCP of the appointment of a new principal with effect from 1 October."] },
  ];
  const outward: L[] = [
    { dir: "OUT", day: -17, inst: "CCP", subject: `Reminder: outstanding deficiency on ${nocCcp ?? "your case"}`, mode: "EMAIL", linkedRef: nocCcp, status: "ACTIONED", dispatched: true, body: `The Pharmacy Council of Pakistan reminds the college that the deficiency raised on ${nocCcp ?? "its case"} remains outstanding.\n\nPlease upload the evidence through the PCP portal before the deadline. The case cannot proceed to inspection until it is accepted.` },
    { dir: "OUT", day: -15, party: "Ms. Rabia Anwar, Advocate High Court", email: "rabia.anwar@example.com", subject: "Engagement as counsel in WP 2214/2026", mode: "EMAIL", linkedRef: cases[0].ref, status: "ACTIONED", dispatched: true, body: "The Council engages you to appear on its behalf in WP 2214/2026 before the Lahore High Court, Multan Bench.\n\nThe case file, the deferral decision and the inspection report are enclosed. Please file para-wise comments before the next date." },
    { dir: "OUT", day: -8, party: "Drug Regulatory Authority of Pakistan", subject: "Nomination to the pharmacy practice working group", mode: "POST", status: "CLOSED", dispatched: true, replyTo: 7, body: "With reference to your letter, the Council nominates its Registration Officer, Ms. Hina Malik, to the working group on pharmacy practice standards." },
    { dir: "OUT", day: -6, inst: "FRU", subject: "Acknowledgement of the notice in WP 2214/2026", mode: "COURIER", linkedRef: appRef("RNW-2026-0001"), status: "ACTIONED", dispatched: true, body: "The Council acknowledges the interim order of the Lahore High Court in WP 2214/2026.\n\nNo further action will be taken on the renewal until the court's next order. The university may continue to file the safety audit through the portal." },
    { dir: "OUT", day: -5, inst: "RBU", subject: "Inspection visit for accreditation of the Pharm.D programme", mode: "EMAIL", linkedRef: appRef("ACC-2026-0001"), status: "ACTIONED", dispatched: true, body: "The Council will schedule an inspection visit after the technical review of your self-assessment.\n\nPlease make the laboratories, library records and faculty files available to the inspection team." },
    { dir: "OUT", day: -3, party: "Higher Education Commission, Islamabad", email: "accreditation@hec.example.pk", subject: "Pharmacy programmes approved by PCP for 2026-27", mode: "EMAIL", status: "ACTIONED", dispatched: true, replyTo: 2, body: "With reference to your letter, the list of pharmacy programmes approved by the Council for the 2026-27 admissions is enclosed.\n\nThe live list is also available on the PCP public verification page." },
    { dir: "OUT", day: -1, inst: "BVU", subject: "Council date for the pending NOC", mode: "EMAIL", linkedRef: appRef("NOC-2026-0005"), status: "OPEN", replyTo: 10, body: "With reference to your letter, the Council informs the university that its NOC case is on the agenda of the next council meeting.\n\nYou will receive the decision letter through the portal after the meeting." },
    { dir: "OUT", day: 0, party: "Ministry of National Health Services, Regulations and Coordination", email: "so.pharmacy@nhsrc.example.pk", subject: "Pharmacy graduates by province, 2023 to 2025", mode: "EMAIL", status: "OPEN", replyTo: 5, body: "With reference to your letter, the number of pharmacy graduates by province for the last three years is enclosed, drawn from the annual returns filed by institutions." },
  ];

  const ids: number[] = [];
  let n = { IN: 0, OUT: 0 };
  for (const l of [...inward, ...outward]) {
    n = { ...n, [l.dir]: n[l.dir] + 1 };
    const ref = `${l.dir}-${YEAR}-${String(n[l.dir]).padStart(5, "0")}`;
    const inst = l.inst ? by(l.inst)! : null;
    const created = at(l.day, 9 + (n[l.dir] % 6));
    const officer = l.markedTo ?? null;
    const [row] = await db
      .insert(schema.correspondence)
      .values({
        ref,
        direction: l.dir,
        letterDate: ymd(l.day - (l.dir === "IN" ? 2 : 0)),
        party: inst ? inst.name : l.party!,
        partyEmail: inst ? null : (l.email ?? null),
        partyInstitutionId: inst?.id ?? null,
        institutionId: inst?.id ?? null,
        subject: l.subject,
        body: l.body ?? null,
        mode: l.mode,
        linkedRef: l.linkedRef ?? null,
        inReplyTo: l.replyTo ? ids[l.replyTo - 1] : null,
        markedTo: officer,
        actionDue: l.due !== undefined ? ymd(l.due) : null,
        status: l.status,
        actionNote: l.note ?? null,
        createdBy: l.dir === "IN" ? "pcp.registration" : "pcp.secretary",
        createdAt: created,
        updatedAt: created,
        dispatchedAt: l.dispatched ? at(l.day, 15) : null,
        dispatchedBy: l.dispatched ? "pcp.secretary" : null,
      })
      .returning();
    if (l.dir === "IN") ids.push(row.id);
    const doc =
      l.dir === "IN"
        ? await fileLetterDocument(db, row, { docType: "Scanned letter", fileName: `${ref}-scan.pdf`, bytes: await paperPdf((inst?.name ?? l.party!).toUpperCase().slice(0, 60), l.subject, l.lines ?? [], [0.12, 0.2, 0.36]), uploadedBy: "pcp.registration" })
        : await fileLetterDocument(db, row, { docType: "Outward letter", fileName: `${ref}.pdf`, bytes: await renderOutwardLetter(db, row, { name: "Dr. Nadia Hussain", role: "pcp_secretary" }), uploadedBy: "pcp.secretary" });
    await db.update(schema.correspondence).set({ documentId: doc.id }).where(eq(schema.correspondence.id, row.id));
    await audit(db, { actor: l.dir === "IN" ? "pcp.registration" : "pcp.secretary", action: l.dir === "IN" ? "correspondence.registered" : "correspondence.generated", entity: "correspondence", entityId: ref, details: { seeded: true } });
    if (l.dir === "IN" && officer) await db.insert(schema.notifications).values({ audience: `user:${officer}`, title: `Letter ${ref} marked to you`, body: `From ${row.party}: ${l.subject}.`, link: `/pcp/correspondence/${ref}`, createdAt: created });
    if (l.dir === "OUT" && l.dispatched) {
      const subject = `Letter ${ref} from PCP: ${l.subject}`;
      const body = `The Pharmacy Council of Pakistan has sent you letter ${ref}. The signed PDF is in your Correspondence folder.`;
      if (inst) await emailAudience(db, `inst:${inst.code}`, subject, body, l.linkedRef ? `/institution/applications/${l.linkedRef}` : "/institution/documents", l.linkedRef ? { entity: "application", entityRef: l.linkedRef } : { entity: "correspondence", entityRef: ref });
      else if (l.email) await db.insert(schema.messages).values({ channel: "EMAIL", toAddress: l.email, toName: row.party, subject, body: `${body}\n\nPharmacy Council of Pakistan · demo · this message was not actually sent`, entity: "correspondence", entityRef: ref, createdAt: at(l.day, 15) });
      await audit(db, { actor: "pcp.secretary", action: "correspondence.dispatched", entity: "correspondence", entityId: ref, details: { seeded: true } });
    }
  }

  // ---- Committees: a closed Accreditation Committee meeting with action points, and the next one ----
  const acc = apps.find((a) => a.ref === "ACC-2026-0001");
  const held = at(-10, 11);
  const [acm] = await db
    .insert(schema.councilMeetings)
    .values({ ref: `ACM-${YEAR}-01`, committee: "Accreditation Committee", title: `Accreditation Committee meeting 1 of ${YEAR}`, meetingDate: ymd(-10), status: "CLOSED", createdBy: "pcp.secretary", createdAt: at(-25), startedAt: held, closedAt: new Date(held.getTime() + 2 * 3600000) })
    .returning();
  const letterRbu = await db.query.correspondence.findFirst({ where: eq(schema.correspondence.ref, `IN-${YEAR}-00008`) });
  const items = [
    ...(acc ? [{ applicationId: acc.id, recommendation: "Self-assessment received; technical review pending. The officer suggests an inspection before the committee recommends.", resolution: "Recommends an inspection visit within 30 days, then return to the committee with the technical review before the case goes to the Council." }] : []),
    { courtCaseId: courtIds[cases[0].ref], subject: `LHC ${cases[0].caseNumber}: ${cases[0].petitioner} v. ${cases[0].respondent}`, recommendation: "Stay order in force on RNW-2026-0001. Counsel to file comments before the next date.", resolution: "Noted the stay. Recommends that counsel argue the deferral was reasoned and offer a fresh inspection once the safety audit is filed." },
    ...(letterRbu ? [{ letterId: letterRbu.id, subject: letterRbu.subject, recommendation: "Bound evidence received by hand; scanned and filed.", resolution: "Technical officer to review the evidence against the standards before the inspection." }] : []),
    { subject: "Revised self-assessment template for accreditation and renewal", recommendation: "Draft circulated to members.", resolution: "Approved for circulation to institutions after one more round of comments." },
  ];
  const itemIds: number[] = [];
  for (const [i, it] of items.entries()) {
    const [row] = await db.insert(schema.councilItems).values({ meetingId: acm.id, position: i + 1, ...it, resolvedBy: "pcp.secretary", resolvedAt: new Date(held.getTime() + (i + 1) * 900000) }).returning();
    itemIds.push(row.id);
  }
  const actionRows = [
    { itemId: itemIds[0], title: "Schedule the inspection visit for ACC-2026-0001 with a conflict-free team", owner: "pcp.officer", dueDate: ymd(4), status: "IN_PROGRESS", note: null as string | null, doneAt: null as Date | null },
    { itemId: itemIds[2] ?? itemIds[0], title: "Review RBU's self-assessment evidence against the accreditation standards", owner: "pcp.technical", dueDate: ymd(-2), status: "OPEN", note: null, doneAt: null },
    { itemId: itemIds[1], title: `Brief counsel and file para-wise comments in ${cases[0].caseNumber}`, owner: "pcp.legal", dueDate: ymd(-3), status: "DONE", note: "Comments drafted with counsel and filed on time.", doneAt: at(-4, 14) },
    { itemId: itemIds[items.length - 1], title: "Circulate the revised self-assessment template to members for final comments", owner: "pcp.registration", dueDate: ymd(9), status: "OPEN", note: null, doneAt: null },
  ];
  for (const a of actionRows) await db.insert(schema.committeeActions).values({ meetingId: acm.id, ...a, createdBy: "pcp.secretary", createdAt: new Date(held.getTime() + 3600000), updatedAt: a.doneAt ?? new Date(held.getTime() + 3600000) });
  const minutes = await fileMinutes(db, acm.id, { username: "pcp.secretary", name: "Dr. Nadia Hussain" });
  await db.update(schema.councilMeetings).set({ minutesDocumentId: minutes.id }).where(eq(schema.councilMeetings.id, acm.id));
  await audit(db, { actor: "pcp.secretary", action: "council.meeting.closed", entity: "council_meeting", entityId: acm.ref, details: { committee: "Accreditation Committee", items: items.length, actions: actionRows.length, minutes: minutes.id, seeded: true } });
  const [acm2] = await db
    .insert(schema.councilMeetings)
    .values({ ref: `ACM-${YEAR}-02`, committee: "Accreditation Committee", title: `Accreditation Committee meeting 2 of ${YEAR}`, meetingDate: ymd(9), status: "PLANNED", createdBy: "pcp.secretary", createdAt: at(-2) })
    .returning();
  if (acc) await db.insert(schema.councilItems).values({ meetingId: acm2.id, position: 1, applicationId: acc.id, recommendation: "Returns from ACM-01 with the inspection report and the technical review." });
  await audit(db, { actor: "pcp.secretary", action: "council.meeting.created", entity: "council_meeting", entityId: acm2.ref, details: { committee: "Accreditation Committee", seeded: true } });

  // Reminders that are due now: hearings within the week, overdue action points, letters past their date.
  const r = await runGovernanceReminders();
  return `${cases.length} court cases (1 stay on ${stayed.linkedRef ?? "none"}), ${inward.length} inward and ${outward.length} outward letters, ${acm.ref} with ${actionRows.length} action points, ${acm2.ref} planned; ${r.sent} reminders sent`;
}
