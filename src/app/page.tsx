import { eq, isNotNull, sql } from "drizzle-orm";
import PublicHome from "@/components/PublicHome";
import { db, schema } from "@/db";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getUser();
  const n = sql<number>`count(*)::int`;
  const [[inst], [programs], [faculty], [certs]] = await Promise.all([
    db.select({ n }).from(schema.institutions),
    db.select({ n }).from(schema.programs).where(eq(schema.programs.nocStatus, "APPROVED")),
    db.select({ n }).from(schema.facultyLinks).where(eq(schema.facultyLinks.status, "ACTIVE")),
    db.select({ n }).from(schema.applications).where(isNotNull(schema.applications.certificateNo)),
  ]);
  return <PublicHome signedIn={!!user} stats={{ institutions: inst.n, programs: programs.n, faculty: faculty.n, certificates: certs.n }} />;
}
