// End-to-end test of the people module (RFP 4.1.2, 4.1.3, 4.1.16): provincial councils, faculty self-service,
// student requests and certificates, and the two-step sign-in for officers.
// Run from the repository root against a dev server on BASE (default http://localhost:3204):
//   node e2e/modules/people.mjs            re-seeds the database first (npm run seed)
//   SKIP_SEED=1 node e2e/modules/people.mjs
// Covers:
//   1. a PCP officer and a provincial officer signing in through the real Keycloak login are asked for the code;
//      the demo switch opens the workspace directly
//   2. punjab.council sees Punjab only, validates a pharmacist's practice update and sends a register file;
//      PCP registration sees "Validated by the Punjab Pharmacy Council", verifies the update and loads the file
//   3. sindh.council gets 404 for a Punjab institution, a Punjab pharmacist, Punjab evidence and a Punjab export
//   4. fac.noor sends a qualification update that pcp.verification approves, and declares leaving an institution;
//      pcp.verification creates a faculty login, which signs in through Keycloak (the user is deleted at the end)
//   5. student.ruh asks for an eligibility certificate; ruh.exam forwards it, pcp.verification issues it; the
//      PDF downloads and its QR page shows name, ID, institution, programme and status, never the CNIC
//   6. phone-width (390px) screenshots of /faculty, /student and /province
import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const BASE = process.env.BASE ?? "http://localhost:3204";
const T = 45000;
const OUT = process.env.SHOTS ?? path.resolve("e2e/screenshots/people");
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
const fail = (msg) => {
  throw new Error(msg);
};

if (!process.env.SKIP_SEED) {
  console.log("Re-seeding the database (npm run seed) ...");
  execSync("npm run seed", { stdio: ["ignore", "ignore", "inherit"] });
}

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const db = new pg.Client({ connectionString: env.DATABASE_URL });
await db.connect();
const q = async (sql, args) => (await db.query(sql, args)).rows;

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
const createdKeycloakUsers = [];
let current = null;

