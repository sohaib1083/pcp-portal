import { randomBytes } from "node:crypto";

// Keycloak Admin REST API, called with the "pcp-admin-api" service account (client credentials).
// Only the Super Admin screens use this.
const ISSUER = process.env.AUTH_KEYCLOAK_ISSUER ?? "http://localhost:8088/auth/realms/pcp";
const BASE = ISSUER.replace("/realms/", "/admin/realms/");

let cached: { token: string; exp: number } | null = null;

async function token() {
  if (cached && cached.exp > Date.now() + 10_000) return cached.token;
  const res = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.KEYCLOAK_ADMIN_CLIENT_ID ?? "pcp-admin-api",
      client_secret: process.env.KEYCLOAK_ADMIN_CLIENT_SECRET ?? "",
    }),
  });
  if (!res.ok) throw new Error(`Keycloak admin login failed (${res.status})`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

async function kc(path: string, init: RequestInit = {}) {
  const call = async () =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
  let res = await call();
  // A cached token goes stale when the realm is re-imported (./demo.sh reset rotates its keys): fetch a new one once.
  if (res.status === 401) {
    cached = null;
    res = await call();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Keycloak ${init.method ?? "GET"} ${path} failed (${res.status}) ${text.slice(0, 200)}`);
  }
  return res;
}

export function tempPassword() {
  // Shown once to the Super Admin; Keycloak forces a change at first sign-in.
  return `Pcp-${randomBytes(3).toString("hex")}-${randomBytes(2).toString("hex").toUpperCase()}`;
}

export type KcUser = { id: string; username: string; enabled: boolean; email?: string };

export async function findUser(username: string): Promise<KcUser | null> {
  const res = await kc(`/users?username=${encodeURIComponent(username)}&exact=true`);
  const list = (await res.json()) as KcUser[];
  return list[0] ?? null;
}

export async function listUsers(): Promise<KcUser[]> {
  const res = await kc(`/users?max=1000&briefRepresentation=true`);
  return (await res.json()) as KcUser[];
}

async function groupIdByPath(path: string): Promise<string> {
  const res = await kc(`/group-by-path/${path.split("/").filter(Boolean).map(encodeURIComponent).join("/")}`);
  return ((await res.json()) as { id: string }).id;
}

/** A tenant = an institution = a Keycloak group under /institutions. */
export async function createInstitutionGroup(code: string) {
  const parent = await groupIdByPath("/institutions");
  const res = await fetch(`${BASE}/groups/${parent}/children`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: code }),
  });
  if (!res.ok && res.status !== 409) throw new Error(`Could not create Keycloak group ${code} (${res.status})`);
}

export async function createUser(o: { username: string; email: string; fullName: string; role: string; institutionCode?: string | null }) {
  const [firstName, ...rest] = o.fullName.replace(/^(Dr\.?|Prof\.?|Mr\.?|Ms\.?|Mrs\.?)\s+/i, "").split(" ");
  const password = tempPassword();
  const res = await kc(`/users`, {
    method: "POST",
    body: JSON.stringify({
      username: o.username,
      email: o.email,
      firstName: firstName || o.username,
      lastName: rest.join(" ") || "-",
      enabled: true,
      emailVerified: true,
      credentials: [{ type: "password", value: password, temporary: true }],
    }),
  });
  const id = res.headers.get("location")?.split("/").pop();
  if (!id) throw new Error("Keycloak did not return the new user id");
  const role = await (await kc(`/roles/${encodeURIComponent(o.role)}`)).json();
  await kc(`/users/${id}/role-mappings/realm`, { method: "POST", body: JSON.stringify([role]) });
  if (o.institutionCode) {
    const gid = await groupIdByPath(`/institutions/${o.institutionCode}`);
    await kc(`/users/${id}/groups/${gid}`, { method: "PUT" });
  }
  return { id, password };
}

export async function setEnabled(username: string, enabled: boolean) {
  const u = await findUser(username);
  if (!u) throw new Error(`No Keycloak user ${username}`);
  await kc(`/users/${u.id}`, { method: "PUT", body: JSON.stringify({ enabled }) });
  if (!enabled) await kc(`/users/${u.id}/logout`, { method: "POST" }); // end their Keycloak sessions
}

export async function resetPassword(username: string) {
  const u = await findUser(username);
  if (!u) throw new Error(`No Keycloak user ${username}`);
  const password = tempPassword();
  await kc(`/users/${u.id}/reset-password`, { method: "PUT", body: JSON.stringify({ type: "password", value: password, temporary: true }) });
  return password;
}

// ---------- Self-registration and approval of institutions (onboarding) ----------

/**
 * Self-registration: an account with the password the applicant chose (permanent, not temporary).
 * Keycloak does not verify the email; the portal verifies email and mobile with its own codes.
 */
export async function createUserWithPassword(o: { username: string; email: string; fullName: string; role: string; password: string }) {
  const [firstName, ...rest] = o.fullName.replace(/^(Dr\.?|Prof\.?|Mr\.?|Ms\.?|Mrs\.?)\s+/i, "").split(" ");
  const res = await kc(`/users`, {
    method: "POST",
    body: JSON.stringify({
      username: o.username,
      email: o.email,
      firstName: firstName || o.username,
      lastName: rest.join(" ") || "-",
      enabled: true,
      emailVerified: false,
      credentials: [{ type: "password", value: o.password, temporary: false }],
    }),
  });
  const id = res.headers.get("location")?.split("/").pop();
  if (!id) throw new Error("Keycloak did not return the new user id");
  try {
    const role = await (await kc(`/roles/${encodeURIComponent(o.role)}`)).json();
    await kc(`/users/${id}/role-mappings/realm`, { method: "POST", body: JSON.stringify([role]) });
  } catch (e) {
    await deleteUserById(id).catch(() => undefined);
    throw e;
  }
  return { id };
}

/** Undo a half-finished registration. Only ever called for an account created moments earlier. */
export async function deleteUserById(id: string) {
  await kc(`/users/${id}`, { method: "DELETE" });
}

/** True when Keycloak already has an account with this email (the realm does not allow duplicates). */
export async function emailInUse(email: string) {
  const res = await kc(`/users?email=${encodeURIComponent(email)}&exact=true&briefRepresentation=true`);
  return ((await res.json()) as KcUser[]).length > 0;
}

async function requireUserId(username: string) {
  const u = await findUser(username);
  if (!u) throw new Error(`No Keycloak user ${username}`);
  return u.id;
}

export async function addRealmRole(username: string, roleName: string) {
  const id = await requireUserId(username);
  const role = await (await kc(`/roles/${encodeURIComponent(roleName)}`)).json();
  await kc(`/users/${id}/role-mappings/realm`, { method: "POST", body: JSON.stringify([role]) });
}

export async function removeRealmRole(username: string, roleName: string) {
  const id = await requireUserId(username);
  const role = await (await kc(`/roles/${encodeURIComponent(roleName)}`)).json();
  await kc(`/users/${id}/role-mappings/realm`, { method: "DELETE", body: JSON.stringify([role]) });
}

export async function realmRolesOf(username: string): Promise<string[]> {
  const id = await requireUserId(username);
  const res = await kc(`/users/${id}/role-mappings/realm`);
  return ((await res.json()) as { name: string }[]).map((r) => r.name);
}

/** Put a user into an institution's group: the group is what scopes their data to that institution. */
export async function joinInstitutionGroup(username: string, institutionCode: string) {
  const id = await requireUserId(username);
  const gid = await groupIdByPath(`/institutions/${institutionCode}`);
  await kc(`/users/${id}/groups/${gid}`, { method: "PUT" });
}

/** Take a user out of every group (used to restore the seeded applicant to its starting state). */
export async function leaveAllGroups(username: string) {
  const id = await requireUserId(username);
  const groups = (await (await kc(`/users/${id}/groups`)).json()) as { id: string }[];
  for (const g of groups) await kc(`/users/${id}/groups/${g.id}`, { method: "DELETE" });
}

// ---------- Quarterly access review (guide section 14): who holds which role, in a few calls ----------

export type KcUserFull = KcUser & { firstName?: string; lastName?: string; createdTimestamp?: number };

/** Every account in the realm with its name and email. */
export async function listUsersFull(): Promise<KcUserFull[]> {
  const res = await kc(`/users?max=1000`);
  return (await res.json()) as KcUserFull[];
}

/** username -> the given realm roles they hold (one call per role, not one per user). Unknown roles are skipped. */
export async function realmRoleMembers(roleNames: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  await Promise.all(
    roleNames.map(async (role) => {
      try {
        const users = (await (await kc(`/roles/${encodeURIComponent(role)}/users?first=0&max=1000`)).json()) as KcUser[];
        for (const u of users) (out[u.username] ??= []).push(role);
      } catch {
        /* the realm does not have this role */
      }
    }),
  );
  return out;
}

/** username -> PCP-UNI code of the institution group they belong to. */
export async function institutionGroupMembers(): Promise<Record<string, string>> {
  const parent = await groupIdByPath("/institutions");
  const children = (await (await kc(`/groups/${parent}/children?first=0&max=1000&briefRepresentation=true`)).json()) as { id: string; name: string }[];
  const out: Record<string, string> = {};
  await Promise.all(
    children.map(async (g) => {
      const members = (await (await kc(`/groups/${g.id}/members?first=0&max=1000&briefRepresentation=true`)).json()) as KcUser[];
      for (const m of members) out[m.username] = g.name;
    }),
  );
  return out;
}
