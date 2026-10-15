import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { fileDocument } from "@/lib/letters";
import { facultyForUser, nextPeopleRef } from "@/lib/people";
import { notifyVerifiers } from "@/lib/registry";
import { QUALIFICATIONS, SPECIALIZATIONS } from "@/lib/registry-shared";
import { getActiveUser } from "@/lib/session";

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
const bad = (message: string, status = 400) => NextResponse.json({ ok: false, message }, { status });

/**
 * A teacher's qualification or academic profile update, with evidence (RFP 4.1.2). It goes to PCP's verification
 * desk as a request: nothing on the faculty record changes until PCP approves it. A file upload, so a route handler.
 * A newer update replaces one PCP has not decided yet.
 */
export async function POST(req: Request) {
  const user = await getActiveUser();
  if (!user || !user.roles.includes("faculty")) return bad("Sign in with your faculty login.", 403);
  const person = await facultyForUser(user.username);
  if (!person) return bad("Your login is not linked to a PCP Faculty ID yet. Ask PCP's verification desk to link it.", 404);
  if (person.verificationStatus === "REJECTED") return bad("PCP deactivated this record as a duplicate. Contact PCP's verification desk.");

  const form = await req.formData();
  const qualification = String(form.get("qualification") ?? "").trim();
  const specialization = String(form.get("specialization") ?? "").trim().replace(/\s+/g, " ");
  const pcpRegNo = String(form.get("pcpRegNo") ?? "").trim().toUpperCase();
  const awardingBody = String(form.get("awardingBody") ?? "").trim().replace(/\s+/g, " ");
  const awardYear = Number(form.get("awardYear"));
  const note = String(form.get("note") ?? "").trim().slice(0, 500);
  const file = form.get("evidence");

  if (!QUALIFICATIONS.includes(qualification)) return bad("Choose your highest qualification from the list.");
  if (specialization.length < 3 || specialization.length > 80) return bad("Write your specialization, for example Pharmacology (3 to 80 characters).");
  if (!SPECIALIZATIONS.includes(specialization) && !/^[A-Za-z .,&()-]+$/.test(specialization)) return bad("Write the specialization in letters only.");
  if (pcpRegNo && !/^[A-Z0-9-]{4,24}$/.test(pcpRegNo)) return bad("Write the registration number as it appears on your card, for example PC-50888.");
  if (awardingBody.length < 3 || awardingBody.length > 120) return bad("Name the university that awarded the qualification.");
  const year = new Date().getFullYear();
  if (!Number.isInteger(awardYear) || awardYear < 1970 || awardYear > year) return bad(`Give the year the qualification was awarded (1970 to ${year}).`);
  if (!(file instanceof File) || file.size === 0) return bad("Attach evidence: the degree or transcript, or the HEC attestation.");
  if (file.size > MAX_BYTES) return bad("The evidence file is larger than 5 MB. Upload a smaller scan or photo.");
  if (!TYPES[file.type]) return bad("Upload the evidence as a PDF, JPG or PNG file.");

  const changes: Record<string, { from: string | null; to: string | null }> = {};
  if (qualification !== person.qualification) changes.qualification = { from: person.qualification, to: qualification };
  if (specialization !== person.specialization) changes.specialization = { from: person.specialization, to: specialization };
  if ((pcpRegNo || null) !== (person.pcpRegNo ?? null) && pcpRegNo) changes.pcpRegNo = { from: person.pcpRegNo, to: pcpRegNo };
  if (!Object.keys(changes).length) return bad("Nothing changed: this is already your qualification on record. Change at least one detail.");

  const bytes = Buffer.from(await file.arrayBuffer());
  const out = await db.transaction(async (tx) => {
    const replaced = await tx
      .update(schema.facultyRequests)
      .set({ status: "WITHDRAWN", decidedBy: user.username, decidedAt: new Date(), decisionNote: "Replaced by a newer update from the teacher" })
      .where(and(eq(schema.facultyRequests.facultyId, person.id), eq(schema.facultyRequests.kind, "PROFILE"), eq(schema.facultyRequests.status, "PENDING")))
      .returning({ ref: schema.facultyRequests.ref });
    const ref = await nextPeopleRef(tx, "FUR");
    // Filed as a PCP-level paper under the person's Faculty ID: it belongs to the person, not to one institution.
    const doc = await fileDocument(tx, { folder: `faculty/${person.pcpId}/requests/${ref}`, docType: "Qualification evidence", fileName: file.name || `evidence.${TYPES[file.type]}`, bytes, mimeType: file.type, uploadedBy: user.username, verificationStatus: "PENDING" });
    await tx.insert(schema.facultyRequests).values({ ref, facultyId: person.id, kind: "PROFILE", details: { changes, awardingBody, awardYear }, note: note || null, evidenceDocumentId: doc.id, requestedBy: user.username });
    await notifyVerifiers(tx, `Qualification update ${ref}`, `${person.fullName} (${person.pcpId}) sent a qualification update with evidence: ${qualification} ${specialization}, ${awardingBody} ${awardYear}.`, "/pcp/verification?tab=faculty-requests");
    await audit(tx, { actor: user.username, action: "faculty.self.profile_submitted", entity: "faculty", entityId: person.pcpId, details: { ref, changes, awardingBody, awardYear, evidenceDocumentId: doc.id, sha256: doc.sha256, replaced: replaced.map((r) => r.ref) } });
    return { ref, replaced: replaced.length };
  });
  revalidatePath("/faculty");
  revalidatePath("/pcp/verification");
  return NextResponse.json({
    ok: true,
    ref: out.ref,
    message: `${out.ref} sent to PCP's verification desk. Your record stays as it is until PCP approves it.${out.replaced ? " It replaces the update you sent earlier." : ""}`,
  });
}
