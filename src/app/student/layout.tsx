import SimpleAreaLayout from "@/components/SimpleAreaLayout";

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <SimpleAreaLayout
      kind="student"
      workspace={{ label: "Student", name: "My PCP record" }}
      nav={[
        { href: "/student", label: "My record", icon: "record", group: "Overview" },
        { href: "/student/help", label: "Help desk", icon: "help", group: "Overview" },
      ]}
    >
      {children}
    </SimpleAreaLayout>
  );
}
