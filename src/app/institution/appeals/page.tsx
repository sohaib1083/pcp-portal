import AppealsList from "@/components/AppealsList";
import { appealableCases, loadAppeals } from "@/lib/council-data";
import { can } from "@/lib/roles";
import { requireInstitution } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The institution's own appeals; the head of institution and the principal can file one. */
export default async function InstitutionAppealsPage() {
  const { user, inst } = await requireInstitution("inst.app.view");
  const canFile = can(user.roles, "inst.appeal.file");
  return <AppealsList side="institution" rows={await loadAppeals(inst.id)} canFile={canFile} appealable={canFile ? await appealableCases(inst.id) : []} />;
}
