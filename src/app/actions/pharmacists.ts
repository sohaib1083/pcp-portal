"use server";
// Pharmacist register (guide section 9): status decisions, practice verification, provincial imports, logins.
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { createUser, findUser } from "@/lib/keycloak-admin";
import { sendEmail, sendSms } from "@/lib/messages";
import { requireOtp } from "@/lib/otp";
import { checkImportFile, sampleImportFile, type ImportReport } from "@/lib/pharmacist-import";
import { COUNCIL_INFO, STATUSES, STATUS_LABELS, isCouncil, type Council } from "@/lib/register";
import { requirePermission } from "@/lib/session";
import { notify } from "@/lib/util";
import type { ActionResult } from "./faculty";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const councilName = (c: string) => (isCouncil(c) ? COUNCIL_INFO[c].name : c);

function refresh(id?: number) {
  revalidatePath("/pcp/pharmacists");
  if (id) revalidatePath(`/pcp/pharmacists/${id}`);
  revalidatePath("/pharmacist");
}

/** Plain words for the pharmacist and the council, matching the public check. */
function statusSentence(status: string, council: string) {
  if (status === "ACTIVE") return "Your registration is active again.";
  if (status === "DORMANT") return `Your registration is now dormant. You may not practise until it is renewed with the ${councilName(council)}.`;
  if (status === "SUSPENDED") return "Your registration is suspended. You may not practise while the suspension lasts.";
  return "Your registration is cancelled. You may not practise as a pharmacist.";
}

/** Record a council's decision on a registration. Needs a reason and a one-time code; audited and notified. */
export async function changePharmacistStatus(id: number, status: string, reason: string, otp: string): Promise<ActionResult> {
  const user = await requirePermission("pcp.pharmacists.manage");
  const p = await db.query.pharmacists.findFirst({ where: eq(schema.pharmacists.id, id) });
  if (!p) return { ok: false, level: "error", message: "This register entry no longer exists. Reload the register." };
  if (!(STATUSES as readonly string[]).includes(status)) return { ok: false, level: "error", message: "Choose Active, Dormant, Suspended or Cancelled." };
  if (p.status === status) return { ok: false, level: "warning", message: `${p.regNo} is already ${STATUS_LABELS[status].toLowerCase()}.` };
  const why = reason.trim();
  if (why.length < 10) return { ok: false, level: "error", message: "Give the reason in at least 10 characters, for example the council's letter number and date." };
  try {
    await requireOtp(user.username, `pharmacist-status:${p.regNo}`, otp);
  } catch (e) {
    return { ok: false, level: "error", message: (e as Error).message };
  }
  await db.transaction(async (tx) => {
    await tx.update(schema.pharmacists).set({ status, updatedAt: new Date() }).where(eq(schema.pharmacists.id, id));
    await tx.insert(schema.pharmacistEvents).values({ pharmacistId: id, kind: "STATUS", fromStatus: p.status, toStatus: status, note: why, actor: user.username });
    await audit(tx, { actor: user.username, action: "pharmacist.status.changed", entity: "pharmacist", entityId: p.regNo, details: { from: p.status, to: status, reason: why } });
    const title = `Registration ${STATUS_LABELS[status].toLowerCase()}: ${p.regNo}`;
    const body = `${statusSentence(status, p.council)} Reason recorded by PCP: ${why}`;
    if (p.username) await notify(tx, `user:${p.username}`, title, body, "/pharmacist");
    else if (p.email) await sendEmail(tx, { to: p.email, toName: p.fullName, subject: title, body, entity: "pharmacist", entityRef: p.regNo });
    if (p.mobile) await sendSms(tx, { to: p.mobile, toName: p.fullName, body: `PCP: registration ${p.regNo} is now ${STATUS_LABELS[status].toLowerCase()}. Check /verify?reg=${p.regNo}`, entity: "pharmacist", entityRef: p.regNo });
    if (isCouncil(p.council))
      await sendEmail(tx, {
        to: COUNCIL_INFO[p.council].registrar,
        toName: `Registrar, ${COUNCIL_INFO[p.council].name}`,
        subject: `PCP index updated: ${p.regNo} ${STATUS_LABELS[p.status]} to ${STATUS_LABELS[status]}`,
        body: `PCP's index of your register now shows ${p.fullName} (${p.regNo}) as ${STATUS_LABELS[status]}. Reason recorded: ${why}. If this does not match your register, reply to correct it.`,
        entity: "pharmacist",
        entityRef: p.regNo,
      });
  });
  refresh(id);
  return { ok: true, level: "success", message: `${p.regNo} is now ${STATUS_LABELS[status].toLowerCase()}. The public check shows it at once, and the pharmacist and the council were told.` };
}

