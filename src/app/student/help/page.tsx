import HelpDeskSelf from "@/components/HelpDeskSelf";
import { loadTickets, publicView } from "@/lib/council-data";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function StudentHelpPage() {
  const user = await requireUser("student");
  const tickets = (await loadTickets({ username: user.username })).map(publicView);
  return (
    <HelpDeskSelf
      who="student"
      tickets={tickets}
      examples={{ category: "Question", subject: "When will my result for year 2 show?", message: "My university announced the year 2 results last month, but my PCP record still shows no result. When will it be updated?" }}
    />
  );
}
