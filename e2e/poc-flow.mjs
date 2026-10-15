// The POC guide's main flow, done by the real people who own each step, each signing in through the
// Keycloak form with their own password (POC mode: no one-click entry). It also takes the guide's screenshots.
//   BASE=http://localhost:7860 CREDS=deploy/poc-credentials.json IMG=../poc-guide/img node e2e/poc-flow.mjs
// Run on a fresh start (clean demo data).
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

const BASE = process.env.BASE ?? "http://localhost:7860";
const T = BASE.includes("localhost") ? 30000 : 60000;
const CREDS = process.env.CREDS ? JSON.parse(readFileSync(process.env.CREDS, "utf8")) : null;
const IMG = path.resolve(process.env.IMG ?? "e2e/screenshots/poc");
mkdirSync(IMG, { recursive: true });
const password = (u) => (CREDS ? CREDS.find((c) => c.username === u)?.password : "Demo@1234");

let step = 0;
const log = (...a) => console.log(`[${String(++step).padStart(2, "0")}]`, ...a);
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });

async function pdf(name) {
  const doc = await PDFDocument.create();
  const p = doc.addPage([400, 300]);
  p.drawText(`POC upload: ${name}`, { x: 30, y: 250, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  const file = path.join(IMG, `..-${name.replace(/\W+/g, "-")}.pdf`);
  writeFileSync(file, await doc.save());
  return file;
}

/** Sign in as a person through the real form (POC sign-in page, or the persona page on a presenter build). */
async function signIn(username, to) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  ctx.setDefaultTimeout(T);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  const poc = page.locator("form button[type=submit]", { hasText: /^\s*Sign in\s*$/ });
  if (await poc.count()) await poc.click();
  else {
    const card = page.locator(`[data-username="${username}"]`).getByRole("button", { name: /Sign in with Keycloak/ });
    if (await card.count()) await card.click();
    else await page.getByRole("button", { name: "Sign in with another account" }).click();
  }
  await page.waitForURL(/\/auth\/realms\/pcp\//, { timeout: T });
  await page.fill("#username", username);
  await page.fill("#password", password(username));
  await page.click("#kc-login");
  await page.waitForURL((u) => !u.toString().includes("/auth/realms/"), { timeout: T });
  if (page.url().includes("/login/code")) {
    await page.waitForFunction(() => document.querySelector("#signin-code")?.value?.length === 6, null, { timeout: T });
    if (step === 0 || !globalThis.__codeShot) {
      globalThis.__codeShot = true;
      await snap(page, "officer-code");
    }
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: T });
  }
  if (to) await page.goto(`${BASE}${to}`, { waitUntil: "networkidle" });
  return { ctx, page };
}

const toast = async (page, re) => {
  const el = page.locator(".ant-message-notice", { hasText: re }).first();
  await el.waitFor({ timeout: T });
  return (await el.innerText()).trim();
};
const settle = (page) => page.waitForFunction(() => !document.querySelector(".ant-btn-loading"), null, { timeout: T }).catch(() => {});

/** A guide screenshot: the viewport, scrolled so `at` (if given) sits near the top. */
let shotNo = 0;
async function snap(page, name, at) {
  if (at) {
    await at.first().waitFor({ timeout: T });
    await at.first().evaluate((el) => window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 90) }));
  } else await page.evaluate(() => window.scrollTo({ top: 0 }));
  await page.waitForTimeout(500);
  shotNo++;
  await page.screenshot({ path: path.join(IMG, `${name}.png`) });
}

async function pick(page, select, text) {
  await select.click();
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: text }).first().click();
}
async function linkTeacher(page, query, subject, mustContain) {
  const sel = page.locator(".case-faculty-search");
  await sel.click();
  await sel.locator("input").fill(query);
  await page.waitForTimeout(900);
  const opt = page.locator(".ant-select-dropdown:visible .ant-select-item-option:not(.ant-select-item-option-disabled)", mustContain ? { hasText: mustContain } : {}).first();
  await opt.waitFor({ timeout: T });
  const label = (await opt.innerText()).trim();
  await opt.click();
  await page.waitForTimeout(400);
  const subj = page.locator(".case-subject-select");
  for (let i = 0; i < 3 && !(await subj.innerText()).includes(subject); i++) {
    await pick(page, subj, new RegExp(`^${subject}$`));
    await page.waitForTimeout(400);
  }
  await page.getByRole("button", { name: "Link teacher" }).click();
  await toast(page, new RegExp(`linked to ${subject}`));
  await page.waitForTimeout(700);
  return label;
}

