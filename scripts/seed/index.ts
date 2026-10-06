// Module seeds run after the core registry (institutions, programmes, faculty, students, cases) exists.
// Each module owns its own file and reads what it needs from the database.
import seedOnboarding from "./onboarding";
import seedWorkflow from "./workflow";
import seedFaculty from "./faculty";
import seedStudents from "./students";
import seedPharmacists from "./pharmacists";
import seedCouncil from "./council";
import seedAccounts from "./accounts";

export async function seedModules() {
  for (const [name, fn] of [
    ["onboarding", seedOnboarding],
    ["workflow", seedWorkflow],
    ["faculty", seedFaculty],
    ["students", seedStudents],
    ["pharmacists", seedPharmacists],
    ["council", seedCouncil],
    ["accounts", seedAccounts],
  ] as const) {
    const note = await fn();
    console.log(`  module ${name}: ${note ?? "nothing to seed"}`);
  }
}
