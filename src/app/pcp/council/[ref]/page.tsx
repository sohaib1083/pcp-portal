import { notFound, redirect } from "next/navigation";
import CouncilMeetingView from "@/components/CouncilMeetingView";
import { loadMeeting } from "@/lib/council-data";
import { agendaOptions, committeesWithNames, meetingActions } from "@/lib/governance-data";
import { can } from "@/lib/roles";
import { requireUser } from "@/lib/session";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function CouncilMeetingPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const user = await requireUser("pcp");
  const canManage = can(user.roles, "pcp.council.manage");
  if (!canManage && !can(user.roles, "pcp.app.view")) redirect("/home?denied=pcp.council.manage");
  const d = await loadMeeting(ref);
  if (!d) notFound();
  const m = await db.query.councilMeetings.findFirst({ where: eq(schema.councilMeetings.ref, ref), columns: { id: true } });
  const committee = (await committeesWithNames()).find((c) => c.name === d.meeting.committee) ?? null;
  return (
    <CouncilMeetingView
      d={d}
      canManage={canManage}
      canDecide={can(user.roles, "pcp.council.decide")}
      username={user.username}
      committee={committee ? { name: committee.name, chair: committee.chairName, members: committee.memberNames, remit: committee.remit } : null}
      actions={await meetingActions(m!.id)}
      options={canManage && d.meeting.status !== "CLOSED" ? await agendaOptions() : null}
    />
  );
}
