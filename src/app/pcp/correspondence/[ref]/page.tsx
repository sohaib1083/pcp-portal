import { notFound } from "next/navigation";
import LetterView from "@/components/LetterView";
import { pcpStaff } from "@/lib/governance";
import { loadLetter } from "@/lib/governance-data";
import { can } from "@/lib/roles";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LetterPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const user = await requirePermission("pcp.correspondence.view");
  const d = await loadLetter(ref);
  if (!d) notFound();
  const canManage = can(user.roles, "pcp.correspondence.manage");
  return <LetterView d={d} canManage={canManage} isMine={d.l.markedTo === user.username} staff={canManage ? await pcpStaff() : []} />;
}
