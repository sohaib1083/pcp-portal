// Prints the credentials sheet for a hosted POC: every sign-in account with its role, organisation and password.
//   POC_PASSWORD_SEED=... npx tsx scripts/poc-credentials.ts [out.json]
// The passwords come from the same seed the server uses (scripts/poc-password.mjs). Never commit the output.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MORE_PERSONAS, PERSONAS } from "../src/lib/demo-story";
import { HOME_BY_KIND, ROLE_DESCRIPTIONS, ROLE_LABELS, kindOf } from "../src/lib/roles";
import { pocPassword } from "./poc-password.mjs";

const seed = process.env.POC_PASSWORD_SEED;
if (!seed) throw new Error("Set POC_PASSWORD_SEED (it is in deploy/.azure.env)");

const INSTITUTIONS: Record<string, string> = {
  "PCP-UNI-000101": "Riverside University of Health Sciences",
  "PCP-UNI-000102": "Northern Hills College of Pharmacy",
  "PCP-UNI-000103": "Ravi Bank University",
  "PCP-UNI-000104": "Clifton College of Pharmacy",
  "PCP-UNI-000105": "Bolan Valley University",
  "PCP-UNI-000106": "Gilgit Mountain Institute of Pharmacy",
  "PCP-UNI-000107": "Five Rivers University",
  "PCP-UNI-000108": "Sindh Coastal University",
};

// The realm generator is the single source of the accounts.
const dir = mkdtempSync(path.join(tmpdir(), "pcp-realm-"));
const out = path.join(dir, "realm.json");
execFileSync("node", ["scripts/gen-realm.mjs"], { env: { ...process.env, REALM_OUT: out, PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN ?? "https://example.invalid" }, stdio: "ignore" });
const realm = JSON.parse(readFileSync(out, "utf8")) as { users: { username: string; firstName?: string; lastName?: string; realmRoles?: string[]; groups?: string[]; serviceAccountClientId?: string }[] };
const personas = [...PERSONAS, ...MORE_PERSONAS];

const rows = realm.users
  .filter((u) => !u.serviceAccountClientId)
  .map((u) => {
    const role = u.realmRoles?.[0] ?? "";
    const code = u.groups?.[0]?.split("/").pop() ?? null;
    const p = personas.find((x) => x.username === u.username);
    return {
      username: u.username,
      password: pocPassword(seed, u.username),
      name: p?.name ?? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
      role: ROLE_LABELS[role] ?? role,
      does: ROLE_DESCRIPTIONS[role] ?? "",
      organisation: code ? `${INSTITUTIONS[code] ?? code} (${code})` : p?.org ?? "Pharmacy Council of Pakistan",
      home: HOME_BY_KIND[kindOf([role])],
    };
  });

if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(rows, null, 2));
for (const r of rows) console.log(`${r.username.padEnd(17)} ${r.password.padEnd(16)} ${r.role.padEnd(32)} ${r.organisation}`);
