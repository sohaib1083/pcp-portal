import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import CouncilMeetings from "@/components/CouncilMeetings";
import CouncilMembers from "@/components/CouncilMembers";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { loadMeetingsOverview } from "@/lib/council-data";
import { committeesWithNames, openActions } from "@/lib/governance-data";
import { loadRegister, seatedToday } from "@/lib/members";
import { can } from "@/lib/roles";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The Secretary manages council and committee meetings and the members register; other PCP desk roles can read them. */
export default async function CouncilPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser("pcp");
  const canManage = can(user.roles, "pcp.council.manage");
  if (!canManage && !can(user.roles, "pcp.app.view")) redirect("/home?denied=pcp.council.manage");
  const tab = (await searchParams).tab === "members" ? "members" : "meetings";
  // Chair and members come from the members register where it has seats; the ref.committees rule otherwise.
  const seated = await seatedToday();
  // (The Council's card names the Secretary who runs it, so its chair stays as the rule has it.)
  const committees = (await committeesWithNames()).map((c) =>
    seated[c.name]?.members.length ? { ...c, chairName: c.decides ? c.chairName : (seated[c.name].chair ?? c.chairName), memberNames: seated[c.name].members } : c,
  );
  let members: React.ReactNode = null;
  if (tab === "members") {
    // Contact details of members (many external) are personal data: in full for the Secretary and the Super Administrator only, and logged.
    const contactShown = canManage || can(user.roles, "pcp.users.manage");
    const data = await loadRegister({ showContact: contactShown });
    if (contactShown) {
      const recent = await db
        .select({ id: schema.auditLog.id })
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.action, "council.members.viewed"), eq(schema.auditLog.actor, user.username), gt(schema.auditLog.ts, new Date(Date.now() - 10 * 60 * 1000))))
        .limit(1);
      if (!recent.length) await audit(db, { actor: user.username, action: "council.members.viewed", entity: "council_member", entityId: "register", details: { members: data.members.length, contactShown } });
    }
    members = <CouncilMembers data={data} committees={committees.map((c) => c.name)} canManage={canManage} contactShown={contactShown} />;
  }
  return <CouncilMeetings tab={tab} members={members} data={await loadMeetingsOverview()} committees={committees} actions={await openActions()} canManage={canManage} />;
}
