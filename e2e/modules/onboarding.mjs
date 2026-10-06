// End-to-end test of the onboarding module (guide sections 2, 3, 12 and 14).
// A new institution registers itself, verifies its codes, completes the checklist and submits; PCP returns it
// with a reason; the applicant fixes and resubmits; PCP approves with a one-time code; the applicant signs in
// again and lands on the institution portal with the new PCP-UNI ID. Then: the Head adds a user, the Super
// Admin edits a reference rule as a new version, and the idle-timeout warning appears.
//
// Run: node e2e/modules/onboarding.mjs   (dev copy at http://localhost:3201, seeded database)
// Creates one Keycloak applicant and one institution user with unique usernames; disables no shared user.
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Keycloak admin calls for cleaning up the accounts this run created (set KEEP=1 to keep them). */
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
async function deleteKeycloakUser(username) {
  const issuer = env.AUTH_KEYCLOAK_ISSUER;
  const tok = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.KEYCLOAK_ADMIN_CLIENT_ID, client_secret: env.KEYCLOAK_ADMIN_CLIENT_SECRET }),
  }).then((r) => r.json());
  const base = issuer.replace("/realms/", "/admin/realms/");
  const auth = { Authorization: `Bearer ${tok.access_token}` };
  const [u] = await fetch(`${base}/users?username=${encodeURIComponent(username)}&exact=true`, { headers: auth }).then((r) => r.json());
  if (u) await fetch(`${base}/users/${u.id}`, { method: "DELETE", headers: auth });
  return !!u;
}
const created = [];

const BASE = process.env.BASE ?? "http://localhost:3201";
const T = 30000;
const OUT = process.env.SHOTS ?? path.resolve("e2e/screenshots/onboarding");
mkdirSync(OUT, { recursive: true });

const stamp = Date.now().toString(36).slice(-6);
const applicant = { username: `e2e.reg${stamp}`, password: "Regist3r@2026", name: "Dr. Kamran Shah", email: `kamran.${stamp}@mehran-pharmacy.demo`, mobile: "0300-4567123" };
let n = 0;
const results = [];
const log = (...a) => {
  const line = `[${String(++n).padStart(2, "0")}] ${a.join(" ")}`;
  results.push(line);
  console.log(line);
};
const errors = [];

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });

const open = new Set();
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  ctx.setDefaultTimeout(T);
  const page = await ctx.newPage();
  open.add(page);
  page.on("close", () => open.delete(page));
  page.on("pageerror", (e) => errors.push(`pageerror ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Download the React DevTools|favicon/.test(m.text())) errors.push(`console ${m.text().slice(0, 200)}`);
  });
  return { ctx, page };
}

const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, "0")}-${name}.png`), fullPage: true });

/** Buttons stay "loading" (and ignore clicks) until the page refresh after an action finishes. */
const settle = (page) => page.waitForFunction(() => !document.querySelector(".ant-btn-loading"), null, { timeout: T });

async function toast(page, re) {
  const el = page.locator(".ant-message-notice", { hasText: re }).last();
  await el.waitFor({ timeout: T });
  const text = (await el.innerText()).trim();
  await settle(page);
  return text;
}

/** Demo persona switch (Keycloak password grant on the demo client), as the presenter guide does. */
async function switchTo(page, username, next) {
  await page.goto(`${BASE}/login`);
  await page.evaluate(
    ([u, nx]) => {
      const f = document.createElement("form");
      f.method = "POST";
      f.action = "/api/demo/switch";
      for (const [k, v] of [["username", u], ["next", nx]]) {
        const i = document.createElement("input");
        i.name = k;
        i.value = v;
        f.appendChild(i);
      }
      document.body.appendChild(f);
      f.submit();
    },
    [username, next],
  );
  await page.waitForURL((u) => u.pathname.startsWith(next.split("?")[0]), { timeout: T });
  await page.waitForLoadState("networkidle");
}

