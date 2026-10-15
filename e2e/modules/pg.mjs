// Postgraduate accreditation module test (RFP 4.1.10, 4.1.2, 4.1.14): a PhD case from the programme type and
// field, the PG proforma, supervisors linked by Faculty ID failing and then meeting the rule, the HEC NOC upload,
// fee and submission; the technical officer's review with a check per supervisor; an inspection with scores;
// the score on the Council agenda; approval, the certificate, and the public check showing "PhD".
// Run on a fresh seed:  npm run seed && BASE=http://localhost:3201 node e2e/modules/pg.mjs
// Uses the demo persona switch (Keycloak-backed) and reads the database only to assert.
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { PDFDocument, StandardFonts } from "pdf-lib";

const BASE = process.env.BASE ?? "http://localhost:3201";
const DB = process.env.DATABASE_URL ?? /^DATABASE_URL=(.*)$/m.exec(readFileSync(".env.local", "utf8"))?.[1];
const OUT = process.env.SHOTS ?? path.resolve("e2e/screenshots/pg");
const T = 30000;
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
  const t = await toast(new RegExp(`${re.source}|wrong|Not allowed|Fix the|Cannot|missing|must|needs|required for`));
  if (!re.test(t)) throw new Error(`Unexpected message: ${t}`);
  await page.waitForFunction(() => !document.querySelector(".ant-btn-loading"), null, { timeout: T });
  await page.waitForTimeout(300);
  return t;
};
/** Wait until earlier messages have gone, so the next one read is the new one. */
const clearToasts = () => page.waitForFunction(() => !document.querySelector(".ant-message-notice"), null, { timeout: 15000 });
const otp = async () => {
  await page.locator(".ant-modal").getByRole("button", { name: "Confirm" }).click();
};
const checkText = async (key) => (await page.locator(`[data-check="${key}"]`).innerText()).replace(/\s+/g, " ").trim();
const failing = async (key) => (await page.locator(`.check-fail[data-check="${key}"]`).count()) > 0;

