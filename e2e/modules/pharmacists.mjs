// Module test: pharmacist register, public check, pharmacist portal and English/Urdu public screens.
// Run against a dev server with the demo seed:  BASE=http://localhost:3204 node e2e/modules/pharmacists.mjs
// Re-runnable: it uses fresh numbers and places, and puts back any status it changes.
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

const BASE = process.env.BASE ?? "http://localhost:3204";
const T = 30000;
const OUT = process.env.SHOTS ?? path.resolve("e2e/screenshots/pharmacists");
mkdirSync(OUT, { recursive: true });
let step = 0;
let failures = 0;
const log = (...a) => console.log(`[${String(++step).padStart(2, "0")}]`, ...a);
const ok = (cond, msg) => {
  if (!cond) {
    failures++;
    console.log("   ✗ FAIL:", msg);
  } else console.log("   ✓", msg);
};
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${String(step).padStart(2, "0")}-${name}.png`), fullPage: true });
/** No horizontal scroll once the layout has settled (the signed-in shell collapses its sidebar after the first paint). */
const noHScroll = (page) =>
  page
    .waitForFunction(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1, null, { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
let current = null; // page to photograph if something throws

const ACTIVE = "PPC-A-031457"; // Ali Raza, Punjab
const DORMANT = "SPC-A-2014-00187"; // Kashif Shaikh, Sindh
const UNKNOWN = "PPC-A-999999";
const TO_SUSPEND = "KPPC-A-02118"; // Zainab Durrani, put back to Active at the end
const run = Date.now();

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });

async function context(viewport = { width: 1440, height: 950 }, lang) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  ctx.setDefaultTimeout(T);
  if (lang) await ctx.addCookies([{ name: "pcp_lang", value: lang, url: BASE }]);
  return ctx;
}

/** Sign in with the "Enter as …" button on /login, or the demo switch for personas not listed there. */
async function enterAs(username, next) {
  const ctx = await context();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  const card = page.locator(`[data-username="${username}"]`);
  if (await card.count()) {
    await card.getByRole("button", { name: /Enter as/ }).click();
  } else {
    await page.evaluate(
      ({ username, next }) => {
        const f = document.createElement("form");
        f.method = "POST";
        f.action = "/api/demo/switch";
        for (const [k, v] of Object.entries({ username, next })) {
          const i = document.createElement("input");
          i.type = "hidden";
          i.name = k;
          i.value = v;
          f.appendChild(i);
        }
        document.body.appendChild(f);
        f.submit();
      },
      { username, next },
    );
  }
  await page.waitForURL((u) => u.pathname === next.split("?")[0], { timeout: T });
  await page.waitForLoadState("networkidle");
  return { ctx, page };
}

const toast = async (page, re) => {
  const el = page.locator(".ant-message-notice", { hasText: re }).first();
  await el.waitFor({ timeout: T });
  return (await el.innerText()).trim();
};
const confirmOtp = async (page) => {
  const modal = page.locator(".ant-modal", { hasText: "Confirm with a one-time code" });
  await modal.waitFor();
  await modal.getByRole("button", { name: "Confirm" }).click();
};
/** Private fields must never reach a public page, not even in the page's data payload. */
const leaks = (html) => {
  const found = [];
  if (/\b\d{5}-\d{7}-\d\b/.test(html)) found.push("CNIC");
  if (/0321-4567891|0300-3344556/.test(html)) found.push("phone");
  if (/pharm\.ali@|kashif\.shaikh@/.test(html)) found.push("email");
  if (/Model Town, Lahore|Latifabad/.test(html)) found.push("home address");
  if (/Ravi Hospital Pharmacy/.test(html)) found.push("practice place");
  return found;
};

try {
  // ---------- Public check: active, dormant, unknown ----------
  {
    const ctx = await context();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/verify?reg=${ACTIVE}`);
    let r = page.getByTestId("pharmacist-result");
    log("public check, active number", ACTIVE);
    ok((await r.getAttribute("data-status")) === "ACTIVE", "status is ACTIVE");
    ok((await page.getByTestId("pharmacist-status").innerText()).includes("Registered pharmacist: active"), "heading says active");
    ok((await r.innerText()).includes("Ali Raza") && (await r.innerText()).includes("Category A · Pharm-D"), "shows name and category");
    ok(leaks(await page.content()).length === 0, `no private data on the page (${leaks(await page.content()).join(", ") || "none"})`);
    await shot(page, "public-active");

    await page.goto(`${BASE}/verify?reg=${DORMANT.toLowerCase()}`);
    r = page.getByTestId("pharmacist-result");
    log("public check, dormant number typed in lower case", DORMANT);
    ok((await r.getAttribute("data-status")) === "DORMANT", "status is DORMANT");
    ok((await r.innerText()).includes("This registration is dormant. The pharmacist may not practise until it is renewed with the Sindh Pharmacy Council."), "plain-words dormant sentence");
    ok(leaks(await page.content()).length === 0, "no private data on the page");
    await shot(page, "public-dormant");

    await page.goto(`${BASE}/verify?tab=pharmacist`);
    await page.getByPlaceholder("Registration number").fill(UNKNOWN);
    await page.getByRole("button", { name: "Verify" }).last().click();
    await page.waitForURL(/reg=PPC-A-999999/);
    r = page.getByTestId("pharmacist-result");
    await r.waitFor();
    log("public check, unknown number typed into the search", UNKNOWN);
    ok((await r.getAttribute("data-status")) === "NONE", "status is NONE");
    ok((await page.getByTestId("pharmacist-status").innerText()).includes("Not on the register"), "says not on the register");
    await shot(page, "public-unknown");
    await ctx.close();
  }

  // ---------- English and Urdu ----------
  {
    const ctx = await context();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`);
    log("home page: English first, then the Urdu toggle");
    ok((await page.locator(".pub-h1").innerText()).trim() === "One registry for pharmacy education in Pakistan", "English heading unchanged");
    ok((await page.getByPlaceholder("Verify an institution: name or PCP ID (e.g. PCP-UNI-000101)").count()) === 1, "English search placeholder unchanged");
    ok((await page.getByRole("link", { name: "Register your institution" }).count()) >= 1, "Register your institution link");
    ok((await page.getByRole("link", { name: "Help and complaints" }).count()) >= 1, "Help and complaints link");
    ok((await page.getByTestId("pharmacist-service").count()) === 1, "pharmacist check in the e-services section");
    await page.getByTestId("lang-toggle").click();
    await page.waitForFunction(() => document.querySelector(".pub-h1")?.textContent?.includes("پاکستان"));
    ok((await page.locator("[lang=ur][dir=rtl]").count()) >= 1, "Urdu wrapper is right to left");
    ok((await page.getByTestId("lang-toggle").innerText()).includes("English"), "toggle now offers English");
    const cookie = (await ctx.cookies()).find((c) => c.name === "pcp_lang");
    ok(cookie?.value === "ur", "choice remembered in the pcp_lang cookie");
    await shot(page, "home-urdu");

    await page.goto(`${BASE}/verify?reg=${DORMANT}`);
    log("verify page remembers Urdu");
    ok((await page.locator(".ant-tabs-tab", { hasText: "فارماسسٹ" }).count()) === 1, "tabs in Urdu");
    ok((await page.getByTestId("pharmacist-result").innerText()).includes("یہ رجسٹریشن غیر فعال"), "dormant sentence in Urdu");
    ok((await page.getByTestId("pharmacist-result").innerText()).includes("Kashif Shaikh") && (await page.getByTestId("pharmacist-result").innerText()).includes(DORMANT), "name and number stay as they are");
    await shot(page, "verify-urdu");
    await page.goto(`${BASE}/verify/certificate/NOC-TECH-2026-9999`);
    ok((await page.getByTestId("verify-result").innerText()).includes("ایسا کوئی سرٹیفکیٹ موجود نہیں"), "certificate check in Urdu");
    await shot(page, "certificate-urdu");

    await page.getByTestId("lang-toggle").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=verify-result]")?.textContent?.includes("No such certificate"));
    log("back to English");
    ok((await page.getByTestId("verify-result").innerText()).trim() === "No such certificate", "certificate check in English again");
    await page.goto(`${BASE}/verify`);
    ok((await page.getByPlaceholder("Institution name or PCP ID, e.g. Riverside or PCP-UNI-000101").count()) === 1, "English verify placeholder unchanged");
    ok((await page.getByRole("button", { name: "Verify" }).count()) >= 1, "Verify button text unchanged");
    await ctx.close();
  }

  // ---------- Phone width ----------
  {
    log("phone width (390 px), English and Urdu");
    for (const lang of ["en", "ur"]) {
      const ctx = await context({ width: 390, height: 844 }, lang);
      const page = await ctx.newPage();
      for (const [p, name] of [
        ["/", "home"],
        [`/verify?reg=${DORMANT}`, "verify-dormant"],
        [`/verify?reg=${ACTIVE}`, "verify-active"],
        ["/verify/certificate/NOC-TECH-2026-9999", "certificate"],
      ]) {
        await page.goto(BASE + p);
        await page.waitForLoadState("networkidle");
        ok(await noHScroll(page), `${lang} ${p}: no horizontal scroll`);
        if (name.startsWith("verify")) await shot(page, `phone-${lang}-${name}`);
      }
      await ctx.close();
    }
  }

  // ---------- pharm.ali: own record and registration card ----------
  {
    const { ctx, page } = await enterAs("pharm.ali", "/pharmacist");
    log("pharm.ali opens his registration");
    ok((await page.locator(".pcp-page-title").innerText()).includes("My registration"), "portal opens");
    ok((await page.getByTestId("card-preview").innerText()).includes(ACTIVE), "card preview shows the number");
    ok((await page.locator("body").innerText()).includes(`/verify?reg=${ACTIVE}`), "card QR opens the live public status");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("card-download").click()]);
    const file = path.join(OUT, `registration-card-${ACTIVE}.pdf`);
    await dl.saveAs(file);
    const bytes = readFileSync(file);
    const doc = await PDFDocument.load(bytes);
    const { width, height } = doc.getPage(0).getSize();
    log("card downloaded:", dl.suggestedFilename(), `${bytes.length} bytes`);
    ok(bytes.subarray(0, 4).toString() === "%PDF", "it is a PDF");
    ok(doc.getPageCount() === 2 && Math.round(width) === 243 && Math.round(height) === 153, "card size (85.6 x 54 mm), front and back");
    await shot(page, "ali-portal");
    await ctx.close();

    const phone = await context({ width: 390, height: 844 });
    const p2 = await phone.newPage();
    await p2.goto(`${BASE}/login?next=/pharmacist`);
    await p2.locator('[data-username="pharm.ali"]').getByRole("button", { name: /Enter as/ }).click();
    await p2.waitForURL((u) => u.pathname === "/pharmacist");
    await p2.waitForLoadState("networkidle");
    ok(await noHScroll(p2), "/pharmacist at 390 px: no horizontal scroll");
    await shot(p2, "phone-ali-portal");
    await phone.close();
  }

  // ---------- pharm.sana sends a practice update; pcp.registration verifies it ----------
  const place = `Seaview Community Pharmacy, Block ${(run % 900) + 100}, Karachi`;
  const sana = await enterAs("pharm.sana", "/pharmacist");
  {
    const page = sana.page;
    log("pharm.sana reports a new practice place:", place);
    await page.fill("#practice-place", place);
    await page.fill("#designation", "Community Pharmacist");
    await page.keyboard.press("Escape");
    const ev = await PDFDocument.create();
    ev.addPage([400, 300]).drawText(`Appointment letter: ${place}`, { x: 20, y: 250, size: 10, font: await ev.embedFont(StandardFonts.Helvetica) });
    const evFile = path.join(OUT, "appointment-letter.pdf");
    writeFileSync(evFile, await ev.save());
    await page.locator(".ph-update-form input[type=file]").setInputFiles(evFile);
    await page.getByTestId("evidence-name").waitFor();
    await page.getByRole("button", { name: "Send for verification" }).click();
    ok(/Sent to PCP for verification/.test(await toast(page, /Sent to PCP/)), "update sent");
    await page.waitForFunction((pl) => document.querySelector("[data-testid=pending-update]")?.textContent?.includes(pl), place);
    ok(true, "shows as waiting for PCP");
    await shot(page, "sana-pending");
  }
  const officer = await enterAs("pcp.registration", "/pcp/pharmacists");
  {
    const page = officer.page;
    current = page;
    await page.goto(`${BASE}/pcp/pharmacists?tab=updates`);
    const row = page.locator("tr", { hasText: place });
    log("pcp.registration verifies it in the queue");
    ok((await row.count()) === 1, "update is in the queue");
    await shot(page, "queue");
    await row.getByRole("button", { name: "Verify" }).click();
    await confirmOtp(page);
    ok(/practice place is confirmed/.test(await toast(page, /confirmed/)), "verified with a one-time code");
    await sana.page.reload();
    ok((await sana.page.locator("body").innerText()).includes(place) && (await sana.page.getByText("Verified by PCP").count()) >= 1, "Sana now sees the confirmed place");
    await shot(sana.page, "sana-confirmed");
    const pub = await (await context()).newPage();
    await pub.goto(`${BASE}/verify?reg=SPC-A-2019-00412`);
    ok(!(await pub.content()).includes("Seaview Community Pharmacy"), "practice place is not on the public check");
    await pub.context().close();
  }
  await sana.ctx.close();

  // ---------- Import from a provincial council, with errors ----------
  {
    const page = officer.page;
    await page.goto(`${BASE}/pcp/pharmacists?tab=imports`);
    const card = page.getByTestId("import-card");
    await card.locator(".ant-select").first().click();
    await page.locator(".ant-select-item-option", { hasText: "Sindh Pharmacy Council" }).click();
    current = page;
    await card.getByRole("button", { name: "Generate sample file" }).click();
    const report = page.getByTestId("import-report");
    await report.waitFor();
    await card.locator(".ant-segmented-item", { hasText: "All (" }).click();
    const text = await report.innerText();
    log("generated sample file: row-by-row report");
    ok(/10 rows\. 5 ready/.test(text) && /5 with errors/.test(text), "10 rows: 5 ready, 5 with errors");
    for (const msg of ["does not match the Sindh format", "CNIC must have 13 digits", "Already on the register", "Same CNIC as row 2", "Father's name is missing", "Issue date is in the future", "University is not in PCP's list"]) ok(text.includes(msg), `reports "${msg}"`);
    await shot(page, "import-sample-report");

    // A file the council sent: one good row, one bad row, one repeat of the good row
    const good = `SPC-B-2025-${10000 + (run % 89999)}`;
    const cnicDigits = String(1000000 + (run % 8999999));
    const csv = [
      "registration_no,full_name,father_name,cnic,gender,category,university,graduation_year,issue_date,valid_until,status,mobile,email,address",
      `${good},Rehana Siddiqui,Abdul Majeed,42101-${cnicDigits}-2,F,B,Sindh Coastal University,2024,2025-01-15,2030-12-31,Active,0302-1234567,,`,
      `SPC-A-2025-12,Naveed Junejo,Ali Junejo,42101-123-1,M,A,Sindh Coastal University,2023,31/02/2024,,Active,,,`,
      `${good},Rehana Siddiqui,Abdul Majeed,42101-${cnicDigits}-2,F,B,Sindh Coastal University,2024,2025-01-15,2030-12-31,Active,,,`,
    ].join("\n");
    await card.getByRole("button", { name: "Choose another file" }).click();
    await card.locator("input[type=file]").setInputFiles({ name: `spc-register-test-${run}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) });
    await report.waitFor();
    await card.locator(".ant-segmented-item", { hasText: "All (" }).click();
    const t2 = await report.innerText();
    log("uploaded CSV with errors:", `spc-register-test-${run}.csv`);
    ok(/3 rows\. 1 ready/.test(t2) && /2 with errors/.test(t2), "3 rows: 1 ready, 2 with errors");
    ok(t2.includes("Issue date must be a date") && t2.includes(`Same registration number as row 2`) && t2.includes("Same CNIC as row 2"), "bad date and duplicates reported");
    await page.waitForFunction(() => !document.querySelector("[data-testid=import-card] .ant-btn-loading")); // the check has finished
    await card.getByRole("button", { name: /Import 1 ready row/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Import 1 row", exact: true }).click();
    const done = page.getByTestId("import-done");
    await done.waitFor();
    log("import:", (await done.innerText()).trim());
    ok(/1 pharmacist added\. 2 rows with errors were left out/.test(await done.innerText()), "only the good row imported");
    await page.waitForLoadState("networkidle");
    await shot(page, "import-done");
    const pub = await (await context()).newPage();
    await pub.goto(`${BASE}/verify?reg=${good}`);
    ok((await pub.getByTestId("pharmacist-result").getAttribute("data-status")) === "ACTIVE", `imported ${good} answers the public check`);
    await pub.context().close();
  }

  // ---------- Status change with a reason ----------
  {
    const page = officer.page;
    await page.goto(`${BASE}/pcp/pharmacists?q=${TO_SUSPEND}`);
    await page.locator("tr", { hasText: TO_SUSPEND }).getByRole("link").first().click();
    await page.waitForURL(/\/pcp\/pharmacists\/\d+$/);
    const change = async (status, reason) => {
      await page.getByRole("button", { name: "Change status" }).click();
      const modal = page.locator(".ant-modal", { hasText: "Change the status of" });
      await modal.locator(".ant-radio-wrapper", { hasText: status }).click();
      await modal.locator("#status-reason").fill(reason);
      await modal.getByRole("button", { name: "Record the change" }).click();
      await confirmOtp(page);
      return toast(page, new RegExp(`is now ${status.toLowerCase()}`));
    };
    log(`status change: ${TO_SUSPEND} to Suspended`);
    ok(/is now suspended/.test(await change("Suspended", `KP Pharmacy Council letter KPPC/DC/2026/${run % 1000}: inquiry pending (test)`)), "recorded with a reason and a one-time code");
    await page.waitForFunction(() => document.querySelector("[data-testid=record-status]")?.textContent?.includes("Suspended"));
    ok((await page.locator(".ant-timeline").innerText()).includes("Active to Suspended"), "history shows the change");
    await shot(page, "record-suspended");
    const pub = await (await context()).newPage();
    await pub.goto(`${BASE}/verify?reg=${TO_SUSPEND}`);
    ok((await pub.getByTestId("pharmacist-result").innerText()).includes("This registration is suspended. The pharmacist may not practise while the suspension lasts."), "public check says suspended in plain words");
    await shot(pub, "public-suspended");
    log("put it back to Active");
    ok(/is now active/.test(await change("Active", "Inquiry closed by the KP Pharmacy Council (test run, restored)")), "restored");
    await pub.reload();
    ok((await pub.getByTestId("pharmacist-result").getAttribute("data-status")) === "ACTIVE", "public check active again");
    await pub.context().close();
  }
  await officer.ctx.close();

  // ---------- Other PCP desk roles can look, not change ----------
  {
    const { ctx, page } = await enterAs("pcp.secretary", "/pcp/pharmacists");
    log("pcp.secretary: view only");
    ok((await page.getByRole("button", { name: "Import from a provincial council" }).count()) === 0, "no import button");
    await page.goto(`${BASE}/pcp/pharmacists?q=${ACTIVE}`);
    await page.locator("tr", { hasText: ACTIVE }).getByRole("link").first().click();
    await page.waitForURL(/\/pcp\/pharmacists\/\d+$/);
    ok((await page.getByRole("button", { name: "Change status" }).count()) === 0, "no status change");
    ok((await page.locator("body").innerText()).includes("35202-XXXXXXX-") || /\d{5}-XXXXXXX-\d/.test(await page.locator("body").innerText()), "CNIC masked");
    await ctx.close();
  }
} catch (e) {
  failures++;
  console.error("ERROR:", e);
  if (current) await current.screenshot({ path: path.join(OUT, "error.png"), fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll pharmacist module checks passed");
console.log(`Screenshots: ${OUT}`);
process.exit(failures ? 1 : 0);
