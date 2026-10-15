// Seed data for the people module (RFP 4.1.2): faculty login link, teachers' requests, student requests,
// and a pharmacist practice update waiting for the Punjab Pharmacy Council. Runs after the other module seeds.
import { and, eq } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db, schema } from "../../src/db";
import { audit } from "../../src/lib/audit";
import { fileDocument } from "../../src/lib/letters";
import { studentCertificatePdf } from "../../src/lib/people";
import { notify } from "../../src/lib/util";

async function demoPdf(title: string, lines: string[]) {
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

const daysAgo = (d: number, h = 10) => {
  const t = new Date(Date.now() - d * 86400000);
  t.setUTCHours(h, 0, 0, 0);
  return t;
};
const YEAR = new Date().getFullYear();

export default async function seedPeople() {
  const notes: string[] = [];

  // ---------- Faculty: fac.noor is Dr. Noor Rabia Ahmed, PCP-FAC-000094 ----------
  const noor = await db.query.faculty.findFirst({ where: eq(schema.faculty.pcpId, "PCP-FAC-000094") });
  if (noor) {
    await db.insert(schema.facultyAccounts).values({ username: "fac.noor", facultyId: noor.id, createdBy: "pcp.verification", createdAt: daysAgo(40) });
    const evidence = await fileDocument(db, {
      folder: `faculty/${noor.pcpId}/requests/FUR-${YEAR}-0001`,
      docType: "Qualification evidence",
      fileName: "phd-degree-university-of-peshawar.pdf",
      bytes: await demoPdf("Degree of Doctor of Philosophy", [`University of Peshawar (demo)`, `${noor.fullName} is awarded the degree of PhD in ${noor.specialization}`, `Convocation ${YEAR}`, "Registrar (demo signature)"]),
      uploadedBy: "fac.noor",
      verificationStatus: "PENDING",
    });
    await db.insert(schema.facultyRequests).values([
      {
        ref: `FUR-${YEAR}-0001`,
        facultyId: noor.id,
        kind: "PROFILE",
        details: { changes: { qualification: { from: noor.qualification, to: "PhD" } }, awardingBody: "University of Peshawar", awardYear: YEAR },
        note: "PhD awarded at this year's convocation. Degree attached.",
        evidenceDocumentId: evidence.id,
        requestedBy: "fac.noor",
        createdAt: daysAgo(3),
      },
      {
        ref: `FUR-${YEAR}-0002`,
        facultyId: noor.id,
        kind: "VERIFICATION",
        note: "Please re-verify my record once the PhD is added, so it counts on Riverside's next renewal.",
        requestedBy: "fac.noor",
        createdAt: daysAgo(3, 11),
      },
    ]);
    await notify(db, "role:pcp_verification", `Qualification update FUR-${YEAR}-0001`, `${noor.fullName} (${noor.pcpId}) sent a qualification update with evidence.`, "/pcp/verification?tab=faculty-requests");
    await audit(db, { actor: "fac.noor", action: "faculty.self.profile_submitted", entity: "faculty", entityId: noor.pcpId, details: { ref: `FUR-${YEAR}-0001`, seeded: true } });
    notes.push("fac.noor linked to PCP-FAC-000094 with 2 requests pending");
  }

  // ---------- Students: three requests at different stages ----------
  const rbuStudent = await db.query.students.findFirst({ where: eq(schema.students.username, "student.rbu") });
  const ruhStudent = await db.query.students.findFirst({ where: eq(schema.students.username, "student.ruh") });
  let srq = 0;
  const ref = () => `SRQ-${YEAR}-${String(++srq).padStart(4, "0")}`;
  if (rbuStudent) {
    const inst = (await db.query.institutions.findFirst({ where: eq(schema.institutions.id, rbuStudent.institutionId) }))!;
    // 1. Issued: an enrolment verification letter with its QR code.
    const no = `SC-${YEAR}-000001`;
    const issuedAt = daysAgo(12, 12);
    const pdf = await studentCertificatePdf({ kind: "ENROLMENT_LETTER", no, student: rbuStudent, inst, purpose: "Scholarship application (Punjab Educational Endowment Fund)", signedBy: { name: "Kashif Iqbal", title: "Verification officer, Pharmacy Council of Pakistan" }, issuedAt });
    const doc = await fileDocument(db, { institutionId: inst.id, folder: `student-documents/certificates/${rbuStudent.pcpId}`, docType: "Enrolment verification letter", fileName: `${no}.pdf`, bytes: pdf, uploadedBy: "pcp.verification", verificationStatus: "VERIFIED" });
    await db.insert(schema.studentRequests).values({
      ref: ref(),
      studentId: rbuStudent.id,
      institutionId: inst.id,
      kind: "ENROLMENT_LETTER",
      details: { purpose: "Scholarship application (Punjab Educational Endowment Fund)" },
      status: "ISSUED",
      requestedBy: "student.rbu",
      institutionBy: "rbu.poc",
      institutionAt: daysAgo(14, 15),
      institutionNote: "Enrolled in year 4, morning session, fees clear.",
      pcpBy: "pcp.verification",
      pcpAt: issuedAt,
      certificateNo: no,
      certificateDocumentId: doc.id,
      createdAt: daysAgo(16),
      updatedAt: issuedAt,
    });
    // 2. With the institution: a correction the examination office has not checked yet.
    const ev = await fileDocument(db, { institutionId: inst.id, folder: `student-documents/requests/SRQ-${YEAR}-0002`, docType: "Student request evidence", fileName: "admission-letter.pdf", bytes: await demoPdf("Admission letter", [`${inst.name} (demo)`, `${rbuStudent.fullName}, admitted ${rbuStudent.enrollmentYear}, Morning session`, "Admissions office (demo signature)"]), uploadedBy: "student.rbu", verificationStatus: "PENDING" });
    await db.insert(schema.studentRequests).values({
      ref: ref(),
      studentId: rbuStudent.id,
      institutionId: inst.id,
      kind: "CORRECTION",
      details: { changes: { shift: { from: rbuStudent.shift, to: rbuStudent.shift === "Morning" ? "Evening" : "Morning" } } },
      reason: "I moved to the other session in year 2; my admission and transfer letters are attached.",
      evidenceDocumentId: ev.id,
      requestedBy: "student.rbu",
      createdAt: daysAgo(2),
      updatedAt: daysAgo(2),
    });
    await notify(db, `inst:${inst.code}`, `Student request SRQ-${YEAR}-0002: correct my record`, `${rbuStudent.fullName} (${rbuStudent.pcpId}) asks for a correction of the session.`, "/institution/students?tab=requests");
  }
  if (ruhStudent) {
    const inst = (await db.query.institutions.findFirst({ where: eq(schema.institutions.id, ruhStudent.institutionId) }))!;
    // 3. With PCP: the examination officer checked a spelling correction and forwarded it.
    const r = ref();
    const ev = await fileDocument(db, { institutionId: inst.id, folder: `student-documents/requests/${r}`, docType: "Student request evidence", fileName: "cnic-copy.pdf", bytes: await demoPdf("CNIC copy", [`Name: ${ruhStudent.fullName}`, "Father: Noor Ahmad", "Copy for the demo; no real identity data"]), uploadedBy: "student.ruh", verificationStatus: "PENDING" });
    await db.insert(schema.studentRequests).values({
      ref: r,
      studentId: ruhStudent.id,
      institutionId: inst.id,
      kind: "CORRECTION",
      details: { changes: { fatherName: { from: ruhStudent.fatherName, to: "Noor Ahmad" } } },
      reason: "My father's name is spelt Ahmad on my CNIC, not Ahmed.",
      evidenceDocumentId: ev.id,
      status: "WITH_PCP",
      requestedBy: "student.ruh",
      institutionBy: "ruh.exam",
      institutionAt: daysAgo(1, 9),
      institutionNote: "Checked against the admission file: the CNIC spelling is Ahmad.",
      createdAt: daysAgo(4),
      updatedAt: daysAgo(1, 9),
    });
    await notify(db, "role:pcp_verification", `Student request ${r}`, `RUH forwarded ${ruhStudent.fullName}'s correction request.`, "/pcp/verification?tab=student-requests");
  }
  notes.push(`${srq} student requests (issued, with the institution, with PCP)`);

  // ---------- A Punjab pharmacist's practice update waiting for the Punjab Pharmacy Council ----------
  const punjab = await db.query.pharmacists.findFirst({ where: and(eq(schema.pharmacists.council, "Punjab"), eq(schema.pharmacists.regNo, "PPC-A-036766")) });
  const ph =
    punjab && punjab.status === "ACTIVE"
      ? punjab
      : (await db.select().from(schema.pharmacists).where(and(eq(schema.pharmacists.council, "Punjab"), eq(schema.pharmacists.status, "ACTIVE"), eq(schema.pharmacists.practiceConfirmed, false))).limit(5)).find((x) => !x.username);
  if (ph) {
    const sentAt = daysAgo(1, 8);
    const evidence = await fileDocument(db, {
      pharmacistId: ph.id,
      folder: "practice-updates",
      docType: "Practice evidence",
      fileName: "appointment-letter-mayo-hospital-pharmacy.pdf",
      bytes: await demoPdf("Appointment letter", ["Mayo Hospital Pharmacy, Lahore (demo)", `${ph.fullName} (${ph.regNo}) is appointed Hospital Pharmacist`, "with effect from 1 October.", "Medical Superintendent (demo signature)"]),
      uploadedBy: ph.username ?? ph.regNo,
      verificationStatus: "PENDING",
    });
    await db.update(schema.documents).set({ uploadedAt: sentAt }).where(eq(schema.documents.id, evidence.id));
    await db.insert(schema.practiceUpdates).values({ pharmacistId: ph.id, practicePlace: "Mayo Hospital Pharmacy, Lahore", designation: "Hospital Pharmacist", evidenceDocumentId: evidence.id, status: "WITH_COUNCIL", submittedAt: sentAt });
    await db.insert(schema.pharmacistEvents).values({ pharmacistId: ph.id, kind: "PRACTICE", note: "Practice update sent for verification (the Punjab Pharmacy Council validates it first): Hospital Pharmacist, Mayo Hospital Pharmacy, Lahore.", actor: ph.username ?? ph.regNo, createdAt: sentAt });
    await notify(db, "user:punjab.council", `Practice update to validate: ${ph.fullName}`, `${ph.regNo} reported Hospital Pharmacist, Mayo Hospital Pharmacy, Lahore, with evidence. Validate it for PCP, or return it.`, "/province/pharmacists?tab=validation");
    notes.push(`practice update of ${ph.regNo} waiting for the Punjab Pharmacy Council`);
  }
  return notes.join("; ");
}
