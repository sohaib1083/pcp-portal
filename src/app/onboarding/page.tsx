import { asc, eq } from "drizzle-orm";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import { PageTitle } from "@/components/common";
import { db, schema } from "@/db";
import { requiredDocs, ruleList } from "@/lib/onboarding";
import { onboardingSteps } from "@/lib/onboarding-steps";
import { requirePermission } from "@/lib/session";
import { iso } from "@/lib/util";

export const metadata = { title: "Onboarding checklist" };

export default async function OnboardingPage() {
  const user = await requirePermission("applicant.self");
  const req = await db.query.onboardingRequests.findFirst({ where: eq(schema.onboardingRequests.applicantUsername, user.username) });
  if (!req)
    return (
      <>
        <PageTitle eyebrow="Institution onboarding" title="No registration found" sub="Your account is not linked to an institution registration. Contact PCP's help desk with your username." />
      </>
    );

  const [docs, events, required, provinces, universities] = await Promise.all([
    db.select().from(schema.documents).where(eq(schema.documents.onboardingId, req.id)).orderBy(asc(schema.documents.id)),
    db.select().from(schema.onboardingEvents).where(eq(schema.onboardingEvents.requestId, req.id)).orderBy(asc(schema.onboardingEvents.id)),
    requiredDocs(),
    ruleList("ref.provinces"),
    ruleList("ref.universities"),
  ]);
  const inst = req.institutionId ? await db.query.institutions.findFirst({ where: eq(schema.institutions.id, req.institutionId) }) : null;
  const staffNames = Object.fromEntries((await db.select({ u: schema.staff.username, n: schema.staff.displayName }).from(schema.staff)).map((s) => [s.u, s.n]));

  return (
    <OnboardingChecklist
      req={{
        ref: req.ref,
        status: req.status,
        applicantUsername: req.applicantUsername,
        applicantName: req.applicantName,
        applicantDesignation: req.applicantDesignation,
        email: req.email,
        mobile: req.mobile,
        emailVerifiedAt: iso(req.emailVerifiedAt),
        mobileVerifiedAt: iso(req.mobileVerifiedAt),
        profile: req.profile,
        campuses: req.campuses,
        programmes: req.programmes,
        submittedAt: iso(req.submittedAt),
        reviewNote: req.reviewNote,
        reviewedBy: req.reviewedBy ? (staffNames[req.reviewedBy] ?? req.reviewedBy) : null,
        reviewedAt: iso(req.reviewedAt),
        institutionCode: inst?.code ?? null,
      }}
      steps={onboardingSteps({ ...req, docs, requiredDocs: required })}
      docs={docs.map((d) => ({ id: d.id, docType: d.docType, fileName: d.fileName, version: d.version, verificationStatus: d.verificationStatus, sha256: d.sha256, uploadedAt: iso(d.uploadedAt)!, uploadedBy: d.uploadedBy }))}
      requiredDocs={required}
      provinces={provinces}
      universities={universities}
      events={events.map((e) => ({ id: e.id, fromStatus: e.fromStatus, toStatus: e.toStatus, actor: staffNames[e.actor] ?? (e.actor === req.applicantUsername ? req.applicantName : e.actor), note: e.note, createdAt: iso(e.createdAt)! }))}
    />
  );
}
