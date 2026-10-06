// End-to-end test of the council module: council meetings, appeals and the help desk.
// Run from the repository root against a dev server on BASE (default http://localhost:3205):
//   node e2e/modules/council.mjs            re-seeds the database first (npm run seed)
//   SKIP_SEED=1 node e2e/modules/council.mjs
// Covers:
//   1. an institution head files an appeal; an officer reviews it and places it on the agenda
//   2. the Secretary builds the agenda, sets a draft, starts the session, records a case decision and
//      upholds the appeal (each with a one-time code), closes the meeting and downloads the minutes;
//      the upheld appeal sends the original case back to council review and a new agenda picks it up
//   3. a public ticket is raised on /help and answered and resolved by PCP
import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const BASE = process.env.BASE ?? "http://localhost:3205";
const T = 30000;
const OUT = process.env.SHOTS ?? path.resolve("e2e/screenshots/council");
mkdirSync(OUT, { recursive: true });
let step = 0;
const log = (...a) => console.log(`[${++step}]`, ...a);
const fail = (msg) => {
  throw new Error(msg);
};

if (!process.env.SKIP_SEED) {
  console.log("Re-seeding the database (npm run seed) ...");
  execSync("npm run seed", { stdio: ["ignore", "ignore", "inherit"] });
}

const dbUrl = /^DATABASE_URL=(.*)$/m.exec(readFileSync(".env.local", "utf8"))?.[1];
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });

/** Sign in as a demo user through the demo switch (POST /api/demo/switch), landing on `next`. */
async function as(username, next) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  ctx.setDefaultTimeout(T);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.evaluate(
    ({ username, next }) => {
      const f = document.createElement("form");
      f.method = "POST";
      f.action = "/api/demo/switch";
      for (const [k, v] of Object.entries({ username, next })) {
        const i = document.createElement("input");
        i.name = k;
        i.value = v;
        f.appendChild(i);
      }
      document.body.appendChild(f);
      f.submit();
    },
    { username, next },
  );
  await page.waitForURL((u) => u.pathname === next, { timeout: T });
  await page.waitForLoadState("networkidle");
  return { ctx, page };
}