async function context(viewport = { width: 1440, height: 950 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  ctx.setDefaultTimeout(T);
  return ctx;
}

/** Open a page and wait until it is idle (hydrated), so the first click is not lost. */
async function open(page, url) {
  const res = await page.goto(url);
  await page.waitForLoadState("networkidle");
  return res;
}

/** Sign in through the demo switch (POST /api/demo/switch), landing on `next`. */
async function as(username, next, viewport) {
  const ctx = await context(viewport);
  const page = await ctx.newPage();
  await open(page, `${BASE}/login`);
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
  await page.waitForURL((u) => u.pathname === next.split("?")[0], { timeout: T });
  await page.waitForLoadState("networkidle");
  current = page;
  return { ctx, page };
}

/** Sign in through the real Keycloak login page (not the demo switch). */
async function keycloak(username, password = "Demo@1234") {
  const ctx = await context();
  const page = await ctx.newPage();
  await open(page, `${BASE}/login`);
  const card = page.locator(`[data-username="${username}"]`).getByRole("button", { name: /Sign in with Keycloak/ });
  if (await card.count()) await card.click();
  else await page.getByRole("button", { name: "Sign in with another account" }).click();
  await page.waitForURL(/\/auth\/realms\/pcp\//, { timeout: T });
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click("#kc-login");
  current = page;
  return { ctx, page };
}

const toast = async (page, re) => {
  const el = page.locator(".ant-message-notice", { hasText: re }).first();
  await el.waitFor({ timeout: T });
  const text = (await el.innerText()).trim();
  await page.waitForFunction(() => !document.querySelector(".ant-btn-loading"), null, { timeout: T });
  return text;
};
const confirmOtp = async (page) => {
  const modal = page.locator(".ant-modal", { hasText: "Confirm with a one-time code" });
  await modal.waitFor();
  await modal.getByRole("button", { name: "Confirm" }).click();
};
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${String(step).padStart(2, "0")}-${name}.png`), fullPage: true });
const noHScroll = (page) =>
  page
    .waitForFunction(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1, null, { timeout: 5000 })
    .then(() => true)
    .catch(() => false);

async function keycloakAdmin() {
  const issuer = env.AUTH_KEYCLOAK_ISSUER;
  const res = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.KEYCLOAK_ADMIN_CLIENT_ID, client_secret: env.KEYCLOAK_ADMIN_CLIENT_SECRET }),
  });
  const { access_token } = await res.json();
  return { base: issuer.replace("/realms/", "/admin/realms/"), headers: { Authorization: `Bearer ${access_token}` } };
}

try {
  // ---------- 1. Two-step sign-in for officers ----------
  {
    const { ctx, page } = await keycloak("pcp.verification");
    await page.waitForURL((u) => !u.toString().includes("/auth/realms/"), { timeout: T });
    await page.waitForURL(/\/login\/code/, { timeout: T });
    log("pcp.verification after the Keycloak password →", page.url().replace(BASE, ""));
    ok(page.url().includes("/login/code"), "a PCP officer signing in through Keycloak is asked for the one-time code");
    await page.locator("#signin-code").waitFor();
    await page.waitForFunction(() => document.querySelector("#signin-code")?.value?.length === 6, null, { timeout: T });
    await shot(page, "officer-code");
    // Opening a PCP page before the code goes back to the code screen.
    await open(page, `${BASE}/pcp/verification`);
    ok(page.url().includes("/login/code"), "/pcp pages stay closed until the code is entered");
    await page.waitForFunction(() => document.querySelector("#signin-code")?.value?.length === 6, null, { timeout: T });
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((u) => u.pathname.startsWith("/pcp"), { timeout: T });
    log("after the code →", page.url().replace(BASE, ""));
    ok(page.url().startsWith(`${BASE}/pcp`), "the code opens the PCP workspace");
    await open(page, `${BASE}/pcp/verification`);
    ok(page.url().endsWith("/pcp/verification"), "the code is remembered for the session");
    await ctx.close();
  }
  {
    const { ctx, page } = await keycloak("punjab.council");
    await page.waitForURL(/\/login\/code/, { timeout: T });
    ok(true, "a provincial officer signing in through Keycloak is asked for the code too");
    await page.waitForFunction(() => document.querySelector("#signin-code")?.value?.length === 6, null, { timeout: T });
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((u) => u.pathname.startsWith("/province"), { timeout: T });
    ok(true, "the code opens /province");
    await ctx.close();
  }
  {
    const { ctx, page } = await as("pcp.verification", "/pcp/verification");
    ok(page.url().endsWith("/pcp/verification"), "the demo switch opens /pcp directly (DEMO_MODE marks the code as verified)");
    await ctx.close();
  }

  // ---------- 2. Punjab: one province only; validation routing ----------
  const [punjabUpdate] = await q("select u.id, p.id as pid, p.reg_no, p.full_name from practice_updates u join pharmacists p on p.id = u.pharmacist_id where u.status = 'WITH_COUNCIL' and p.council = 'Punjab' limit 1");
  if (!punjabUpdate) fail("the seed has no practice update waiting for the Punjab Pharmacy Council");
  const [punjabInst] = await q("select code, name from institutions where province = 'Punjab' order by id limit 1");
  const [sindhInst] = await q("select code, name from institutions where province = 'Sindh' order by id limit 1");
  const [punjabPh] = await q("select id, reg_no from pharmacists where council = 'Punjab' order by id limit 1");
  const [evidence] = await q("select evidence_document_id as id from practice_updates where id = $1", [punjabUpdate.id]);
  {
    const { ctx, page } = await as("punjab.council", "/province");
    log("punjab.council opens /province");
    ok((await page.locator("h1").innerText()).includes("Punjab"), "the dashboard is for Punjab");
    await shot(page, "punjab-dashboard");
    await open(page, `${BASE}/province/institutions`);
    const list = await page.getByTestId("province-institutions").innerText();
    ok(list.includes(punjabInst.name) && !list.includes(sindhInst.name), `institutions: ${punjabInst.name} listed, ${sindhInst.name} (Sindh) not`);
    const provinces = await q("select distinct province from institutions where code = any($1)", [[...list.matchAll(/PCP-UNI-\d{6}/g)].map((m) => m[0])]);
    ok(provinces.length === 1 && provinces[0].province === "Punjab", "every institution on the page is in Punjab");
    await open(page, `${BASE}/province/pharmacists?tab=register`);
    const reg = await page.getByTestId("province-register").innerText();
    ok(/PPC-[AB]-\d{6}/.test(reg) && !/SPC-|KPPC-|BPC-|GBPC-/.test(reg), "the register shows Punjab numbers only");
    await open(page, `${BASE}/province/inspections`);
    await shot(page, "punjab-inspections");
    await open(page, `${BASE}/province/reports`);
    ok((await page.getByTestId("report-filters").innerText()).includes("Punjab (fixed)"), "reports are fixed to Punjab");
    const csv = await (await page.request.get(`${BASE}/api/province/reports/institutions?format=csv`)).text();
    ok(csv.includes("Punjab") && !csv.includes("Sindh"), "the Punjab CSV export contains Punjab and no other province");
    const xlsx = await page.request.get(`${BASE}/api/province/reports/intake?format=xlsx`);
    ok(xlsx.status() === 200 && xlsx.headers()["content-type"].includes("spreadsheetml"), "Excel export works");
    const pdf = await page.request.get(`${BASE}/api/province/reports/validity?format=pdf`);
    ok(pdf.status() === 200 && pdf.headers()["content-type"].includes("pdf"), "PDF export works");
    await shot(page, "punjab-reports");

    // Validate the waiting practice update
    await open(page, `${BASE}/province/pharmacists?tab=validation`);
    const card = page.getByTestId(`validate-${punjabUpdate.reg_no}`);
    await card.waitFor();
    await shot(page, "punjab-validation-queue");
    log(`punjab.council validates ${punjabUpdate.full_name}'s practice update`);
    await card.getByRole("button", { name: "Validate and send to PCP" }).click();
    await confirmOtp(page);
    ok(/Validated/.test(await toast(page, /Validated/)), "validated with a one-time code");
    ok((await q("select status from practice_updates where id = $1", [punjabUpdate.id]))[0].status === "PENDING", "the update moved on to PCP registration");

    // Send a register file from the council
    await open(page, `${BASE}/province/pharmacists?tab=files`);
    const fileCard = page.getByTestId("council-file-card");
    await fileCard.getByRole("button", { name: "Use a sample file" }).click();
    await page.getByTestId("council-file-report").waitFor();
    await shot(page, "punjab-file-checked");
    await fileCard.getByRole("button", { name: /Validate \d+ rows and send to PCP/ }).click();
    await confirmOtp(page);
    const sent = await toast(page, /sent to PCP registration/);
    log("register file →", sent);
    ok(/PCF-\d{4}-\d{4} sent to PCP registration/.test(sent), "the council's validated file goes to PCP registration");
    await ctx.close();
  }
  {
    const { ctx, page } = await as("pcp.registration", "/pcp/pharmacists");
    await open(page, `${BASE}/pcp/pharmacists?tab=updates`);
    const row = page.locator("tr", { hasText: punjabUpdate.reg_no });
    ok((await row.getByTestId("queue-council-validated").innerText()).includes("Validated by the Punjab Pharmacy Council"), "PCP's queue marks it Validated by the Punjab Pharmacy Council");
    await open(page, `${BASE}/pcp/pharmacists/${punjabUpdate.pid}`);
    const mark = page.getByTestId("council-validated");
    ok((await mark.innerText()).includes("Validated by the Punjab Pharmacy Council"), "the PCP pharmacist record shows the council's validation step");
    ok((await page.locator(".ant-timeline").innerText()).includes("Provincial council validation"), "the record's history has the validation step");
    await shot(page, "pcp-record-validated");
    await page.getByTestId("pending-update").getByRole("button", { name: "Verify" }).click();
    await confirmOtp(page);
    ok(/practice place is confirmed/.test(await toast(page, /confirmed/)), "PCP registration verifies it");

    await open(page, `${BASE}/pcp/pharmacists?tab=imports`);
    const files = page.getByTestId("council-files-queue");
    await files.waitFor();
    log("pcp.registration loads the council's file");
    await files.getByRole("button", { name: "Load into the register" }).first().click();
    await confirmOtp(page);
    const loaded = await toast(page, /loaded|not loaded/);
    log("load →", loaded);
    ok(/PCF-\d{4}-\d{4} loaded\. IMP-\d{4}-\d{4}/.test(loaded), "the file is loaded through the normal import");
    const [imp] = await q("select f.import_ref, p.id from council_files f join pharmacist_imports i on i.ref = f.import_ref join pharmacists p on p.import_id = i.id where f.status = 'LOADED' limit 1");
    await open(page, `${BASE}/pcp/pharmacists/${imp.id}`);
    ok((await page.getByTestId("import-council-validated").innerText()).includes("Validated by the Punjab Pharmacy Council"), "an imported record shows Validated by the Punjab Pharmacy Council");
    await shot(page, "pcp-imported-validated");
    await ctx.close();
  }

  // ---------- 3. Sindh never sees Punjab ----------
  {
    const { ctx, page } = await as("sindh.council", "/province");
    log("sindh.council tries Punjab data");
    ok((await page.locator("h1").innerText()).includes("Sindh"), "the dashboard is for Sindh");
    const r1 = await open(page, `${BASE}/province/institutions/${punjabInst.code}`);
    ok(r1.status() === 404, `a Punjab institution (${punjabInst.code}) is 404`);
    const r2 = await open(page, `${BASE}/province/pharmacists/${punjabPh.id}`);
    ok(r2.status() === 404, `a Punjab pharmacist (${punjabPh.reg_no}) is 404`);
    const r3 = await page.request.get(`${BASE}/api/province/reports/institutions?format=csv&province=Punjab`);
    ok(r3.status() === 404, "a Punjab export is 404");
    const r4 = await page.request.get(`${BASE}/api/province/reports/institutions?format=xlsx&province=Punjab`);
    ok(r4.status() === 404, "a Punjab Excel export is 404");
    const own = await (await page.request.get(`${BASE}/api/province/reports/institutions?format=csv`)).text();
    ok(own.includes("Sindh") && !own.includes("Punjab"), "Sindh's own export has no Punjab rows");
    const r5 = await page.request.get(`${BASE}/api/people/documents/${evidence.id}`);
    ok(r5.status() === 404, "Punjab practice evidence is 404");
    const r6 = await page.request.get(`${BASE}/api/reports/institutions?format=csv`);
    ok(r6.status() === 403, "PCP's own report export is refused (403)");
    await open(page, `${BASE}/province/institutions`);
    ok(!(await page.locator("body").innerText()).includes(punjabInst.name), "the Sindh institutions list has no Punjab institution");
    await open(page, `${BASE}/pcp/verification`);
    ok(!page.url().includes("/pcp/"), "/pcp is closed to a provincial officer");
    await ctx.close();
  }

  // ---------- 4. Faculty self-service ----------
  {
    const { ctx, page } = await as("fac.noor", "/faculty");
    log("fac.noor sends a qualification update");
    ok((await page.getByTestId("faculty-card").innerText()).includes("PCP-FAC-000094"), "she sees her Faculty ID");
    ok((await page.getByTestId("faculty-links").innerText()).includes("Riverside University"), "she sees her institutional link");
    await page.getByRole("button", { name: "Update my qualification" }).click();
    const modal = page.locator(".ant-modal", { hasText: "Update my qualification" });
    await modal.getByRole("button", { name: /Fill demo values/ }).click();
    await modal.getByRole("button", { name: "Attach sample PDF" }).click();
    await modal.getByTestId("fq-evidence").waitFor();
    await modal.getByRole("button", { name: "Send to PCP" }).click();
    const sentMsg = await toast(page, /sent to PCP's verification desk/);
    const ref = /FUR-\d{4}-\d{4}/.exec(sentMsg)[0];
    log("→", sentMsg);
    ok((await q("select qualification from faculty where pcp_id = 'PCP-FAC-000094'"))[0].qualification === "M.Pharm", "nothing changes before PCP approves");
    await shot(page, "faculty-update-sent");

    log("fac.noor declares leaving Riverside");
    await page.getByRole("button", { name: "Declare joining or leaving" }).click();
    const am = page.locator(".ant-modal", { hasText: "Declare an institutional attachment" });
    await am.getByLabel("What happened").fill("Moving to a new post next month; resigned with notice.");
    await am.getByRole("button", { name: "Send the declaration" }).click();
    const dec = await toast(page, /Declared/);
    ok(/FCR-\d{4}-\d{4}/.test(dec), "the declaration becomes a registry change request");
    const fcrRef = /FCR-\d{4}-\d{4}/.exec(dec)[0];
    const [inform] = await q("select count(*)::int as n from notifications where audience = 'inst:PCP-UNI-000101' and body like $1", [`%${fcrRef}%`]);
    ok(inform.n === 1, "Riverside is notified of the declaration");

    const pcp = await as("pcp.verification", "/pcp/verification");
    await open(pcp.page, `${BASE}/pcp/verification?tab=faculty-requests`);
    const card = pcp.page.getByTestId(`fur-${ref}`);
    await card.waitFor();
    await shot(pcp.page, "pcp-teachers-requests");
    await card.getByRole("button", { name: "Approve and apply" }).click();
    await pcp.page.locator(".ant-modal", { hasText: `Approve ${ref}` }).getByRole("button", { name: "Continue" }).click();
    await confirmOtp(pcp.page);
    ok(/approved and applied/.test(await toast(pcp.page, /approved and applied/)), "pcp.verification approves it with a one-time code");
    await open(pcp.page, `${BASE}/pcp/verification?tab=changes`);
    ok((await pcp.page.getByTestId(`request-${fcrRef}`).count()) === 1, "the teacher's declaration waits in Change requests");

    await page.reload();
    ok((await page.getByTestId("faculty-card").innerText()).includes("PhD"), "her record now shows PhD");
    ok((await page.getByTestId("faculty-requests").innerText()).includes("Approved"), "she sees the decision");
    await shot(page, "faculty-approved");
    await ctx.close();

    // A faculty login for another teacher: created by PCP, used through Keycloak, deleted at the end.
    log("pcp.verification creates a faculty login for PCP-FAC-000095");
    await open(pcp.page, `${BASE}/pcp/faculty/PCP-FAC-000095`);
    await pcp.page.getByTestId("faculty-login-card").getByRole("button", { name: "Create a faculty login" }).click();
    const issued = pcp.page.getByTestId("faculty-login-issued");
    await issued.waitFor();
    const codes = await issued.locator("code").allInnerTexts();
    const [username, temp] = codes.map((c) => c.trim());
    createdKeycloakUsers.push(username);
    ok(/^fac\.[a-z]+\.\d{4}[a-f]?$/.test(username) && /^Pcp-/.test(temp), `login ${username} created; temporary password shown once`);
    await shot(pcp.page, "faculty-login-created");
    await pcp.ctx.close();
    const nu = await keycloak(username, temp);
    await nu.page.waitForSelector("#password-new", { timeout: T });
    const fresh = `Fac-${Date.now() % 100000}-Pass!`;
    await nu.page.fill("#password-new", fresh);
    await nu.page.fill("#password-confirm", fresh);
    await nu.page.locator('input[type="submit"], button[type="submit"]').first().click();
    await nu.page.waitForURL(/\/faculty/, { timeout: T });
    await nu.page.waitForLoadState("networkidle");
    ok((await nu.page.getByTestId("faculty-card").innerText()).includes("PCP-FAC-000095"), "the new faculty login opens that teacher's own record (no officer code needed)");
    await nu.ctx.close();
  }

  // ---------- 5. Student request, certificate and public check ----------
  {
    const [areeba] = await q("select id, pcp_id, full_name, cnic from students where username = 'student.ruh'");
    const student = await as("student.ruh", "/student");
    log("student.ruh asks for an eligibility certificate");
    await student.page.getByTestId("student-requests").getByRole("button", { name: "Eligibility certificate" }).click();
    await student.page.locator(".ant-modal").getByRole("button", { name: "Send the request" }).click();
    const sent = await toast(student.page, /sent to RUH's examination office/);
    const ref = /SRQ-\d{4}-\d{4}/.exec(sent)[0];
    ok(!!ref, `request ${ref} raised`);
    await shot(student.page, "student-request-sent");

    const exam = await as("ruh.exam", "/institution/students");
    const row = exam.page.getByTestId(`inst-srq-${ref}`);
    await row.waitFor();
    await shot(exam.page, "exam-queue");
    log("ruh.exam confirms the degree and forwards it");
    await row.getByRole("button", { name: /forward to PCP/i }).click();
    await exam.page.locator(".ant-modal").getByRole("button", { name: "Forward to PCP" }).click();
    ok(/forwarded to PCP/.test(await toast(exam.page, /forwarded to PCP/)), "forwarded by the examination officer");
    ok((await q("select degree_verified from students where id = $1", [areeba.id]))[0].degree_verified === true, "the degree check ran when it was forwarded");
    await exam.ctx.close();

    const pcp = await as("pcp.verification", "/pcp/verification");
    await open(pcp.page, `${BASE}/pcp/verification?tab=student-requests`);
    const card = pcp.page.getByTestId(`pcp-srq-${ref}`);
    await card.waitFor();
    log("pcp.verification issues the certificate");
    await card.getByRole("button", { name: "Issue the eligibility certificate" }).click();
    await pcp.page.locator(".ant-modal", { hasText: ref }).getByRole("button", { name: "Continue" }).click();
    await confirmOtp(pcp.page);
    const issued = await toast(pcp.page, /issued/);
    const no = /SC-\d{4}-\d{6}/.exec(issued)[0];
    ok(!!no, `certificate ${no} issued`);
    await pcp.ctx.close();

    await student.page.reload();
    const box = student.page.getByTestId("certificate-issued");
    await box.waitFor();
    ok((await box.innerText()).includes(no), "the student sees the certificate");
    await shot(student.page, "student-certificate");
    const href = await box.getByRole("link", { name: /Download PDF/ }).getAttribute("href");
    const pdf = await student.page.request.get(`${BASE}${href}`);
    const body = await pdf.body();
    ok(pdf.status() === 200 && pdf.headers()["content-type"] === "application/pdf" && body.subarray(0, 4).toString() === "%PDF", "the certificate downloads as a PDF");
    const other = await as("student.rbu", "/student");
    const denied = await other.page.request.get(`${BASE}${href}`);
    ok(denied.status() === 404, "another student cannot download it");
    await other.ctx.close();
    await student.ctx.close();

    const pub = await (await context()).newPage();
    await open(pub, `${BASE}/verify/student/${no}`);
    const text = await pub.getByTestId("student-verify").innerText();
    const digits = areeba.cnic.replace(/\D/g, "");
    ok(text.includes(areeba.full_name) && text.includes(areeba.pcp_id) && text.includes("Riverside University") && text.includes("PharmD") && /eligible for registration/i.test(text), "the QR page shows name, student ID, institution, programme and status");
    const html = await pub.content();
    ok(!html.includes(areeba.cnic) && !html.replace(/\D/g, "").includes(digits) && !html.includes(areeba.cnic.slice(0, 5) + "-"), "the QR page shows no CNIC");
    ok(!html.includes("Noor Ahmed"), "the QR page does not show the father's name");
    await shot(pub, "public-student-check");
    const bad = await open(pub, `${BASE}/verify/student/SC-2026-999999`);
    ok(bad.status() === 200 && (await pub.getByTestId("verify-result").innerText()).includes("No certificate"), "an unknown number says so");
    await pub.context().close();
  }

  // ---------- 6. Phone width ----------
  for (const [user, page] of [
    ["fac.noor", "/faculty"],
    ["student.ruh", "/student"],
    ["punjab.council", "/province"],
    ["punjab.council", "/province/pharmacists?tab=validation"],
  ]) {
    const { ctx, page: p } = await as(user, page, { width: 390, height: 844 });
    await p.waitForTimeout(600);
    ok(await noHScroll(p), `${page} at 390px has no horizontal scroll`);
    await shot(p, `phone-${user}-${page.replace(/\W+/g, "-")}`);
    await ctx.close();
  }

  // ---------- Audit ----------
  {
    const actions = (await q("select distinct action from audit_log where action like any($1)", [["signin.code.%", "pharmacist.practice.council_%", "council.file.%", "faculty.self.%", "faculty.login.created", "student.request.%", "student.certificate.issued", "report.export%"]])).map((r) => r.action);
    for (const a of ["signin.code.sent", "signin.code.verified", "pharmacist.practice.council_validated", "council.file.validated", "council.file.loaded", "faculty.self.profile_submitted", "faculty.self.request_approved", "faculty.self.attachment_declared", "faculty.login.created", "student.request.raised", "student.request.forwarded", "student.certificate.issued", "report.exported", "report.export.denied"])
      ok(actions.includes(a), `audit log has ${a}`);
    const chain = JSON.parse(execSync("npm run -s audit:verify", { encoding: "utf8" }).trim().split("\n").pop());
    ok(chain.ok, `audit chain verifies (${chain.total} rows)`);
  }
} catch (e) {
  failures++;
  console.error("\nERROR:", e.message);
  if (current) await current.screenshot({ path: path.join(OUT, "FAILED.png"), fullPage: true }).catch(() => undefined);
} finally {
  // Delete every Keycloak user this test created (the shared demo users are never touched).
  if (createdKeycloakUsers.length) {
    try {
      const kc = await keycloakAdmin();
      for (const u of createdKeycloakUsers) {
        const list = await (await fetch(`${kc.base}/users?username=${encodeURIComponent(u)}&exact=true`, { headers: kc.headers })).json();
        for (const x of list) await fetch(`${kc.base}/users/${x.id}`, { method: "DELETE", headers: kc.headers });
        console.log(`cleanup: deleted Keycloak user ${u}`);
      }
    } catch (e) {
      console.error("cleanup failed:", e.message);
      failures++;
    }
  }
  await db.end();
  await browser.close();
}
console.log(failures ? `\nFAIL: ${failures} check(s) failed. Screenshots in ${OUT}` : `\nPASS: people module end to end. Screenshots in ${OUT}`);
process.exitCode = failures ? 1 : 0;
