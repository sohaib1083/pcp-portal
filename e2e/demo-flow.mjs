// End-to-end walk through the whole NOC story with real Keycloak logins.
// Run: node e2e/demo-flow.mjs   (app at http://localhost:8088, fresh seed)
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

const BASE = process.env.BASE ?? "http://localhost:8088";
// Over a public tunnel every page crosses the internet twice, so allow more time.
const T = BASE.includes("localhost") ? 20000 : 60000;
const OUT = process.env.SHOTS ?? path.resolve("e2e/screenshots");
mkdirSync(OUT, { recursive: true });
let step = 0;
const log = (...a) => console.log(`[${++step}]`, ...a);

async function pdf(name) {
  const doc = await PDFDocument.create();
  const p = doc.addPage([400, 300]);
  p.drawText(`Demo upload: ${name}`, { x: 30, y: 250, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  const file = path.join(OUT, `${name.replace(/\W+/g, "-")}.pdf`);
  writeFileSync(file, await doc.save());
  return file;
}

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });

async function login(username) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  ctx.setDefaultTimeout(T);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.locator(`[data-username="${username}"]`).getByRole("button", { name: /Sign in with Keycloak/ }).click();
  await page.waitForURL(/\/auth\/realms\/pcp\//, { timeout: T });
  await page.fill("#username", username);
  await page.fill("#password", "Demo@1234");
  await page.click("#kc-login");
  await page.waitForURL((u) => !u.toString().includes("/auth/realms/"), { timeout: T });
  await page.waitForLoadState("networkidle");
  return { ctx, page };
}

