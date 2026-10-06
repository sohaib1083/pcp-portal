// Presenter dry run: plays the demo story the way a presenter would, through the presenter guide
// (one-click persona switch, "Fill demo values", "Attach sample PDF"), and captures a screenshot per beat.
// Run after a fresh reset:  ./demo.sh reset && node e2e/presenter-run.mjs
// Env: SHOTS=<dir> (default e2e/tour), VIDEO=1 to also record a video of the whole run,
//      E2E_SKIP_ADMIN=1 on development copies (skips the beats that use or change shared Keycloak users).
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:8088";
const OUT = process.env.SHOTS ?? path.resolve("e2e/tour");
mkdirSync(OUT, { recursive: true });
const VIEW = { width: 1440, height: 900 };

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
const ctx = await browser.newContext({ viewport: VIEW, ...(process.env.VIDEO ? { recordVideo: { dir: OUT, size: VIEW } } : {}) });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  page error:", e.message));

const beats = [];
let n = 0;
async function shot(id, caption, opts = {}) {
  await page.waitForTimeout(opts.wait ?? 600);
  const file = `${String(++n).padStart(2, "0")}-${id}.jpg`;
  await page.screenshot({ path: path.join(OUT, file), type: "jpeg", quality: 82, fullPage: !!opts.full });
  beats.push({ file, id, caption, url: page.url().replace(BASE, "") });
  console.log(`[${n}] ${id}: ${caption}`);
}
const toast = async (re) => {
  const el = page.locator(".ant-message-notice", { hasText: re }).first();
  await el.waitFor({ timeout: 15000 });
  return (await el.innerText()).trim();
};
const settle = () => page.waitForLoadState("networkidle");
const click = async (loc) => {
  await loc.scrollIntoViewIfNeeded();
  await loc.click();
};

/** Jump the guide to a story step and press its main button (switches persona when needed). */
async function guide(step) {
  await page.evaluate((s) => {
    localStorage.setItem("pcp-guide-step", String(s));
    localStorage.setItem("pcp-guide-open", "1");
  }, step);
  await page.reload();
  await settle();
  const panel = page.locator(".dg-panel");
  await panel.waitFor();
  // The main button shows a spinner until the guide knows the story's application; wait for it.
  const main = panel.locator(".dg-foot .ant-btn-primary");
  await page.waitForFunction(() => !document.querySelector(".dg-foot .ant-btn-primary.ant-btn-loading"));
  const target = (await panel.getAttribute("data-target")) ?? "";
  const path = target.split("?")[0];
  const switching = (await panel.locator('form[action="/api/demo/switch"]').count()) > 0;
  if (switching) {
    // The switch is a full page load, possibly to the same URL: wait for a fresh document.
    await page.evaluate(() => (window.__beforeSwitch = true));
    await main.click();
    await page.waitForFunction(() => !window.__beforeSwitch && document.readyState === "complete", null, { timeout: 20000 });
  } else if (new URL(page.url()).pathname !== path) await main.click();
  await page.waitForURL((u) => u.pathname === path, { timeout: 20000 });
  await settle();
  await page.waitForTimeout(500);
}
const hideGuide = () => page.evaluate(() => localStorage.setItem("pcp-guide-open", "0")).then(() => page.reload()).then(settle);

