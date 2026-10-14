import SimpleAreaLayout from "@/components/SimpleAreaLayout";

export default function ProvinceLayout({ children }: { children: React.ReactNode }) {
  return (
    <SimpleAreaLayout
      kind="province"
      workspace={{ label: "Provincial council", name: "Regional oversight" }}
      nav={[{ href: "/province", label: "My province", icon: "region", group: "Overview" }]}
    >
      {children}
    </SimpleAreaLayout>
  );
}
