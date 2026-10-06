import CoverageView from "@/components/CoverageView";
import { quickLoginEnabled } from "@/lib/demo";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata = { title: "Working guide coverage · PCP Digital Portal" };

/** Public: each point of PCP's working guide, what the demo does for it, and a one-click way to try it. */
export default async function CoveragePage() {
  const user = await getUser();
  return <CoverageView quick={quickLoginEnabled()} signedIn={!!user} />;
}
