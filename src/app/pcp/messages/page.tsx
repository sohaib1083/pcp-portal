import { desc } from "drizzle-orm";
import MessagesView from "@/components/MessagesView";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Messages" };

export default async function PcpMessages() {
  await requireUser("pcp");
  const rows = await db.select().from(schema.messages).orderBy(desc(schema.messages.id)).limit(500);
  return <MessagesView scope="This list shows the latest 500 messages across PCP." rows={rows.map((m) => ({ id: m.id, channel: m.channel, toAddress: m.toAddress, toName: m.toName, subject: m.subject, body: m.body, entityRef: m.entityRef, createdAt: m.createdAt.toISOString() }))} />;
}
