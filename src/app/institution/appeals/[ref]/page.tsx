import { notFound } from "next/navigation";
import AppealView from "@/components/AppealView";
import { loadAppeal } from "@/lib/council-data";
import { can } from "@/lib/roles";
import { requireInstitution } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function InstitutionAppealPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const { user, inst } = await requireInstitution("inst.app.view");
  const d = await loadAppeal(ref);
  // An institution sees only its own appeals.
  if (!d || d.inst?.id !== inst.id) notFound();
  // The officer's review note is advice to the council, not shared with the institution.
  const own = { ...d, appeal: { ...d.appeal, reviewNote: null, reviewedBy: null } };
  return <AppealView d={own} side="institution" canWithdraw={can(user.roles, "inst.appeal.file")} />;
}