let ctx, page, ref, certNo;
try {
  // ---------- Riverside University prepares the application ----------
  ({ ctx, page } = await signIn("ruh.entry", "/institution"));
  await snap(page, "institution-dashboard");
  await page.goto(`${BASE}/institution/applications`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /New NOC application/ }).hover();
  await page.getByText("New Pharmacy Technician NOC application").click();
  await page.waitForURL(/\/institution\/applications\/NOC-/);
  ref = page.url().split("/").pop();
  await pick(page, page.locator("#case-form .ant-select").first(), "Hayatabad campus, Peshawar");
  await page.getByLabel("Proposed intake (students per year)").fill("60");
  await page.getByLabel("Classrooms").fill("4");
  await page.getByLabel("Laboratories", { exact: true }).fill("3");
  await page.getByLabel("Library books").fill("800");
  await page.getByRole("button", { name: "Save and run checks" }).click();
  await toast(page, /Saved/);
  for (const doc of ["Charter or affiliation letter", "Building plan", "Laboratory inventory"]) {
    await page.locator(".required-doc", { hasText: doc }).locator('input[type="file"]').setInputFiles(await pdf(doc));
    await toast(page, /Uploaded v1/);
    await page.waitForTimeout(400);
  }
  for (const subject of ["Pharmaceutics", "Pharmacology", "Pharmaceutical Chemistry"]) await linkTeacher(page, "", subject, "Pharmacy Technician");
  await page.reload({ waitUntil: "networkidle" });
  const rule = await page.locator(".check-fail", { hasText: "Pharmacology:" }).first().innerText();
  log(`ruh.entry (Data-entry officer) started ${ref}: ${/Pharmacology: .*/.exec(rule)?.[0]}`);
  await snap(page, "checks-failing", page.locator(".check-fail").first());
  const ask = await page.getByText("Ask your Head or Principal to submit").count();
  log(`ruh.entry cannot submit: ${ask ? "shown \"Ask your Head or Principal to submit\"" : "NOT SHOWN"}`);
  if (!ask) throw new Error("data entry could submit");
  await ctx.close();

  // ---------- The Head adds a teacher; the duplicate check asks "Did you mean ...?" ----------
  ({ ctx, page } = await signIn("ruh.poc", "/institution/faculty"));
  await page.getByRole("button", { name: "Add faculty member" }).click();
  await page.getByLabel("CNIC").fill("17301-7777777-1");
  await page.getByLabel("Full name").fill("Dr. Mohammad Ali Khan");
  await page.getByLabel("Father's name").fill("Abdul Ghafoor Khan");
  await page.locator(".ant-drawer").getByRole("button", { name: "Save and run checks" }).click();
  const dym = await page.locator(".ant-drawer .ant-alert-warning").last().innerText({ timeout: T });
  log(`ruh.poc (Head) adds a teacher: ${dym.slice(0, 70)}`);
  await snap(page, "did-you-mean");
  const different = page.locator(".ant-drawer").getByRole("button", { name: "No, a different person" });
  if (await different.count()) await different.click();
  await page.locator(".ant-drawer .ant-alert-warning", { hasText: "Saved as" }).waitFor({ timeout: T });
  await ctx.close();

  // ---------- PCP Verification officer settles the possible duplicate ----------
  ({ ctx, page } = await signIn("pcp.verification", "/pcp/verification"));
  const flagCard = page.locator(".ant-card").filter({ hasText: "Dr. Mohammad Ali Khan" }).filter({ has: page.getByRole("button", { name: /Different people/ }) }).filter({ hasNotText: "Possible duplicates (" });
  await snap(page, "verification-duplicate", flagCard);
  await flagCard.getByRole("button", { name: /Different people/ }).click();
  log(`pcp.verification: ${await toast(page, /flag is cleared/i)}`);
  await ctx.close();

  // ---------- The Head links the teacher: every check passes ----------
  ({ ctx, page } = await signIn("ruh.poc", `/institution/applications/${ref}`));
  await linkTeacher(page, "Mohammad Ali", "Pharmacology", "Pharmacy Technician");
  await page.reload({ waitUntil: "networkidle" });
  const failing = await page.locator(".check-fail").count();
  log(`ruh.poc linked the teacher: ${failing} checks failing`);
  if (failing) throw new Error("checks still failing");
  await snap(page, "checks-passing", page.locator(".check-ok").first());
  await ctx.close();

  // ---------- The Finance officer pays ----------
  ({ ctx, page } = await signIn("ruh.finance", `/institution/applications/${ref}`));
  await page.getByRole("button", { name: /generate challan/i }).click();
  const challan = await toast(page, /PSID/);
  await settle(page);
  await snap(page, "challan", page.getByRole("button", { name: /Simulate bank confirmation/ }));
  await page.getByRole("button", { name: /Simulate bank confirmation/ }).click();
  await page.locator(".ant-modal").waitFor();
  await snap(page, "one-time-code");
  await page.locator(".ant-modal").getByRole("button", { name: "Confirm" }).click();
  log(`ruh.finance (Finance officer): ${challan.slice(0, 60)} · ${await toast(page, /Payment confirmed/)}`);
  await ctx.close();

  // ---------- The Head submits ----------
  ({ ctx, page } = await signIn("ruh.poc", `/institution/applications/${ref}`));
  await page.getByRole("button", { name: /Submit application/ }).click();
  log(`ruh.poc: ${await toast(page, /Submitted/)}`);
  await page.reload({ waitUntil: "networkidle" });
  await snap(page, "submitted");
  await ctx.close();

  // ---------- PCP Registration officer: scrutiny and a formal deficiency ----------
  ({ ctx, page } = await signIn("pcp.registration", "/pcp/applications"));
  await snap(page, "pcp-queue");
  await page.goto(`${BASE}/pcp/applications/${ref}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start scrutiny/ }).click();
  await toast(page, /Scrutiny started/);
  await page.getByLabel("Required action").fill("Upload the lab safety certificate for the Pharmaceutics lab");
  await page.getByLabel("Evidence required").fill("Safety certificate");
  await snap(page, "raise-deficiency", page.getByLabel("Required action"));
  await page.getByRole("button", { name: "Raise deficiency", exact: true }).click();
  log(`pcp.registration (Registration officer): ${await toast(page, /Deficiency raised/)}`);
  await ctx.close();

  // ---------- The Principal answers the deficiency ----------
  ({ ctx, page } = await signIn("ruh.dean", `/institution/applications/${ref}`));
  await page.getByPlaceholder("What did you do to fix it?").fill("Safety certificate obtained from the district fire officer; attached.");
  await page.locator(".deficiency-card, .ant-card", { hasText: "Your response" }).locator('input[type="file"]').first().setInputFiles(await pdf("Safety certificate")).catch(() => {});
  await snap(page, "deficiency-response", page.getByPlaceholder("What did you do to fix it?"));
  await page.getByRole("button", { name: "Submit response" }).click();
  log(`ruh.dean (Principal): ${await toast(page, /Response submitted/)}`);
  await ctx.close();

  // ---------- Registration accepts and passes scrutiny ----------
  ({ ctx, page } = await signIn("pcp.registration", `/pcp/applications/${ref}`));
  await page.getByRole("button", { name: "Accept" }).click();
  await toast(page, /accepted/);
  await settle(page);
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /Pass scrutiny/ }).click();
  log(`pcp.registration: ${await toast(page, /Scrutiny passed/)}`);
  await ctx.close();

  // ---------- Technical officer: the academic check ----------
  ({ ctx, page } = await signIn("pcp.technical", `/pcp/applications/${ref}`));
  const meets = page.locator(".review-rating .ant-radio-button-wrapper", { hasText: /^Meets$/ });
  await meets.nth(4).waitFor();
  for (let i = 0; i < (await meets.count()); i++) await meets.nth(i).click();
  await page.getByPlaceholder("Summary of the technical review").fill("Faculty, laboratories and library meet the standards for intake 60.");
  await snap(page, "technical-review", page.locator(".review-rating").first());
  await page.getByRole("button", { name: /Record review/ }).click();
  log(`pcp.technical (Technical officer): ${await toast(page, /Technical review recorded/)}`);
  await ctx.close();

  // ---------- Inspection coordinator: the team, with the conflict check ----------
  ({ ctx, page } = await signIn("pcp.coordinator", `/pcp/applications/${ref}`));
  const suggest = page.getByRole("button", { name: /Suggest a team/ });
  if (await suggest.count()) {
    await suggest.click();
    const panel = page.getByTestId("team-suggestion");
    await panel.waitFor({ timeout: T });
    await snap(page, "suggested-team", panel);
    log(`pcp.coordinator: suggested team shown (${(await panel.innerText()).split("\n").slice(0, 3).join(" · ").slice(0, 90)})`);
    await panel.getByRole("button", { name: "Dismiss" }).click();
    await page.waitForTimeout(500);
  }
  await page.locator(".pcp-inspector-select").click();
  await page.locator(".ant-select-item-option", { hasText: "Zainab" }).click();
  await page.getByRole("button", { name: "Schedule and notify" }).click();
  const coi = await toast(page, /Conflict of interest/);
  await snap(page, "conflict-blocked", page.locator(".pcp-inspector-select"));
  log(`pcp.coordinator: ${coi.slice(0, 80)}`);
  await settle(page);
  await page.locator(".pcp-inspector-select").click();
  await page.locator(".ant-select-item-option", { hasText: "Kamran" }).click();
  await page.getByRole("button", { name: "Schedule and notify" }).click();
  log(`pcp.coordinator (Inspection coordinator): ${(await toast(page, /Inspection scheduled/)).slice(0, 80)}`);
  await ctx.close();

  // ---------- Panel member: the checklist on a tablet ----------
  ({ ctx, page } = await signIn("pcp.inspector", "/pcp/inspections"));
  await page.locator("tr", { hasText: ref }).getByRole("button", { name: "Open checklist" }).click();
  await page.waitForURL(/\/pcp\/inspections\/\d+/);
  await page.waitForLoadState("networkidle");
  const fill = page.getByRole("button", { name: /Fill demo values/ });
  if (await fill.count()) await fill.first().click();
  await page.getByPlaceholder("Overall finding and recommendation to PCP").fill("Adequate for intake 60; recommend approval.");
  await snap(page, "inspection-checklist", page.getByTestId("offline-status"));
  await page.getByRole("button", { name: "Submit inspection report" }).click();
  await page.waitForURL(new RegExp(`/pcp/applications/${ref}`), { timeout: 60000 });
  log("pcp.inspector (Panel member): inspection report submitted");
  await ctx.close();

  // ---------- Registration forwards to the Council ----------
  ({ ctx, page } = await signIn("pcp.registration", `/pcp/applications/${ref}`));
  await page.getByPlaceholder("Recommendation for the council").fill("Recommend approval for intake 60.");
  await page.getByRole("button", { name: "Forward to council agenda" }).click();
  log(`pcp.registration: ${await toast(page, /Forwarded/)}`);
  await ctx.close();

  // ---------- Secretary: Council decision, letter, certificate ----------
  ({ ctx, page } = await signIn("pcp.secretary", `/pcp/applications/${ref}`));
  await page.getByPlaceholder("Decision note / conditions (optional)").fill("Approved; lab signage within 3 months.");
  await snap(page, "council-decision", page.getByPlaceholder("Decision note / conditions (optional)"));
  await page.getByRole("button", { name: "Record approval" }).click();
  await page.locator(".ant-modal").getByRole("button", { name: "Confirm" }).click();
  await toast(page, /approved/);
  await page.getByTestId("decision-letter").waitFor();
  await page.getByRole("button", { name: /Issue NOC certificate/ }).click();
  await page.locator(".ant-modal").getByRole("button", { name: "Confirm" }).click();
  const issued = await toast(page, /Certificate NOC-/);
  certNo = /NOC-TECH-\d{4}-\d{4}/.exec(issued)?.[0];
  log(`pcp.secretary (Secretary): approved, decision letter filed, ${certNo} issued`);
  await page.goto(`${BASE}/certificate/${certNo}`, { waitUntil: "networkidle" });
  await snap(page, "certificate");
  await ctx.close();

  // ---------- Anyone: the public QR check ----------
  {
    const pub = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await pub.goto(`${BASE}/verify/certificate/${certNo}`, { waitUntil: "networkidle" });
    log(`public QR check: ${(await pub.getByTestId("verify-result").innerText()).trim()}`);
    await snap(pub, "public-verify");
    await pub.goto(`${BASE}/verify/certificate/NOC-TECH-2026-9999`, { waitUntil: "networkidle" });
    log(`forged number: ${(await pub.getByTestId("verify-result").innerText()).trim()}`);
    await pub.context().close();
  }

  // ---------- Accounts officer: today's bank statement reconciles the fee ----------
  ({ ctx, page } = await signIn("pcp.accounts", "/pcp/accounts"));
  await page.getByTestId("tab-statement").click();
  await page.getByRole("button", { name: /Generate today's statement/ }).click();
  log(`pcp.accounts (Accounts officer): ${await toast(page, /Imported STMT-/)}`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("tab-ledger").click();
  await snap(page, "accounts-ledger");
  await ctx.close();

  // ---------- Back at Riverside: the programme card shows the NOC ----------
  ({ ctx, page } = await signIn("ruh.poc", "/institution"));
  await snap(page, "institution-after");
  log("ruh.poc: dashboard after the decision");
  await ctx.close();

  // ---------- Oversight: PCP's dashboard and the audit log ----------
  ({ ctx, page } = await signIn("pcp.secretary", "/pcp"));
  await snap(page, "pcp-dashboard");
  await ctx.close();
  ({ ctx, page } = await signIn("pcp.admin", "/pcp/audit"));
  await snap(page, "audit-log");
  log(`pcp.admin: audit ${(await page.locator("body").innerText()).match(/Chain intact[^\n]*/)?.[0] ?? "(no chain banner found)"}`);
  await ctx.close();

  console.log(`\nPOC FLOW PASSED · ${ref} · ${certNo} · ${shotNo} screenshots in ${IMG}`);
} catch (e) {
  console.log(`\nPOC FLOW FAILED at step ${step + 1}: ${e.message}`);
  if (page) await page.screenshot({ path: path.join(IMG, "FAILED.png"), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