try {
  // Opening: the public front door and the persona chooser
  await page.goto(BASE + "/");
  await page.evaluate(() => localStorage.setItem("pcp-guide-open", "0"));
  await page.reload();
  await settle();
  await shot("home", "Public front door: search the registry, the four promised e-services, live stats");
  await page.goto(BASE + "/login");
  await settle();
  await shot("login", "Choose who you are: each persona sees a different portal (Keycloak SSO, one-click in the demo)");

  // Act I · step 1
  await guide(0);
  await shot("guide", "Presenter guide: who to be, what to click, what to say, one click to switch persona");
  await hideGuide();
  await shot("institution-dashboard", "Riverside University's Head: programme cards with history and Start renewal, the renewal alert, action list");

  // Step 2: technician NOC: campus first, faculty by Faculty ID, documents
  await page.goto(BASE + "/institution/applications");
  await settle();
  await page.getByRole("button", { name: /New NOC application/ }).hover();
  await page.getByText("New Pharmacy Technician NOC application").click();
  await page.waitForURL(/\/institution\/applications\/NOC-/);
  await settle();
  const ref = page.url().split("/").pop();
  await click(page.getByRole("button", { name: "Fill demo values" }).first());
  await click(page.getByRole("button", { name: "Save and run checks" }));
  await toast(/Saved/);
  await settle();
  await click(page.getByRole("button", { name: "Link by specialisation" }));
  await toast(/teachers linked/);
  await settle();
  for (let i = 0; i < 3; i++) {
    await click(page.getByRole("button", { name: /Attach sample PDF/ }).first());
    await toast(/Uploaded v1/);
    await page.waitForTimeout(900);
  }
  await page.reload();
  await settle();
  await shot("noc-draft", `New technician NOC ${ref}: campus picked, 3 teachers linked by Faculty ID, documents attached`);
  await page.locator("#case-faculty").scrollIntoViewIfNeeded();
  await shot("noc-checks", "The check names the line and the rule: Pharmacology 1 teacher linked, 2 required for intake 60. Pay stays locked");

  // Step 3: faculty duplicates
  await page.goto(BASE + "/institution/faculty");
  await settle();
  await page.getByRole("button", { name: "Add faculty member" }).click();
  await page.getByRole("button", { name: "Try: active elsewhere" }).click();
  await page.locator(".ant-drawer").getByRole("button", { name: "Save and run checks" }).click();
  await page.locator(".ant-drawer .ant-alert-error").waitFor();
  await shot("faculty-blocked", "Blocked: this CNIC is already active at another institution, which is not named");
  await page.waitForFunction(() => !document.querySelector(".ant-drawer .ant-btn-loading"));
  await page.getByRole("button", { name: "Try: near-duplicate" }).click();
  await page.locator(".ant-drawer").getByRole("button", { name: "Save and run checks" }).click();
  await page.locator(".ant-drawer .ant-alert-warning").last().waitFor();
  await shot("faculty-flagged", "Saved but flagged: “Mohammad Ali Khan” matches “Muhammad Ali Khan” after normalising");
  await page.keyboard.press("Escape");

  // Act II · step 4: officer resolves the duplicate
  await guide(3);
  await hideGuide();
  await shot("officer-duplicates", "PCP Officer: the possible duplicate side by side, differences highlighted");
  const flag = page.locator(".ant-card").filter({ hasText: "Dr. Mohammad Ali Khan" }).filter({ has: page.getByRole("button", { name: /Different people/ }) });
  await click(flag.getByRole("button", { name: /Different people/ }));
  await toast(/flag is cleared/i);

  // Step 5: the institution links the teacher by Faculty ID, pays (one-time code) and submits
  await guide(4);
  await hideGuide();
  const search = page.locator(".case-faculty-search");
  await click(search);
  await search.locator("input").fill("Mohammad Ali");
  await page.waitForTimeout(900);
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option:not(.ant-select-item-option-disabled)", { hasText: "Pharmacy Technician" }).first().click();
  await page.locator(".case-subject-select").click();
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: /^Pharmacology$/ }).click();
  await page.locator("#case-faculty").scrollIntoViewIfNeeded();
  await shot("faculty-picker", "Find the teacher by Faculty ID, CNIC or name and pick the subject: no names typed in");
  await click(page.getByRole("button", { name: "Link teacher" }));
  await toast(/linked to Pharmacology/);
  await settle();
  await page.waitForTimeout(800);
  await click(page.getByRole("button", { name: /generate challan/i }));
  await toast(/PSID/);
  await settle();
  await page.locator(".ant-card", { hasText: "Simulate bank confirmation" }).last().scrollIntoViewIfNeeded();
  await shot("fee-raast", "Every check passes, so Pay opens: 1Link PSID and a Raast QR (0% merchant fee)");
  await click(page.getByRole("button", { name: /Simulate bank confirmation/ }));
  await page.locator(".ant-modal").waitFor();
  await shot("otp", "Payments and decisions need a one-time code (shown on screen in the demo, SMS in production)");
  await page.locator(".ant-modal").getByRole("button", { name: "Confirm" }).click();
  await toast(/Payment confirmed/);
  await settle();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("ready-to-submit", "All checks pass and the fee is paid: the Head can submit");
  await click(page.getByRole("button", { name: /Submit application/ }));
  await toast(/Submitted/);
  await settle();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("submitted", "Submitted: the institution sees who holds its file and the stage clock");

  // Step 6: scrutiny and deficiency
  await guide(5);
  await hideGuide();
  await click(page.getByRole("button", { name: /Start scrutiny/ }));
  await toast(/Scrutiny started/);
  await settle();
  await click(page.getByRole("button", { name: "Fill demo values" }).first());
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("scrutiny", "Officer's workspace: track, who holds it, the time limit, and only the actions this role owns");
  await click(page.getByRole("button", { name: "Raise deficiency", exact: true }));
  await toast(/Deficiency raised/);

  // Step 7: institution responds
  await guide(6);
  await hideGuide();
  await click(page.locator(".ant-card", { hasText: "Deficiencies raised by PCP" }).getByRole("button", { name: "Fill demo values" }));
  await click(page.getByRole("button", { name: /Attach sample PDF/ }).first());
  await toast(/Evidence uploaded/);
  await settle();
  await page.locator(".ant-card", { hasText: "Deficiencies raised by PCP" }).scrollIntoViewIfNeeded();
  await page.getByPlaceholder("What did you do to fix it?").fill("Safety certificate obtained from the district fire officer; attached.");
  await shot("deficiency-response", "Formal deficiency with ID, deadline and required evidence; the response carries the evidence");
  await click(page.getByRole("button", { name: "Submit response" }));
  await toast(/Response submitted/);

  // Step 8: accept, technical review, then the team with the conflict-of-interest guard
  await guide(7);
  await hideGuide();
  await click(page.getByRole("button", { name: "Accept" }));
  await toast(/accepted/);
  await settle();
  await page.waitForTimeout(800);
  await click(page.getByRole("button", { name: /Pass scrutiny/ }));
  await toast(/Scrutiny passed/);
  await settle();
  await page.waitForTimeout(800);
  await click(page.locator(".ant-card", { hasText: "Your next step" }).getByRole("button", { name: "Fill demo values" }).first());
  await shot("technical-review", "Technical review: the academic check against PCP standards, between scrutiny and inspection");
  await click(page.getByRole("button", { name: /Record review/ }));
  await toast(/Technical review recorded/);
  await settle();
  await page.waitForTimeout(800);
  await click(page.locator(".pcp-inspector-select"));
  await page.locator(".ant-select-item-option", { hasText: "Zainab" }).click();
  await page.getByRole("button", { name: "Schedule and notify" }).click();
  await toast(/Conflict of interest/);
  await page.locator(".pcp-inspector-select").scrollIntoViewIfNeeded();
  await shot("coi-blocked", "Conflict of interest: a KP inspector can't inspect a KP institution, so the booking is refused");
  await click(page.locator(".pcp-inspector-select"));
  await page.locator(".ant-select-item-option", { hasText: "Kamran" }).click();
  await page.getByRole("button", { name: "Schedule and notify" }).click();
  await toast(/Inspection scheduled/);

  // Step 9: inspector
  await guide(8);
  await hideGuide();
  await shot("inspector-home", "Inspector's view: only their visits, as lead or member");
  await click(page.locator("tr", { hasText: ref }).getByRole("button", { name: "Open checklist" }));
  await page.waitForURL(/\/pcp\/inspections\/\d+/);
  await settle();
  await page.getByRole("button", { name: "Fill demo values" }).click();
  await shot("checklist", "Tablet checklist per criterion with remarks and photos (ODK offline in production)");
  await click(page.getByRole("button", { name: "Submit inspection report" }));
  await page.waitForURL(new RegExp(`/pcp/applications/${ref}`));

  // Step 10: forward
  await guide(9);
  await hideGuide();
  await click(page.getByRole("button", { name: "Fill demo values" }).first());
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("report-review", "Inspection report in the case file; the officer recommends and forwards to council");
  await click(page.getByRole("button", { name: "Forward to council agenda" }));
  await toast(/Forwarded/);

  // Act III · step 11: council decision (one-time code), decision letter, certificate (one-time code)
  await guide(10);
  await hideGuide();
  await click(page.getByRole("button", { name: "Fill demo values" }).first());
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("council", "Council secretary: approve, defer with a return date, or reject with grounds");
  await click(page.getByRole("button", { name: "Record approval" }));
  await page.locator(".ant-modal").getByRole("button", { name: "Confirm" }).click();
  await toast(/approved/);
  await settle();
  await click(page.getByRole("button", { name: /Issue NOC certificate/ }));
  await page.locator(".ant-modal").getByRole("button", { name: "Confirm" }).click();
  const issued = await toast(/Certificate NOC-/);
  const cert = /NOC-TECH-\d{4}-\d{4}/.exec(issued)?.[0];
  await settle();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("issued", `Certificate ${cert} issued, decision letter on file: the track is complete`);
  await page.goto(`${BASE}/certificate/${cert}`);
  await settle();
  await shot("certificate", "The NOC: QR code, SHA-256 fingerprint, digital signature");

  // Step 12: public verification
  await page.goto(`${BASE}/verify/certificate/${cert}`);
  await settle();
  await shot("verify-genuine", "Scan the QR: anyone sees it is genuine and valid, without signing in");
  await page.goto(`${BASE}/verify/certificate/NOC-TECH-2026-9999`);
  await settle();
  await shot("verify-forged", "A forged number fails immediately");

  // Step 13: tenant isolation (nhc.poc; skipped on development copies where a sibling run may have disabled it)
  if (!process.env.E2E_SKIP_ADMIN) {
    await guide(12);
    await hideGuide();
    await shot("isolation-404", "Another institution opening Riverside's case gets 404: tenants never see each other");
  }

  // Act IV · step 14: the officer's work first, then the live picture
  await guide(13);
  await hideGuide();
  await shot("executive-dashboard", "My work first: due, blocked or overdue (with escalations), decided; every figure opens its list", { full: false });
  await page.evaluate(() => window.scrollTo(0, 860));
  await shot("executive-dashboard-2", "Case pipeline with the technical review stage, then charts below the task list");
  await page.goto(`${BASE}/pcp/applications?overdue=1`);
  await settle();
  await shot("overdue", "Overdue cases first, with a badge; reminders then one escalation to the supervisor");

  // Steps 15–16 create and disable shared Keycloak users; skip them on parallel development copies.
  if (!process.env.E2E_SKIP_ADMIN) {
    await guide(14);
    await hideGuide();
    await page.getByRole("button", { name: "Onboard institution" }).click();
    await page.getByRole("button", { name: "Fill demo values" }).click();
    await shot("onboard", "Super Admin onboards a new institution: PCP ID, Keycloak group and POC account in one step");
    await page.locator(".ant-drawer").getByRole("button", { name: "Onboard institution" }).click();
    await toast(/onboarded as/);
    await page.locator(".ant-modal").waitFor();
    await shot("temp-password", "The temporary password is shown once; Keycloak forces a change at first sign-in");
    await page.locator(".ant-modal").getByRole("button", { name: "OK" }).click();
    await page.locator("tr", { hasText: "nhc.poc" }).getByRole("button", { name: "Disable" }).click();
    await page.locator(".ant-popconfirm").getByRole("button", { name: "OK" }).click();
    await toast(/disabled/);
    await shot("disabled", "Disabling a POC signs them out everywhere at once; history is kept");
    await page.goto(BASE + "/pcp/audit");
    await settle();
    await shot("audit", "Every action of this story, hash-chained: Chain intact");
  }

  writeFileSync(path.join(OUT, "beats.json"), JSON.stringify({ ref, cert, beats }, null, 2));
  console.log(`\nPRESENTER RUN PASSED · ${ref} · ${cert} · ${beats.length} screenshots in ${OUT}`);
} catch (e) {
  await page.screenshot({ path: path.join(OUT, "FAILED.png") }).catch(() => undefined);
  console.error("FAILED after beat", n, e);
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}
