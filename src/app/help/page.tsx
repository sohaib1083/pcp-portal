import { asc } from "drizzle-orm";
import HelpPublic from "@/components/HelpPublic";
import { db, schema } from "@/db";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata = { title: "Help desk · PCP Digital Portal" };

/** Public help desk: anyone can ask a question or make a complaint, without signing in. */
export default async function HelpPage() {
  const user = await getUser();
  const institutions = await db.select({ id: schema.institutions.id, name: schema.institutions.name, city: schema.institutions.city }).from(schema.institutions).orderBy(asc(schema.institutions.name));
  return <HelpPublic institutions={institutions} signedIn={!!user} />;
}
