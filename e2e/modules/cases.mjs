// Case workflow module test: accreditation, renewal (alert, prepared file, teacher load, dues), team inspection
// with declared and same-province conflicts, deferral with a return date, rejection with a letter and the
// 12-month bar, the service-level clock and escalation, case messages, the task-first dashboard.
// Run on a fresh seed:  npm run seed && BASE=http://localhost:3202 node e2e/modules/cases.mjs
// Uses the demo persona switch (Keycloak-backed) and reads the database only to assert or to add a due.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const BASE = process.env.BASE ?? "http://localhost:3202";
const DB = process.env.DATABASE_URL ?? "postgres://pcp:pcp_demo_pw@localhost:5433/pcp_cases";
const OUT = process.env.SHOTS ?? path.resolve("e2e/screenshots/cases");
const T = 25000;
mkdirSync(OUT, { recursive: true });
let step = 0;
const log = (...a) => console.log(`[${++step}]`, ...a);
const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const assert = (cond, msg) => {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
};

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
ctx.setDefaultTimeout(T);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  page error:", e.message));
const consoleErrors = new Map();
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text().replace(/\s+/g, " ").slice(0, 300);
  consoleErrors.set(t, (consoleErrors.get(t) ?? 0) + 1);
});

const settle = () => page.waitForLoadState("networkidle");
const shot = (name) => page.screenshot({ path: path.join(OUT, `${String(step).padStart(2, "0")}-${name}.png`), fullPage: true });
const toast = async (re) => {
  const el = page.locator(".ant-message-notice", { hasText: re }).first();
  await el.waitFor({ timeout: T });
  return (await el.innerText()).trim();
};
const okToast = async (re) => {
  const t = await toast(new RegExp(`${re.source}|wrong|Not allowed|Fix the|Cannot|missing|must|needs`));
  if (!re.test(t)) throw new Error(`Unexpected message: ${t}`);
  // A button stays in its loading state until the refreshed page arrives; clicks before that are ignored.
  await page.waitForFunction(() => !document.querySelector(".ant-btn-loading"), null, { timeout: T });
  await page.waitForTimeout(300);
  return t;
};
const otp = async () => {
  await page.locator(".ant-modal").getByRole("button", { name: "Confirm" }).click();
};
const pick = async (select, text) => {
  await select.click();
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: text }).first().click();
  await page.waitForTimeout(400); // let the dropdown close before the next one opens
};