const toast = async (page, re) => {
  const el = page.locator(".ant-message-notice", { hasText: re }).first();
  await el.waitFor({ timeout: T });
  return (await el.innerText()).trim();
};
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${String(step).padStart(2, "0")}-${name}.png`), fullPage: true });

try {
  // 0. Route protection (proxy): signed-out users are sent to sign-in
  {
    const anon = await (await browser.newContext()).newPage();
    await anon.goto(`${BASE}/pcp/applications`);
    log("signed-out /pcp/applications →", anon.url().replace(BASE, ""));
    if (!anon.url().includes("/login")) throw new Error("proxy did not protect /pcp");
  }

  // 1. The institution POC starts a technician NOC
  let { ctx, page } = await login("ruh.poc");
  log("ruh.poc signed in →", page.url());
  await page.goto(`${BASE}/pcp/applications`);
  log("ruh.poc trying /pcp/applications →", page.url().replace(BASE, ""));
  if (page.url().includes("/pcp")) throw new Error("institution user reached /pcp");
  await shot(page, "institution-dashboard");
  await page.goto(`${BASE}/institution/applications`);
  await page.getByRole("button", { name: /New NOC application/ }).hover();
  await page.getByText("New Pharmacy Technician NOC application").click();
  await page.waitForURL(/\/institution\/applications\/NOC-/);
  const ref = page.url().split("/").pop();
  log("created", ref);
  await page.getByLabel("Campus").fill("Hayatabad campus, Peshawar");
  await page.getByLabel("Proposed intake (students per year)").fill("60");
  await page.getByLabel("Classrooms").fill("4");
  await page.getByLabel("Laboratories", { exact: true }).fill("3");
  await page.getByLabel("Library books").fill("800");
  await page.getByRole("button", { name: "Save and run checks" }).click();
  await toast(page, /Saved/);
  for (const doc of ["Charter or affiliation letter", "Building plan", "Laboratory inventory"]) {
    await page.locator(".ant-list-item", { hasText: doc }).locator('input[type="file"]').setInputFiles(await pdf(doc));
    await toast(page, /Uploaded v1/);
    await page.waitForTimeout(400);
  }
  await page.reload();
  const failing1 = await page.locator(".ant-card", { hasText: "Faculty count" }).first().innerText();
  log("checks after form + docs:", /Faculty count[\s\S]*?(\d+ active faculty linked; \d+ needed)/.exec(failing1)?.[1]);

  // 2. Faculty: blocked CNIC, then a near-duplicate
  await page.goto(`${BASE}/institution/faculty`);
  await page.getByRole("button", { name: "Add faculty member" }).click();
  await page.getByLabel("CNIC").fill("35202-7654321-2");
  await page.getByLabel("Full name").fill("Dr. Sara Malik");
  await page.getByLabel("Father's name").fill("Javed Malik");
  await page.locator(".ant-drawer").getByRole("button", { name: "Save and run checks" }).click();
  log("CNIC active elsewhere →", (await page.locator(".ant-drawer .ant-alert-error").innerText({ timeout: T })).slice(0, 80));
  await page.getByLabel("CNIC").fill("17301-7777777-1");
  await page.getByLabel("Full name").fill("Dr. Mohammad Ali Khan");
  await page.getByLabel("Father's name").fill("Abdul Ghafoor Khan");
  await page.locator(".ant-drawer").getByRole("button", { name: "Save and run checks" }).click();
  log("near-duplicate →", (await page.locator(".ant-drawer .ant-alert-warning").last().innerText({ timeout: T })).slice(0, 90));
  await page.keyboard.press("Escape");

  // 3. Same POC pays the fee (no separate finance user any more)
  await page.goto(`${BASE}/institution/applications/${ref}`);
  await page.getByRole("button", { name: /Generate challan/ }).click();
  await toast(page, /PSID/);
  await page.getByRole("button", { name: /Simulate bank confirmation/ }).click();
  log("POC paid →", await toast(page, /Payment confirmed/));
  await ctx.close();

  // 4. PCP officer clears the duplicate flag
  ({ ctx, page } = await login("pcp.officer"));
  await page.goto(`${BASE}/institution`);
  log("pcp.officer trying /institution →", page.url().replace(BASE, ""));
  await page.goto(`${BASE}/pcp/verification`);
  const flagCard = page.locator(".ant-card").filter({ hasText: "Dr. Mohammad Ali Khan" }).filter({ has: page.getByRole("button", { name: /Different people/ }) }).filter({ hasNotText: "Possible duplicates (" });
  await flagCard.getByRole("button", { name: /Different people/ }).click();
  log("officer →", await toast(page, /flag is cleared/i));
  await ctx.close();

  // 5. POC re-runs checks and submits
  ({ ctx, page } = await login("ruh.poc"));
  await page.goto(`${BASE}/institution/applications/${ref}`);
  await page.getByRole("button", { name: "Re-run" }).click();
  await toast(page, /Checks re-run/);
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /Submit application/ }).click();
  log("POC →", await toast(page, /Submitted|Cannot/));
  await ctx.close();

  // 6. Officer: scrutiny + deficiency
  ({ ctx, page } = await login("pcp.officer"));
  await page.goto(`${BASE}/pcp/applications/${ref}`);
  await page.getByRole("button", { name: /Start scrutiny/ }).click();
  await toast(page, /Scrutiny started/);
  await page.getByLabel("Required action").fill("Upload the lab safety certificate for the Pharmaceutics lab");
  await page.getByLabel("Evidence required").fill("Safety certificate");
  await page.getByRole("button", { name: "Raise deficiency", exact: true }).click();
  log("officer →", await toast(page, /Deficiency raised/));
  await ctx.close();

  // 7. POC responds
  ({ ctx, page } = await login("ruh.poc"));
  await page.goto(`${BASE}/institution/applications/${ref}`);
  await page.getByPlaceholder("What did you do to fix it?").fill("Safety certificate obtained from the district fire officer; attached.");
  await page.getByRole("button", { name: "Submit response" }).click();
  log("POC →", await toast(page, /Response submitted/));
  await ctx.close();

  // 8. Officer accepts, then schedules the inspection (conflict of interest first)
  ({ ctx, page } = await login("pcp.officer"));
  await page.goto(`${BASE}/pcp/applications/${ref}`);
  await page.getByRole("button", { name: "Accept" }).click();
  log("officer →", await toast(page, /accepted/));
  await page.waitForTimeout(800);
  await page.locator(".pcp-inspector-select").click();
  await page.locator(".ant-select-item-option", { hasText: "Zainab" }).click();
  await page.getByRole("button", { name: "Schedule and notify" }).click();
  log("COI →", (await toast(page, /Conflict of interest/)).slice(0, 90));
  await page.locator(".pcp-inspector-select").click();
  await page.locator(".ant-select-item-option", { hasText: "Kamran" }).click();
  await page.getByRole("button", { name: "Schedule and notify" }).click();
  log("officer →", await toast(page, /Inspection scheduled/));
  await ctx.close();

  // 9. Inspector fills the checklist
  ({ ctx, page } = await login("pcp.inspector"));
  await page.locator("tr", { hasText: ref }).getByRole("button", { name: "Open checklist" }).click();
  await page.waitForURL(/\/pcp\/inspections\/\d+/);
  await page.getByPlaceholder("Overall finding and recommendation to PCP").fill("Adequate for intake 60; recommend approval.");
  await page.getByRole("button", { name: "Submit inspection report" }).click();
  await page.waitForURL(new RegExp(`/pcp/applications/${ref}`));
  log("inspection submitted");
  await ctx.close();

  // 10. Officer forwards; Secretary decides and issues
  ({ ctx, page } = await login("pcp.officer"));
  await page.goto(`${BASE}/pcp/applications/${ref}`);
  await page.getByPlaceholder("Recommendation for the council").fill("Recommend approval for intake 60.");
  await page.getByRole("button", { name: "Forward to council agenda" }).click();
  log("officer →", await toast(page, /Forwarded/));
  await ctx.close();
  ({ ctx, page } = await login("pcp.secretary"));
  await page.goto(`${BASE}/pcp/applications/${ref}`);
  await page.getByPlaceholder("Decision note / conditions").fill("Approved; lab signage within 3 months.");
  await page.getByRole("button", { name: /Approved$/ }).click();
  await toast(page, /approved/);
  await page.getByRole("button", { name: /Issue NOC certificate/ }).click();
  const issued = await toast(page, /Certificate NOC-/);
  log("secretary →", issued);
  const certNo = /NOC-TECH-\d{4}-\d{4}/.exec(issued)?.[0];
  await ctx.close();

  // 11. Public verification
  const pub = await (await browser.newContext()).newPage();
  await pub.goto(`${BASE}/verify/certificate/${certNo}`);
  log("public QR page →", (await pub.getByTestId("verify-result").innerText()).trim());
  await pub.goto(`${BASE}/verify/certificate/NOC-TECH-2026-9999`);
  log("forged number →", (await pub.getByTestId("verify-result").innerText()).trim());

  // 12. Segregation between institutions
  ({ ctx, page } = await login("nhc.poc"));
  const res = await page.goto(`${BASE}/institution/applications/${ref}`);
  log("nhc.poc opening RUH's application → HTTP", res.status());
  const dl = await page.goto(`${BASE}/api/documents/1`);
  log("nhc.poc downloading another institution's document → HTTP", dl.status());
  await ctx.close();

  // 13. Super Admin onboards a new institution (tenant) with its POC
  ({ ctx, page } = await login("pcp.admin"));
  await page.goto(`${BASE}/pcp/admin`);
  await shot(page, "admin-users");
  await page.getByRole("button", { name: "Onboard institution" }).click();
  await page.getByLabel("Institution name").fill("Margalla Institute of Pharmacy");
  await page.getByLabel("Short code").fill("MIP");
  await page.getByLabel("City").fill("Islamabad");
  await page.getByLabel("Province / region").click();
  await page.locator(".ant-select-item-option", { hasText: "Islamabad Capital Territory" }).click();
  await page.getByLabel("Full name").fill("Dr. Hina Abbasi");
  await page.getByLabel("Official email").fill("hina.abbasi@mip.demo");
  await page.getByLabel("Username").fill("mip.poc");
  await page.locator(".ant-drawer").getByRole("button", { name: "Onboard institution" }).click();
  log("admin →", await toast(page, /onboarded as/));
  const temp = (await page.locator(".ant-modal").getByText(/^Pcp-/).innerText()).trim();
  log("temporary password issued (shown once)");
  await shot(page, "temp-password");
  await page.locator(".ant-modal").getByRole("button", { name: "OK" }).click();

  // 14. Super Admin disables a POC: locked out at once
  const nhcRow = page.locator("tr", { hasText: "nhc.poc" });
  await nhcRow.getByRole("button", { name: "Disable" }).click();
  await page.locator(".ant-popconfirm").getByRole("button", { name: "OK" }).click();
  log("admin →", await toast(page, /disabled/));
  log("audit →", (await (async () => { await page.goto(`${BASE}/pcp/audit`); return page.getByText(/Chain intact|Tampering detected/).first().innerText(); })()).trim());
  await ctx.close();

  // 15. New POC's first sign-in: Keycloak forces a password change; sees only their own institution
  {
    const c = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const p = await c.newPage();
    await p.goto(`${BASE}/login`);
    await p.getByRole("button", { name: "Sign in with another account" }).click();
    await p.waitForURL(/\/auth\/realms\/pcp\//);
    await p.fill("#username", "mip.poc");
    await p.fill("#password", temp);
    await p.click("#kc-login");
    await p.waitForSelector("#password-new", { timeout: T });
    log("Keycloak asks the new POC to set a password");
    await p.fill("#password-new", "MyNewPass@2026");
    await p.fill("#password-confirm", "MyNewPass@2026");
    await p.locator('input[type="submit"], button[type="submit"]').first().click();
    await p.waitForURL(/\/institution/, { timeout: T });
    await p.waitForLoadState("networkidle");
    log("mip.poc lands on →", p.url().replace(BASE, ""), "·", (await p.locator("h1").first().innerText()).trim());
    await shot(p, "new-tenant-dashboard");
    await c.close();
  }

  // 16. Disabled POC cannot sign in
  {
    const c = await browser.newContext();
    const p = await c.newPage();
    await p.goto(`${BASE}/login`);
    await p.locator('[data-username="nhc.poc"]').getByRole("button", { name: /Sign in with Keycloak/ }).click();
    await p.waitForURL(/\/auth\/realms\/pcp\//);
    await p.fill("#username", "nhc.poc");
    await p.fill("#password", "Demo@1234");
    await p.click("#kc-login");
    log("disabled nhc.poc →", (await p.getByText(/disabled/i).first().innerText()).trim());
    await c.close();
  }

  // 17. Sign out, then Back: the protected page is not shown from cache
  ({ ctx, page } = await login("ruh.poc"));
  await page.goto(`${BASE}/institution/faculty`);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(`${BASE}/`, { timeout: T });
  await page.goBack();
  await page.waitForLoadState("networkidle");
  log("Back after sign-out →", page.url().replace(BASE, ""));
  if (!page.url().includes("/login")) throw new Error("Back after sign-out showed a protected page");
  await ctx.close();

  console.log("\nALL STEPS PASSED for", ref, certNo);
} catch (e) {
  console.error("FAILED at step", step + 1, e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
