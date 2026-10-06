// Point the demo at a public address (for ./demo.sh share) or back to localhost.
//   node scripts/public-url.mjs https://example.trycloudflare.com
//   node scripts/public-url.mjs http://localhost:8088
// It adds the address to the two Keycloak clients' allowed redirects and rewrites the URLs in .env.local.
// Keycloak itself has no fixed hostname: it builds links from the forwarded headers Nginx sends.
// The app must be restarted afterwards to read the new .env.local (demo.sh does this).
import fs from "node:fs";

const LOCAL = "http://localhost:8088";
const url = (process.argv[2] ?? LOCAL).replace(/\/+$/, "");
if (!/^https?:\/\/[^/]+$/.test(url)) throw new Error(`Not an origin: ${url}`);
const KC = `${LOCAL}/auth`; // always talk to Keycloak's admin API locally

const tokenRes = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
  method: "POST",
  body: new URLSearchParams({ grant_type: "password", client_id: "admin-cli", username: process.env.KC_ADMIN_USER ?? "admin", password: process.env.KC_ADMIN_PASSWORD ?? "admin" }),
});
if (!tokenRes.ok) throw new Error(`Keycloak admin login failed (${tokenRes.status})`);
const H = { Authorization: `Bearer ${(await tokenRes.json()).access_token}`, "Content-Type": "application/json" };
const kc = async (path, init = {}) => {
  const r = await fetch(`${KC}/admin/realms/pcp${path}`, { ...init, headers: H });
  if (!r.ok) throw new Error(`Keycloak ${init.method ?? "GET"} ${path} failed (${r.status}) ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};

// 1. No fixed realm frontend URL: Keycloak derives it per request from Nginx's forwarded headers
const realm = await kc("");
if (realm.attributes?.frontendUrl) await kc("", { method: "PUT", body: JSON.stringify({ attributes: { ...realm.attributes, frontendUrl: "" } }) });

// 2. Clients: localhost always allowed, plus the public address
const origins = [...new Set([LOCAL, url])];
for (const clientId of ["pcp-portal", "pcp-demo"]) {
  const [c] = await kc(`/clients?clientId=${clientId}`);
  if (!c) continue;
  c.redirectUris = origins.map((o) => `${o}/*`);
  c.webOrigins = origins;
  if (c.rootUrl) c.rootUrl = url;
  c.attributes = { ...(c.attributes ?? {}), "post.logout.redirect.uris": origins.map((o) => `${o}/*`).join("##") };
  await kc(`/clients/${c.id}`, { method: "PUT", body: JSON.stringify(c) });
}

// 3. App environment
const envPath = new URL("../.env.local", import.meta.url);
let env = fs.readFileSync(envPath, "utf8");
const set = (k, v) => {
  env = new RegExp(`^${k}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : `${env.trimEnd()}\n${k}=${v}\n`;
};
set("AUTH_URL", url);
set("AUTH_KEYCLOAK_ISSUER", `${url}/auth/realms/pcp`);
set("PUBLIC_BASE_URL", url);
fs.writeFileSync(envPath, env);

console.log(`Demo now answers on ${url} (Keycloak client redirects and .env.local updated)`);