async function pdf(name) {
  const doc = await PDFDocument.create();
  const p = doc.addPage([400, 300]);
  p.drawText(`Demo upload: ${name}`, { x: 30, y: 250, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  const file = path.join(OUT, `${name.replace(/\W+/g, "-")}.pdf`);
  writeFileSync(file, await doc.save());
  return file;
}

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

/** Link a supervisor through the Faculty ID picker (names are never typed into the case). */
async function linkSupervisor(name) {
  await clearToasts();
  const sel = page.locator(".case-faculty-search");
  await sel.click();
  await sel.locator("input").fill(name);
  const opt = page.locator(".ant-select-dropdown:visible .ant-select-item-option:not(.ant-select-item-option-disabled)", { hasText: name }).first();
  await opt.waitFor({ timeout: T });
  await opt.click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Link supervisor" }).click();
  return okToast(/linked as a supervisor/);
}

/** Declare a supervisor's publications / HEC status on their row, then save. */
async function declare(name, { publications, hec }) {
  await clearToasts();
  const row = page.locator(".supervisor-table tr", { hasText: name });
  if (publications !== undefined) {
    const input = row.locator(".sup-publications input");
    await input.fill(String(publications));
    await input.press("Tab");
  }
  if (hec) await row.locator(".sup-hec").click();
  await row.getByRole("button", { name: "Save" }).click();
  return okToast(/is an eligible supervisor|^Saved\. /);
}

try {
  // ---------- 1. The technical officer's landing: cases waiting for technical review ----------
  await as("pcp.technical", "/pcp");
  const due = page.getByTestId("work-due");
  await due.getByText("PGA-2026-0001").waitFor();
  log("pcp.technical My work →", (await due.innerText()).split("\n").filter(Boolean).slice(0, 4).join(" | "));
  await shot("technical-landing");
  await page.goto(`${BASE}/pcp/applications`);
  await page.locator("a.mono", { hasText: "PGA-2026-0001" }).first().waitFor();
  log("queue 'Needs my action' shows the seeded PhD Pharmacology case");

  // ---------- 2. Ravi Bank starts a PhD programme: type first, then the field ----------
  await as("rbu.poc", "/institution/applications");
  await page.getByRole("button", { name: /New postgraduate programme/ }).hover();
  await page.getByText("PhD programme", { exact: true }).click();
  const modal = page.locator(".ant-modal", { hasText: "New postgraduate programme" });
  await modal.waitFor();
  assert((await modal.locator(".pg-type .ant-radio-button-wrapper-checked").innerText()).trim() === "PhD", "PhD asked first and selected");
  await modal.locator(".pg-field").click();
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: /^Pharmaceutics$/ }).click();
  await shot("new-pg-modal");
  await modal.getByRole("button", { name: "Start accreditation case" }).click();
  await page.waitForURL(/\/institution\/applications\/PGA-2026-\d{4}$/);
  await settle();
  const ref = page.url().split("/").pop();
  const eyebrow = (await page.getByTestId("case-programme").textContent()).trim();
  assert(/Accreditation · PhD Pharmaceutics/.test(eyebrow), `case is a PhD Pharmaceutics accreditation (${eyebrow})`);
  log("created", ref, "→", eyebrow);

  // ---------- 3. The PG proforma ----------
  await page.locator("#case-form").getByRole("button", { name: "Fill demo values" }).click();
  await page.locator("#case-form").getByLabel("Annual intake").fill("6");
  await page.locator("#case-form").getByRole("button", { name: "Save and run checks" }).click();
  log("proforma →", await okToast(/Saved/));
  for (const k of ["fields", "intake", "duration", "coursework", "thesis", "research_labs", "pg_library"]) assert(!(await failing(k)), `proforma check ${k} passes`);

  // ---------- 4. Supervisor rule failures, then supervisors linked by Faculty ID ----------
  assert(await failing("supervisors"), "supervisor count fails with nobody linked");
  log("rule →", await checkText("supervisors"));
  log("rule →", await checkText("phd_in_field"));
  await shot("supervisor-rule-failing");
  log("link →", await linkSupervisor("Sara Malik"));
  await page.reload();
  await settle();
  const elig = await checkText("supervisor_eligibility");
  assert(/needs 5 publications or HEC-approved supervisor status/.test(elig), `eligibility names the rule (${elig})`);
  log("rule →", elig.replace(/^Supervisor eligibility\s*/, ""));
  await shot("supervisor-not-eligible");
  log("declare →", await declare("Sara Malik", { publications: 12 }));
  await page.reload();
  await settle();
  const one = await checkText("supervisors");
  assert(/PhD Pharmaceutics: 1 eligible supervisor linked, 2 required for intake 6\./.test(one), `one of two (${one})`);
  log("rule →", one.replace(/^Eligible supervisors\s*/, ""));
  log("link →", await linkSupervisor("Hina Aslam"));
  log("declare →", await declare("Hina Aslam", { hec: true }));
  log("link →", await linkSupervisor("Faraz Ahmed Siddiqui"));
  log("declare →", await declare("Faraz Ahmed Siddiqui", { publications: 7 }));
  await page.reload();
  await settle();
  for (const k of ["supervisors", "supervisor_eligibility", "phd_in_field"]) assert(!(await failing(k)), `${k} passes after linking`);
  log("rule →", await checkText("supervisors"));
  log("rule →", await checkText("phd_in_field"));

  // ---------- 5. The HEC NOC and the other PG documents ----------
  assert(await failing("documents"), "documents check fails before upload");
  await page.locator(".required-doc", { hasText: "HEC NOC for the PG programme" }).locator('input[type="file"]').setInputFiles(await pdf("HEC NOC PhD Pharmaceutics"));
  log("upload →", await toast(/Uploaded v1/));
  await page.waitForTimeout(500);
  for (const doc of ["PG scheme of studies", "Research laboratory inventory"]) {
    await page.locator(".required-doc", { hasText: doc }).getByRole("button", { name: /Attach sample PDF/ }).click();
    await toast(/Uploaded v/);
    await page.locator(".required-doc", { hasText: doc }).getByRole("button", { name: /Attach sample PDF/ }).waitFor({ state: "detached", timeout: T });
  }
  await page.reload();
  await settle();
  await shot("pg-case-ready");

  // ---------- 6. Pay and submit ----------
  const stillFailing = await page.locator(".check-fail").allInnerTexts();
  assert(!stillFailing.length, `every check passes before paying (${stillFailing.join(" | ")})`);
  await page.getByRole("button", { name: /generate challan/i }).click();
  log("fee →", await okToast(/PSID/));
  const fee = (await q("select fee_amount from applications where ref = $1", [ref]))[0].fee_amount;
  assert(fee === 350000, `PhD accreditation fee from the fees rule (${fee})`);
  await page.getByRole("button", { name: /Simulate bank confirmation/ }).click();
  await otp();
  log("fee →", await okToast(/Payment confirmed/));
  await page.getByRole("button", { name: /Submit application/ }).click();
  log("submit →", await okToast(/Submitted/));

  // ---------- 7. Officer: scrutiny ----------
  await as("pcp.officer", `/pcp/applications/${ref}`);
  await page.getByRole("button", { name: /Start scrutiny/ }).click();
  log("officer →", await okToast(/Scrutiny started/));
  await page.getByRole("button", { name: /Pass scrutiny/ }).click();
  log("officer →", await okToast(/Scrutiny passed/));

  // ---------- 8. Technical officer: PG proforma review with a check per supervisor ----------
  await as("pcp.technical", "/pcp");
  await page.getByTestId("work-due").getByText(ref).waitFor();
  log(`${ref} is in the technical officer's My work`);
  await page.goto(`${BASE}/pcp/applications/${ref}`);
  await settle();
  assert((await page.getByRole("button", { name: /Start scrutiny|Pass scrutiny|Forward to council/ }).count()) === 0, "the technical officer has no scrutiny or forwarding buttons");
  const meets = page.locator(".review-rating .ant-radio-button-wrapper", { hasText: /^Meets$/ });
  await meets.nth(5).waitFor();
  for (let i = 0; i < (await meets.count()); i++) await meets.nth(i).click();
  // Two supervisors marked not eligible: one eligible, two needed for intake 6, so the review cannot pass.
  const checks = page.locator(".supervisor-check");
  assert((await checks.count()) === 3, "one check per linked supervisor");
  await checks.nth(0).locator(".ant-radio-button-wrapper", { hasText: /^Eligible$/ }).click();
  for (const n of [1, 2]) {
    await checks.nth(n).locator(".ant-radio-button-wrapper", { hasText: /^Not eligible$/ }).click();
    await checks.nth(n).getByPlaceholder("Why not eligible (required)").fill("Publications not found on HEC's recognised journal list");
  }
  await page.getByPlaceholder("Summary of the technical review").fill("PG proforma meets the PhD standards; supervisors checked against HEC records; intake of 6 fits.");
  await shot("technical-review-form");
  await page.getByRole("button", { name: /Record review/ }).click();
  const refused = await toast(/confirmed eligible/);
  assert(/1 supervisor confirmed eligible, 2 required for intake 6/.test(refused), `review refused below the rule (${refused})`);
  log("technical review refused →", refused);
  await clearToasts();
  for (const n of [1, 2]) await checks.nth(n).locator(".ant-radio-button-wrapper", { hasText: /^Eligible$/ }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /Record review/ }).click();
  log("technical →", await okToast(/Technical review recorded/));
  await page.getByTestId("review-supervisors").waitFor();
  const reviewRow = (await q("select reviewer, jsonb_array_length(supervisors) as n from technical_reviews tr join applications a on a.id = tr.application_id where a.ref = $1", [ref]))[0];
  assert(reviewRow.reviewer === "pcp.technical" && Number(reviewRow.n) === 3, "review stored by pcp.technical with 3 supervisor checks");
  const leftover = await q("select s->>'remarks' as r from technical_reviews tr join applications a on a.id = tr.application_id, jsonb_array_elements(tr.supervisors) s where a.ref = $1 and s->>'result' = 'ELIGIBLE' and s->>'remarks' <> ''", [ref]);
  assert(leftover.length === 0, `a "not eligible" reason does not stay on a supervisor changed back to eligible (${leftover.map((x) => x.r).join("; ")})`);
  await shot("technical-review-recorded");

  // ---------- 9. Coordinator assigns the team (Ravi Bank is in Punjab: a Punjab member conflicts) ----------
  await as("pcp.coordinator", `/pcp/applications/${ref}`);
  await page.locator(".pcp-inspector-select").click();
  await page.locator(".ant-select-item-option", { hasText: "Zainab" }).click();
  await page.getByRole("button", { name: "Schedule and notify" }).click();
  log("coordinator →", (await okToast(/Inspection scheduled/)).slice(0, 100));

  // ---------- 10. Inspector: checklist with score entry ----------
  await as("pcp.inspector2", "/pcp/inspections");
  await page.locator("tr", { hasText: ref }).getByRole("button", { name: "Open checklist" }).first().click();
  await page.waitForURL(/\/pcp\/inspections\/\d+/);
  await settle();
  const lines = page.locator(".inspection-line");
  assert((await lines.count()) === 7, "seven PG checklist lines");
  assert(/Supervisors: in post/.test(await lines.first().innerText()), "the postgraduate checklist");
  // Line 3 partial (score 2 of the 2 to 3 band), line 5 compliant at 4.
  await lines.nth(2).locator(".ant-segmented-item", { hasText: /^Partial$/ }).click();
  await lines.nth(2).locator(".line-score input").fill("2");
  await lines.nth(2).locator(".line-score input").press("Tab");
  await lines.nth(2).getByPlaceholder("Remarks").fill("Only 21 of 26 journal subscriptions current");
  await lines.nth(4).locator(".line-score input").fill("4");
  await lines.nth(4).locator(".line-score input").press("Tab");
  // A score outside the band is clamped: a compliant line cannot score 1.
  await lines.nth(5).locator(".line-score input").fill("1");
  await lines.nth(5).locator(".line-score input").press("Tab");
  assert((await lines.nth(5).locator(".line-score input").inputValue()) === "4", "compliant line clamped to its band (4 to 5)");
  await page.getByPlaceholder("Overall finding and recommendation to PCP").fill("Research facilities and supervision adequate for an intake of 6; recommend approval.");
  const total = (await page.getByTestId("score-total").innerText()).replace(/\s+/g, " ");
  log("score panel →", total);
  assert(/Pass/.test(total), "the running total passes the mark");
  await page.getByTestId("saved-at").waitFor({ timeout: T });
  await shot("inspection-scores");
  await page.getByRole("button", { name: "Submit inspection report" }).click();
  await page.waitForURL(new RegExp(`/pcp/applications/${ref}`), { timeout: 60000 });
  await settle();
  const score = (await q("select s.total, s.max, s.percent, s.passed from inspection_scores s join inspections i on i.id = s.inspection_id join applications a on a.id = i.application_id where a.ref = $1", [ref]))[0];
  assert(score && score.passed, "score stored and passed");
  log(`inspection score stored → ${score.total} of ${score.max} (${score.percent}%), pass`);
  await page.getByTestId("inspection-score").first().waitFor();
  log("case screen →", (await page.getByTestId("inspection-score").first().innerText()).replace(/\s+/g, " "));
  await shot("case-inspection-score");

  // ---------- 11. Officer forwards; the score is on the Council agenda ----------
  await as("pcp.officer", `/pcp/applications/${ref}`);
  await page.getByPlaceholder("Recommendation for the council").fill(`Recommend approval of PhD Pharmaceutics for an intake of 6. Inspection score ${score.percent}%.`);
  await page.getByRole("button", { name: "Forward to council agenda" }).click();
  log("officer →", await okToast(/Forwarded/));
  await as("pcp.secretary", "/pcp/council/CM-2026-07");
  await page.getByRole("button", { name: "Build agenda from ready cases" }).click();
  log("agenda →", await okToast(/Added/));
  const item = page.locator(`[data-item="${ref}"]`);
  await item.waitFor();
  const agendaScore = (await item.getByTestId("agenda-score").innerText()).replace(/\s+/g, " ");
  assert(/Pass/.test(agendaScore) && agendaScore.includes(`${score.percent}%`), `agenda shows the score (${agendaScore})`);
  log("council agenda →", agendaScore);
  await item.scrollIntoViewIfNeeded();
  await shot("council-agenda-score");

  // ---------- 12. Secretary: approval and the certificate ----------
  await page.goto(`${BASE}/pcp/applications/${ref}`);
  await settle();
  await page.getByPlaceholder("Decision note / conditions (optional)").fill("Approved for an intake of 6.");
  await page.getByRole("button", { name: "Record approval" }).click();
  await otp();
  log("secretary →", await okToast(/approved/));
  await page.getByRole("button", { name: /Issue accreditation certificate/ }).click();
  await otp();
  const issued = await okToast(/Certificate ACR-PHD-/);
  const certNo = /ACR-PHD-\d{4}-\d{4}/.exec(issued)[0];
  log("secretary →", issued);
  const prog = (await q("select p.accreditation_status, p.approved_intake, p.noc_number as noc from programs p join institutions i on i.id = p.institution_id where i.short_code = 'RBU' and p.type = 'PHD' and p.field = 'Pharmaceutics'"))[0];
  assert(prog.accreditation_status === "VALID" && prog.approved_intake === 6 && prog.noc === "HEC/QAA/PG/2026/0417", `programme card written (${JSON.stringify(prog)})`);

  // ---------- 13. Public check shows "PhD" ----------
  const pub = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
  await pub.goto(`${BASE}/verify/certificate/${certNo}`);
  const verdict = (await pub.getByTestId("verify-result").innerText()).trim();
  const shownProg = (await pub.getByTestId("verify-programme").innerText()).trim();
  const shownField = (await pub.getByTestId("verify-field").innerText()).trim();
  assert(/Genuine accreditation certificate: valid/.test(verdict) && shownProg === "PhD" && shownField === "Pharmaceutics", `public check (${verdict} · ${shownProg} · ${shownField})`);
  log("public QR page →", verdict, "·", shownProg, shownField);
  await pub.screenshot({ path: path.join(OUT, `${String(++step).padStart(2, "0")}-public-check-phd.png`), fullPage: true });
  await pub.context().addCookies([{ name: "pcp_lang", value: "ur", url: BASE }]);
  await pub.goto(`${BASE}/verify/certificate/ACR-MPHIL-2025-0001`);
  const urProg = (await pub.getByTestId("verify-programme").innerText()).trim();
  assert(urProg === "ایم ایس/ایم فل", `Urdu label for MS/MPhil (${urProg})`);
  log("seeded MS/MPhil certificate in Urdu →", urProg, (await pub.getByTestId("verify-field").innerText()).trim());
  await pub.screenshot({ path: path.join(OUT, `${String(++step).padStart(2, "0")}-public-check-mphil-urdu.png`), fullPage: true });
  await pub.context().close();

  // ---------- 14. The programme card, the certificate page and the registry filter ----------
  await as("rbu.poc", "/institution/applications");
  const card = page.locator('[data-programme="PHD"][data-field="Pharmaceutics"]');
  await card.waitFor();
  const cardText = (await card.innerText()).replace(/\s+/g, " ");
  assert(/PhD Pharmaceutics/.test(cardText) && /Accreditation valid/.test(cardText) && /HEC NOC/.test(cardText), `programme card (${cardText.slice(0, 160)})`);
  log("programme card →", cardText.slice(0, 140));
  await shot("programme-cards");
  await page.goto(`${BASE}/certificate/${certNo}`);
  await page.getByText("PhD Pharmaceutics").first().waitFor();
  await shot("certificate-print");
  await as("pcp.officer", "/pcp/institutions?programme=PG");
  const listed = await page.locator(".ant-table-tbody tr").allInnerTexts();
  assert(listed.some((t) => t.includes("Ravi Bank")) && listed.some((t) => t.includes("Sindh Coastal")), "PG filter lists Ravi Bank and Sindh Coastal");
  log("institutions?programme=PG →", listed.length, "institutions");
  await shot("institutions-pg-filter");
  await page.goto(`${BASE}/pcp`);
  await page.getByTestId("kpi-tiles").getByText("Postgraduate programmes").waitFor();
  await shot("dashboard-pg-tile");

  const errs = [...consoleErrors.entries()].filter(([t]) => !/favicon|DevTools|Download the React/.test(t));
  if (errs.length) console.log("console errors:", errs.map(([t, n]) => `${n}x ${t}`).join("\n  "));
  console.log(`\nPG MODULE TEST PASSED (${step} steps). Screenshots in ${OUT}`);
} catch (e) {
  console.error("\nFAILED:", e.message);
  await shot("failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await db.end();
  await browser.close();
}
