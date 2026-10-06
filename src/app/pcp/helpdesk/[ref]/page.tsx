import { notFound } from "next/navigation";
import TicketView from "@/components/TicketView";
import { helpdeskStaff, loadTickets } from "@/lib/council-data";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PcpTicketPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const user = await requirePermission("pcp.helpdesk");
  const [t] = await loadTickets({ ref });
  if (!t) notFound();
  return <TicketView t={t} me={user.username} staff={await helpdeskStaff()} />;
}
