import SimpleAreaLayout from "@/components/SimpleAreaLayout";

export default function FacultyLayout({ children }: { children: React.ReactNode }) {
  return (
    <SimpleAreaLayout
      kind="faculty"
      workspace={{ label: "Faculty", name: "My academic profile" }}
      nav={[{ href: "/faculty", label: "My profile", icon: "record", group: "Overview" }]}
    >
      {children}
    </SimpleAreaLayout>
  );
}
