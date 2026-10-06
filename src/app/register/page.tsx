import { RegisterForm } from "@/components/OnboardingRegister";
import { PublicFrame } from "@/components/PublicHome";
import { getUser } from "@/lib/session";

export const metadata = { title: "Register your institution" };

export default async function RegisterPage() {
  const user = await getUser();
  return (
    <PublicFrame
      signedIn={!!user}
      title="Register your institution"
      sub="Universities, colleges and affiliated campuses register once with PCP. Approval issues your Institution ID, which every NOC, faculty link, student and inspection is attached to."
    >
      <RegisterForm />
    </PublicFrame>
  );
}