/** Verify or reject a pharmacist's practice update. A rejection needs a reason the pharmacist can act on. */
export async function reviewPracticeUpdate(updateId: number, decision: "VERIFIED" | "REJECTED", note: string, otp: string): Promise<ActionResult> {
  const user = await requirePermission("pcp.pharmacists.manage");
  const u = await db.query.practiceUpdates.findFirst({ where: eq(schema.practiceUpdates.id, updateId) });
  if (!u || u.status !== "PENDING") return { ok: false, level: "warning", message: "This update was already decided or replaced by a newer one. Reload the queue." };
  const p = await db.query.pharmacists.findFirst({ where: eq(schema.pharmacists.id, u.pharmacistId) });
  if (!p) return { ok: false, level: "error", message: "The register entry for this update no longer exists." };
  const why = note.trim();
  if (decision === "REJECTED" && why.length < 10) return { ok: false, level: "error", message: "Tell the pharmacist what is wrong and what to upload instead (at least 10 characters)." };
  try {
    await requireOtp(user.username, `practice-update:${u.id}`, otp);
  } catch (e) {
    return { ok: false, level: "error", message: (e as Error).message };
  }
  const decided = await db.transaction(async (tx) => {
    const now = new Date();
    // Only a still-pending update can be decided: a second officer or a newer update may have got there first.
    const [row] = await tx
      .update(schema.practiceUpdates)
      .set({ status: decision, reviewedBy: user.username, reviewedAt: now, reviewNote: why || null })
      .where(and(eq(schema.practiceUpdates.id, u.id), eq(schema.practiceUpdates.status, "PENDING")))
      .returning({ id: schema.practiceUpdates.id });
    if (!row) return false;
    if (u.evidenceDocumentId) await tx.update(schema.documents).set({ verificationStatus: decision === "VERIFIED" ? "VERIFIED" : "REJECTED" }).where(eq(schema.documents.id, u.evidenceDocumentId));
    if (decision === "VERIFIED")
      await tx.update(schema.pharmacists).set({ practicePlace: u.practicePlace, designation: u.designation, practiceConfirmed: true, practiceConfirmedAt: now, updatedAt: now }).where(eq(schema.pharmacists.id, p.id));
    await tx.insert(schema.pharmacistEvents).values({
      pharmacistId: p.id,
      kind: "PRACTICE",
      note: decision === "VERIFIED" ? `Practice details verified: ${u.designation}, ${u.practicePlace}.` : `Practice update rejected: ${why}`,
      actor: user.username,
    });
    await audit(tx, { actor: user.username, action: decision === "VERIFIED" ? "pharmacist.practice.verified" : "pharmacist.practice.rejected", entity: "pharmacist", entityId: p.regNo, details: { updateId: u.id, practicePlace: u.practicePlace, designation: u.designation, note: why } });
    const title = decision === "VERIFIED" ? "Your practice details are verified" : "Your practice update was not accepted";
    const body = decision === "VERIFIED" ? `PCP verified ${u.designation}, ${u.practicePlace}. It now shows on your record and your registration card.` : `PCP could not verify ${u.practicePlace}. ${why}`;
    if (p.username) await notify(tx, `user:${p.username}`, title, body, "/pharmacist");
    else if (p.email) await sendEmail(tx, { to: p.email, toName: p.fullName, subject: title, body, entity: "pharmacist", entityRef: p.regNo });
    return true;
  });
  refresh(p.id);
  if (!decided) return { ok: false, level: "warning", message: "This update was already decided or replaced by a newer one. Reload the queue." };
  return decision === "VERIFIED"
    ? { ok: true, level: "success", message: `${p.fullName}'s practice place is confirmed: ${u.practicePlace}.` }
    : { ok: true, level: "success", message: `Update rejected. ${p.fullName} was told what to send instead.` };
}