/** Switch persona the way the presenter guide does (a form POST to the demo switch). */
async function as(username, next) {
  await page.goto(`${BASE}/login`);
  await page.evaluate(
    ([u, n]) => {
      const f = document.createElement("form");
      f.method = "POST";
      f.action = "/api/demo/switch";
      for (const [k, v] of Object.entries({ username: u, next: n })) {
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
  await page.waitForURL((u) => u.pathname === next.split("?")[0], { timeout: T });
  await settle();
}

const ACC_DOCS = ["Self-assessment evidence", "Annual compliance statement"];
async function attachSamples(docs = ACC_DOCS) {
  for (const doc of docs) {
    await page.locator(".required-doc", { hasText: doc }).getByRole("button", { name: /Attach sample PDF/ }).click();
    await toast(/Uploaded v/);
    await page.locator(".required-doc", { hasText: doc }).getByRole("button", { name: /Attach sample PDF/ }).waitFor({ state: "detached", timeout: T });
  }
}

async function payAndSubmit() {
  await page.reload();
  await settle();
  const failing = await page.locator(".check-fail").count();
  if (failing) throw new Error(`Checks failing: ${await page.locator(".check-fail").allInnerTexts()}`);
  await page.getByRole("button", { name: /generate challan/i }).click();
  await okToast(/PSID/);
  await page.getByRole("button", { name: /Simulate bank confirmation/ }).click();
  await otp();
  await okToast(/Payment confirmed/);
  await page.getByRole("button", { name: /Submit application/ }).click();
  return okToast(/Submitted/);
}

async function technicalReview(ref) {
  await as("pcp.officer", `/pcp/applications/${ref}`);
  await page.getByRole("button", { name: /Start scrutiny/ }).click();
  await okToast(/Scrutiny started/);
  await page.getByRole("button", { name: /Pass scrutiny/ }).click();
  await okToast(/Scrutiny passed/);
  const meets = page.locator(".review-rating .ant-radio-button-wrapper", { hasText: /^Meets$/ });
  await meets.nth(4).waitFor();
  for (let i = 0; i < (await meets.count()); i++) await meets.nth(i).click();
  await page.getByPlaceholder("Summary of the technical review").fill("Meets the academic standards; proceed to inspection.");
  await page.getByRole("button", { name: /Record review/ }).click();
  return okToast(/Technical review recorded/);
}

try {
  // ---------- Service levels: the seeded overdue case, escalation, the clock on both sides ----------
  await as("pcp.officer", "/pcp/applications");
  await page.getByText("All (", { exact: false }).first().click();
  const firstRow = page.locator(".ant-table-tbody tr").first();
  const firstRef = (await firstRow.locator("a.mono").innerText()).trim();
  assert(firstRef === "NOC-2026-0001", `overdue case listed first (got ${firstRef})`);
  assert((await firstRow.getByTestId("overdue-badge").count()) === 1, "overdue badge on the first row");
  log("queue: overdue first →", firstRef, (await firstRow.getByTestId("overdue-badge").innerText()).trim());
  await shot("queue-overdue-first");
  await page.goto(`${BASE}/pcp/applications/NOC-2026-0001`);
  const clock = (await page.getByTestId("sla-clock").innerText()).trim();
  assert(/Scrutiny · \d+ days overdue/.test(clock), `PCP clock reads overdue (${clock})`);
  assert(await page.getByText(/Escalated \d/).first().isVisible(), "escalation shown on the case header");
  log("PCP case header clock →", clock, "· escalated");
  const notices = await q("select sn.kind, sn.audience from sla_notices sn join applications a on a.id = sn.application_id where a.ref = 'NOC-2026-0001' order by sn.kind");
  assert(notices.length === 2 && notices[0].kind === "ESCALATION" && notices[1].kind === "REMINDER", "one reminder and one escalation");
  log("SLA notices →", notices.map((n) => `${n.kind} to ${n.audience}`).join("; "));
  await as("ccp.poc", "/institution/applications/NOC-2026-0002");
  const instClock = (await page.getByTestId("sla-clock").innerText()).trim();
  assert(/Deficiency response · \d+ days left/.test(instClock), `institution sees its own clock (${instClock})`);
  log("institution case header clock →", instClock);

  // ---------- Renewal: alert, prepared file, teacher load, dues, self-assessment, pending history row ----------
  await as("ruh.poc", "/institution");
  const alert = page.getByText(/Renewal due: PharmD accreditation expires on 15 Mar 2027/).first();
  assert(await alert.isVisible(), "renewal alert on the institution dashboard");
  const alerts = await q("select threshold from renewal_alerts ra join programs p on p.id = ra.program_id join institutions i on i.id = p.institution_id where i.short_code = 'RUH'");
  assert(alerts.length === 1 && alerts[0].threshold === 180, "the 180-day alert was sent once");
  log("renewal alert (180 days) on the dashboard and by email, once");
  await page.goto(`${BASE}/institution/applications`);
  await page.locator('[data-programme="PHARMD"]').getByRole("button", { name: "Start renewal" }).click();
  await page.waitForURL(/\/institution\/applications\/RNW-2026-/);
  await settle();
  const rnw = page.url().split("/").pop();
  const linked = await page.locator("#case-faculty .ant-table-tbody tr").count();
  const intake = await page.getByLabel("Proposed intake (students per year)").inputValue();
  assert(linked === 12 && intake === "100", `prepared from RNW-2024-0001 (12 teachers, intake 100; got ${linked}, ${intake})`);
  log("renewal", rnw, "prepared from existing records: 12 faculty linked, intake 100");
  // Teacher load: a technician lecturer counted on the PharmD renewal is over the permitted load.
  const [tech] = await q("select f.pcp_id from faculty f join faculty_links l on l.faculty_id = f.id join institutions i on i.id = l.institution_id where i.short_code = 'RUH' and l.program_type = 'TECH' and l.status = 'ACTIVE' order by f.pcp_id limit 1");
  const search = page.locator(".case-faculty-search");
  await search.click();
  await search.locator("input").fill(tech.pcp_id);
  await page.waitForTimeout(900);
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option:not(.ant-select-item-option-disabled)", { hasText: tech.pcp_id }).first().click();
  await pick(page.locator(".case-subject-select"), /^Pharmacology$/);
  await page.getByRole("button", { name: "Link teacher" }).click();
  await okToast(/linked to Pharmacology/);
  await page.reload();
  const load = await page.locator('.check-fail[data-check="load"]').innerText();
  assert(/also counted on the Pharmacy Technician programme; permitted load is 1/.test(load), "teacher load check names the teacher and the rule");
  log("teacher load →", load.split("\n").find((l) => l.includes("permitted")));
  const techRow = page.locator("#case-faculty .ant-table-tbody tr", { has: page.getByText("Appointed to Pharmacy Technician") });
  await techRow.getByRole("button").last().click();
  await okToast(/removed from this case/);
  // Outstanding dues block the case until paid or waived.
  const [{ id: ruhId }] = await q("select id from institutions where short_code = 'RUH'");
  const [{ id: dueId }] = await q("insert into dues (institution_id, description, amount, due_date) values ($1, 'Annual registration fee 2026', 50000, '2026-09-30') returning id", [ruhId]);
  await page.getByRole("button", { name: "Re-run" }).click();
  await okToast(/Checks re-run/);
  await page.waitForTimeout(800);
  const dues = await page.locator('.check-fail[data-check="dues"]').innerText();
  assert(/Rs 50,000 outstanding: Annual registration fee 2026/.test(dues), "dues check names the due");
  log("outstanding dues →", dues.split("\n").find((l) => l.includes("Rs ")));
  await q("update dues set status = 'WAIVED' where id = $1", [dueId]);
  // Self-assessment, annual compliance, documents.
  await page.locator("#case-self").getByRole("button", { name: "Fill demo values" }).click();
  await page.getByRole("button", { name: "Save self-assessment" }).click();
  await okToast(/Self-assessment saved/);
  await page.getByText("We confirm the programme complied").click();
  await page.getByRole("button", { name: "Save and run checks" }).click();
  await okToast(/Saved/);
  await attachSamples();
  await shot("renewal-draft");
  log("renewal →", await payAndSubmit());
  await page.goto(`${BASE}/institution/applications`);
  const pendingRow = (await page.locator('[data-programme="PHARMD"] .history-pending').innerText()).replace(/\s+/g, " ").trim();
  assert(/Renewal 2027–2030 for intake 100 · RNW-2026-\d{4} pending/.test(pendingRow), `pending history row (${pendingRow})`);
  log("programme history →", pendingRow);
  await shot("renewal-pending-row");

  // ---------- Accreditation with a team inspection, a declared conflict, a deferral and a certificate ----------
  await as("gmi.poc", "/institution/applications");
  await page.locator('[data-programme="TECH"]').getByRole("button", { name: "Apply for accreditation" }).click();
  await page.waitForURL(/\/institution\/applications\/ACC-2026-/);
  await settle();
  const acc = page.url().split("/").pop();
  log("accreditation", acc, "prepared:", await page.locator("#case-faculty .ant-table-tbody tr").count(), "faculty from NOC-2025-0007");
  await page.locator("#case-self").getByRole("button", { name: "Fill demo values" }).click();
  await page.getByRole("button", { name: "Save self-assessment" }).click();
  await okToast(/Self-assessment saved/);
  await attachSamples();
  log("accreditation →", await payAndSubmit());
  await technicalReview(acc);
  log("technical review recorded on", acc);

  // Declared conflict: the coordinator records it, the booking is refused, the declaration is withdrawn.
  await as("pcp.coordinator", "/pcp/inspections");
  await pick(page.locator(".conflict-member"), "Zainab");
  await page.locator(".conflict-institution").click();
  await page.locator(".conflict-institution input").fill("Gilgit");
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "Gilgit Mountain" }).first().click();
  await page.locator(".conflict-reason").fill("Close relative on the institution's faculty");
  await page.getByRole("button", { name: "Record conflict" }).click();
  log("coordinator →", await okToast(/Conflict recorded/));
  await page.goto(`${BASE}/pcp/applications/${acc}`);
  await pick(page.locator(".pcp-inspector-select"), "Kamran");
  await pick(page.locator(".pcp-team-select"), "Zainab");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Fill demo values" }).first().click();
  await page.getByRole("button", { name: "Schedule and notify" }).click();
  log("declared conflict →", (await toast(/Conflict of interest/)).slice(0, 120));
  await shot("team-conflict");
  await page.goto(`${BASE}/pcp/inspections`);
  await page.getByTestId("conflicts").getByRole("button", { name: "Withdraw" }).first().click();
  await okToast(/withdrawn/);
  await page.goto(`${BASE}/pcp/applications/${acc}`);
  await pick(page.locator(".pcp-inspector-select"), "Kamran");
  await pick(page.locator(".pcp-team-select"), "Zainab");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Fill demo values" }).first().click();
  await page.getByRole("button", { name: "Schedule and notify" }).click();
  log("coordinator →", (await okToast(/Inspection scheduled/)).slice(0, 120));
  // Same-province rule on a KP case: Zainab (KP) cannot inspect Riverside (KP).
  await technicalReview(rnw);
  await as("pcp.coordinator", `/pcp/applications/${rnw}`);
  await pick(page.locator(".pcp-inspector-select"), "Zainab");
  await page.getByRole("button", { name: "Schedule and notify" }).click();
  log("same province →", (await toast(/Conflict of interest/)).slice(0, 110));

  // The institution sees the date, the scope and the team size, not the names.
  await as("gmi.poc", `/institution/applications/${acc}`);
  const instInsp = (await page.getByTestId("inst-inspection").innerText()).replace(/\s+/g, " ");
  assert(/team of 2/.test(instInsp) && /Please prepare:/.test(instInsp) && !/Zainab|Kamran/.test(instInsp), "institution sees date, scope and team size only");
  log("institution sees →", instInsp.slice(0, 110));
  // A member sees the visit but cannot submit; the lead submits the checklist.
  await as("pcp.inspector2", "/pcp/inspections");
  const visit = page.getByTestId(`visit-${acc}`);
  assert((await visit.innerText()).includes("Team member"), "member sees the visit as a team member");
  await visit.getByRole("button", { name: "Open visit" }).click();
  await page.waitForURL(/\/pcp\/inspections\/\d+/);
  assert(await page.getByText("You are a member of this inspection team").isVisible(), "member view");
  assert((await page.getByRole("button", { name: "Submit inspection report" }).count()) === 0, "member cannot submit");
  log("team member sees the visit; only the lead submits");
  await shot("member-visit");
  await as("pcp.inspector", "/pcp/inspections");
  await page.getByTestId(`visit-${acc}`).getByRole("button", { name: "Open checklist" }).click();
  await page.waitForURL(/\/pcp\/inspections\/\d+/);
  await page.getByRole("button", { name: "Fill demo values" }).click();
  await page.getByRole("button", { name: "Submit inspection report" }).click();
  await page.waitForURL(new RegExp(`/pcp/applications/${acc}`));
  log("lead submitted the checklist");
  await as("pcp.officer", `/pcp/applications/${acc}`);
  await page.getByPlaceholder("Recommendation for the council").fill("Recommend accreditation for intake 40.");
  await page.getByRole("button", { name: "Forward to council agenda" }).click();
  await okToast(/Forwarded/);

  // Deferral: a reason and a return date, a one-time code, a decision letter on both sides.
  await as("pcp.secretary", `/pcp/applications/${acc}`);
  await page.locator(".decision-choice").getByText("Defer").click();
  await page.getByPlaceholder("Reason for deferral: what the institution must do").fill("Upload the renewed appointment letter of the Pharmacology lecturer and the lab safety audit.");
  await page.getByRole("button", { name: "Record deferral" }).click();
  await otp();
  const deferred = await okToast(/deferred until \d{4}-\d{2}-\d{2}/);
  log("secretary →", deferred);
  const [{ defer_until, letter_document_id }] = await q("select defer_until, letter_document_id from applications where ref = $1", [acc]);
  assert(defer_until && letter_document_id, "deferral stores its return date and letter");
  await as("gmi.poc", `/institution/applications/${acc}`);
  const card = (await page.getByTestId("decision-card").innerText()).replace(/\s+/g, " ");
  assert(/Deferred until/.test(card) && /Reason: Upload the renewed/.test(card) && /Return date:/.test(card), "institution sees reason and return date");
  const letter = await page.request.get(`${BASE}/api/documents/${letter_document_id}`);
  assert(letter.status() === 200 && (await letter.body()).subarray(0, 4).toString() === "%PDF", "institution can open the decision letter PDF");
  log("institution sees the deferral →", card.slice(0, 120), "· letter PDF", letter.status());
  await shot("deferral-institution");
  const answer = page.getByTestId("deferral-answer");
  await answer.getByRole("button", { name: "Fill demo values" }).click();
  await answer.getByRole("button", { name: /Attach sample PDF/ }).click();
  await okToast(/Evidence uploaded/);
  await answer.getByRole("button", { name: "Send to PCP" }).click();
  log("institution answers the deferral →", await okToast(/Sent to PCP/));

  // Back to the council, approve, issue the accreditation certificate (one-time codes).
  await as("pcp.officer", `/pcp/applications/${acc}`);
  await page.getByPlaceholder("What changed since the deferral").fill("Appointment letter and safety audit received.");
  await page.getByRole("button", { name: "Return to council agenda" }).click();
  await okToast(/Returned to the council/);
  await as("pcp.secretary", `/pcp/applications/${acc}`);
  await page.getByRole("button", { name: "Record approval" }).click();
  await otp();
  await okToast(/approved/);
  await page.getByRole("button", { name: /Issue accreditation certificate/ }).click();
  await otp();
  const issued = await okToast(/Certificate ACR-TECH-\d{4}-\d{4}/);
  const cert = /ACR-TECH-\d{4}-\d{4}/.exec(issued)[0];
  log("secretary →", issued);
  await shot("accreditation-issued");
  await page.goto(`${BASE}/verify/certificate/${cert}`);
  const verify = (await page.getByTestId("verify-result").innerText()).trim();
  assert(verify === "Genuine accreditation certificate: valid", `public check (${verify})`);
  assert(await page.getByText(/^\d{4}–\d{4}$/).first().isVisible(), "public check shows the term");
  log("public QR page →", verify);
  await shot("accreditation-verify");
  await page.goto(`${BASE}/certificate/${cert}`);
  assert(await page.getByText("Accreditation Certificate").isVisible(), "printable accreditation certificate");
  const prog = await q("select accreditation_status, accreditation_valid_until::text as accreditation_valid_until from programs p join institutions i on i.id = p.institution_id where i.short_code = 'GMI' and p.type = 'TECH'");
  const hist = await q("select status, valid_from, valid_until, intake, decision, application_ref from accreditation_history where application_ref = $1", [acc]);
  assert(prog[0].accreditation_status === "VALID" && hist.length === 1 && hist[0].decision === "Approved", "programme VALID and one history row");
  log("programme →", prog[0].accreditation_status, "until", prog[0].accreditation_valid_until, "· history", `${hist[0].status} ${hist[0].valid_from}–${hist[0].valid_until} intake ${hist[0].intake}`);
  await as("gmi.poc", `/institution/applications/${acc}`);
  const msgs = await page.getByTestId("case-messages").locator(".ant-table-tbody tr").count();
  assert(msgs > 3, "case messages listed on the case");
  log("case messages on the institution's screen:", msgs, "on the first page");

  // ---------- Rejection with grounds and a letter; the 12-month bar ----------
  await as("pcp.secretary", "/pcp/applications/NOC-2026-0005");
  await page.locator(".decision-choice").getByText("Reject").click();
  await page.getByPlaceholder("Grounds for rejection").fill("Faculty strength is below the PCP standard and the library deficiency was not resolved.");
  await page.getByRole("button", { name: "Record rejection" }).click();
  await otp();
  log("secretary →", await okToast(/rejected/));
  await as("bvu.poc", "/institution/applications/NOC-2026-0005");
  const rej = (await page.getByTestId("decision-card").innerText()).replace(/\s+/g, " ");
  assert(/Rejected by the council/.test(rej) && /Grounds: Faculty strength/.test(rej) && (await page.getByTestId("decision-letter").count()) === 1, "grounds and letter shown");
  log("institution sees →", rej.slice(0, 110));
  await shot("rejection-institution");
  await page.goto(`${BASE}/institution/applications`);
  await page.getByRole("button", { name: /New NOC application/ }).hover();
  await page.getByText("New PharmD NOC application").click();
  await page.waitForURL(/\/institution\/applications\/NOC-/);
  await settle();
  const bar = await page.locator('.check-fail[data-check="regulatory"]').innerText();
  assert(/NOC-2026-0005 was rejected/.test(bar), "regulatory bar names the rejected case");
  log("regulatory bar →", bar.split("\n").find((l) => l.includes("rejected")).slice(0, 140));

  // ---------- Task-first dashboard: My work, tiles that open their lists; case views are audited ----------
  await as("pcp.officer", "/pcp");
  assert(await page.getByTestId("work-due").isVisible(), "My work: due");
  assert((await page.getByTestId("work-blocked").innerText()).includes("NOC-2026-0001"), "My work: overdue case listed");
  assert((await page.getByTestId("work-decided").innerText()).includes("NOC-2026-0005"), "My work: decided recently");
  await shot("dashboard-my-work");
  await page.getByTestId("kpi-tiles").getByText("Inspections this month").click();
  await page.waitForURL(/\/pcp\/inspections\?month=\d{4}-\d{2}/);
  log("tile → ", page.url().replace(BASE, ""), "·", (await page.locator("h1").first().innerText()).trim());
  await page.goto(`${BASE}/pcp`);
  await page.getByTestId("kpi-tiles").getByText("Awaiting a decision").click();
  await page.waitForURL(/status=COUNCIL_REVIEW/);
  log("tile →", page.url().replace(BASE, ""));
  const views = await q("select count(*)::int n from audit_log where action = 'application.viewed'");
  assert(views[0].n > 5, "case views audited");
  log("audit: application.viewed rows =", views[0].n);

  if (consoleErrors.size) console.log("Browser console errors:", [...consoleErrors].map(([t, n]) => `${n}× ${t}`).join("\n  "));
  console.log("\nCASES MODULE TEST PASSED ·", rnw, acc, cert);
} catch (e) {
  await page.screenshot({ path: path.join(OUT, `FAILED-${step + 1}.png`), fullPage: true }).catch(() => undefined);
  console.error("FAILED at step", step + 1, e);
  process.exitCode = 1;
} finally {
  await db.end();
  await browser.close();
}
