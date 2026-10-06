import { redirect } from "next/navigation";
import LoginView from "@/components/LoginView";
import { quickLoginEnabled } from "@/lib/demo";
import { getUser } from "@/lib/session";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; u?: string }> }) {
  const { next, error, u } = await searchParams;
  const user = await getUser();
  // In the demo build a signed-in presenter may come back here to switch persona.
  if (user && !error && !quickLoginEnabled()) redirect("/home");
  return <LoginView next={next ?? ""} quick={quickLoginEnabled()} error={error === "quick" ? { user: u ?? "that account" } : null} />;
}
