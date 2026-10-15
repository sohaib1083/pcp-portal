import { notFound } from "next/navigation";
import LitigationView from "@/components/LitigationView";
import { loadCourtCase } from "@/lib/governance-data";
import { can } from "@/lib/roles";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CourtCasePage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const user = await requirePermission("pcp.litigation.view");
  const d = await loadCourtCase(ref);
  if (!d) notFound();
  return <LitigationView d={d} canManage={can(user.roles, "pcp.litigation.manage")} />;
}
