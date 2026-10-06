import HelpDeskQueue from "@/components/HelpDeskQueue";
import { loadTickets } from "@/lib/council-data";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PcpHelpdeskPage() {
  const user = await requirePermission("pcp.helpdesk");
  return <HelpDeskQueue rows={await loadTickets()} me={user.username} />;
}
