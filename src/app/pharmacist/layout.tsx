import SimpleAreaLayout from "@/components/SimpleAreaLayout";

export default function PharmacistLayout({ children }: { children: React.ReactNode }) {
  return (
    <SimpleAreaLayout
      kind="pharmacist"
      workspace={{ label: "Registered pharmacist", name: "My registration" }}
      nav={[
        { href: "/pharmacist", label: "My registration", icon: "record", group: "Overview" },
        { href: "/pharmacist/help", label: "Help desk", icon: "help", group: "Overview" },
      ]}
    >
      {children}
    </SimpleAreaLayout>
  );
}
