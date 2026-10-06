import { notFound, redirect } from "next/navigation";
import CouncilMeetingView from "@/components/CouncilMeetingView";
import { loadMeeting } from "@/lib/council-data";
import { can } from "@/lib/roles";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CouncilMeetingPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const user = await requireUser("pcp");
  const canManage = can(user.roles, "pcp.council.manage");
  if (!canManage && !can(user.roles, "pcp.app.view")) redirect("/home?denied=pcp.council.manage");
  const d = await loadMeeting(ref);
  if (!d) notFound();
  return <CouncilMeetingView d={d} canManage={canManage} canDecide={can(user.roles, "pcp.council.decide")} />;
}
