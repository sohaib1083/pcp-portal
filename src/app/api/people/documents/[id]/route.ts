import { and, eq, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { officerCodeSatisfied } from "@/lib/officer-code";
import { facultyForUser } from "@/lib/people";
import { getActiveUser } from "@/lib/session";
import { getFile } from "@/lib/storage";

/**
 * A teacher's or a student's own papers: the evidence they sent and the certificates PCP issued to them.
 * Permission-checked and logged like every other download; anyone else gets 404.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const user = await getActiveUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  if (!Number.isInteger(id)) return new Response("Not found", { status: 404 });
  let allowed = false;
  if (user.roles.includes("student")) {
    const s = await db.query.students.findFirst({ where: eq(schema.students.username, user.username) });
    if (s)
      allowed = !!(await db.query.studentRequests.findFirst({
        where: and(eq(schema.studentRequests.studentId, s.id), or(eq(schema.studentRequests.certificateDocumentId, id), eq(schema.studentRequests.evidenceDocumentId, id))),
      }));
  } else if (user.roles.includes("faculty")) {
    const f = await facultyForUser(user.username);
    if (f) allowed = !!(await db.query.facultyRequests.findFirst({ where: and(eq(schema.facultyRequests.facultyId, f.id), eq(schema.facultyRequests.evidenceDocumentId, id)) }));
  } else if (user.roles.includes("provincial_council") && (await officerCodeSatisfied(user.roles))) {
    // A provincial officer opens the evidence of practice updates for registrations their own council issued.
    const staff = await db.query.staff.findFirst({ where: eq(schema.staff.username, user.username) });
    const [hit] = staff?.province
      ? await db
          .select({ id: schema.practiceUpdates.id })
          .from(schema.practiceUpdates)
          .innerJoin(schema.pharmacists, eq(schema.pharmacists.id, schema.practiceUpdates.pharmacistId))
          .where(and(eq(schema.practiceUpdates.evidenceDocumentId, id), eq(schema.pharmacists.council, staff.province)))
          .limit(1)
      : [];
    allowed = !!hit;
  }
  const doc = allowed ? await db.query.documents.findFirst({ where: eq(schema.documents.id, id) }) : null;
  if (!doc) {
    await audit(db, { actor: user.username, action: "document.download.denied", entity: "document", entityId: id });
    return new Response("Not found", { status: 404 });
  }
  const bytes = await getFile(doc.storageKey);
  await audit(db, { actor: user.username, action: "document.downloaded", entity: "document", entityId: doc.id, details: { own: true } });
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${doc.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
