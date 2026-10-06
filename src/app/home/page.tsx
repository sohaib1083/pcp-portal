import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";

export default async function HomeRedirect() {
  const user = await requireUser();
  if (user.kind === "institution") redirect("/institution");
  if (user.roles.includes("pcp_inspector")) redirect("/pcp/inspections");
  if (user.kind === "pcp") redirect("/pcp");
  return <p style={{ padding: 40 }}>Your account has no PCP or institution role. Ask an administrator.</p>;
}
