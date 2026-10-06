import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import OnboardingReview from "@/components/OnboardingReview";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { requiredDocs } from "@/lib/onboarding";
import { onboardingSteps } from "@/lib/onboarding-steps";
import { requirePermission } from "@/lib/session";
import { iso } from "@/lib/util";

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }) {
  return { title: (await params).ref };
}

export default async function PcpOnboardingDetail({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const user = await requirePermission("pcp.onboarding.review");
  const req = await db.query.onboardingRequests.findFirst({ where: eq(schema.onboardingRequests.ref, ref) });
  if (!req) notFound();
  const [docs, events, required, staff] = await Promise.all([
    db.select().from(schema.documents).where(eq(schema.documents.onboardingId, req.id)).orderBy(asc(schema.documents.id)),
    db.select().from(schema.onboardingEvents).where(eq(schema.onboardingEvents.requestId, req.id)).orderBy(asc(schema.onboardingEvents.id)),
    requiredDocs(),
    db.select({ u: schema.staff.username, n: schema.staff.displayName }).from(schema.staff),
  ]);
  const names = Object.fromEntries(staff.map((s) => [s.u, s.n]));
  const inst = req.institutionId ? await db.query.institutions.findFirst({ where: eq(schema.institutions.id, req.institutionId) }) : null;
  const clash = req.profile.shortCode && req.status !== "APPROVED" ? await db.query.institutions.findFirst({ where: eq(schema.institutions.shortCode, req.profile.shortCode) }) : null;
  // Who viewed a record is part of the audit trail (guide section 14).
  await audit(db, { actor: user.username, action: "onboarding.viewed", entity: "onboarding", entityId: ref });

  return (
    <OnboardingReview
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
        createdAt: iso(req.createdAt)!,
        reviewNote: req.reviewNote,
        reviewedBy: req.reviewedBy ? (names[req.reviewedBy] ?? req.reviewedBy) : null,
        reviewedAt: iso(req.reviewedAt),
        institutionCode: inst?.code ?? null,
      }}
      shortCodeClash={clash ? `${clash.name} (${clash.code})` : null}
      steps={onboardingSteps({ ...req, docs, requiredDocs: required })}
      requiredDocs={required}
      docs={docs.map((d) => ({ id: d.id, docType: d.docType, fileName: d.fileName, version: d.version, verificationStatus: d.verificationStatus, sha256: d.sha256, sizeBytes: d.sizeBytes, uploadedAt: iso(d.uploadedAt)!, uploadedBy: d.uploadedBy }))}
      events={events.map((e) => ({ id: e.id, fromStatus: e.fromStatus, toStatus: e.toStatus, actor: names[e.actor] ?? (e.actor === req.applicantUsername ? req.applicantName : e.actor), note: e.note, createdAt: iso(e.createdAt)! }))}
    />
  );
}
