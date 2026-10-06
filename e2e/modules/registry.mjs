// End-to-end test of the faculty and student registries (guide sections 7, 8 and 14).
// Run against a freshly seeded app:  BASE=http://localhost:3203 node e2e/modules/registry.mjs
// Signs in with the demo "Enter as ..." buttons (or a POST to /api/demo/switch for accounts without a card).
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

const BASE = process.env.BASE ?? "http://localhost:3203";
const T = 25000;
const OUT = process.env.SHOTS ?? path.resolve("e2e/screenshots/registry");
mkdirSync(OUT, { recursive: true });
let n = 0;
const log = (...a) => console.log(`[${++n}]`, ...a);
const shot = async (page, name) => {
  await page.waitForTimeout(450); // let drawers and toasts finish animating
  return page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, "0")}-${name}.png`), fullPage: true });
};
const expect = (cond, what) => {
  if (!cond) throw new Error(`Expected: ${what}`);
};

async function pdfFile(name) {
  const doc = await PDFDocument.create();
  const p = doc.addPage([400, 300]);
  p.drawText(`Demo evidence: ${name}`, { x: 30, y: 250, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  const file = path.join(OUT, `${name.replace(/\W+/g, "-")}.pdf`);
  writeFileSync(file, await doc.save());
  return file;
}

// A CSV with three good rows and one of each kind of mistake (same as the demo sample in the screen).
const CSV = `full_name,father_name,cnic,mobile,email,programme,session,enrolment_year,year_of_study
Ayesha Siddiqa,Muhammad Siddiq,17301-5550001-2,0301-5550001,ayesha.siddiqa@student.demo,PHARMD,Morning,2026,1
Bilal Ahmed Khan,Ahmed Khan,17301-5550002-3,0302-5550002,bilal.khan@student.demo,PHARMD,Evening,2026,1
Hira Batool,Syed Ali Shah,17301-555-0003,0303-5550003,hira.batool@student.demo,PHARMD,Morning,2026,1
Usman Tariq,Tariq Mehmood,17301-5550001-2,0304-5550004,usman.tariq@student.demo,PHARMD,Morning,2026,1
Zainab Rauf,Abdul Rauf,17301-2021001-2,0305-5550005,zainab.rauf@student.demo,PHARMD,Morning,2026,1
Saad Akhtar,Javed Akhtar,17301-5550006-7,0306-5550006,saad.akhtar@student.demo,PHARMD,Weekend,2026,1
Mehwish Anwar,,17301-5550007-8,0307-5550007,mehwish.anwar@student.demo,PHARMD,Morning,2026,1
Kashif Nawaz,Nawaz Sharif Khan,17301-5550008-9,0308-5550008,kashif.nawaz@student.demo,TECH,Morning,2026,1
Rabia Iqbal,Muhammad Iqbal,17301-5550009-1,0309-5550009,rabia.iqbal@student.demo,PHARMD,Self-finance,2025,1
Owais Qureshi,Adnan Qureshi,17301-5550010-2,0310-5550010,owais.qureshi@student.demo,PHARMD,Morning,2026,4
Maryam Javed,Javed Iqbal,17301-5550011-3,0311-5550011,maryam.javed@student.demo,PHARMD,Self-finance,2026,1
`;

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });

async function login(username, next = "/home") {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
  ctx.setDefaultTimeout(T);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  const card = page.locator(`[data-username="${username}"]`).getByRole("button", { name: /^Enter as/ });
  if (await card.count()) await card.click();
  else await page.request.post(`${BASE}/api/demo/switch`, { form: { username, next }, maxRedirects: 0 });
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: T }).catch(() => {});
  if (page.url().includes("/login")) await page.goto(`${BASE}${next}`);
  await page.waitForLoadState("networkidle");
  return { ctx, page };
}

const toast = async (page, re) => {
  const el = page.locator(".ant-message-notice", { hasText: re }).first();
  await el.waitFor({ timeout: T });
  return (await el.innerText()).trim();
};
/** Confirms the one-time-code dialog (the demo fills the code in). */
const otp = async (page) => {
  const dlg = page.locator(".ant-modal", { hasText: "Confirm with a one-time code" });
  await dlg.waitFor();
  await dlg.getByRole("button", { name: "Confirm" }).click();
};
const tab = (page, name) => page.getByRole("tab", { name }).click();
const closeDrawer = async (page) => {
  await page.locator(".ant-drawer-open .ant-drawer-close").last().click();
  await page.waitForTimeout(400);
};

let ctx, page;
try {
  // ---------- 1. Faculty: search, link by ID, did you mean, change request, annual update (ruh.poc) ----------
  ({ ctx, page } = await login("ruh.poc", "/institution/faculty"));
  expect(page.url().includes("/institution/faculty"), "ruh.poc lands on the faculty page");
  const search = async (q) => {
    await page.getByLabel("Search the faculty registry").fill(q);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.locator('[data-testid="faculty-search-results"]').waitFor();
    await page.waitForTimeout(300);
    return page.locator('[data-testid="faculty-search-results"]');
  };
  let results = await search("Sara Malik");
  const elsewhere = await results.innerText();
  expect(/Active at another institution/.test(elsewhere), "Sara Malik reads 'Active at another institution'");
  expect(!/Ravi Bank|RBU/.test(elsewhere), "the other institution is not named");
  log("search 'Sara Malik' →", elsewhere.split("\n").filter(Boolean).slice(0, 3).join(" | "));

  results = await search("PCP-FAC-000095");
  expect(/Free to link/.test(await results.innerText()), "PCP-FAC-000095 is free to link");
  await results.getByRole("button", { name: "Link by ID" }).click();
  const linkModal = page.locator(".ant-modal", { hasText: "Link Dr. Farhan Saeed" });
  await linkModal.getByRole("button", { name: "Request link" }).click();
  const linkToast = await toast(page, /Link request FCR-/);
  const linkRef = /FCR-\d{4}-\d{4}/.exec(linkToast)[0];
  log("link by ID →", linkToast);
  await page.locator("tr", { hasText: "Dr. Farhan Saeed" }).getByText("Requested · awaiting PCP").waitFor();
  await shot(page, "faculty-search-and-link");

  // Did you mean: active elsewhere (error), near-duplicate (warning, then "different person"), spelling variant (link)
  await page.getByRole("button", { name: "Add faculty member" }).click();
  const drawer = page.locator(".ant-drawer");
  await drawer.getByRole("button", { name: "Try: active elsewhere" }).click();
  await drawer.getByRole("button", { name: "Save and run checks" }).click();
  log("active elsewhere →", (await drawer.locator(".ant-alert-error").innerText()).slice(0, 90));

  await drawer.getByRole("button", { name: "Try: near-duplicate" }).click();
  await drawer.getByRole("button", { name: "Save and run checks" }).click();
  const dym = (await drawer.locator(".ant-alert-warning").last().innerText()).trim();
  expect(/Did you mean PCP-FAC-000001\?/.test(dym), "near-duplicate asks 'Did you mean PCP-FAC-000001?'");
  log("near-duplicate →", dym.split("\n")[0]);
  await shot(page, "did-you-mean");
  await drawer.getByRole("button", { name: "No, a different person" }).click();
  const flagged = await drawer.locator(".ant-alert-warning", { hasText: "Saved as" }).innerText();
  log("different person →", flagged.slice(0, 100));

  await drawer.getByRole("button", { name: "Try: spelling variant" }).click();
  await drawer.getByRole("button", { name: "Save and run checks" }).click();
  await drawer.locator('[data-testid="did-you-mean"]', { hasText: "Dr. Muhammad Yousuf Qureshi" }).waitFor();
  log("spelling variant →", (await drawer.locator(".ant-alert-warning").last().innerText()).split("\n")[0]);
  await drawer.getByRole("button", { name: "Yes, link this person" }).click();
  log("yes, link this person →", (await drawer.locator(".ant-alert-success").innerText()).slice(0, 100));
  await closeDrawer(page);

  // End a verified appointment: it becomes a change request
  const row = page.locator("tr", { hasText: "Active · verified" }).filter({ hasNotText: "Pharmacy Technician" }).filter({ has: page.getByRole("button", { name: "End" }) }).first();
  const cell = (await row.locator("td").first().innerText()).split("\n").map((x) => x.trim()).filter(Boolean);
  const leavingId = cell.find((x) => /^PCP-FAC-\d+$/.test(x));
  const leaving = cell[cell.indexOf(leavingId) - 1];
  await row.getByRole("button", { name: "End" }).click();
  const endModal = page.locator(".ant-modal-confirm");
  await endModal.getByLabel("Reason").fill("Transferred to a university in Lahore from 1 November 2026");
  await endModal.getByRole("button", { name: "Send change request to PCP" }).click();
  const changeToast = await toast(page, /Change request FCR-/);
  const changeRef = /FCR-\d{4}-\d{4}/.exec(changeToast)[0];
  log(`end appointment of ${leaving} (${leavingId}) →`, changeToast);
  await page.locator("tr", { hasText: leavingId }).getByText(`${changeRef} with PCP`).waitFor();

  // Annual faculty update
  await page.getByRole("button", { name: "Confirm faculty list for 2026" }).click();
  await page.locator(".ant-modal-confirm").getByRole("button", { name: "Confirm faculty list for 2026" }).click();
  log("annual update →", await toast(page, /Faculty list for 2026 confirmed/));
  await page.getByText(/Faculty list confirmed by ruh.poc/).waitFor();
  await shot(page, "faculty-after-requests");
  await ctx.close();

  // ---------- 2. PCP verification officer approves the link request and the change request ----------
  ({ ctx, page } = await login("pcp.verification", "/pcp/verification?tab=links"));
  await page.locator(`[data-testid="request-${linkRef}"]`).getByRole("button", { name: "Approve link" }).click();
  await page.locator(".ant-modal", { hasText: `Approve link ${linkRef}` }).getByRole("button", { name: "Continue" }).click();
  await otp(page);
  log(`approve ${linkRef} →`, await toast(page, /Approved and applied/));
  await tab(page, /Change requests/);
  const card = page.locator(`[data-testid="request-${changeRef}"]`);
  await card.waitFor();
  await shot(page, "pcp-change-request");
  await card.getByRole("button", { name: "Approve and apply" }).click();
  const decideModal = page.locator(".ant-modal", { hasText: `Approve ${changeRef}` });
  await decideModal.getByLabel("Decision note").fill("Relieving letter checked");
  await decideModal.getByRole("button", { name: "Continue" }).click();
  await otp(page);
  log(`approve ${changeRef} →`, await toast(page, /Approved and applied/));
  // Reject the seeded designation change: a reason is required, and the original record is kept.
  await page.locator('[data-testid="request-FCR-2026-0003"]').getByRole("button", { name: "Reject, keep original" }).click();
  const rejModal = page.locator(".ant-modal", { hasText: "Reject FCR-2026-0003" });
  await rejModal.getByRole("button", { name: "Continue" }).click();
  log("reject without a reason →", await toast(page, /Give the reason/));
  await rejModal.getByLabel("Decision note").fill("The selection board minutes are not attached");
  await rejModal.getByRole("button", { name: "Continue" }).click();
  await otp(page);
  log("reject FCR-2026-0003 →", await toast(page, /Rejected. The original record is kept/));
  await tab(page, "Decided");
  await page.locator("tr", { hasText: changeRef }).getByText("Approved").waitFor();
  await shot(page, "pcp-decided");
  await ctx.close();

  // ---------- 3. The institution sees the results; the history stays on the record ----------
  ({ ctx, page } = await login("ruh.poc", "/institution/faculty"));
  await page.locator("tr", { hasText: "Dr. Farhan Saeed" }).getByText("Active · verified").waitFor();
  await page.getByText("Ended and declined").click();
  await page.locator("tr", { hasText: leavingId }).getByText(/Ended/).first().waitFor();
  await page.locator("tr", { hasText: leavingId }).first().getByRole("button", { name: "View" }).click();
  const hist = page.locator('[data-testid="change-history"]', { hasText: changeRef });
  await hist.waitFor();
  log("history on the record →", (await hist.innerText()).replace(/\s+/g, " ").slice(0, 140));
  await shot(page, "faculty-history");
  await ctx.close();

  // ---------- 4. Students: bulk upload with errors, then import; degree check (ruh.exam) ----------
  ({ ctx, page } = await login("ruh.exam", "/institution/students"));
  await page.getByRole("button", { name: "Bulk upload" }).click();
  const bulk = page.locator(".ant-drawer", { hasText: "Bulk upload of students" });
  const [tpl] = await Promise.all([page.waitForEvent("download"), bulk.getByRole("button", { name: "Download CSV template" }).click()]);
  log("template →", tpl.suggestedFilename());
  const csvPath = path.join(OUT, "students-upload.csv");
  writeFileSync(csvPath, CSV);
  await bulk.locator('input[type="file"]').setInputFiles(csvPath);
  const report = bulk.locator('[data-testid="upload-report"]');
  await report.waitFor();
  const summary = (await report.locator(".ant-alert").first().innerText()).trim();
  expect(/11 rows checked: 3 valid, 8 with errors/.test(summary), `the report counts 3 valid and 8 with errors (got: ${summary})`);
  log("row-by-row check →", summary.split("\n")[0]);
  const reportText = await report.innerText();
  for (const e of ["CNIC must be 13 digits", "Same CNIC as row 2", "already registered at your institution", "Session must be Morning", "Missing father name", "no approved NOC for Pharmacy Technician", "PharmD 2025 is locked", "Year of study 4 is not possible"])
    expect(reportText.includes(e), `the report shows "${e}"`);
  await shot(page, "bulk-upload-report");
  const [dl] = await Promise.all([page.waitForEvent("download"), report.getByRole("button", { name: "Download error report" }).click()]);
  const errPath = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(errPath);
  const errCsv = readFileSync(errPath, "utf8");
  expect(errCsv.split("\n")[0].startsWith("row,full_name") && errCsv.includes("Error"), "the error report CSV has a row column and errors");
  log("error report →", dl.suggestedFilename(), `${errCsv.trim().split("\n").length - 1} rows`);
  await report.getByRole("button", { name: "Import 3 valid rows" }).click();
  await page.locator(".ant-modal-confirm").getByRole("button", { name: "Import 3 rows" }).click();
  log("import →", await toast(page, /Imported 3 students/));
  await bulk.locator(".ant-alert-success", { hasText: "New PCP student IDs" }).waitFor();
  await shot(page, "bulk-upload-imported");
  await closeDrawer(page);

  // Lifecycle: the degree check marks Areeba Noor eligible for registration
  await page.getByPlaceholder("Search name or PCP ID").fill("Areeba Noor");
  await page.locator("tr", { hasText: "Areeba Noor" }).click();
  const sd = page.locator(".ant-drawer", { hasText: "PCP-RUH-2021-00000001" });
  await sd.getByRole("button", { name: "Check degree" }).click();
  log("degree check →", await toast(page, /Degree confirmed/));
  await sd.getByText("Verified with the university and HEC").waitFor();
  await shot(page, "student-degree-checked");
  await closeDrawer(page);

  // Lifecycle: result then promotion for a newly imported student
  await page.getByPlaceholder("Search name or PCP ID").fill("Maryam Javed");
  await page.locator("tr", { hasText: "Maryam Javed" }).first().click();
  const md = page.locator(".ant-drawer", { hasText: "Maryam Javed" });
  await md.getByRole("button", { name: "Record result" }).click();
  log("result →", await toast(page, /2026 result recorded: pass/));
  await md.getByRole("button", { name: "Promote to year 2" }).click();
  log("promote →", await toast(page, /Promoted to year 2/));
  await closeDrawer(page);
  await ctx.close();

  // ---------- 5. Annual student update filed by ruh.exam ----------
  ({ ctx, page } = await login("ruh.exam", "/institution/annual-returns"));
  const form = page.locator('[data-testid="annual-return-form"]');
  await form.waitFor();
  const enrolled = await form.getByLabel("Enrolled").inputValue();
  log("prefilled from records → enrolled", enrolled, "graduated", await form.getByLabel("Graduated").inputValue());
  await form.locator('input[type="file"]').setInputFiles(await pdfFile("Result notification 2026"));
  await toast(page, /Uploaded/);
  await form.getByRole("button", { name: "Submit to PCP" }).click();
  log("submit →", await toast(page, /AR-2026-RUH-PHARMD submitted to PCP/));
  await page.getByText("With PCP for review").waitFor();
  await shot(page, "annual-return-submitted");
  await ctx.close();

  // ---------- 6. PCP accepts it: the year locks ----------
  ({ ctx, page } = await login("pcp.verification", "/pcp/annual-returns"));
  // Return Ravi Bank's 2026 return: a reason is required.
  await page.locator('[data-testid="return-AR-2026-RBU-PHARMD"]').getByRole("button", { name: "Return with reason" }).click();
  const retModal = page.locator(".ant-modal", { hasText: "Return AR-2026-RBU-PHARMD" });
  await retModal.getByRole("button", { name: "Continue" }).click();
  log("return without a reason →", await toast(page, /Give the reason/));
  await retModal.getByLabel("Decision note").fill("The graduates figure does not match the result notification. Check the 2021 cohort.");
  await retModal.getByRole("button", { name: "Continue" }).click();
  await otp(page);
  log("return AR-2026-RBU-PHARMD →", await toast(page, /Returned to the institution/));
  const ar = page.locator('[data-testid="return-AR-2026-RUH-PHARMD"]');
  await ar.waitFor();
  await shot(page, "pcp-annual-review");
  await ar.getByRole("button", { name: "Accept and lock 2026" }).click();
  await page.locator(".ant-modal", { hasText: "Accept and lock AR-2026-RUH-PHARMD" }).getByRole("button", { name: "Continue" }).click();
  await otp(page);
  log("accept →", await toast(page, /Accepted. The year is locked/));
  await ctx.close();

  // ---------- 7. After the lock: student records for 2026 are frozen; a correction request goes to PCP ----------
  ({ ctx, page } = await login("ruh.exam", "/institution/students"));
  const lockNote = await page.locator(".ant-alert", { hasText: "Locked by PCP" }).innerText();
  expect(/PharmD 2026/.test(lockNote), "the students page shows PharmD 2026 as locked");
  await page.getByPlaceholder("Search name or PCP ID").fill("Maryam Javed");
  await page.locator("tr", { hasText: "Maryam Javed" }).first().click();
  const locked = page.locator(".ant-drawer", { hasText: "Maryam Javed" });
  await locked.getByText("2026 is locked by PCP").waitFor();
  expect(await locked.getByRole("button", { name: "Repeat year 2" }).isDisabled(), "lifecycle buttons for the locked year are disabled");
  log("locked year →", lockNote.replace(/\s+/g, " ").slice(0, 90));
  await closeDrawer(page);

  await page.goto(`${BASE}/institution/annual-returns`);
  await page.getByText("Accepted · locked").first().waitFor();
  await page.getByRole("button", { name: "Request a correction" }).click();
  const cd = page.locator(".ant-drawer", { hasText: "Request a correction to AR-2026-RUH-PHARMD" });
  const w = Number(await cd.getByLabel("Withdrawn").inputValue());
  await cd.getByLabel("Withdrawn").fill(String(w + 1));
  await cd.getByLabel("Reason for the correction").fill("One student withdrew in September 2026 and was missed in the return.");
  await cd.locator('input[type="file"]').setInputFiles(await pdfFile("Withdrawal notification"));
  await toast(page, /Uploaded/);
  await cd.getByRole("button", { name: "Send correction request to PCP" }).click();
  const crToast = await toast(page, /Correction request CR-/);
  const crRef = /CR-\d{4}-\d{4}/.exec(crToast)[0];
  log("correction →", crToast);
  await shot(page, "correction-requested");
  await ctx.close();

  // ---------- 8. PCP approves the correction; the original figures stay visible ----------
  ({ ctx, page } = await login("pcp.verification", "/pcp/annual-returns?tab=corrections"));
  const cr = page.locator(`[data-testid="correction-${crRef}"]`);
  await cr.waitFor();
  await shot(page, "pcp-correction");
  await cr.getByRole("button", { name: "Approve correction" }).click();
  await page.locator(".ant-modal", { hasText: `Approve ${crRef}` }).getByRole("button", { name: "Continue" }).click();
  await otp(page);
  log(`approve ${crRef} →`, await toast(page, /Correction approved/));
  await ctx.close();

  ({ ctx, page } = await login("ruh.exam", "/institution/annual-returns"));
  await page.getByRole("columnheader", { name: "Original (accepted)" }).waitFor();
  await page.getByRole("columnheader", { name: "Corrected" }).waitFor();
  const wrow = await page.locator("tr", { hasText: "Withdrawn" }).first().innerText();
  log("original and corrected side by side → Withdrawn", wrow.replace(/\s+/g, " ").trim());
  await shot(page, "annual-return-corrected");
  await ctx.close();

  // ---------- 9. Student portal ----------
  ({ ctx, page } = await login("student.ruh", "/student"));
  const sc = await page.locator('[data-testid="student-card"]').innerText();
  expect(sc.includes("PCP-RUH-2021-00000001") && sc.includes("Riverside University"), "student.ruh sees her PCP ID and institution");
  await page.getByText("Eligible for registration", { exact: true }).first().waitFor();
  log("student.ruh →", sc.replace(/\s+/g, " ").slice(0, 120));
  await shot(page, "student-portal-ruh");
  await page.goto(`${BASE}/institution/students`);
  expect(!page.url().includes("/institution/"), "a student cannot open the institution portal");
  await ctx.close();

  ({ ctx, page } = await login("student.rbu", "/student"));
  const sc2 = await page.locator('[data-testid="student-card"]').innerText();
  expect(sc2.includes("Hamza Iqbal") && sc2.includes("Ravi Bank"), "student.rbu sees Hamza Iqbal's record");
  log("student.rbu →", sc2.replace(/\s+/g, " ").slice(0, 100));
  await shot(page, "student-portal-rbu");
  await ctx.close();

  console.log("\nALL REGISTRY STEPS PASSED");
} catch (e) {
  console.error("FAILED after step", n, e);
  if (page) await page.screenshot({ path: path.join(OUT, "failure.png"), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
