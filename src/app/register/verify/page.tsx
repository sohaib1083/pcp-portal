import { eq } from "drizzle-orm";
import { UnknownRegistration, VerifyAccount } from "@/components/OnboardingRegister";
import { PublicFrame } from "@/components/PublicHome";
import { db, schema } from "@/db";
import { demoCodes } from "@/lib/onboarding";
import { getUser } from "@/lib/session";

export const metadata = { title: "Verify your account" };

// A public page: show where the codes went, never the full email or mobile number.
const maskEmail = (e: string) => e.replace(/^(.)(.*)(@.*)$/, (_, a: string, b: string, c: string) => `${a}${"•".repeat(Math.min(6, b.length))}${c}`);
const maskMobile = (m: string) => m.replace(/^(\d{4})-(\d{3})(\d{4})$/, "$1-•••$3");

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref } = await searchParams;
  const user = await getUser();
  const req = ref ? await db.query.onboardingRequests.findFirst({ where: eq(schema.onboardingRequests.ref, ref) }) : null;
  return (
    <PublicFrame signedIn={!!user} title="Verify your account" sub="Two codes confirm that the official email and the mobile number belong to you.">
      {req ? (
        <VerifyAccount
          info={{
            ref: req.ref,
            username: req.applicantUsername,
            name: req.applicantName,
            emailMasked: maskEmail(req.email),
            mobileMasked: maskMobile(req.mobile),
            emailVerified: !!req.emailVerifiedAt,
            mobileVerified: !!req.mobileVerifiedAt,
            demo: req.emailVerifiedAt && req.mobileVerifiedAt ? null : await demoCodes(req.ref),
          }}
        />
      ) : (
        <UnknownRegistration />
      )}
    </PublicFrame>
  );
}
