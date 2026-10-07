// End-to-end test of the section 14 gaps module: simulated NADRA check, quarterly access review,
// measures of success report, retention clean-up and the privacy notice.
// Run against a freshly seeded app:  BASE=http://localhost:3207 node e2e/modules/gaps.mjs
// Keycloak is shared: the only account this test changes is a throwaway one it creates and then deletes.
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3207";
const T = 30000;
const OUT = process.env.SHOTS ?? path.resolve("e2e/screenshots/gaps");
mkdirSync(OUT, { recursive: true });
let n = 0;
const log = (...a) => console.log(`[${++n}]`, ...a);
const shot = async (page, name) => {
  await page.waitForTimeout(500);
  return page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, "0")}-${name}.png`), fullPage: true });
};
const expect = (cond, what) => {
  if (!cond) throw new Error(`Expected: ${what}`);
};
const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
/** A CNIC with a chosen ending: "0000" not found, "1111" name differs, otherwise a match. */
const cnic = (tail) => (tail ? `17301-${rnd(1000, 9999)}${tail.slice(0, 3)}-${tail.slice(3)}` : `17301-${rnd(1000000, 9999999)}-${rnd(2, 9)}`);
const plainCnic = () => {
  for (;;) {
    const c = cnic();
    const d = c.replace(/\D/g, "").slice(-4);
    if (d !== "0000" && d !== "1111") return c;
  }
};

// Keycloak admin REST, only for the throwaway account (check it was disabled, then delete it).
const env = Object.fromEntries(
  readFileSync(path.resolve(".env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const ISSUER = env.AUTH_KEYCLOAK_ISSUER;
const KC = ISSUER.replace("/realms/", "/admin/realms/");
async function kc(p, init = {}) {
  const tok = await (
    await fetch(`${ISSUER}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.KEYCLOAK_ADMIN_CLIENT_ID ?? "pcp-admin-api", client_secret: env.KEYCLOAK_ADMIN_CLIENT_SECRET }),
    })
  ).json();
  return fetch(`${KC}${p}`, { ...init, headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" } });
}

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });

async function login(username, next = "/home", viewport = { width: 1440, height: 950 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  ctx.setDefaultTimeout(T);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  const card = page.locator(`[data-username="${username}"]`).getByRole("button", { name: /^Enter as/ });
  if (await card.count()) await card.click();
  else await page.request.post(`${BASE}/api/demo/switch`, { form: { username, next }, maxRedirects: 0 });
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: T }).catch(() => {});
  if (!page.url().includes(next.split("?")[0])) await page.goto(`${BASE}${next}`);
  await page.waitForLoadState("networkidle");
  return { ctx, page };
}
const toast = async (page, re) => {
  const el = page.locator(".ant-message-notice", { hasText: re }).first();
  await el.waitFor({ timeout: T });
  return (await el.innerText()).trim();
};
const otp = async (page) => {
  const dlg = page.locator(".ant-modal", { hasText: "Confirm with a one-time code" });
  await dlg.waitFor();
  await dlg.getByRole("button", { name: "Confirm" }).click();
};
const closeDrawer = async (page) => {
  await page.locator(".ant-drawer-open .ant-drawer-close").last().click();
  await page.waitForTimeout(400);
};

