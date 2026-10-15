import LitigationList from "@/components/LitigationList";
import { institutionOptions, linkableRefs, loadCourtCases } from "@/lib/governance-data";
import { can } from "@/lib/roles";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Court cases" };

/** Court case ledger (RFP section 6 week 3, Annexure-III item 4). The legal officer and the Secretary keep it. */
export default async function LitigationPage() {
  const user = await requirePermission("pcp.litigation.view");
  const canManage = can(user.roles, "pcp.litigation.manage");
  const data = await loadCourtCases();
  return <LitigationList data={data} canManage={canManage} options={canManage ? { institutions: await institutionOptions(), refs: (await linkableRefs()).filter((r) => r.kind !== "court") } : null} />;
}
