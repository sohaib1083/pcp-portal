import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { fileDocument } from "@/lib/letters";
import { COUNCIL_INFO, STATUS_LABELS, isCouncil } from "@/lib/register";
import { getUser } from "@/lib/session";
import { notify } from "@/lib/util";

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

/**
 * A pharmacist reports a new practice place and designation, with evidence (guide section 2: "registered
 * pharmacists see and update their own practice details, subject to verification"). It waits for PCP.
 * A file upload, so a route handler rather than a server action (server actions accept 1 MB).
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user || !user.roles.includes("pharmacist")) return NextResponse.json({ ok: false, message: "Sign in as a registered pharmacist." }, { status: 403 });
  const p = await db.query.pharmacists.findFirst({ where: eq(schema.pharmacists.username, user.username) });
  if (!p) return NextResponse.json({ ok: false, message: "No registration is linked to this account. Contact PCP's registration officer." }, { status: 404 });
  if (p.status !== "ACTIVE") {
    const council = isCouncil(p.council) ? COUNCIL_INFO[p.council].name : p.council;
    return NextResponse.json({ ok: false, message: `Your registration is ${STATUS_LABELS[p.status]?.toLowerCase() ?? p.status}, so PCP cannot record a practice place. Contact the ${council} first.` }, { status: 400 });
  }

  const form = await req.formData();
  const practicePlace = String(form.get("practicePlace") ?? "").trim().replace(/\s+/g, " ");
  const designation = String(form.get("designation") ?? "").trim().replace(/\s+/g, " ");
  const file = form.get("evidence");
  if (practicePlace.length < 5 || practicePlace.length > 160) return NextResponse.json({ ok: false, message: "Write the practice place with its city, e.g. Clifton Community Pharmacy, Karachi (5 to 160 characters)." }, { status: 400 });
  if (designation.length < 3 || designation.length > 80) return NextResponse.json({ ok: false, message: "Choose or type your designation." }, { status: 400 });
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ ok: false, message: "Attach evidence: an appointment letter, or the drug sale licence that names you." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, message: "The evidence file is larger than 5 MB. Upload a smaller scan or photo." }, { status: 400 });
  if (!TYPES[file.type]) return NextResponse.json({ ok: false, message: "Upload the evidence as a PDF, JPG or PNG file." }, { status: 400 });
  if (practicePlace === p.practicePlace && designation === p.designation && p.practiceConfirmed)
    return NextResponse.json({ ok: false, message: "These are already your confirmed practice details. Nothing to change." }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const result = await db.transaction(async (tx) => {
    const replaced = await tx
      .update(schema.practiceUpdates)
      .set({ status: "WITHDRAWN", reviewNote: "Replaced by a newer update from the pharmacist.", reviewedAt: new Date(), reviewedBy: user.username })
      .where(and(eq(schema.practiceUpdates.pharmacistId, p.id), eq(schema.practiceUpdates.status, "PENDING")))
      .returning({ id: schema.practiceUpdates.id });
    const doc = await fileDocument(tx, { pharmacistId: p.id, folder: "practice-updates", docType: "Practice evidence", fileName: file.name || `evidence.${TYPES[file.type]}`, bytes, mimeType: file.type, uploadedBy: user.username, verificationStatus: "PENDING" });
    const [u] = await tx.insert(schema.practiceUpdates).values({ pharmacistId: p.id, practicePlace, designation, evidenceDocumentId: doc.id, status: "PENDING" }).returning();
    await tx.insert(schema.pharmacistEvents).values({ pharmacistId: p.id, kind: "PRACTICE", note: `Practice update sent for verification: ${designation}, ${practicePlace}.`, actor: user.username });
    await audit(tx, { actor: user.username, action: "pharmacist.practice.submitted", entity: "pharmacist", entityId: p.regNo, details: { updateId: u.id, practicePlace, designation, evidenceDocumentId: doc.id, sha256: doc.sha256, replaced: replaced.map((r) => r.id) } });
    for (const role of ["role:pcp_registration", "role:pcp_officer"])
      await notify(tx, role, `Practice update waiting: ${p.fullName}`, `${p.regNo} reported ${designation}, ${practicePlace}, with evidence. Verify or reject it.`, "/pcp/pharmacists?tab=updates");
    return { replaced: replaced.length };
  });
  revalidatePath("/pharmacist");
  revalidatePath("/pcp/pharmacists");
  return NextResponse.json({
    ok: true,
    message: result.replaced ? "Sent to PCP for verification. It replaces the update you sent earlier." : "Sent to PCP for verification. You will get a message when it is decided.",
  });
}
