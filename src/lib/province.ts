// Provincial council officers (RFP 4.1.2: local territory oversight, validation routing, regional reporting).
// The officer's province comes from their staff row (set by the Super administrator), never from the browser.
// Every query on the /province pages and downloads is scoped by it, so one province never sees another's data.
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { COUNCIL_INFO, isCouncil, type Council } from "./register";
import { requirePermission } from "./session";
import { notify } from "./util";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export type ProvinceContext = Awaited<ReturnType<typeof requireProvince>>;

/** The signed-in provincial council officer and their province. Anyone else is sent home. */
export async function requireProvince() {
  const user = await requirePermission("province.dashboard");
  const row = await db.query.staff.findFirst({ where: eq(schema.staff.username, user.username) });
  const province = row?.province?.trim();
  if (!province) throw new Error("This provincial council login has no province on record. Ask PCP's Super administrator to set it.");
  const council: Council | null = isCouncil(province) ? province : null;
  return { user, province, council, councilName: council ? COUNCIL_INFO[council].name : `${province} council` };
}

/** One institution, only if it is in the officer's province. */
export async function institutionInProvince(code: string, province: string) {
  const inst = await db.query.institutions.findFirst({ where: eq(schema.institutions.code, code) });
  return inst && inst.province === province ? inst : null;
}

/** One register entry, only if this council issued it. */
export async function pharmacistInProvince(id: number, province: string) {
  if (!Number.isInteger(id)) return null;
  const p = await db.query.pharmacists.findFirst({ where: eq(schema.pharmacists.id, id) });
  return p && p.council === province ? p : null;
}

/** Active officer logins of a council. Validation routing applies only to a council that has one on the portal. */
export async function councilOfficers(exec: Executor, council: string) {
  const rows = await exec
    .select({ username: schema.staff.username })
    .from(schema.staff)
    .where(and(eq(schema.staff.role, "provincial_council"), eq(schema.staff.province, council), eq(schema.staff.active, true)));
  return rows.map((r) => r.username);
}

export async function notifyCouncil(exec: Executor, council: string, title: string, body: string, link: string) {
  for (const u of await councilOfficers(exec, council)) await notify(exec, `user:${u}`, title, body, link);
}

export const councilName = (c: string) => (isCouncil(c) ? COUNCIL_INFO[c].name : `${c} council`);
