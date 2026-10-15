import { redirect } from "next/navigation";
import SigninCodeView from "@/components/SigninCodeView";
import { needsOfficerCode, officerCodeSatisfied } from "@/lib/officer-code";
import { HOME_BY_KIND, ROLE_LABELS } from "@/lib/roles";
import { getUser } from "@/lib/session";

export const metadata = { title: "Sign-in code" };
export const dynamic = "force-dynamic";

/** Second step of an officer's sign-in (RFP 4.1.3, 4.1.16): the one-time code sent by SMS. */
export default async function SigninCodePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const home = HOME_BY_KIND[user.kind];
  const { next } = await searchParams;
  const target = next && next.startsWith(home) && !next.startsWith("//") ? next : home;
  if (!needsOfficerCode(user.roles) || (await officerCodeSatisfied(user.roles))) redirect(target);
  return <SigninCodeView name={user.name} role={ROLE_LABELS[user.role] ?? user.role} next={target} />;
}
