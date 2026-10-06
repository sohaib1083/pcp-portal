// Simulated email and SMS. Every message is stored against its case and shown on the Messages screens;
// nothing leaves the server in the demo. In production this module hands the same rows to an email
// service and an SMS gateway.
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export type Recipient = { name: string; email: string | null; username: string; institutionId: number | null };

/** Who an audience string means: inst:<PCP-UNI-ID> | role:<role> | user:<username>. */
export async function resolveAudience(exec: Executor, audience: string): Promise<Recipient[]> {
  const [kind, value] = audience.split(":", 2);
  let rows: (typeof schema.staff.$inferSelect)[] = [];
  if (kind === "inst") {
    const inst = await exec.query.institutions.findFirst({ where: eq(schema.institutions.code, value) });
    if (!inst) return [];
    rows = await exec.select().from(schema.staff).where(and(eq(schema.staff.institutionId, inst.id), eq(schema.staff.active, true)));
    if (rows.length === 0 && inst.email) return [{ name: inst.name, email: inst.email, username: "", institutionId: inst.id }];
  } else if (kind === "role") {
    rows = await exec.select().from(schema.staff).where(and(eq(schema.staff.role, value), eq(schema.staff.active, true)));
  } else if (kind === "user") {
    rows = await exec.select().from(schema.staff).where(eq(schema.staff.username, value));
  }
  return rows.map((r) => ({ name: r.displayName, email: r.email, username: r.username, institutionId: r.institutionId }));
}

/** Work out which case a link points at, so the message is filed on that case. */
export function entityFromLink(link?: string | null): { entity: string | null; entityRef: string | null } {
  if (!link) return { entity: null, entityRef: null };
  const m =
    /\/applications\/([A-Z]+-\d{4}-\d{4})/.exec(link) ??
    /\/onboarding\/(REG-\d{4}-\d{4})/.exec(link) ??
    /\/appeals\/(APL-\d{4}-\d{4})/.exec(link) ??
    /\/annual-returns\/(AR-[\w-]+)/.exec(link) ??
    /\/helpdesk\/(TKT-\d{4}-\d{4})/.exec(link);
  if (!m) return { entity: null, entityRef: null };
  const ref = m[1];
  const entity = ref.startsWith("REG") ? "onboarding" : ref.startsWith("APL") ? "appeal" : ref.startsWith("AR-") ? "annual_return" : ref.startsWith("TKT") ? "ticket" : "application";
  return { entity, entityRef: ref };
}

/** Record one email per recipient of an audience. */
export async function emailAudience(
  exec: Executor,
  audience: string,
  subject: string,
  body: string,
  link?: string | null,
  meta?: { entity?: string; entityRef?: string },
) {
  const recipients = await resolveAudience(exec, audience);
  const { entity, entityRef } = meta?.entity ? { entity: meta.entity, entityRef: meta.entityRef ?? null } : entityFromLink(link);
  const base = process.env.PUBLIC_BASE_URL ?? "http://localhost:8088";
  const rows = recipients
    .filter((r) => r.email)
    .map((r) => ({
      channel: "EMAIL",
      toAddress: r.email!,
      toName: r.name,
      audience,
      subject,
      // Notifications stay short: "an update is waiting" with a link, never CNICs or results.
      body: `${body}${link ? `\n\nOpen: ${base}${link}` : ""}\n\nPharmacy Council of Pakistan · demo · this message was not actually sent`,
      entity,
      entityRef,
      link: link ?? null,
      institutionId: r.institutionId,
    }));
  if (rows.length) await exec.insert(schema.messages).values(rows);
  return rows.length;
}

/** Record an SMS (urgent items and one-time codes only). */
export async function sendSms(exec: Executor, o: { to: string; toName?: string; body: string; entity?: string; entityRef?: string; institutionId?: number | null; audience?: string }) {
  await exec.insert(schema.messages).values({
    channel: "SMS",
    toAddress: o.to,
    toName: o.toName ?? null,
    audience: o.audience ?? null,
    subject: o.body.slice(0, 60),
    body: o.body,
    entity: o.entity ?? null,
    entityRef: o.entityRef ?? null,
    institutionId: o.institutionId ?? null,
  });
}

/** Record an email to one address that is not a user yet (e.g. an applicant verifying their email). */
export async function sendEmail(exec: Executor, o: { to: string; toName?: string; subject: string; body: string; entity?: string; entityRef?: string; institutionId?: number | null; link?: string }) {
  await exec.insert(schema.messages).values({
    channel: "EMAIL",
    toAddress: o.to,
    toName: o.toName ?? null,
    subject: o.subject,
    body: `${o.body}\n\nPharmacy Council of Pakistan · demo · this message was not actually sent`,
    entity: o.entity ?? null,
    entityRef: o.entityRef ?? null,
    link: o.link ?? null,
    institutionId: o.institutionId ?? null,
  });
}

/** A demo mobile number for a user, shown masked (the directory holds no real phone numbers). */
export function demoMobile(username: string) {
  const n = [...username].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 10_000_000, 7);
  return `+92 3${String(n).padStart(7, "0").slice(0, 2)} ${String(n).padStart(7, "0").slice(2)}`;
}
