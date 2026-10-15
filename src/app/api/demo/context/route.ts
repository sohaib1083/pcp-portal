import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { quickLoginEnabled } from "@/lib/demo";
import { getActiveUser } from "@/lib/session";

/** Demo build only: tells the presenter guide who is signed in and which application the story created. */
export async function GET() {
  if (!quickLoginEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const user = await getActiveUser();
  const ruh = await db.query.institutions.findFirst({ where: eq(schema.institutions.code, "PCP-UNI-000101") });
  const app = ruh
    ? await db.query.applications.findFirst({
        where: and(eq(schema.applications.institutionId, ruh.id), eq(schema.applications.kind, "NOC"), eq(schema.applications.programType, "TECH")),
        orderBy: desc(schema.applications.id),
      })
    : null;
  return NextResponse.json(
    { user: user ? { username: user.username, name: user.name } : null, ref: app?.ref ?? null, status: app?.status ?? null, cert: app?.certificateNo ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
