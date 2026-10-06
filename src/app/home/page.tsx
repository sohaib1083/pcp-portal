import { redirect } from "next/navigation";
import { HOME_BY_KIND } from "@/lib/roles";
import { requireUser } from "@/lib/session";

export default async function HomeRedirect() {
  const user = await requireUser();
  if (user.roles.includes("pcp_inspector") && !user.roles.some((r) => r !== "pcp_inspector" && r.startsWith("pcp_"))) redirect("/pcp/inspections");
  if (user.kind !== "unknown") redirect(HOME_BY_KIND[user.kind]);
  return <p style={{ padding: 40 }}>Your account has no PCP, institution, student or pharmacist role. Ask an administrator.</p>;
}
