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
  const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, doc.institutionId) });

  let allowed = false;
  if (user.kind === "institution") {
    allowed = user.institutionCode === inst?.code && (can(user.roles, "inst.documents.view") || can(user.roles, "inst.app.view"));
  } else if (can(user.roles, "pcp.documents.view")) {
    allowed = true;
  } else if (user.roles.includes("pcp_inspector")) {
    const assigned = await db.query.inspections.findFirst({ where: and(eq(schema.inspections.institutionId, doc.institutionId), eq(schema.inspections.inspector, user.username)) });
    allowed = !!assigned;
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