/** Wait for a toast, then for every button to leave its loading state (antd ignores clicks on loading buttons). */
const toast = async (page, re) => {
  const el = page.locator(".ant-message-notice", { hasText: re }).first();
  await el.waitFor({ timeout: T });
  const text = (await el.innerText()).trim();
  await page.waitForFunction(() => !document.querySelector(".ant-btn-loading"), null, { timeout: T });
  return text;
};
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${String(step).padStart(2, "0")}-${name}.png`), fullPage: true });
const popconfirm = (page, label) => page.locator(".ant-popconfirm").getByRole("button", { name: label }).click();

/** Record a decision on an agenda item: open the dialog, fill it, confirm with the one-time code. */
async function decide(page, ref, decisionLabel) {
  await page.locator(`[data-item="${ref}"]`).getByRole("button", { name: "Record decision" }).click();
  const modal = page.locator(".ant-modal", { hasText: "Record the council decision" });
  await modal.waitFor();
  if (decisionLabel) await modal.getByText(decisionLabel, { exact: true }).click();
  await modal.getByRole("button", { name: /Fill demo values/ }).click();
  await modal.getByRole("button", { name: "Continue to one-time code" }).click();
  const otp = page.locator(".ant-modal", { hasText: "Confirm with a one-time code" });
  await otp.waitFor();
  const code = await otp.locator("#otp-code").inputValue();
  if (!/^\d{6}$/.test(code)) fail(`one-time code not filled in (${code})`);
  await otp.getByRole("button", { name: "Confirm" }).click();
  return code;
}

try {
  // ---------- 1. Appeal: filed by the institution, reviewed and placed by an officer ----------
  let appealRef;
  {
    const { ctx, page } = await as("fru.poc", "/institution/appeals");
    await page.locator('[data-appeal="ACC-2026-0002"]').click();
    const modal = page.locator(".ant-modal", { hasText: "File an appeal" });
    await modal.waitFor();
    await modal.getByRole("button", { name: /Fill demo values/ }).click();
    await modal.getByRole("button", { name: /Attach sample PDF/ }).click();
    await modal.locator("#appeal-file").waitFor();
    await modal.getByRole("button", { name: "File appeal" }).click();
    await page.waitForURL(/\/institution\/appeals\/APL-\d{4}-\d{4}$/);
    appealRef = page.url().split("/").pop();
    await toast(page, /filed/);
    await page.getByText("With: PCP officer").waitFor();
    log("fru.poc filed appeal", appealRef, "against ACC-2026-0002 with evidence");
    await shot(page, "institution-appeal-filed");
    // An institution sees and appeals only its own cases.
    const other = await page.goto(`${BASE}/institution/appeals/APL-2026-0001`);
    if (other.status() !== 404) fail(`fru.poc could open another institution's appeal (HTTP ${other.status()})`);
    const res = await ctx.request.post(`${BASE}/api/appeals`, { multipart: { caseRef: "NOC-2026-0006", grounds: "Trying to appeal another institution's decision, which must be refused.", file: { name: "x.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") } } });
    if (res.status() !== 404) fail(`appeal on another institution's case was not refused (HTTP ${res.status()})`);
    const again = await ctx.request.post(`${BASE}/api/appeals`, { multipart: { caseRef: "ACC-2026-0002", grounds: "A second appeal on the same decision while the first is open.", file: { name: "x.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") } } });
    if (again.status() !== 400) fail(`second open appeal was not refused (HTTP ${again.status()})`);
    log("isolation: another institution's appeal is 404; appealing its case and a second appeal are refused");
    await ctx.close();
  }
  {
    const { ctx, page } = await as("pcp.officer", `/pcp/appeals/${appealRef}`);
    await page.getByText("Grounds of appeal").waitFor();
    await page.locator(".ant-card", { hasText: "Your next step" }).getByRole("button", { name: /Fill demo values/ }).click();
    await page.getByRole("button", { name: "Save review note" }).click();
    log("officer review:", await toast(page, /Review note saved/));
    await page.getByRole("button", { name: "Place on the next council agenda" }).click();
    const msg = await toast(page, /on the agenda of CM-2026-07/);
    log("officer placed it:", msg);
    await page.getByText("With: the council").waitFor();
    await shot(page, "pcp-appeal-on-agenda");
    await ctx.close();
  }

  // ---------- 2. The council meeting ----------
  {
    const { ctx, page } = await as("pcp.secretary", "/pcp/applications/NOC-2026-0005");
    const note = page.locator(".council-agenda-note");
    await note.waitFor();
    const noteText = (await note.innerText()).trim();
    if (!/On the agenda of CM-2026-07/.test(noteText)) fail(`case screen note wrong: ${noteText}`);
    log("case screen shows:", noteText);
    await shot(page, "case-on-agenda");

    await page.goto(`${BASE}/pcp/council/CM-2026-07`);
    await page.getByRole("button", { name: "Build agenda from ready cases" }).click();
    log("build agenda:", await toast(page, /Nothing new to add|Added/));
    for (const ref of ["NOC-2026-0005", appealRef]) await page.locator(`[data-item="${ref}"]`).waitFor();
    log("agenda has NOC-2026-0005 and", appealRef);

    // Draft decision before the session
    await page.locator('[data-item="NOC-2026-0005"] .draft-select').click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: /^Approve$/ }).click();
    log("draft:", await toast(page, /Draft decision set/));
    await shot(page, "meeting-planned");

    await page.getByRole("button", { name: "Start session" }).click();
    await popconfirm(page, "Start session");
    log("session:", await toast(page, /is in session/));
    await page.locator('[data-item="NOC-2026-0005"]').getByRole("button", { name: "Record decision" }).waitFor();

    const code1 = await decide(page, "NOC-2026-0005");
    log(`decision on NOC-2026-0005 with code ${code1}:`, await toast(page, /NOC-2026-0005: approved/));
    const code2 = await decide(page, appealRef, "Uphold the appeal");
    log(`appeal decision with code ${code2}:`, await toast(page, /upheld/));
    await page.locator(`[data-item="${appealRef}"]`).getByText("Appeal decision letter").waitFor();
    await shot(page, "meeting-decided");

    await page.getByRole("button", { name: "Close meeting and file minutes" }).click();
    await popconfirm(page, "Close and file minutes");
    log("close:", await toast(page, /closed\. Minutes filed/));
    const href = await page.locator("#minutes-link").getAttribute("href");
    const res = await ctx.request.get(`${BASE}${href}`);
    const body = await res.body();
    if (res.status() !== 200 || !res.headers()["content-type"]?.includes("application/pdf") || body.subarray(0, 4).toString() !== "%PDF") fail(`minutes download failed: ${res.status()} ${res.headers()["content-type"]}`);
    writeFileSync(path.join(OUT, "minutes-CM-2026-07.pdf"), body);
    log(`minutes downloaded: ${href} (${body.length} bytes, application/pdf)`);
    await shot(page, "meeting-closed");

    // The upheld appeal sent the original case back to council review
    await page.goto(`${BASE}/pcp/applications/ACC-2026-0002`);
    await page.getByText("Awaiting council decision").first().waitFor();
    await page.getByText(new RegExp(`Appeal ${appealRef} upheld`)).waitFor();
    log("ACC-2026-0002 is back in council review, with the appeal event on its timeline");
    await shot(page, "case-reopened");

    // A new meeting picks it up when its agenda is built
    await page.goto(`${BASE}/pcp/council`);
    await page.getByRole("button", { name: "New meeting" }).click();
    await page.locator("#meeting-title").fill("Special council meeting on appeals");
    await page.getByRole("button", { name: "Create meeting" }).click();
    await page.waitForURL(/\/pcp\/council\/CM-2026-\d{2}$/);
    const newRef = page.url().split("/").pop();
    await page.getByRole("button", { name: "Build agenda from ready cases" }).click();
    log(`new meeting ${newRef}:`, await toast(page, /Added 1 item.*ACC-2026-0002/));
    await page.locator('[data-item="ACC-2026-0002"]').waitFor();
    await shot(page, "new-meeting-agenda");
    await ctx.close();
  }
  {
    const { ctx, page } = await as("fru.poc", `/institution/appeals/${appealRef}`);
    await page.getByText("Council decision", { exact: true }).waitFor();
    await page.getByText("Appeal decision letter (PDF)").waitFor();
    if (await page.getByText("Officer's review").count()) fail("the officer's review note is shown to the institution");
    log("institution sees the upheld appeal and its decision letter, not the officer's review note");
    await shot(page, "institution-appeal-upheld");
    await ctx.close();
  }

  // ---------- 3. Help desk: a signed-in requester, then a public ticket answered by PCP ----------
  {
    const { ctx, page } = await as("student.ruh", "/student/help");
    await page.locator(".ant-card", { hasText: "Raise a ticket" }).getByRole("button", { name: /Fill demo values/ }).click();
    await page.getByRole("button", { name: "Raise ticket" }).click();
    const msg = await toast(page, /Ticket TKT-\d{4}-\d{4} created/);
    const ref = /TKT-\d{4}-\d{4}/.exec(msg)[0];
    await page.locator(`[id="${ref}"]`).waitFor();
    log("student raised", ref, "and sees it under Your tickets");
    await shot(page, "student-ticket");
    await ctx.close();
  }
  let ticketRef;
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    ctx.setDefaultTimeout(T);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/help`);
    await page.getByRole("button", { name: /Fill demo values/ }).click();
    await page.getByRole("button", { name: "Send to PCP" }).click();
    await page.locator("#ticket-ref").waitFor();
    ticketRef = (await page.locator("#ticket-ref").innerText()).trim();
    if (!/^TKT-\d{4}-\d{4}$/.test(ticketRef)) fail(`bad ticket ref ${ticketRef}`);
    log("public ticket raised:", ticketRef);
    await shot(page, "public-ticket");
    await ctx.close();
  }
  {
    const { ctx, page } = await as("pcp.officer", "/pcp/helpdesk");
    await page.getByRole("link", { name: new RegExp(ticketRef) }).waitFor();
    await shot(page, "helpdesk-queue");
    await page.goto(`${BASE}/pcp/helpdesk/${ticketRef}`);
    await page.getByRole("button", { name: /Fill demo values/ }).click();
    await page.getByRole("button", { name: "Send reply" }).click();
    log("reply:", await toast(page, /Reply sent to saima\.tariq@example\.com/));
    await page.locator("#ticket-resolution").fill("Answered by email: the NOC for this programme is still pending, so admissions are not yet approved.");
    await page.getByRole("button", { name: "Resolve and tell the requester" }).click();
    log("resolve:", await toast(page, /resolved/));
    await shot(page, "ticket-resolved");
    await ctx.close();
  }

  // ---------- Outbox and audit checks ----------
  {
    const client = new pg.Client({ connectionString: dbUrl });
    await client.connect();
    const q = async (sql, args) => (await client.query(sql, args)).rows;
    const mails = await q("select subject from messages where entity = 'ticket' and entity_ref = $1 and to_address = 'saima.tariq@example.com' order by id", [ticketRef]);
    if (mails.length < 3) fail(`expected acknowledgement, reply and resolution emails, got ${mails.map((m) => m.subject).join(" | ")}`);
    log("emails to the requester:", mails.map((m) => m.subject).join(" | "));
    const appealMail = await q("select count(*)::int as n from messages where entity = 'appeal' and entity_ref = $1", [appealRef]);
    log(`messages filed on ${appealRef}:`, appealMail[0].n);
    const actions = (await q("select action from audit_log where entity_id in ($1, $2, 'CM-2026-07', 'ACC-2026-0002') order by id", [appealRef, ticketRef])).map((r) => r.action);
    for (const a of ["appeal.filed", "appeal.reviewed", "appeal.placed_on_agenda", "appeal.upheld", "application.reopened", "council.session.started", "council.item.decided", "council.meeting.closed", "ticket.created", "ticket.replied", "ticket.resolved"])
      if (!actions.includes(a)) fail(`audit log is missing ${a}`);
    log("audit log has every step:", [...new Set(actions)].join(", "));
    const [m] = await q("select status, minutes_document_id from council_meetings where ref = 'CM-2026-07'");
    if (m.status !== "CLOSED" || !m.minutes_document_id) fail("CM-2026-07 not closed with minutes");
    await client.end();
    // Every step above wrote to the hash-chained audit log; the chain must still verify.
    const chain = JSON.parse(execSync("npm run -s audit:verify", { encoding: "utf8" }).trim().split("\n").pop());
    if (!chain.ok) fail(`audit chain broken at row ${chain.brokenAt}`);
    log(`audit chain verifies (${chain.total} rows)`);
  }

  console.log(`\nPASS: council module end to end. Screenshots in ${OUT}`);
} catch (e) {
  console.error("\nFAIL:", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
