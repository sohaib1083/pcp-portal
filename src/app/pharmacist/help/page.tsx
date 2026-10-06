import HelpDeskSelf from "@/components/HelpDeskSelf";
import { loadTickets, publicView } from "@/lib/council-data";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PharmacistHelpPage() {
  const user = await requireUser("pharmacist");
  const tickets = (await loadTickets({ username: user.username })).map(publicView);
  return (
    <HelpDeskSelf
      who="pharmacist"
      tickets={tickets}
      examples={{ category: "Data correction", subject: "Father's name is misspelt on my registration", message: "My father's name is Muhammad Aslam but the registration shows Mohammad Aslam. My CNIC copy is with the provincial council." }}
    />
  );
}
