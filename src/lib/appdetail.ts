import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getRule, type ProgramRule } from "./rules";
import { iso } from "./util";

export async function loadApplication(ref: string) {
  const app = await db.query.applications.findFirst({ where: eq(schema.applications.ref, ref) });
  if (!app) return null;
  const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.id, app.institutionId) });
  const events = await db.select().from(schema.applicationEvents).where(eq(schema.applicationEvents.applicationId, app.id)).orderBy(asc(schema.applicationEvents.id));
  const defs = await db.select().from(schema.deficiencies).where(eq(schema.deficiencies.applicationId, app.id)).orderBy(asc(schema.deficiencies.id));
  const insps = await db.select().from(schema.inspections).where(eq(schema.inspections.applicationId, app.id)).orderBy(desc(schema.inspections.id));
  const docs = await db.select().from(schema.documents).where(eq(schema.documents.applicationId, app.id)).orderBy(asc(schema.documents.docType), desc(schema.documents.version));
  const staff = await db.select().from(schema.staff);
  const names = Object.fromEntries(staff.map((s) => [s.username, s.displayName]));
  let requiredDocs: string[] = [];
  try {
    requiredDocs = (await getRule<ProgramRule>(`noc.${app.programType}`)).value.requiredDocs;
  } catch {}

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
      decidedAt: iso(app.decidedAt),
      certificateNo: app.certificateNo,
      issuedAt: iso(app.issuedAt),
      validUntil: app.validUntil,
      createdAt: iso(app.createdAt)!,
    },
    inst: inst ? { id: inst.id, code: inst.code, name: inst.name, shortCode: inst.shortCode, province: inst.province, city: inst.city, sector: inst.sector } : null,
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
      status: i.status,
      checklist: i.checklist ?? [],
      summary: i.summary,
      submittedAt: iso(i.submittedAt),
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
    requiredDocs,
  };
}

export type AppDetail = NonNullable<Awaited<ReturnType<typeof loadApplication>>>;
