import HelpDeskSelf from "@/components/HelpDeskSelf";
import { loadTickets, publicView } from "@/lib/council-data";
import { requireInstitution } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function InstitutionHelpPage() {
  const { user, inst } = await requireInstitution("inst.helpdesk");
  const tickets = (await loadTickets({ username: user.username, institutionId: inst.id })).map(publicView);
  return (
    <HelpDeskSelf
      who="institution"
      tickets={tickets}
      examples={{ category: "Technical issue", subject: "Faculty CSV upload shows an error on row 12", message: "Our faculty bulk upload stops at row 12 with 'CNIC format'. The CNIC on that row is 17301-1234567-1, which looks correct. Please advise." }}
    />
  );
}
