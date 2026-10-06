import { desc, eq } from "drizzle-orm";
import MessagesView from "@/components/MessagesView";
import { db, schema } from "@/db";
import { requireInstitution } from "@/lib/session";

export const metadata = { title: "Messages" };

export default async function InstitutionMessages() {
  const { inst } = await requireInstitution();
  const rows = await db.select().from(schema.messages).where(eq(schema.messages.institutionId, inst.id)).orderBy(desc(schema.messages.id)).limit(500);
  return <MessagesView scope={`Messages to ${inst.name}'s users.`} rows={rows.map((m) => ({ id: m.id, channel: m.channel, toAddress: m.toAddress, toName: m.toName, subject: m.subject, body: m.body, entityRef: m.entityRef, createdAt: m.createdAt.toISOString() }))} />;
}
