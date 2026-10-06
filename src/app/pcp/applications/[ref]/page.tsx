import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import PcpApplicationView from "@/components/PcpApplicationView";
import { db, schema } from "@/db";
import { loadApplication } from "@/lib/appdetail";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/roles";
import { redirect } from "next/navigation";

export default async function PcpApplicationPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const user = await requireUser("pcp");
  const d = await loadApplication(ref);
  if (!d || d.app.status === "DRAFT") notFound();
  // Inspectors see only applications they are assigned to inspect.
  if (!can(user.roles, "pcp.app.view")) {
    if (!d.inspections.some((i) => i.inspector === user.username)) redirect("/home");
  }
  const inspectors = await db.select().from(schema.staff).where(eq(schema.staff.role, "pcp_inspector"));
  return (
    <PcpApplicationView
      d={d}
      roles={user.roles}
      username={user.username}
      inspectors={inspectors.map((i) => ({ username: i.username, name: i.displayName, province: i.province ?? "" }))}
    />
  );
}
