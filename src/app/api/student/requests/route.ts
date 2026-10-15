import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { fileDocument } from "@/lib/letters";
import { nextPeopleRef } from "@/lib/people";
import { STUDENT_REQUEST_KINDS, STUDENT_REQUEST_LABELS, type StudentRequestKind } from "@/lib/people-shared";
import { SHIFTS } from "@/lib/registry-shared";
import { getActiveUser } from "@/lib/session";
import { notify } from "@/lib/util";

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
const bad = (message: string, status = 400) => NextResponse.json({ ok: false, message }, { status });

/**
 * A student raises a request from their own login (RFP 4.1.2): correct my record (with evidence), an enrolment
 * verification letter, or an eligibility certificate for pharmacist registration. It goes to the institution's
 * examination officer first, then to PCP verification. A route handler because a correction carries a file.
 */
export async function POST(req: Request) {
  const user = await getActiveUser();
  if (!user || !user.roles.includes("student")) return bad("Sign in with your student login.", 403);
  const s = await db.query.students.findFirst({ where: eq(schema.students.username, user.username) });
  if (!s) return bad("No student record is linked to your login. Ask your institution's examination office to link it.", 404);
  const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, s.institutionId) });
  if (!inst) return bad("Your institution was not found.", 404);

  const form = await req.formData();
  const kind = String(form.get("kind") ?? "") as StudentRequestKind;
  if (!STUDENT_REQUEST_KINDS.includes(kind)) return bad("Choose what you need.");
  const reason = String(form.get("reason") ?? "").trim().slice(0, 600);
  const open = await db.query.studentRequests.findFirst({ where: and(eq(schema.studentRequests.studentId, s.id), eq(schema.studentRequests.kind, kind), inArray(schema.studentRequests.status, ["WITH_INSTITUTION", "WITH_PCP"])) });
  if (open) return bad(`Your request ${open.ref} (${STUDENT_REQUEST_LABELS[kind].toLowerCase()}) is still open. Follow it below; you can raise a new one once it is decided.`);

  const details: { changes?: Record<string, { from: string | null; to: string | null }>; purpose?: string } = {};
  let evidence: File | null = null;
  if (kind === "CORRECTION") {
    const changes: Record<string, { from: string | null; to: string | null }> = {};
    const fullName = String(form.get("fullName") ?? "").trim().replace(/\s+/g, " ");
    const fatherName = String(form.get("fatherName") ?? "").trim().replace(/\s+/g, " ");
    const shift = String(form.get("shift") ?? "").trim();
    if (fullName && fullName !== s.fullName) {
      if (fullName.length < 3 || fullName.length > 80) return bad("Write the full name as on your CNIC or B-Form (3 to 80 characters).");
      changes.fullName = { from: s.fullName, to: fullName };
    }
    if (fatherName && fatherName !== s.fatherName) {
      if (fatherName.length < 3 || fatherName.length > 80) return bad("Write your father's name as on your CNIC or B-Form (3 to 80 characters).");
      changes.fatherName = { from: s.fatherName, to: fatherName };
    }
    if (shift && shift !== s.shift) {
      if (!(SHIFTS as readonly string[]).includes(shift)) return bad("Choose the session from the list.");
      changes.shift = { from: s.shift, to: shift };
    }
    if (!Object.keys(changes).length) return bad("Nothing to correct: change at least one detail.");
    if (reason.length < 10) return bad("Say what is wrong and why (at least 10 characters).");
    const file = form.get("evidence");
    if (!(file instanceof File) || file.size === 0) return bad("Attach evidence: your CNIC or B-Form, or the admission letter.");
    if (file.size > MAX_BYTES) return bad("The evidence file is larger than 5 MB. Upload a smaller scan or photo.");
    if (!TYPES[file.type]) return bad("Upload the evidence as a PDF, JPG or PNG file.");
    details.changes = changes;
    evidence = file;
  } else if (kind === "ENROLMENT_LETTER") {
    if (s.status === "WITHDRAWN") return bad("Your record shows that you withdrew, so PCP cannot confirm enrolment. If this is wrong, ask for a correction first.");
    const purpose = String(form.get("purpose") ?? "").trim().replace(/\s+/g, " ");
    if (purpose.length < 3 || purpose.length > 120) return bad("Say what the letter is for, for example: Scholarship application (3 to 120 characters).");
    details.purpose = purpose;
  } else {
    if (s.status !== "GRADUATED") return bad("The eligibility certificate opens after you graduate. Your institution records your final result first.");
    const issued = await db.query.studentRequests.findFirst({ where: and(eq(schema.studentRequests.studentId, s.id), eq(schema.studentRequests.kind, "ELIGIBILITY"), eq(schema.studentRequests.status, "ISSUED")) });
    if (issued) return bad(`Your eligibility certificate ${issued.certificateNo} is already issued. Download or print it below.`);
  }

  const out = await db.transaction(async (tx) => {
    const ref = await nextPeopleRef(tx, "SRQ");
    let evidenceDocumentId: number | null = null;
    if (evidence) {
      const doc = await fileDocument(tx, { institutionId: inst.id, folder: `student-documents/requests/${ref}`, docType: "Student request evidence", fileName: evidence.name || `evidence.${TYPES[evidence.type]}`, bytes: Buffer.from(await evidence.arrayBuffer()), mimeType: evidence.type, uploadedBy: user.username, verificationStatus: "PENDING" });
      evidenceDocumentId = doc.id;
    }
    await tx.insert(schema.studentRequests).values({ ref, studentId: s.id, institutionId: inst.id, kind, details, reason: reason || null, evidenceDocumentId, requestedBy: user.username });
    await notify(tx, `inst:${inst.code}`, `Student request ${ref}: ${STUDENT_REQUEST_LABELS[kind].toLowerCase()}`, `${s.fullName} (${s.pcpId}) asks for: ${STUDENT_REQUEST_LABELS[kind].toLowerCase()}. The examination officer checks it and forwards it to PCP, or returns it.`, "/institution/students?tab=requests");
    await audit(tx, { actor: user.username, action: "student.request.raised", entity: "student", entityId: s.pcpId, details: { ref, kind, details, evidenceDocumentId } });
    return { ref };
  });
  revalidatePath("/student");
  revalidatePath("/institution/students");
  return NextResponse.json({ ok: true, ref: out.ref, message: `Request ${out.ref} sent to ${inst.shortCode}'s examination office. You can follow it below.` });
}
