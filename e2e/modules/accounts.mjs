// Accounts, reports, exports and the data feed: end-to-end test against a dev server.
// Run on a fresh seed:  npm run seed && BASE=http://localhost:3206 node e2e/modules/accounts.mjs
// Screenshots go to $SHOTS (default: <tmp>/pcp-e2e-accounts). Uses quick demo sign-in; disables no users.
import { chromium } from "playwright-core";
import ExcelJS from "exceljs";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3206";
const OUT = process.env.SHOTS ?? path.join(os.tmpdir(), "pcp-e2e-accounts");
const T = 30000;
mkdirSync(OUT, { recursive: true });
const FEED_KEY = "pcpfeed_demo_moh_7c41e2b9d05a";

let step = 0;
let failures = 0;
const log = (...a) => console.log(`[${String(++step).padStart(2, "0")}]`, ...a);
function check(cond, what) {
  if (cond) console.log(`     ok  ${what}`);
  else {
    failures++;
    console.log(`   FAIL  ${what}`);
  }
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${String(step).padStart(2, "0")}-${name}.png`), fullPage: true });

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });

async function signIn(username, next) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
  ctx.setDefaultTimeout(T);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`     page error (${username}): ${e.message}`));
  const res = await ctx.request.post(`${BASE}/api/demo/switch`, { form: { username, next }, maxRedirects: 0 });
  if (res.status() !== 303) throw new Error(`demo sign-in failed for ${username}: HTTP ${res.status()}`);
  await page.goto(BASE + next);
  await page.waitForLoadState("networkidle");
  return { ctx, page };
}

const toast = async (page, re) => {
  const el = page.locator(".ant-message-notice", { hasText: re }).last();
  await el.waitFor({ timeout: T });
  return (await el.innerText()).trim();
};
/** The demo OTP dialog fills the code in; confirm it. */
async function confirmOtp(page) {
  const dlg = page.locator(".ant-modal", { hasText: "Confirm with a one-time code" });
  await dlg.waitFor();
  const code = await dlg.locator("#otp-code").inputValue();
  check(/^\d{6}$/.test(code), `one-time code issued (${code})`);
  await dlg.getByRole("button", { name: "Confirm" }).click();
  await dlg.waitFor({ state: "hidden" });
}
function walkKeys(v, out = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => walkKeys(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (out.add(k.toLowerCase()), walkKeys(x, out));
  return out;
}
async function xlsxRows(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  const header = ws.getRow(7).values.slice(1).map(String);
  let n = 0; // data rows run from row 8 to the first blank row (notes follow it)
  while (ws.getRow(8 + n).getCell(1).value !== null && ws.getRow(8 + n).getCell(1).value !== undefined) n++;
  return { title: String(ws.getCell(1, 1).value), header, n, sheet: ws.name };
}
function pdfPages(buf, name) {
  const file = path.join(OUT, name);
  writeFileSync(file, buf);
  const info = execFileSync("pdfinfo", [file]).toString();
  return { pages: Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? 0), title: /Title:\s+(.*)/.exec(info)?.[1] ?? "" };
}

try {
  // ---------------- Data feed (section 14): key required, no personal data, audited ----------------
  log("Read-only data feed");
  {
    const idx = await fetch(`${BASE}/api/feed`).then((r) => r.json());
    check(idx.endpoints?.length === 4, "GET /api/feed lists 4 endpoints without a key");
    const none = await fetch(`${BASE}/api/feed/institutions`);
    check(none.status === 401, `no key -> ${none.status} (want 401)`);
    const bad = await fetch(`${BASE}/api/feed/institutions`, { headers: { "X-PCP-Feed-Key": "pcpfeed_not_a_real_key" } });
    check(bad.status === 403, `wrong key -> ${bad.status} (want 403)`);
    const revoked = await fetch(`${BASE}/api/feed/institutions`, { headers: { "X-PCP-Feed-Key": "pcpfeed_sindhpc_2025_revoked" } });
    check(revoked.status === 403, `revoked 2025 Sindh key -> ${revoked.status} (want 403)`);
    for (const r of ["institutions", "programmes", "statistics", "pharmacists"]) {
      const res = await fetch(`${BASE}/api/feed/${r}`, { headers: { "X-PCP-Feed-Key": FEED_KEY } });
      const body = await res.json();
      const keys = walkKeys(body.data);
      const leaked = ["cnic", "mobile", "phone", "email", "address", "fathername"].filter((k) => keys.has(k));
      check(res.status === 200 && Array.isArray(body.data), `/api/feed/${r} with key -> ${res.status}, ${body.count} records`);
      check(leaked.length === 0, `/api/feed/${r} has no CNIC or contact fields${leaked.length ? ` (found ${leaked})` : ""}`);
    }
    const sindh = await fetch(`${BASE}/api/feed/programmes?province=Sindh&programme=PHARMD`, { headers: { "X-PCP-Feed-Key": FEED_KEY } }).then((r) => r.json());
    check(sindh.data.every((x) => x.province === "Sindh" && x.programme === "PHARMD") && sindh.count > 0, `programme feed filters work (${sindh.count} Sindh PharmD programmes)`);
  }

  // ---------------- Public receipt check ----------------
  log("Public receipt verification");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/verify/receipt/RCPT-2026-000001`);
    const txt = await page.getByTestId("receipt-facts").innerText();
    check((await page.getByTestId("verify-result").innerText()).includes("Genuine receipt"), "seeded receipt RCPT-2026-000001 is genuine");
    check(/Rs\s1,000,000/.test(txt) && txt.includes("•") && !/Bolan Valley University/.test(txt), "shows amount and a masked payer, not the full name");
    await shot(page, "receipt-genuine");
    await page.goto(`${BASE}/verify/receipt/RCPT-2026-999999`);
    check((await page.getByTestId("verify-result").innerText()).includes("not found"), "unknown receipt -> not found");
    await shot(page, "receipt-not-found");
    await ctx.close();
  }

  // ---------------- SCU is blocked by its seeded due ----------------
  log("Seeded outstanding due blocks Sindh Coastal University");
  {
    const { ctx, page } = await signIn("scu.poc", "/institution/payments");
    check(await page.getByTestId("dues-block").isVisible(), "SCU sees the 'dues block new submissions' notice");
    await shot(page, "scu-blocked");
    await ctx.close();
  }

  // ---------------- Accounts officer: statement, auto-match, manual match, ignore, CSV ----------------
  log("Accounts officer generates today's statement");
  let acc = await signIn("pcp.accounts", "/pcp/accounts");
  {
    const { page } = acc;
    const awaiting = Number((await page.getByTestId("kpi-awaiting").locator(".pcp-stat-value").innerText()).trim());
    check(awaiting === 3, `3 seeded payments await reconciliation (found ${awaiting})`);
    await shot(page, "accounts-ledger");
    await page.getByTestId("tab-statement").click();
    await page.getByRole("button", { name: /Generate today's statement/ }).click();
    const msg = await toast(page, /Imported STMT-/);
    log(" ", msg);
    check(/2 matched and reconciled/.test(msg), "two paid challans matched automatically by PSID and amount");
    await page.waitForLoadState("networkidle");
    const unmatchedRows = page.getByTestId("unmatched-card").locator("tr.ant-table-row");
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="unmatched-card"] tr.ant-table-row').length >= 3);
    check((await unmatchedRows.count()) === 3, `3 unmatched lines now (seeded deposit, mistyped PSID, unidentified deposit)`);
    await shot(page, "statement-generated");

    log("Manual match of the mistyped PSID");
    await unmatchedRows.filter({ hasText: "BRANCH DEPOSIT PSID" }).getByRole("button", { name: "Match by hand" }).click();
    const modal = page.locator(".ant-modal", { hasText: "Match a bank line by hand" });
    await modal.waitFor();
    check(await modal.getByText("Same amount").first().isVisible(), "the matching challan is suggested (same amount)");
    await modal.locator("textarea").fill("Branch keyed two PSID digits the wrong way round");
    await shot(page, "manual-match");
    await modal.getByRole("button", { name: "Match and reconcile" }).click();
    await confirmOtp(page);
    log(" ", await toast(page, /Matched by hand/));
    await modal.waitFor({ state: "hidden" });

    log("Ignore an unidentified credit with a note");
    await page.getByTestId("unmatched-card").locator("tr.ant-table-row", { hasText: "CASH DEPOSIT HYDERABAD" }).getByRole("button", { name: "Ignore" }).click();
    const ig = page.locator(".ant-modal", { hasText: "Ignore this bank line" });
    await ig.locator("textarea").fill("Not a PCP fee: refunded to the depositor");
    await ig.getByRole("button", { name: "Ignore line" }).click();
    log(" ", await toast(page, /Line ignored/));

    log("CSV statement upload: a bad file is refused row by row, a good one imports");
    await page.locator('input[type="file"]').setInputFiles({ name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from("date,psid,amount,bank_ref,channel,narration\n2026-10-06,123,abc,,RAAST,bad row\n") });
    const refused = await toast(page, /Nothing was imported/);
    check(/Row 2/.test(refused), `bad CSV refused with the row number: ${refused.slice(0, 110)}`);
    await page.locator('input[type="file"]').setInputFiles({ name: "hbl-2026-10-06.csv", mimeType: "text/csv", buffer: Buffer.from("date,psid,amount,bank_ref,channel,narration\n2026-10-06,,15000,BR20261006E2E1,BRANCH,E2E TEST CREDIT\n") });
    log(" ", await toast(page, /Imported STMT-.*hbl-2026-10-06\.csv/));
    await page.waitForLoadState("networkidle");
    const awaitingAfter = Number((await page.getByTestId("kpi-awaiting").locator(".pcp-stat-value").innerText()).trim());
    check(awaitingAfter === 0, `nothing awaits reconciliation after auto and manual matching (found ${awaitingAfter})`);
    await shot(page, "statement-after");
  }

  // ---------------- Dues: add two for RUH, waive one with a code ----------------
  log("Accounts officer adds dues and waives one");
  {
    const { page } = acc;
    await page.getByTestId("tab-dues").click();
    const add = async (description) => {
      await page.getByRole("button", { name: "Add a due" }).click();
      const m = page.locator(".ant-modal", { hasText: "Add a due" }).last();
      await m.getByRole("button", { name: /Fill demo values/ }).click();
      if (description) await m.getByLabel("What it is for").fill(description);
      const text = await m.getByLabel("What it is for").inputValue();
      await m.getByRole("button", { name: "Add due" }).click();
      await m.waitFor({ state: "hidden" });
      await page.getByTestId("outstanding-table").getByText(text).waitFor();
      return `added: ${text}`;
    };
    log(" ", await add());
    log(" ", await add("Certificate re-issue fee (e2e)"));
    check((await page.getByTestId("kpi-dues").innerText()).includes("2 institutions blocked"), "RUH and SCU are now both blocked");
    const row = page.getByTestId("outstanding-table").locator('[data-testid^="due-DUE-"]', { hasText: "Certificate re-issue fee (e2e)" });
    await shot(page, "dues-added");
    await row.getByRole("button", { name: "Waive" }).click();
    const w = page.locator(".ant-modal", { hasText: /^Waive DUE-/ }).last();
    await page.getByTestId("waive-note").fill("Waived on Council decision CM-2026-07 item 4 (e2e)");
    await page.locator(".ant-modal").getByRole("button", { name: "Waive due" }).click();
    await confirmOtp(page);
    log(" ", await toast(page, /waived/));
    await w.waitFor({ state: "hidden" }).catch(() => {});
    await page.waitForLoadState("networkidle");
    check(!(await page.getByTestId("outstanding-table").innerText()).includes("Certificate re-issue fee (e2e)"), "waived due no longer outstanding");
    await shot(page, "dues-after-waive");
  }

  // ---------------- Institution Finance officer pays the due ----------------
  log("ruh.finance pays the new due and gets the receipt at once");
  let receiptNo = "";
  {
    const { ctx, page } = await signIn("ruh.finance", "/institution/payments");
    check(await page.getByTestId("dues-block").isVisible(), "RUH now sees that the due blocks new submissions");
    await shot(page, "ruh-due");
    await page.getByTestId("outstanding-dues").locator('[data-testid^="due-DUE-"]', { hasText: "Late student-enrolment fee: 2026 intake" }).getByRole("button", { name: "Pay this due" }).click();
    await page.getByTestId("pay-psid").waitFor();
    check(await page.locator(".ant-modal img[alt='Raast QR (demo)']").isVisible(), "challan shows a PSID and a Raast QR");
    await shot(page, "ruh-challan");
    await page.getByTestId("pay-now").click();
    await confirmOtp(page);
    await page.getByTestId("receipt-modal").waitFor();
    receiptNo = (await page.getByTestId("receipt-no").innerText()).trim();
    check(/^RCPT-2026-\d{6}$/.test(receiptNo), `receipt shown immediately: ${receiptNo}`);
    await shot(page, "ruh-receipt");
    const href = await page.getByTestId("receipt-download").getAttribute("href");
    const pdf = await ctx.request.get(BASE + href);
    const buf = await pdf.body();
    check(pdf.status() === 200 && buf.subarray(0, 4).toString() === "%PDF", "receipt PDF downloads");
    check(pdfPages(buf, `${receiptNo}.pdf`).pages === 1, "receipt PDF opens (pdfinfo: 1 page)");
    await page.locator(".ant-modal").getByRole("button", { name: "Done" }).click();
    await page.waitForLoadState("networkidle");
    await page.reload();
    check(!(await page.getByTestId("dues-block").isVisible()), "the block is lifted once the due is paid");
    check((await page.getByTestId("receipts-table").innerText()).includes(receiptNo), "the new receipt is listed");
    await shot(page, "ruh-after-payment");
    const denied = await ctx.request.get(`${BASE}/api/reports/payments?format=csv`);
    check(denied.status() === 403, `institution user cannot export the PCP ledger (HTTP ${denied.status()})`);
    await page.goto(`${BASE}/pcp/accounts`);
    check(!page.url().includes("/pcp/accounts"), "institution user is kept out of /pcp/accounts");
    await ctx.close();

    const pub = await (await browser.newContext()).newPage();
    await pub.goto(`${BASE}/verify/receipt/${receiptNo}`);
    check((await pub.getByTestId("verify-result").innerText()).includes("Genuine"), `public check of ${receiptNo}: genuine`);
    check((await pub.getByTestId("receipt-facts").innerText()).includes("Ri••"), "payer shown masked (Ri•• …)");
    await shot(pub, "receipt-new-public");
  }

  // ---------------- Back to Accounts: the new payment reconciles; ledger exports ----------------
  log("Accounts reconciles the new payment and exports the ledger");
  {
    const { page, ctx } = acc;
    await page.reload();
    await page.getByTestId("tab-ledger").click();
    check((await page.getByTestId("ledger-table").innerText()).includes(receiptNo), "the new receipt is in the ledger");
    await page.getByTestId("tab-statement").click();
    await page.getByRole("button", { name: /Generate today's statement/ }).click();
    const m = await toast(page, /Imported STMT-/);
    check(/1 matched and reconciled/.test(m), `today's next statement reconciles it: ${m}`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("tab-ledger").click();
    await page.getByTestId("kpi-reconciled").click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-payments").getByRole("link", { name: "Excel" }).click()]);
    const file = path.join(OUT, dl.suggestedFilename());
    await dl.saveAs(file);
    const x = await xlsxRows(await import("node:fs").then((f) => f.readFileSync(file)));
    check(x.header[0] === "PSID" && x.n >= 8, `ledger Excel opens: sheet "${x.sheet}", ${x.n} reconciled payments`);
    const pdf = await ctx.request.get(`${BASE}/api/reports/payments?format=pdf&status=RECONCILED`);
    check(pdfPages(await pdf.body(), "ledger.pdf").pages >= 1, "ledger PDF opens");
    await shot(page, "ledger-reconciled");
    await ctx.close();
  }

  // ---------------- View-only role ----------------
  log("Secretary sees the accounts page read-only");
  {
    const { ctx, page } = await signIn("pcp.secretary", "/pcp/accounts");
    check((await page.getByText("View only").count()) > 0 && (await page.getByRole("button", { name: "Import bank statement" }).count()) === 0, "no import or dues actions for a view-only role");
    await ctx.close();
  }

  // ---------------- Reports: each report renders, figures open lists, filters, exports ----------------
  log("Reports & exports");
  {
    const { ctx, page } = await signIn("pcp.officer", "/pcp/reports");
    const ids = ["institutions", "intake", "graduates", "ratio", "validity", "early-warning"];
    for (const id of ids) {
      await page.getByTestId(`tab-${id}`).click();
      const card = page.getByTestId(`report-${id}`);
      await card.waitFor();
      await page.waitForTimeout(700);
      const rows = await card.locator("tr.ant-table-row").count();
      const canvas = await card.locator("canvas").count();
      check(rows > 0 && canvas > 0, `${id}: ${rows} rows and a chart`);
      await shot(page, `report-${id}`);
    }
    // Every figure opens its list
    await page.getByTestId("tab-institutions").click();
    await page.getByTestId("report-institutions").locator("tr.ant-table-row", { hasText: "All provinces" }).locator(".rpt-fig").nth(2).click();
    await page.getByTestId("drill-list").locator("tr.ant-table-row").first().waitFor();
    const n = await page.getByTestId("drill-list").locator("tr.ant-table-row").count();
    check(n === 8, `'Total' figure opens the list of all ${n} institutions`);
    await shot(page, "drill-institutions");
    await page.locator(".ant-drawer-close").click();
    await page.getByTestId("tab-validity").click();
    await page.getByTestId("report-validity").locator("tr.ant-table-row", { hasText: "Within 90 days" }).first().getByRole("button", { name: "Within 90 days" }).click();
    await page.getByTestId("drill-list").locator("tr.ant-table-row").first().waitFor();
    check((await page.getByTestId("drill-list").innerText()).includes("Within 90 days"), "validity band opens its programmes");
    await page.locator(".ant-drawer-close").click();
    await page.getByTestId("tab-early-warning").click();
    await page.getByTestId("report-early-warning").locator(".rpt-fig").first().click();
    await page.getByTestId("drill-list").locator("tr.ant-table-row").first().waitFor();
    check((await page.getByTestId("drill-list").innerText()).includes("DF-2026-"), "early-warning deficiency count opens the deficiencies");
    await shot(page, "drill-deficiencies");
    await page.locator(".ant-drawer-close").click();

    // Filter: Sindh only
    await page.getByTestId("tab-institutions").click();
    await page.getByTestId("report-filters").locator(".ant-select").first().click();
    await page.locator(".ant-select-item-option", { hasText: "Sindh" }).click();
    await page.waitForURL(/province=Sindh/);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="report-institutions"] tr.ant-table-row').length === 2);
    const t = await page.getByTestId("report-institutions").innerText();
    check(t.includes("Sindh") && !t.includes("Punjab"), "province filter narrows the report to Sindh");
    await shot(page, "report-filtered-sindh");

    // Exports: UI button for one, then every report in all three formats
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-institutions").getByRole("link", { name: "Excel" }).click()]);
    const f = path.join(OUT, dl.suggestedFilename());
    await dl.saveAs(f);
    const fx = await xlsxRows(await import("node:fs").then((m) => m.readFileSync(f)));
    check(fx.n === 2 && fx.header[0] === "Province", `Excel from the button opens with the Sindh filter (${fx.n} rows)`);
    for (const id of ids) {
      const x = await xlsxRows(await (await ctx.request.get(`${BASE}/api/reports/${id}?format=xlsx`)).body());
      const p = pdfPages(await (await ctx.request.get(`${BASE}/api/reports/${id}?format=pdf`)).body(), `${id}.pdf`);
      const csv = await (await ctx.request.get(`${BASE}/api/reports/${id}?format=csv`)).text();
      const lines = csv.replace(/^﻿/, "").trim().split(/\r?\n/);
      check(x.n > 0 && p.pages >= 1 && lines.length > 1, `${id}: Excel ${x.n} rows (${x.title.slice(0, 40)}…), PDF ${p.pages} page(s), CSV ${lines.length - 1} rows`);
    }

    // Data feed tab
    await page.getByTestId("tab-feed").click();
    check((await page.getByTestId("feed-demo-key").innerText()).includes(FEED_KEY) && (await page.getByTestId("feed-curl").innerText()).includes(`X-PCP-Feed-Key: ${FEED_KEY}`), "demo key and copyable curl example shown");
    await page.getByRole("button", { name: "Call the feed with the demo key" }).click();
    await page.getByTestId("feed-response").waitFor();
    check((await page.getByTestId("feed-response").innerText()).includes('"count"'), "calling the feed from the page returns data");
    await page.getByRole("button", { name: "Call it without a key" }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="feed-response"]')?.textContent?.includes("Missing"));
    check(true, "without a key the feed refuses (401)");
    await page.waitForTimeout(800);
    await page.reload();
    await page.getByTestId("tab-feed").click();
    check((await page.getByTestId("feed-panel").innerText()).includes("Refused: missing key"), "feed calls, including refused ones, appear from the audit log");
    await shot(page, "feed-tab");
    await ctx.close();
  }

  // ---------------- Super administrator issues and revokes a key ----------------
  log("Super administrator issues a key, then revokes it");
  {
    const { ctx, page } = await signIn("pcp.admin", "/pcp/reports?tab=feed");
    await page.getByRole("button", { name: "Issue a key" }).click();
    await page.getByLabel("Organisation that will hold the key").fill("E2E Test Pharmacy Council");
    await page.getByRole("button", { name: "Issue key" }).click();
    const keyModal = page.locator(".ant-modal", { hasText: "Key for E2E Test Pharmacy Council" });
    await keyModal.waitFor();
    const key = (await keyModal.locator("code").innerText()).trim();
    check(/^pcpfeed_/.test(key), `new key shown once (${key.slice(0, 16)}…)`);
    const ok = await fetch(`${BASE}/api/feed/statistics`, { headers: { "X-PCP-Feed-Key": key } });
    check(ok.status === 200, `new key works (HTTP ${ok.status})`);
    await keyModal.getByRole("button", { name: "I have copied it" }).click();
    await page.waitForLoadState("networkidle");
    await page.getByTestId("feed-panel").locator("tr", { hasText: "E2E Test Pharmacy Council" }).getByRole("button", { name: "Revoke" }).click();
    await confirmOtp(page);
    log(" ", await toast(page, /revoked/));
    const after = await fetch(`${BASE}/api/feed/statistics`, { headers: { "X-PCP-Feed-Key": key } });
    check(after.status === 403, `revoked key refused (HTTP ${after.status})`);
    await page.reload();
    await shot(page, "feed-key-revoked");
    await ctx.close();
  }
} catch (e) {
  failures++;
  console.error("ERROR", e);
} finally {
  await browser.close();
}
console.log(`\n${failures ? `FAILED: ${failures} check(s)` : "PASSED: all checks"} · screenshots in ${OUT}`);
process.exit(failures ? 1 : 0);
