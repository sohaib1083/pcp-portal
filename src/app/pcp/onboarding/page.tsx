import { desc, isNotNull } from "drizzle-orm";
import OnboardingQueue from "@/components/OnboardingQueue";
import { db, schema } from "@/db";
import { requiredDocs } from "@/lib/onboarding";
import { onboardingSteps } from "@/lib/onboarding-steps";
import { requirePermission } from "@/lib/session";
import { iso } from "@/lib/util";

export const metadata = { title: "Institution onboarding" };

export default async function PcpOnboardingPage() {
  await requirePermission("pcp.onboarding.review");
  const [rows, docs, required, insts] = await Promise.all([
    db.select().from(schema.onboardingRequests).orderBy(desc(schema.onboardingRequests.updatedAt)),
    db.select().from(schema.documents).where(isNotNull(schema.documents.onboardingId)),
    requiredDocs(),
    db.select({ id: schema.institutions.id, code: schema.institutions.code }).from(schema.institutions),
  ]);
  const code = Object.fromEntries(insts.map((i) => [i.id, i.code]));
  return (
    <OnboardingQueue
      rows={rows.map((r) => {
        const steps = onboardingSteps({ ...r, docs: docs.filter((d) => d.onboardingId === r.id), requiredDocs: required });
        return {
          ref: r.ref,
          status: r.status,
          name: r.profile.name ?? null,
          city: r.profile.city ?? null,
          province: r.profile.province ?? null,
          sector: r.profile.sector ?? null,
          applicantName: r.applicantName,
          applicantDesignation: r.applicantDesignation,
          campuses: r.campuses.length,
          programmes: [...new Set(r.programmes.map((p) => p.type))],
          stepsDone: steps.filter((s) => s.done).length,
          stepsTotal: steps.length,
          submittedAt: iso(r.submittedAt),
          updatedAt: iso(r.updatedAt)!,
          institutionCode: r.institutionId ? (code[r.institutionId] ?? null) : null,
        };
      })}
    />
  );
}
