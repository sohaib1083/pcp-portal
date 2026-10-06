"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { audit } from "@/lib/audit";
import { getFeedKeys, newFeedKey, saveFeedKeys } from "@/lib/accounts";
import { requireOtp } from "@/lib/otp";
import type { Drill, DrillKind, DrillResult } from "@/lib/report-types";
import { drillList } from "@/lib/reports";
import { can } from "@/lib/roles";
import { getUser } from "@/lib/session";
import type { ActionResult } from "./faculty";

const KINDS: DrillKind[] = ["institutions", "students", "faculty", "programmes", "deficiencies", "returns", "faculty-moves", "payments"];

/** The list behind a figure: every number on the Reports page can be checked (guide section 14). */
export async function drillDown(d: Drill): Promise<{ ok: true; result: DrillResult } | { ok: false; message: string }> {
  const user = await getUser();
  if (!user || !can(user.roles, d?.kind === "payments" ? "pcp.accounts.view" : "pcp.reports.view")) return { ok: false, message: "Your role cannot open this list." };
  if (!KINDS.includes(d.kind)) return { ok: false, message: "Unknown list." };
  const params = Object.fromEntries(Object.entries(d.params ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, typeof v === "number" ? v : String(v).slice(0, 400)]));
  const result = await drillList({ kind: d.kind, params, label: String(d.label ?? "").slice(0, 160) });
  await audit(db, { actor: user.username, action: "report.list.viewed", entity: "report", entityId: d.kind, details: { params, rows: result.rows.length } });
  return { ok: true, result };
}

// ---------- Data feed keys (Super administrator: keys are reference rules) ----------

async function rulesAdmin() {
  const user = await getUser();
  return user && can(user.roles, "pcp.rules.manage") ? user : null;
}

export async function issueFeedKey(name: string, audience: string): Promise<ActionResult & { key?: string }> {
  const user = await rulesAdmin();
  if (!user) return { ok: false, level: "error", message: "Only the Super administrator issues feed keys." };
  const holder = String(name ?? "").trim().slice(0, 80);
  if (holder.length < 3) return { ok: false, level: "error", message: "Name the organisation that will hold the key." };
  const { value } = await getFeedKeys();
  const id = holder.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 24) + "-" + (value.keys.length + 1);
  const k = newFeedKey(id);
  await db.transaction(async (tx) => {
    await saveFeedKeys(tx, { keys: [...value.keys, { id, name: holder, audience: audience === "Ministry" ? "Ministry" : "Provincial council", prefix: k.prefix, sha256: k.sha256, active: true, issuedAt: new Date().toISOString(), issuedBy: user.username }] }, `Feed key issued to ${holder}`);
    await audit(tx, { actor: user.username, action: "feed.key.issued", entity: "feed_key", entityId: id, details: { name: holder, prefix: k.prefix } });
  });
  revalidatePath("/pcp/reports");
  return { ok: true, level: "success", message: `Key issued to ${holder}. Copy it now: it is not shown again.`, key: k.plain };
}

export async function revokeFeedKey(id: string, otp: string): Promise<ActionResult> {
  const user = await rulesAdmin();
  if (!user) return { ok: false, level: "error", message: "Only the Super administrator revokes feed keys." };
  const { value } = await getFeedKeys();
  const key = value.keys.find((k) => k.id === id);
  if (!key) return { ok: false, level: "error", message: "That key no longer exists." };
  if (!key.active) return { ok: false, level: "error", message: "That key is already revoked." };
  try {
    await requireOtp(user.username, `feed-key:revoke:${id}`, otp);
  } catch (e) {
    return { ok: false, level: "error", message: (e as Error).message };
  }
  await db.transaction(async (tx) => {
    await saveFeedKeys(tx, { keys: value.keys.map((k) => (k.id === id ? { ...k, active: false, revokedAt: new Date().toISOString(), revokedBy: user.username } : k)) }, `Feed key revoked: ${key.name}`);
    await audit(tx, { actor: user.username, action: "feed.key.revoked", entity: "feed_key", entityId: id, details: { name: key.name } });
  });
  revalidatePath("/pcp/reports");
  return { ok: true, level: "success", message: `Key for ${key.name} revoked. Calls with it now get 403.` };
}
