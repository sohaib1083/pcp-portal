import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { caseFaculty, getRule, requiredDocsFor, subjectRequirements, type ProgramRule } from "./rules";
import { iso } from "./util";
import { DEFICIENCY_FROM } from "./workflow";

/** The accreditation term a case asks for: a renewal continues from the current expiry, a first accreditation starts now. */
export function requestedPeriod(kind: string, currentUntil: string | null | undefined, years: number, now = new Date()) {
  const from = kind === "RENEWAL" && currentUntil && currentUntil > now.toISOString().slice(0, 10) ? Number(currentUntil.slice(0, 4)) : now.getFullYear();
  return { from, until: from + years };
}

export async function loadApplication(ref: string) {
  const app = await db.query.applications.findFirst({ where: eq(schema.applications.ref, ref) });
  if (!app) return null;
  const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, app.institutionId) });
  const events = await db.select().from(schema.applicationEvents).where(eq(schema.applicationEvents.applicationId, app.id)).orderBy(asc(schema.applicationEvents.id));
  const defs = await db.select().from(schema.deficiencies).where(eq(schema.deficiencies.applicationId, app.id)).orderBy(asc(schema.deficiencies.id));
  const insps = await db.select().from(schema.inspections).where(eq(schema.inspections.applicationId, app.id)).orderBy(desc(schema.inspections.id));
  const team = insps.length ? await db.select().from(schema.inspectionTeam).where(inArray(schema.inspectionTeam.inspectionId, insps.map((i) => i.id))) : [];
  const docs = await db.select().from(schema.documents).where(eq(schema.documents.applicationId, app.id)).orderBy(asc(schema.documents.docType), desc(schema.documents.version));
  const staff = await db.select().from(schema.staff);
  const names = Object.fromEntries(staff.map((s) => [s.username, s.displayName]));
  const provinces = Object.fromEntries(staff.map((s) => [s.username, s.province]));
  const campuses = await db.select().from(schema.campuses).where(eq(schema.campuses.institutionId, app.institutionId)).orderBy(desc(schema.campuses.isMain), asc(schema.campuses.name));
  const program = await db.query.programs.findFirst({ where: and(eq(schema.programs.institutionId, app.institutionId), eq(schema.programs.type, app.programType)) });
  const review = await db.query.technicalReviews.findFirst({ where: eq(schema.technicalReviews.applicationId, app.id), orderBy: desc(schema.technicalReviews.id) });
  const letter = app.letterDocumentId ? await db.query.documents.findFirst({ where: eq(schema.documents.id, app.letterDocumentId) }) : null;
  const messages = await db.select().from(schema.messages).where(eq(schema.messages.entityRef, app.ref)).orderBy(desc(schema.messages.id)).limit(200);
  const faculty = await caseFaculty(app.id, app.institutionId);

  let rule: ProgramRule | null = null;
  try {
    rule = (await getRule<ProgramRule>(`noc.${app.programType}`)).value;
  } catch {}
  const intake = Number(app.data?.proposedIntake ?? 0);
  const subjects = rule
    ? subjectRequirements(rule, intake).map((s) => ({ ...s, linked: faculty.filter((f) => f.subject === s.name && f.activeHere).length }))
    : [];
  // The stage a deficiency was raised from: accepting the responses returns the case there.
  const lastRaise = [...events].reverse().find((e) => e.toStatus === "DEFICIENCY_RAISED" && e.fromStatus && DEFICIENCY_FROM.includes(e.fromStatus) && e.fromStatus !== "RESPONDED");
  // A decided case keeps the term written to the history; an open one shows the term it asks for.
  const hist = app.kind === "NOC" ? null : await db.query.accreditationHistory.findFirst({ where: eq(schema.accreditationHistory.applicationRef, app.ref), orderBy: desc(schema.accreditationHistory.id) });
  const period = app.kind === "NOC" ? null : hist ? { from: hist.validFrom, until: hist.validUntil } : requestedPeriod(app.kind, program?.accreditationValidUntil, rule?.accreditationYears ?? 3, app.submittedAt ?? new Date());

  return {
    app: {
      id: app.id,
      ref: app.ref,
      kind: app.kind,
      programType: app.programType,
      status: app.status,
      data: app.data ?? {},
      checks: app.checks ?? [],
      feeAmount: app.feeAmount,
      feePsid: app.feePsid,
      feePaidAt: iso(app.feePaidAt),
      feePaidBy: app.feePaidBy,
      feeMethod: app.feeMethod,
      assignedOfficer: app.assignedOfficer,
      assignedOfficerName: app.assignedOfficer ? names[app.assignedOfficer] ?? app.assignedOfficer : null,
      submittedBy: app.submittedBy,
      submittedAt: iso(app.submittedAt),
      decision: app.decision,
      decisionNote: app.decisionNote,
      decisionGrounds: app.decisionGrounds,
      deferUntil: app.deferUntil,
      decidedAt: iso(app.decidedAt),
      certificateNo: app.certificateNo,
      issuedAt: iso(app.issuedAt),
      validUntil: app.validUntil,
      campusId: app.campusId,
      campusName: campuses.find((c) => c.id === app.campusId)?.name ?? app.data?.campus ?? null,
      stageStartedAt: iso(app.stageStartedAt),
      stageDueAt: iso(app.stageDueAt),
      escalatedAt: iso(app.escalatedAt),
      selfAssessment: app.selfAssessment ?? [],
      renewalOf: app.renewalOf,
      createdAt: iso(app.createdAt)!,
    },
    deficiencyOrigin: lastRaise?.fromStatus ?? null,
    inst: inst ? { id: inst.id, code: inst.code, name: inst.name, shortCode: inst.shortCode, province: inst.province, city: inst.city, sector: inst.sector } : null,
    campuses: campuses.map((c) => ({ id: c.id, name: c.name, city: c.city, isMain: c.isMain })),
    program: program
      ? { nocStatus: program.nocStatus, nocNumber: program.nocNumber, approvedIntake: program.approvedIntake, accreditationStatus: program.accreditationStatus, validUntil: program.accreditationValidUntil }
      : null,
    period,
    events: events.map((e) => ({ id: e.id, fromStatus: e.fromStatus, toStatus: e.toStatus, actor: names[e.actor] ?? e.actor, actorRole: e.actorRole, note: e.note, createdAt: iso(e.createdAt)! })),
    deficiencies: defs.map((d) => ({
      id: d.id,
      ref: d.ref,
      criterion: d.criterion,
      requiredAction: d.requiredAction,
      evidenceRequired: d.evidenceRequired,
      dueDate: d.dueDate,
      status: d.status,
      responseNote: d.responseNote,
      respondedBy: d.respondedBy ? names[d.respondedBy] ?? d.respondedBy : null,
      respondedAt: iso(d.respondedAt),
      reviewNote: d.reviewNote,
      raisedBy: names[d.raisedBy] ?? d.raisedBy,
      createdAt: iso(d.createdAt)!,
    })),
    inspections: insps.map((i) => ({
      id: i.id,
      inspector: i.inspector,
      inspectorName: names[i.inspector] ?? i.inspector,
      scheduledFor: i.scheduledFor,
      scope: i.scope,
      status: i.status,
      checklist: i.checklist ?? [],
      summary: i.summary,
      submittedAt: iso(i.submittedAt),
      team: [
        { username: i.inspector, name: names[i.inspector] ?? i.inspector, province: provinces[i.inspector] ?? null, role: "LEAD" },
        ...team.filter((m) => m.inspectionId === i.id && m.username !== i.inspector).map((m) => ({ username: m.username, name: names[m.username] ?? m.username, province: provinces[m.username] ?? null, role: "MEMBER" })),
      ],
    })),
    documents: docs.map((d) => ({
      id: d.id,
      docType: d.docType,
      fileName: d.fileName,
      version: d.version,
      sizeBytes: d.sizeBytes,
      sha256: d.sha256,
      verificationStatus: d.verificationStatus,
      deficiencyId: d.deficiencyId,
      uploadedBy: names[d.uploadedBy] ?? d.uploadedBy,
      uploadedAt: iso(d.uploadedAt)!,
      folder: d.folder,
    })),
    requiredDocs: rule ? requiredDocsFor(rule, app.kind) : [],
    faculty: faculty.map((f) => ({ ...f, linkedAt: iso(f.linkedAt)! })),
    subjects,
    subjectNames: rule?.subjects?.map((s) => s.name) ?? [],
    reviewDone: !!review,
    technicalReview: review ? { reviewer: names[review.reviewer] ?? review.reviewer, items: review.items, summary: review.summary, outcome: review.outcome, createdAt: iso(review.createdAt)! } : null,
    letter: letter ? { id: letter.id, fileName: letter.fileName, version: letter.version, uploadedAt: iso(letter.uploadedAt)!, sha256: letter.sha256 } : null,
    messages: messages.map((m) => ({
      id: m.id,
      channel: m.channel,
      toAddress: m.toAddress,
      toName: m.toName,
      audience: m.audience,
      institutionId: m.institutionId,
      subject: m.subject,
      body: m.body,
      createdAt: iso(m.createdAt)!,
    })),
  };
}

export type AppDetail = NonNullable<Awaited<ReturnType<typeof loadApplication>>>;
