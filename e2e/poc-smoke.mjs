// A hosted POC (QUICK_LOGIN=off): no one-click entry anywhere, and each key account signs in through the
// real Keycloak form with its own password from the credentials sheet, lands in its own area, and nowhere else.
//   BASE=https://... CREDS=deploy/poc-credentials.json node e2e/poc-smoke.mjs
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:7860";
const CREDS = JSON.parse(readFileSync(process.env.CREDS ?? "deploy/poc-credentials.json", "utf8"));
const T = BASE.includes("localhost") ? 30000 : 60000;
const pass = (u) => CREDS.find((c) => c.username === u)?.password ?? (() => { throw new Error(`no password for ${u}`); })();

let failed = 0;
const ok = (cond, what) => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${what}`);
  if (!cond) failed++;
};

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
try {
  // 1. Nothing offers one-click entry
  {
    const page = await (await browser.newContext()).newPage();
    const sw = await page.request.post(`${BASE}/api/demo/switch`, { form: { username: "pcp.admin", next: "/pcp" }, maxRedirects: 0 });
    ok(sw.status() === 404, `the one-click switch is off (POST /api/demo/switch → ${sw.status()})`);
    const ctxApi = await page.request.get(`${BASE}/api/demo/context`);
    ok(ctxApi.status() === 404, `the presenter guide's API is off (${ctxApi.status()})`);
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    const body = await page.locator("body").innerText();
    ok(!/Demo@1234|Enter as|one-click/i.test(body), "the sign-in page lists no users and no shared password");
    ok(!(await page.getByText("Presenter guide").count()), "no presenter guide");
    await page.goto(`${BASE}/coverage`, { waitUntil: "networkidle" });
    ok(!(await page.locator('form[action="/api/demo/switch"]').count()), "the coverage page has no one-click Try it buttons");
  }

  // 2. Real sign-in, per account
  const accounts = [
    ["ruh.poc", "/institution"],
    ["ruh.entry", "/institution"],
    ["pcp.registration", "/pcp"],
    ["pcp.secretary", "/pcp"],
    ["pcp.inspector", "/pcp"],
    ["punjab.council", "/province"],
    ["fac.noor", "/faculty"],
    ["student.ruh", "/student"],
    ["pharm.ali", "/pharmacist"],
  ];
  for (const [username, home] of accounts) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.locator("form button[type=submit]", { hasText: /^\s*Sign in\s*$/ }).first().click();
    await page.waitForURL(/\/auth\/realms\/pcp\//, { timeout: T });
    // The old shared password must not work.
    await page.fill("#username", username);
    await page.fill("#password", "Demo@1234");
    await page.click("#kc-login");
    await page.waitForLoadState("networkidle");
    const refused = page.url().includes("/auth/realms/pcp/");
    await page.fill("#username", username);
    await page.fill("#password", pass(username));
    await page.click("#kc-login");
    await page.waitForURL((u) => !u.toString().includes("/auth/realms/"), { timeout: T });
    if (page.url().includes("/login/code")) {
      await page.waitForFunction(() => document.querySelector("#signin-code")?.value?.length === 6, null, { timeout: T });
      await page.getByRole("button", { name: "Continue" }).click();
    }
    await page.waitForURL((u) => u.pathname.startsWith(home), { timeout: T });
    const other = home === "/pcp" ? "/institution" : "/pcp";
    await page.goto(`${BASE}${other}`);
    const kept = !new URL(page.url()).pathname.startsWith(other);
    ok(refused && kept, `${username}: Demo@1234 refused, own password lands on ${home}, ${other} closed`);
    await ctx.close();
  }
} catch (e) {
  failed++;
  console.log("ERROR", e.message);
} finally {
  await browser.close();
}
console.log(failed ? `\nPOC SMOKE FAILED (${failed})` : "\nPOC SMOKE PASSED");
process.exit(failed ? 1 : 0);
