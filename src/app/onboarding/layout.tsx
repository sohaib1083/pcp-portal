import SimpleAreaLayout from "@/components/SimpleAreaLayout";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <SimpleAreaLayout kind="applicant" workspace={{ label: "Institution onboarding", name: "Register with PCP" }} nav={[{ href: "/onboarding", label: "Onboarding checklist", icon: "onboarding", group: "Overview" }]}>
      {children}
    </SimpleAreaLayout>
  );
}
