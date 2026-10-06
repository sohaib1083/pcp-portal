import { notFound } from "next/navigation";
import AppealView from "@/components/AppealView";
import { loadAppeal } from "@/lib/council-data";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PcpAppealPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  await requirePermission("pcp.appeals.review");
  const d = await loadAppeal(ref);
  if (!d) notFound();
  return <AppealView d={d} side="pcp" canReview />;
}
