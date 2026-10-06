import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { ensureCard } from "@/lib/pharmacist-card";
import { can } from "@/lib/roles";
import { getUser } from "@/lib/session";
import { getFile } from "@/lib/storage";

/**
 * The registration card PDF. A pharmacist gets their own card; the registration officer can fetch anyone's with ?id=.
 * ?download=1 saves the file; otherwise it opens in the browser (better on phones). Every download is audited.
 */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id") ?? "");
  let p: typeof schema.pharmacists.$inferSelect | undefined;
  if (id) {
    if (!can(user.roles, "pcp.pharmacists.manage")) return new Response("Only the registration officer can issue another person's card", { status: 403 });
    p = await db.query.pharmacists.findFirst({ where: eq(schema.pharmacists.id, id) });
  } else {
    if (!user.roles.includes("pharmacist")) return new Response("No registration is linked to this account", { status: 403 });
    p = await db.query.pharmacists.findFirst({ where: eq(schema.pharmacists.username, user.username) });
  }
  if (!p) return new Response("Registration not found", { status: 404 });

  const { doc } = await db.transaction((tx) => ensureCard(tx, p, user.username));
  const bytes = await getFile(doc.storageKey);
  await audit(db, { actor: user.username, action: "pharmacist.card.downloaded", entity: "pharmacist", entityId: p.regNo, details: { documentId: doc.id, version: doc.version } });
  const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="registration-card-${p.regNo}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Document-Version": String(doc.version),
    },
  });
}