const throwaway = `gaps.tmp.${Date.now().toString(36)}`;
let created = false;
let ctx, page;
try {
  // ---------- 1. NADRA check on a new faculty person: MATCH, then a CNIC ending 1111 ----------
  ({ ctx, page } = await login("ruh.poc", "/institution/faculty"));
  const addPerson = async (values) => {
    await page.getByRole("button", { name: "Add faculty member" }).click();
    const drawer = page.locator(".ant-drawer-open", { hasText: "Checks run when you save" });
    await drawer.getByLabel("CNIC").fill(values.cnic);
    await drawer.getByLabel("Full name").fill(values.fullName);
    await drawer.getByLabel("Father's name").fill(values.fatherName);
    await drawer.getByRole("button", { name: "Save and run checks" }).click();
    const saved = drawer.locator(".ant-alert", { hasText: /Saved as|Did you mean/ });
    await saved.first().waitFor({ timeout: T });
    if (/Did you mean/.test(await saved.first().innerText())) await drawer.getByRole("button", { name: "No, a different person" }).click();
    const alert = drawer.locator(".ant-alert", { hasText: "Saved as" });
    await alert.waitFor({ timeout: T });
    const text = (await alert.innerText()).trim();
    return { text, pcpId: /PCP-FAC-\d{6}/.exec(text)?.[0], drawer };
  };
  const first = await addPerson({ cnic: plainCnic(), fullName: "Dr. Zubair Hamdani", fatherName: "Qasim Hamdani" });
  expect(/Simulated NADRA check: CNIC and name match/.test(first.text), `new person matches at NADRA (got: ${first.text})`);
  log("new faculty →", first.text.slice(0, 140));
  await shot(page, "faculty-nadra-match");
  await closeDrawer(page);

  const second = await addPerson({ cnic: cnic("1111"), fullName: "Dr. Kashif Mehmood", fatherName: "Tariq Mehmood" });
  expect(/NADRA holds the name as "Kashif Mahmood"/.test(second.text), `CNIC ending 1111 → name differs (got: ${second.text})`);
  log("CNIC ending 1111 →", second.text.slice(0, 160));
  await closeDrawer(page);
  // The record shows the badge, and the check can be run again from it.
  await page.locator("tr", { hasText: first.pcpId }).getByRole("button", { name: /Change|View/ }).first().click();
  const rec = page.locator(".ant-drawer-open");
  expect(/NADRA verified/.test(await rec.getByTestId("nadra-badge").innerText()), "the record shows 'NADRA verified'");
  await rec.getByTestId("nadra-check").click();
  log("check again →", await toast(page, /Simulated NADRA check/));
  await shot(page, "faculty-record-badge");
  await closeDrawer(page);
  await ctx.close();

  // ---------- 2. PCP resolves the mismatch on Data verification ----------
  ({ ctx, page } = await login("pcp.verification", "/pcp/verification?tab=nadra"));
  const item = page.getByTestId(`nadra-item-${second.pcpId}`);
  await item.waitFor();
  expect(/Kashif Mahmood/.test(await item.innerText()), "the item shows NADRA's spelling");
  expect((await page.locator('[data-testid^="nadra-item-"]').count()) >= 4, "the three seeded items are waiting too");
  await shot(page, "verification-nadra-items");
  await item.getByRole("button", { name: "Use NADRA's spelling" }).click();
  const modal = page.locator(".ant-modal", { hasText: "Use NADRA's spelling for" });
  await modal.getByLabel("Resolution note").fill("CNIC copy checked; NADRA's spelling is correct");
  await modal.getByRole("button", { name: "Update the name and resolve" }).click();
  log("resolve →", await toast(page, /now reads "Kashif Mahmood"/));
  await page.waitForTimeout(800);
  expect((await page.getByTestId(`nadra-item-${second.pcpId}`).count()) === 0, "the item leaves the open list");
  expect(/NADRA spelling applied/.test(await page.locator(".ant-card", { hasText: "Resolved (" }).innerText()), "it is listed as resolved");
  await shot(page, "verification-nadra-resolved");
  await ctx.close();

  // ---------- 3. Student bulk import with NADRA results per row ----------
  ({ ctx, page } = await login("ruh.poc", "/institution/students"));
  const tag = Date.now().toString().slice(-3);
  const csv = [
    "full_name,father_name,cnic,mobile,email,programme,session,enrolment_year,year_of_study",
    `Saima Gul,Gul Muhammad,${plainCnic()},0301-5551${tag},,PHARMD,Morning,2026,1`,
    `Muhammad Hamza Aslam,Muhammad Aslam,${cnic("1111")},0302-5552${tag},,PHARMD,Evening,2026,1`,
    `Iqra Shaheen,Shaheen Akhtar,${cnic("0000")},0303-5553${tag},,PHARMD,Morning,2026,1`,
  ].join("\n");
  const csvPath = path.join(OUT, "students-nadra.csv");
  writeFileSync(csvPath, csv);
  await page.getByRole("button", { name: "Bulk upload" }).click();
  const bulk = page.locator(".ant-drawer", { hasText: "Bulk upload of students" });
  await bulk.locator('input[type="file"]').setInputFiles(csvPath);
  await bulk.getByTestId("upload-report").waitFor();
  await bulk.getByRole("button", { name: "Import 3 valid rows" }).click();
  await page.locator(".ant-modal-confirm").getByRole("button", { name: "Import 3 rows" }).click();
  log("import →", await toast(page, /Imported 3 students/));
  const nadra = bulk.getByTestId("import-nadra");
  await nadra.waitFor();
  const nt = await nadra.innerText();
  expect(/NADRA verified/.test(nt) && /Name differs at NADRA: Mohammad Hamza Aslam/.test(nt) && /Not found at NADRA/.test(nt), "the import report shows all three NADRA outcomes");
  log("NADRA per row →", nt.split("\n").filter((l) => /NADRA/.test(l)).join(" | "));
  await nadra.scrollIntoViewIfNeeded();
  await shot(page, "student-import-nadra");
  await ctx.close();

  // ---------- 4. Access review with a throwaway account ----------
  ({ ctx, page } = await login("pcp.admin", "/pcp/admin"));
  await page.getByRole("button", { name: "Add user" }).click();
  const ud = page.locator(".ant-drawer-open", { hasText: "Add a user" });
  await ud.getByLabel("Full name").fill("Temporary Gaps Tester");
  await ud.getByLabel("Email").fill(`${throwaway}@demo.pcp.local`);
  await ud.getByLabel("Username").fill(throwaway);
  await ud.getByRole("button", { name: "Create account" }).click();
  await page.locator(".ant-modal", { hasText: "temporary password" }).getByRole("button", { name: "OK" }).click();
  created = true;
  log("throwaway account →", throwaway);
  await page.goto(`${BASE}/pcp/admin?tab=access`);
  const ar = page.getByTestId("access-review");
  await ar.waitFor();
  expect(/review due/.test(await ar.getByTestId("access-review-status").innerText()), "the quarter's review is due");
  expect(/Next review due 1 Jan 2027/.test(await ar.getByTestId("next-review").innerText()), "next review due 1 Jan 2027");
  await ar.getByLabel("Search accounts").fill(throwaway);
  await ar.getByTestId(`decide-${throwaway}`).getByText("Remove access").click();
  await shot(page, "access-review-remove");
  await ar.getByTestId("record-review").click();
  await otp(page);
  log("record →", await toast(page, /recorded: \d+ accounts kept, 1 removed/));
  await page.getByTestId("access-review-status").filter({ hasText: "review recorded" }).waitFor({ timeout: T }).catch(() => {});
  expect(/review recorded/.test(await page.getByTestId("access-review-status").innerText()), "the quarter shows as recorded");
  const u = (await (await kc(`/users?username=${encodeURIComponent(throwaway)}&exact=true`)).json())[0];
  expect(u && u.enabled === false, "Keycloak shows the throwaway account disabled");
  const demo = (await (await kc(`/users?username=ruh.poc&exact=true`)).json())[0];
  expect(demo?.enabled, "demo accounts stay enabled");
  log("Keycloak →", `${throwaway} enabled=${u.enabled}; ruh.poc enabled=${demo.enabled}`);
  await shot(page, "access-review-recorded");
  // The dashboard task disappears once the quarter is reviewed.
  await page.goto(`${BASE}/pcp`);
  expect((await page.getByTestId("admin-tasks").count()) === 0, "no 'Quarterly access review due' task after recording");

  // ---------- 5. Retention: dry run, then clean-up ----------
  await page.goto(`${BASE}/pcp/admin?tab=retention`);
  const ret = page.getByTestId("retention");
  await ret.waitFor();
  const counts = await ret.getByTestId("retention-counts").innerText();
  expect(/Draft applications: 1/.test(counts) && /Onboarding drafts: 1/.test(counts), `preview lists the stale drafts (got: ${counts})`);
  expect((await ret.innerText()).includes("NOC-2025-0006"), "the stale draft NOC-2025-0006 is listed");
  await shot(page, "retention-preview");
  await ret.getByTestId("retention-dry-run").click();
  log("dry run →", await toast(page, /Dry run recorded/));
  await ret.getByTestId("retention-run").click();
  await otp(page);
  log("run →", await toast(page, /^Cleared/));
  await page.waitForTimeout(1000);
  const after = await page.getByTestId("retention-counts").innerText();
  expect(/Draft applications: 0/.test(after) && /Onboarding drafts: 0/.test(after), `nothing left to clear (got: ${after})`);
  const runs = await page.locator(".ant-card", { hasText: "Last runs" }).innerText();
  expect(/Dry run/.test(runs) && /Clean-up/.test(runs), "both runs are listed");
  await shot(page, "retention-after-run");
  await ctx.close();

  // ---------- 6. Measures of success: drill-down and Excel ----------
  ({ ctx, page } = await login("pcp.officer", "/pcp/reports?tab=measures"));
  const rep = page.getByTestId("report-measures");
  await rep.waitFor();
  const kpis = await rep.getByTestId("report-kpis").innerText();
  expect(/Days to decide an NOC/.test(kpis) && /Target: within 60 days/.test(kpis) && /Annual return on time/.test(kpis), "headline figures with targets");
  log("headline →", kpis.replace(/\n+/g, " | ").slice(0, 220));
  await shot(page, "measures-report");
  await rep.getByTestId("kpi-noc").click();
  const drill = page.getByTestId("drill-list");
  await drill.locator("tbody tr.ant-table-row").first().waitFor();
  const dt = await drill.innerText();
  expect(/NOC-20\d\d-\d{4}/.test(dt) && /Days to decide/.test(dt), "the NOC figure opens its list of cases");
  log("drill-down →", dt.split("\n").find((l) => /NOC-/.test(l)));
  await shot(page, "measures-drill");
  await closeDrawer(page);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-measures").getByRole("link", { name: /Excel/ }).or(page.getByTestId("export-measures").getByRole("button", { name: /Excel/ })).first().click()]);
  const file = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(file);
  const buf = readFileSync(file);
  expect(buf.subarray(0, 2).toString() === "PK" && /measures/.test(dl.suggestedFilename()), "Excel file downloads");
  log("Excel →", dl.suggestedFilename(), `${buf.length} bytes`);
  await ctx.close();

  // ---------- 7. Privacy notice in English and Urdu at phone width ----------
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  page = await ctx.newPage();
  await page.goto(`${BASE}/verify`);
  await page.getByTestId("verify-privacy").click();
  await page.waitForURL(/\/privacy/);
  await page.getByTestId("privacy-notice").waitFor();
  const en = await page.innerText("body");
  expect(/Draft for Council approval/.test(en) && /Never shows/.test(en) && /CNIC, phone number, email, home address/.test(en), "English notice: draft, and what the search never shows");
  expect(/90 days/.test(en), "retention values from the rule are shown");
  const wEn = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(wEn <= 390, `no horizontal scroll in English (scrollWidth ${wEn})`);
  await shot(page, "privacy-en-phone");
  await ctx.addCookies([{ name: "pcp_lang", value: "ur", url: BASE }]);
  await page.reload();
  await page.getByTestId("privacy-notice").waitFor();
  const ur = await page.innerText("body");
  expect(/کونسل کی منظوری کے لیے مسودہ/.test(ur) && /رازداری کا نوٹس/.test(ur), "Urdu notice");
  expect((await page.locator('[dir="rtl"]').count()) > 0, "Urdu is right to left");
  const wUr = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(wUr <= 390, `no horizontal scroll in Urdu (scrollWidth ${wUr})`);
  await shot(page, "privacy-ur-phone");
  expect((await page.getByTestId("footer-privacy").count()) === 1, "the footer links the notice");
  log("privacy →", `EN width ${wEn}, UR width ${wUr}`);
  await ctx.close();

  console.log(`\nPASS: ${n} steps. Screenshots in ${OUT}`);
} catch (e) {
  console.error("\nFAIL:", e.message);
  if (page) await page.screenshot({ path: path.join(OUT, "zz-failure.png"), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (created) {
    const u = (await (await kc(`/users?username=${encodeURIComponent(throwaway)}&exact=true`)).json())[0];
    if (u) {
      const r = await kc(`/users/${u.id}`, { method: "DELETE" });
      console.log(`cleanup: deleted throwaway Keycloak account ${throwaway} (HTTP ${r.status})`);
    }
  }
  await browser.close();
}
