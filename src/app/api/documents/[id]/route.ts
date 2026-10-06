import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { can } from "@/lib/roles";
import { getUser } from "@/lib/session";
import { getFile } from "@/lib/storage";

/** Every download is permission-checked and logged. Users never get a direct storage link. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, Number(id)) });
  if (!doc) return new Response("Not found", { status: 404 });
  const inst = doc.institutionId ? await db.query.institutions.findFirst({ where: eq(schema.institutions.id, doc.institutionId) }) : null;

  // A document belongs to an institution, to an onboarding request (before approval) or to a pharmacist.
  let allowed = false;
  if (doc.institutionId && inst) {
    if (user.kind === "institution") {
      allowed = user.institutionCode === inst.code && (can(user.roles, "inst.documents.view") || can(user.roles, "inst.app.view"));
    } else if (can(user.roles, "pcp.documents.view")) {
      allowed = true;
    } else if (user.roles.includes("pcp_inspector")) {
      const assigned = await db.query.inspections.findFirst({ where: and(eq(schema.inspections.institutionId, doc.institutionId), eq(schema.inspections.inspector, user.username)) });
      allowed = !!assigned;
    }
  } else if (doc.onboardingId) {
    const req = await db.query.onboardingRequests.findFirst({ where: eq(schema.onboardingRequests.id, doc.onboardingId) });
    allowed = req?.applicantUsername === user.username || can(user.roles, "pcp.onboarding.review");
  } else if (!doc.onboardingId && !doc.pharmacistId) {
    allowed = can(user.roles, "pcp.documents.view"); // PCP-level papers, e.g. council minutes
  } else if (doc.pharmacistId) {
    const ph = await db.query.pharmacists.findFirst({ where: eq(schema.pharmacists.id, doc.pharmacistId) });
    allowed = (!!ph?.username && ph.username === user.username) || can(user.roles, "pcp.pharmacists.manage");
  }
  if (!allowed) {
    await audit(db, { actor: user.username, action: "document.download.denied", entity: "document", entityId: doc.id });
    return new Response("You do not have access to this document", { status: 403 });
  }
  const bytes = await getFile(doc.storageKey);
  await audit(db, { actor: user.username, action: "document.downloaded", entity: "document", entityId: doc.id, details: { institution: inst?.code } });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `inline; filename="${doc.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
