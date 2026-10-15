import CorrespondenceList from "@/components/CorrespondenceList";
import { correspondenceOptions, loadCorrespondence } from "@/lib/governance-data";
import { can } from "@/lib/roles";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Correspondence" };

/** Inward (diary) and outward (dispatch) registers of official letters (RFP 4.1.1). */
export default async function CorrespondencePage({ searchParams }: { searchParams: Promise<{ tab?: string; reply?: string }> }) {
  const user = await requirePermission("pcp.correspondence.view");
  const { tab, reply } = await searchParams;
  const canManage = can(user.roles, "pcp.correspondence.manage");
  return (
    <CorrespondenceList
      data={await loadCorrespondence(user.username)}
      canManage={canManage}
      username={user.username}
      options={canManage ? await correspondenceOptions() : null}
      initialTab={tab === "out" || tab === "mine" ? tab : "in"}
      replyTo={reply ?? null}
    />
  );
}