// ---------- Import from a provincial council ----------

export async function checkImport(council: string, fileName: string, text: string): Promise<ImportReport | { ok: false; message: string }> {
  await requirePermission("pcp.pharmacists.manage");
  if (!isCouncil(council)) return { ok: false, message: "Choose the council that sent the file." };
  if (text.length > 900_000) return { ok: false, message: "The file is larger than 900 KB. Split it into smaller files." };
  return checkImportFile(council, fileName.slice(0, 120), text);
}

async function nextImportRef() {
  const year = new Date().getFullYear();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.pharmacistImports).where(sql`${schema.pharmacistImports.ref} like ${`IMP-${year}-%`}`);
  return `IMP-${year}-${String(n + 1).padStart(4, "0")}`;
}

/** Re-checks the file, then saves only the rows without errors. Rows with errors go back to the council. */
export async function runImport(council: string, fileName: string, text: string): Promise<ActionResult & { ref?: string; imported?: number }> {
  const user = await requirePermission("pcp.pharmacists.manage");
  if (!isCouncil(council)) return { ok: false, level: "error", message: "Choose the council that sent the file." };
  const report = await checkImportFile(council, fileName.slice(0, 120), text);
  if (!report.ok) return { ok: false, level: "error", message: report.message ?? "The file could not be read." };
  const good = report.rows.filter((r) => r.data);
  if (!good.length) return { ok: false, level: "error", message: "No row is ready to import. Fix the errors in the file and check it again." };
  const ref = await nextImportRef();
  const errors = report.rows.filter((r) => r.errors.length).map((r) => ({ row: r.row, regNo: r.regNo, errors: r.errors }));
  try {
    await db.transaction(async (tx) => {
      const [imp] = await tx.insert(schema.pharmacistImports).values({ ref, council, fileName: report.fileName, totalRows: report.total, importedRows: good.length, errorRows: errors.length, errors, importedBy: user.username }).returning();
      const inserted = await tx
        .insert(schema.pharmacists)
        .values(good.map((r) => ({ ...r.data!, importId: imp.id })))
        .returning({ id: schema.pharmacists.id, regNo: schema.pharmacists.regNo, status: schema.pharmacists.status });
      await tx.insert(schema.pharmacistEvents).values(inserted.map((p) => ({ pharmacistId: p.id, kind: "IMPORTED", toStatus: p.status, note: `Loaded from the ${COUNCIL_INFO[council as Council].name} file ${report.fileName} (${ref}).`, actor: user.username })));
      await audit(tx, { actor: user.username, action: "pharmacist.import.completed", entity: "pharmacist_import", entityId: ref, details: { council, fileName: report.fileName, total: report.total, imported: inserted.length, errors: errors.length, regNos: inserted.map((p) => p.regNo).slice(0, 200) } });
      const errorLines = errors.slice(0, 20).map((e) => `Row ${e.row} (${e.regNo}): ${e.errors.join("; ")}`);
      await sendEmail(tx, {
        to: COUNCIL_INFO[council as Council].registrar,
        toName: `Registrar, ${COUNCIL_INFO[council as Council].name}`,
        subject: `${ref}: ${inserted.length} of ${report.total} rows added to PCP's index`,
        body: errors.length
          ? `PCP added ${inserted.length} rows from ${report.fileName}. ${errors.length} rows were not added:\n${errorLines.join("\n")}${errors.length > 20 ? `\n... and ${errors.length - 20} more` : ""}\nPlease correct them and send them again.`
          : `PCP added all ${inserted.length} rows from ${report.fileName}. Thank you.`,
        entity: "pharmacist_import",
        entityRef: ref,
      });
      await notify(tx, "role:pcp_registration", `${ref}: ${COUNCIL_INFO[council as Council].name} file imported`, `${plural(inserted.length, "pharmacist")} added, ${plural(errors.length, "row")} returned to the council.`, "/pcp/pharmacists?tab=imports");
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (/duplicate key/.test(msg)) return { ok: false, level: "error", message: "Another import added some of these numbers a moment ago. Check the file again." };
    throw e;
  }
  refresh();
  return {
    ok: true,
    level: errors.length ? "warning" : "success",
    ref,
    imported: good.length,
    message: errors.length
      ? `${ref}: ${plural(good.length, "pharmacist")} added. ${plural(errors.length, "row")} with errors ${errors.length === 1 ? "was" : "were"} left out and sent back to the council.`
      : `${ref}: all ${plural(good.length, "pharmacist")} added.`,
  };
}

export async function sampleImport(council: string): Promise<{ ok: boolean; message?: string; fileName?: string; csv?: string }> {
  await requirePermission("pcp.pharmacists.manage");
  if (!isCouncil(council)) return { ok: false, message: "Choose the council first." };
  return { ok: true, ...(await sampleImportFile(council)) };
}

// ---------- Logins ----------

/** Creates a Keycloak login with the pharmacist role. The temporary password is returned once and never stored. */
export async function createPharmacistLogin(id: number): Promise<ActionResult & { username?: string; password?: string }> {
  const user = await requirePermission("pcp.pharmacists.manage");
  const p = await db.query.pharmacists.findFirst({ where: eq(schema.pharmacists.id, id) });
  if (!p) return { ok: false, level: "error", message: "This register entry no longer exists." };
  if (p.username) return { ok: false, level: "warning", message: `${p.fullName} already signs in as ${p.username}.` };
  if (p.status === "CANCELLED") return { ok: false, level: "error", message: "A cancelled registration cannot get a login." };
  const first = p.fullName.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "") || "pharmacist";
  const tail = p.regNo.replace(/\D/g, "").slice(-4);
  let username = "";
  for (const suffix of ["", "a", "b", "c", "d", "e", "f"]) {
    const candidate = `ph.${first}.${tail}${suffix}`;
    const local = await db.query.staff.findFirst({ where: eq(schema.staff.username, candidate) });
    if (local) continue;
    try {
      if (await findUser(candidate)) continue;
    } catch (e) {
      return { ok: false, level: "error", message: `Keycloak could not be reached, so no login was created. ${(e as Error).message}` };
    }
    username = candidate;
    break;
  }
  if (!username) return { ok: false, level: "error", message: "Could not find a free username. Try again." };
  const email = `${username}@demo.pcp.local`;
  let password: string;
  try {
    ({ password } = await createUser({ username, email, fullName: p.fullName, role: "pharmacist" }));
  } catch (e) {
    return { ok: false, level: "error", message: `Keycloak did not create the login: ${(e as Error).message}` };
  }
  await db.transaction(async (tx) => {
    await tx.insert(schema.staff).values({ username, displayName: p.fullName, email, role: "pharmacist", createdBy: user.username });
    await tx.update(schema.pharmacists).set({ username, updatedAt: new Date() }).where(and(eq(schema.pharmacists.id, p.id)));
    await tx.insert(schema.pharmacistEvents).values({ pharmacistId: p.id, kind: "LOGIN", note: `Portal login ${username} created. Temporary password handed over; it must be changed at first sign-in.`, actor: user.username });
    await audit(tx, { actor: user.username, action: "pharmacist.login.created", entity: "pharmacist", entityId: p.regNo, details: { username } });
    if (p.email) await sendEmail(tx, { to: p.email, toName: p.fullName, subject: "Your PCP portal login", body: `A login was created for you: ${username}. PCP will give you a temporary password; you will set your own at first sign-in. You can then see your registration and update your practice place.`, entity: "pharmacist", entityRef: p.regNo });
    if (p.mobile) await sendSms(tx, { to: p.mobile, toName: p.fullName, body: `PCP: your portal username is ${username}. Your temporary password comes from the registration officer.`, entity: "pharmacist", entityRef: p.regNo });
  });
  refresh(p.id);
  return { ok: true, level: "success", username, password, message: `Login ${username} created for ${p.fullName}.` };
}
