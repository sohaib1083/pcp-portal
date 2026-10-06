import { notFound } from "next/navigation";
import InstitutionApplicationView from "@/components/InstitutionApplicationView";
import { loadApplication } from "@/lib/appdetail";
import { can } from "@/lib/roles";
import { requireInstitution } from "@/lib/session";

export default async function InstitutionApplicationPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const { user, inst } = await requireInstitution("inst.app.view");
  const d = await loadApplication(ref);
  // Scope: an institution sees only its own applications.
  if (!d || d.inst?.code !== inst.code) notFound();

  // Institutions see the date, what to prepare and the team size; not inspectors' names, raw notes,
  // PCP's internal technical review or messages addressed to PCP staff.
  const scoped = {
    ...d,
    inspections: d.inspections.map((i) => ({
      ...i,
      inspector: "",
      inspectorName: "PCP inspection team",
      checklist: [],
      summary: null,
      team: i.team.map((m) => ({ ...m, username: "", name: "", province: null })),
    })),
    technicalReview: null,
    messages: d.messages.filter((m) => m.institutionId === inst.id || m.audience === `inst:${inst.code}`),
  };

  return (
    <InstitutionApplicationView
      d={scoped}
      perms={{
        canEdit: can(user.roles, "inst.app.edit"),
        canUpload: can(user.roles, "inst.app.edit") || can(user.roles, "inst.documents.upload"),
        canPay: can(user.roles, "inst.fee.pay"),
        canSubmit: can(user.roles, "inst.app.submit"),
        canRespond: can(user.roles, "inst.deficiency.respond"),
      }}
    />
  );
}
