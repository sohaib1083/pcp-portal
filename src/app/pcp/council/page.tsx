import { redirect } from "next/navigation";
import CouncilMeetings from "@/components/CouncilMeetings";
import { loadMeetingsOverview } from "@/lib/council-data";
import { can } from "@/lib/roles";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The Secretary manages council meetings; other PCP desk roles can read them. */
export default async function CouncilPage() {
  const user = await requireUser("pcp");
  const canManage = can(user.roles, "pcp.council.manage");
  if (!canManage && !can(user.roles, "pcp.app.view")) redirect("/home?denied=pcp.council.manage");
  return <CouncilMeetings data={await loadMeetingsOverview()} canManage={canManage} />;
}
