import AppealsList from "@/components/AppealsList";
import { loadAppeals } from "@/lib/council-data";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PcpAppealsPage() {
  await requirePermission("pcp.appeals.review");
  return <AppealsList side="pcp" rows={await loadAppeals()} />;
}