async function keycloakLogin(page, username, password) {
  await page.waitForURL(/\/auth\/realms\/pcp\//, { timeout: T });
  await page.locator("#password").waitFor();
  // With a live Keycloak session (logout refused on dev ports) Keycloak asks only to re-enter the password.
  if (await page.locator("#username").isVisible()) await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click("#kc-login");
  await page.waitForURL((u) => !u.toString().includes("/auth/realms/"), { timeout: T });
  await page.waitForLoadState("networkidle");
}

const drawer = (page) => page.locator(".ant-drawer.ant-drawer-open");
const modal = (page) => page.locator(".ant-modal-wrap").filter({ has: page.locator(".ant-modal:visible") }).last();

async function openStep(page, key) {
  await page.locator(`[data-step="${key}"] button`).click();
  await drawer(page).waitFor();
}
async function closeDrawer(page) {
  await drawer(page).locator(".ant-drawer-close").click();
  await drawer(page).waitFor({ state: "hidden" });
}

let code = null;
let ref = null;
try {
  // ---------- 1. Public self-registration ----------
  let { ctx: appCtx, page: app } = await newPage();
  await app.goto(`${BASE}/register`);
  await app.getByRole("button", { name: "Create account and send codes" }).click();
  await app.getByText("Enter your full name").waitFor();
  log("register: empty form is refused with field errors");
  await app.getByLabel("Applicant full name").fill(applicant.name);
  await app.getByLabel("Designation").fill("Principal");
  await app.getByLabel("Official email").fill(applicant.email);
  await app.getByLabel("Mobile number").fill("0300 4567");
  await app.getByLabel("Username").fill(applicant.username);
  await app.getByLabel("Password", { exact: true }).fill(applicant.password);
  await app.getByLabel("Confirm password").fill("Different@1");
  await app.getByRole("button", { name: "Create account and send codes" }).click();
  await app.getByText("Enter it as 03xx-xxxxxxx").waitFor();
  await app.getByText("The two passwords do not match").waitFor();
  log("register: bad mobile format and mismatched passwords are refused");
  await app.getByLabel("Mobile number").fill(applicant.mobile);
  await app.getByLabel("Confirm password").fill(applicant.password);
  await shot(app, "register-filled");
  await app.getByRole("button", { name: "Create account and send codes" }).click();
  await app.waitForURL(/\/register\/verify\?ref=REG-/, { timeout: T });
  ref = new URL(app.url()).searchParams.get("ref");
  created.push(applicant.username);
  log("register: account created →", ref, "for", applicant.username);

  // ---------- 2. Email and mobile codes ----------
  await app.getByText("Demo: no real email or SMS is sent").waitFor();
  await shot(app, "verify-codes");
  await app.locator("#email-code").fill("000000");
  await app.locator("#mobile-code").fill("000000");
  await app.getByRole("button", { name: "Verify codes" }).click();
  await app.getByText(/Both codes are wrong/).waitFor();
  await settle(app);
  log("verify: wrong codes are refused");
  await app.getByRole("button", { name: "Fill demo codes" }).click();
  await app.getByRole("button", { name: "Verify codes" }).click();
  await app.getByText("Your account is verified").waitFor();
  await shot(app, "verify-done");
  log("verify: both codes accepted");

  // ---------- 3. Sign in through Keycloak ----------
  await app.getByRole("button", { name: "Sign in to continue" }).click();
  await keycloakLogin(app, applicant.username, applicant.password);
  if (!app.url().includes("/onboarding")) throw new Error(`applicant landed on ${app.url()}`);
  log("sign-in: applicant lands on", new URL(app.url()).pathname);
  const blocked = await app.goto(`${BASE}/institution`).then(() => new URL(app.url()).pathname);
  log("access: applicant opening /institution is sent to", blocked);
  await app.goto(`${BASE}/onboarding`);
  if (!(await app.getByRole("button", { name: "Submit to PCP" }).isDisabled())) throw new Error("submit is not blocked");
  await shot(app, "checklist-empty");
  log("checklist: Submit to PCP is blocked while steps are open");

  // ---------- 4. Checklist steps with the demo buttons ----------
  await openStep(app, "profile");
  await drawer(app).getByRole("button", { name: "Save draft" }).click();
  log("profile: empty draft →", await toast(app, /Draft saved/));
  await drawer(app).getByRole("button", { name: "Fill demo values" }).click();
  await shot(app, "profile-form");
  await drawer(app).getByRole("button", { name: "Save profile" }).click();
  log("profile:", await toast(app, /Profile saved/));
  await drawer(app).waitFor({ state: "hidden" });

  await openStep(app, "campus");
  await drawer(app).getByRole("button", { name: "Add main campus" }).click();
  await modal(app).getByRole("button", { name: "Fill demo values" }).click();
  await modal(app).getByRole("button", { name: "Save campus" }).click();
  log("campus:", await toast(app, /saved as the main campus/));
  await drawer(app).getByRole("button", { name: "Add another campus" }).click();
  await modal(app).getByRole("button", { name: "Fill demo values" }).click();
  await modal(app).getByRole("button", { name: "Save campus" }).click();
  log("campus:", await toast(app, /Jamshoro campus saved/));
  await drawer(app).getByRole("button", { name: "Add programme" }).click();
  await modal(app).getByRole("button", { name: "Fill demo values" }).click();
  await modal(app).getByRole("button", { name: "Save programme" }).click();
  log("programme:", await toast(app, /Programme saved/));
  await app.waitForTimeout(500);
  await shot(app, "campus-programmes");
  await closeDrawer(app);

  await openStep(app, "documents");
  await drawer(app).getByRole("button", { name: "Attach sample PDFs" }).click();
  await drawer(app).getByText("All required documents are attached.").waitFor({ timeout: 60000 });
  await shot(app, "documents");
  log("documents: four legal documents uploaded");
  await closeDrawer(app);

  await app.getByText("4 of 4 complete").waitFor();
  await app.getByRole("button", { name: "Submit to PCP" }).click();
  await app.locator(".ant-popconfirm").getByRole("button", { name: "Submit" }).click();
  log("submit:", await toast(app, /Submitted to PCP/));
  await app.getByText(/Waiting for PCP · submitted/).waitFor();
  await shot(app, "submitted");

  // ---------- 5. PCP returns it with a reason ----------
  let { ctx: pcpCtx, page: pcp } = await newPage();
  await switchTo(pcp, "pcp.registration", "/pcp/onboarding");
  await pcp.getByRole("link", { name: ref }).waitFor();
  await shot(pcp, "pcp-queue");
  log("pcp: request is in the queue →", ref);
  await pcp.getByRole("link", { name: ref }).click();
  await pcp.waitForURL(new RegExp(`/pcp/onboarding/${ref}`));
  await pcp.locator('[data-doc="Building ownership or lease"]').getByRole("button", { name: "Not acceptable" }).click();
  log("pcp:", await toast(pcp, /not acceptable/));
  await pcp.getByRole("button", { name: "Approve and issue Institution ID" }).waitFor();
  if (!(await pcp.getByRole("button", { name: "Approve and issue Institution ID" }).isDisabled())) throw new Error("approve is not blocked with a rejected document");
  log("pcp: approval is blocked until every document is verified");
  await pcp.locator(".ant-btn", { hasText: "Fill demo values" }).first().click();
  await pcp.getByRole("button", { name: "Return to applicant" }).click();
  log("pcp:", await toast(pcp, /Returned to/));

  // ---------- 6. Applicant fixes and resubmits ----------
  await app.reload();
  await app.getByText("PCP returned your request for changes").waitFor();
  await app.getByText("The building lease is not signed by the owner").first().waitFor();
  await shot(app, "returned");
  log("applicant: sees PCP's reason for the return");
  await openStep(app, "documents");
  await drawer(app).locator('[data-doc="Building ownership or lease"]').getByRole("button", { name: "Sample PDF" }).click();
  log("applicant:", await toast(app, /Building ownership or lease: uploaded v2/));
  await closeDrawer(app);
  await app.getByRole("button", { name: "Resubmit to PCP" }).click();
  await app.locator(".ant-popconfirm").getByRole("button", { name: "Resubmit" }).click();
  log("applicant:", await toast(app, /Submitted to PCP/));

  // ---------- 7. PCP approves with a one-time code ----------
  await pcp.reload();
  await pcp.getByRole("button", { name: "Verify all pending" }).click();
  log("pcp:", await toast(pcp, /documents? verified/));
  await pcp.getByRole("button", { name: "Approve and issue Institution ID" }).click();
  await pcp.locator("#otp-code").waitFor();
  await shot(pcp, "approve-otp");
  await pcp.locator(".ant-modal").getByRole("button", { name: "Confirm" }).click();
  const approved = await toast(pcp, /Approved\./);
  code = approved.match(/PCP-UNI-\d{6}/)?.[0];
  if (!code) throw new Error("no institution ID in: " + approved);
  log("pcp:", approved);
  await pcp.getByText("With: Closed").waitFor();
  await shot(pcp, "approved-pcp");
  await pcpCtx.close();

  // ---------- 8. Applicant signs in again and lands on the institution portal ----------
  await app.reload();
  await app.getByTestId("institution-code").waitFor();
  const shown = (await app.getByTestId("institution-code").innerText()).trim();
  if (shown !== code) throw new Error(`checklist shows ${shown}, expected ${code}`);
  await shot(app, "approved-applicant");
  log("applicant: checklist shows the issued ID", shown);
  await app.getByRole("button", { name: "Sign out and sign in again to open your institution portal" }).click();
  await app.waitForURL((u) => !u.pathname.startsWith("/onboarding"), { timeout: T });
  await app.waitForLoadState("networkidle");
  const after = app.url();
  // The shared realm allows post-logout redirects to :8088 only, so on a dev port Keycloak shows "Invalid redirect uri".
  log("sign-out: ended at", after.includes("/protocol/openid-connect/logout") ? `Keycloak's logout page (${(await app.locator("body").innerText()).trim().split("\n")[0].slice(0, 60)})` : after.replace(BASE, "") || "/");
  await app.goto(`${BASE}/onboarding`);
  if (!app.url().includes("/login")) throw new Error("the app session survived sign-out");
  log("sign-out: the portal session is gone (/onboarding → /login)");
  await app.goto(`${BASE}/login`);
  await app.getByRole("button", { name: "Sign in with another account" }).click();
  await keycloakLogin(app, applicant.username, applicant.password);
  await app.waitForURL(/\/institution/, { timeout: T });
  const ws = (await app.locator(".pcp-workspace-code").innerText()).trim();
  if (ws !== code) throw new Error(`institution portal shows ${ws}, expected ${code}`);
  log("sign-in again: lands on", new URL(app.url()).pathname, "as Head of", ws, "·", (await app.locator("h1").first().innerText()).trim());
  await shot(app, "institution-dashboard");
  await app.goto(`${BASE}/institution/profile`);
  await app.getByText("Campuses (2)").waitFor();
  await app.getByText("No NOC yet").first().waitFor();
  await shot(app, "institution-profile");
  log("profile: 2 campuses and the PharmD programme (no NOC yet) came from the request");
  await app.goto(`${BASE}/institution/documents`);
  await app.waitForLoadState("networkidle");
  await shot(app, "institution-documents");
  await appCtx.close();

  // ---------- 9. The Head adds a user (Riverside) ----------
  const { ctx: headCtx, page: head } = await newPage();
  await switchTo(head, "ruh.poc", "/institution/users");
  await head.getByRole("button", { name: "Add user" }).click();
  await drawer(head).getByRole("button", { name: "Fill demo values" }).click();
  const newUser = await drawer(head).getByLabel("Username").inputValue();
  await shot(head, "users-add");
  await drawer(head).getByRole("button", { name: "Create account" }).click();
  log("head:", await toast(head, /added as/));
  created.push(newUser);
  const temp = (await head.locator(".ant-modal").getByText(/^Pcp-/).innerText()).trim();
  await shot(head, "users-temp-password");
  log("head: temporary password shown once for", newUser, temp ? "(Pcp-…)" : "");
  await head.locator(".ant-modal").getByRole("button", { name: "OK" }).click();
  const row = head.locator("tr", { hasText: newUser });
  await row.getByRole("button", { name: "Disable" }).click();
  await head.locator(".ant-popconfirm").getByRole("button", { name: "Disable" }).click();
  log("head:", await toast(head, /disabled/));
  await row.getByRole("button", { name: "Enable" }).click();
  log("head:", await toast(head, /can sign in again/));
  const ownRow = head.locator("tr", { hasText: "ruh.poc" });
  if ((await ownRow.getByRole("button", { name: "Disable" }).count()) !== 0) throw new Error("the Head can disable themselves");
  log("head: no Disable button on the Head's own row");
  await shot(head, "users-list");

  // ---------- 10. Idle timeout warning (short limit for the test) ----------
  await head.evaluate(() => localStorage.setItem("pcp.idleTimeoutMs", "65000"));
  await head.reload();
  await head.getByText("Are you still there?").waitFor({ timeout: 15000 });
  await shot(head, "idle-warning");
  await head.getByRole("button", { name: "Stay signed in" }).click();
  await head.getByText("Are you still there?").waitFor({ state: "hidden" });
  log("idle: one-minute warning shown, Stay signed in keeps the session");
  await head.evaluate(() => localStorage.removeItem("pcp.idleTimeoutMs"));
  await headCtx.close();

  // ---------- 11. Reference rules and the Super Admin role picker ----------
  const { ctx: adminCtx, page: admin } = await newPage();
  await switchTo(admin, "pcp.admin", "/pcp/rules");
  await shot(admin, "rules");
  await admin.locator("tr", { hasText: "ref.universities" }).getByRole("button", { name: "Edit" }).click();
  const list = drawer(admin).locator("#rule-list");
  await list.fill((await list.inputValue()) + `\nTest University ${stamp}, Hyderabad`);
  await drawer(admin).locator("#rule-note").fill("Added a university for the onboarding test");
  await drawer(admin).getByRole("button", { name: /Save as version/ }).click();
  log("rules:", await toast(admin, /saved as version/));
  await drawer(admin).getByText("Superseded").waitFor();
  await shot(admin, "rules-history");
  log("rules: the earlier version is kept in the history");
  await admin.goto(`${BASE}/pcp/admin`);
  await admin.getByRole("button", { name: "Add user" }).click();
  await drawer(admin).getByLabel("Role").click();
  const options = await admin.locator(".ant-select-dropdown:visible .ant-select-item-option").count();
  await shot(admin, "admin-role-picker");
  log("admin: the role picker offers", options, "roles (8 PCP + 6 institution)");
  if (options < 14) throw new Error("role picker is missing roles");
  await adminCtx.close();

  console.log(`\nONBOARDING TEST PASSED · ${ref} → ${code} · applicant ${applicant.username}`);
  if (errors.length) console.log(`Browser errors (${errors.length}):\n  ${[...new Set(errors)].slice(0, 10).join("\n  ")}`);
} catch (e) {
  console.error("\nONBOARDING TEST FAILED after step", n, e);
  let i = 0;
  for (const p of open) await p.screenshot({ path: path.join(OUT, `FAILED-${++i}.png`), fullPage: true }).catch(() => undefined);
  if (errors.length) console.error(`Browser errors:\n  ${[...new Set(errors)].slice(0, 10).join("\n  ")}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  // Keycloak is shared by every copy of the app: remove the accounts this run created.
  if (!process.env.KEEP)
    for (const u of created) console.log(`cleanup: Keycloak user ${u} ${(await deleteKeycloakUser(u).catch(() => false)) ? "deleted" : "not found"}`);
}
