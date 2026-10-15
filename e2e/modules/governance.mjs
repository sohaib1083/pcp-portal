// End-to-end test of the governance module: court cases, correspondence and committees (RFP Oct 2026).
// Run from the repository root against a dev server on BASE (default http://localhost:3203):
//   node e2e/modules/governance.mjs            re-seeds the database first (npm run seed)
//   SKIP_SEED=1 node e2e/modules/governance.mjs
// Covers:
//   1. the legal officer adds a court case linked to NOC-2026-0005 with a hearing (reminder sent at once),
//      lists a second hearing and records a stay order with its PDF
//   2. the case screen shows the red stay banner and the Secretary's decision is refused; after the legal
//      officer lifts the stay the banner is gone
//   3. an inward letter is registered with its scan and marked to an officer, who sees it on the dashboard
//      work list and records the action taken
//   4. an outward letter is generated on the letterhead and dispatched (email copy to the institution);
//      both letters show on the linked case and in the institution's Correspondence folder
//   5. an Inspection Committee meeting takes an agenda item, records a recommendation and an action point;
//      the action point is on the owner's work list and the owner marks it done; minutes are filed
//   6. Excel and PDF exports, role checks, reminder idempotency and the audit chain
import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const BASE = process.env.BASE ?? "http://localhost:3203";
const T = 45000;
const OUT = process.env.SHOTS ?? path.resolve("e2e/screenshots/governance");
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
const client = new pg.Client({ connectionString: dbUrl });
await client.connect();
const q = async (sql, args) => (await client.query(sql, args)).rows;
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });

let current = null; // the last page opened, for a screenshot when a step fails

/** Sign in as a demo user through the demo switch (POST /api/demo/switch), landing on `next`. */
async function as(username, next) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  ctx.setDefaultTimeout(T);
  const page = await ctx.newPage();
  current = page;
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
  await page.waitForURL((u) => u.pathname === next.split("?")[0], { timeout: T });
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
const modal = (page, title) => page.locator(".ant-modal", { hasText: title });

let courtRef;
let caseNumber;
try {
  // ---------- 1. The legal officer adds a court case with a hearing and a stay order ----------
  {
    const { ctx, page } = await as("pcp.legal", "/pcp/litigation");
    await page.getByRole("button", { name: "New court case" }).click();
    const m = modal(page, "New court case");
    await m.waitFor();
    await m.getByRole("button", { name: /Fill demo values/ }).click();
    await m.getByText(/NOC-2026-0005/).first().waitFor();
    await m.getByRole("button", { name: "Add to the ledger" }).click();
    const msg = await toast(page, /added to the ledger/);
    await page.waitForURL(/\/pcp\/litigation\/LIT-\d{4}-\d{4}$/);
    courtRef = page.url().split("/").pop();
    if (!/reminder sent/.test(msg)) fail(`the hearing within 7 days should send its reminder at once: ${msg}`);
    [{ case_number: caseNumber }] = await q("select case_number from court_cases where ref = $1", [courtRef]);
    log(`pcp.legal added ${courtRef} (${caseNumber}, linked to NOC-2026-0005):`, msg);

    await page.getByRole("button", { name: "Add hearing" }).first().click();
    const h = modal(page, "Add a hearing");
    await h.getByRole("button", { name: /Fill demo values/ }).click();
    await h.getByRole("button", { name: "Add hearing" }).click();
    log("second hearing:", await toast(page, /Hearing on .* added/));

    await page.getByRole("button", { name: "Record an order" }).first().click();
    const o = modal(page, "Record an order");
    await o.getByRole("button", { name: /Fill demo values/ }).click();
    await o.getByRole("button", { name: /Attach sample PDF/ }).click();
    await o.locator("#order-file").waitFor();
    await o.getByRole("button", { name: "Record the order" }).click();
    const om = await toast(page, /Stay order recorded/);
    if (!/order is filed/.test(om)) fail(`the order PDF was not filed: ${om}`);
    log("stay order:", om);
    await page.getByTestId("court-state").getByText(/Stay order in force/).waitFor();
    const state = (await page.getByTestId("court-state").innerText()).trim();
    if (!/Stay order in force on NOC-2026-0005/.test(state)) fail(`court box wrong: ${state}`);
    await page.getByText(/^Stay order of /).first().waitFor();
    log("court box:", state.split("\n")[0]);
    await shot(page, "court-case-stay");
    await ctx.close();
  }

  // ---------- 2. The stay blocks the council decision on the linked case ----------
  {
    const { ctx, page } = await as("pcp.secretary", "/pcp/applications/NOC-2026-0005");
    const banner = page.locator(".gov-stay-banner").first();
    await banner.waitFor();
    const text = (await banner.innerText()).trim();
    if (!new RegExp(`Stay order by IHC in ${caseNumber.replace("/", "\\/")}: no further action until \\d{1,2} \\w{3} \\d{4}`).test(text)) fail(`banner text wrong: ${text}`);
    log("case screen banner:", text.split("\n")[0]);
    await page.getByRole("button", { name: "Record approval" }).click();
    const otp = modal(page, "Confirm with a one-time code");
    await otp.waitFor();
    await otp.getByRole("button", { name: "Confirm" }).click();
    const refused = await toast(page, /cannot be recorded while the stay is in force/);
    log("Secretary's decision refused:", refused);
    const [{ status }] = await q("select status from applications where ref = 'NOC-2026-0005'");
    if (status !== "COUNCIL_REVIEW") fail(`NOC-2026-0005 was decided despite the stay (${status})`);
    const told = await q("select count(*)::int as n from notifications where audience = 'role:pcp_secretary' and title = 'Stay order on NOC-2026-0005'");
    if (!told[0].n) fail("the Secretary was not told about the stay");
    await shot(page, "case-stay-banner-decision-refused");
    await ctx.close();
  }
  {
    const { ctx, page } = await as("pcp.legal", `/pcp/litigation/${courtRef}`);
    await page.getByTestId("court-state").getByRole("button", { name: "Lift the stay" }).click();
    const l = modal(page, "Lift the stay of");
    await l.getByRole("button", { name: /Fill demo values/ }).click();
    await l.getByRole("button", { name: "Lift the stay" }).click();
    log("lift:", await toast(page, /Stay lifted/));
    await ctx.close();
  }
  {
    const { ctx, page } = await as("pcp.secretary", "/pcp/applications/NOC-2026-0005");
    await page.locator(".case-governance").waitFor();
    if (await page.locator(".gov-stay-banner").count()) fail("the stay banner is still shown after the stay was lifted");
    const chips = (await page.locator(".case-governance").innerText()).trim();
    if (!chips.includes(courtRef)) fail(`the court case is not listed on the case: ${chips}`);
    log("after lifting: no banner; the case lists", courtRef);
    await shot(page, "case-after-lift");
    await ctx.close();
  }

  // ---------- 3. Inward letter: registered with its scan, marked to an officer, actioned ----------
  let inRef;
  let linkedCase;
  {
    const { ctx, page } = await as("pcp.registration", "/pcp/correspondence");
    await page.getByRole("button", { name: "Register inward letter" }).click();
    const m = modal(page, "Register an inward letter");
    await m.getByRole("button", { name: /Fill demo values/ }).click();
    await m.getByRole("button", { name: /Attach sample PDF/ }).click();
    await m.locator("#letter-file").waitFor();
    await m.getByRole("button", { name: "Enter in the diary" }).click();
    const msg = await toast(page, /entered in the diary/);
    await page.waitForURL(/\/pcp\/correspondence\/IN-\d{4}-\d{5}$/);
    inRef = page.url().split("/").pop();
    if (!/marked to Usman Farooq, who is notified/.test(msg) || !/scan is filed/.test(msg)) fail(`register message wrong: ${msg}`);
    log(`registered ${inRef}:`, msg);
    const [l] = await q("select c.linked_ref, d.folder, d.institution_id from correspondence c join documents d on d.id = c.document_id where c.ref = $1", [inRef]);
    if (!l?.folder?.startsWith(`correspondence/inward/${inRef}`) || !l.institution_id) fail(`scan not in the institution's Correspondence folder: ${JSON.stringify(l)}`);
    linkedCase = l.linked_ref;
    log(`scan filed in the institution's folder ${l.folder}; letter is about ${linkedCase}`);
    await shot(page, "inward-registered");
    await ctx.close();
  }
  {
    const { ctx, page } = await as("pcp.officer", "/pcp");
    const work = page.getByTestId("work-letters");
    await work.getByText(inRef).waitFor();
    log("officer's work list shows", inRef);
    await shot(page, "officer-work-list");
    await work.getByText(inRef).click();
    await page.waitForURL(new RegExp(`/pcp/correspondence/${inRef}$`));
    await page.getByRole("button", { name: /Fill demo values/ }).click();
    await page.getByRole("button", { name: "Record action" }).click();
    log("officer:", await toast(page, /marked as actioned/));
    const [n] = await q("select count(*)::int as n from notifications where audience = 'user:pcp.officer' and title = $1", [`Letter ${inRef} marked to you`]);
    if (!n.n) fail("the officer was not notified");
    await ctx.close();
  }

  // ---------- 4. Outward letter: generated on the letterhead and dispatched ----------
  let outRef;
  {
    const { ctx, page } = await as("pcp.registration", "/pcp/correspondence");
    await page.getByRole("button", { name: "New outward letter" }).click();
    const m = modal(page, "New outward letter");
    await m.getByRole("button", { name: /Fill demo values/ }).click();
    await m.getByRole("button", { name: "Generate the letter" }).click();
    log("outward:", await toast(page, /generated on the PCP letterhead/));
    await page.waitForURL(/\/pcp\/correspondence\/OUT-\d{4}-\d{5}$/);
    outRef = page.url().split("/").pop();
    await page.getByTestId("letter-state").getByText("Draft: not sent yet").waitFor();
    await page.getByRole("button", { name: "Dispatch" }).click();
    await popconfirm(page, "Dispatch");
    const msg = await toast(page, /dispatched by email/);
    if (!/Email copy sent to \d+ recipient/.test(msg)) fail(`no email copy: ${msg}`);
    log(`${outRef}:`, msg);
    const [d] = await q("select c.status, c.linked_ref, d.folder, d.institution_id, d.mime_type from correspondence c join documents d on d.id = c.document_id where c.ref = $1", [outRef]);
    if (d.status !== "ACTIONED" || !d.folder.startsWith(`correspondence/outward/${outRef}`) || !d.institution_id) fail(`outward letter not filed or dispatched: ${JSON.stringify(d)}`);
    const mails = await q("select to_address, entity, entity_ref from messages where subject like $1", [`%${outRef}%`]);
    if (!mails.length) fail("no simulated email for the dispatch");
    log(`dispatch emails: ${mails.length} (filed on ${mails[0].entity} ${mails[0].entity_ref})`);
    const pdf = await ctx.request.get(`${BASE}/api/documents/${(await q("select document_id from correspondence where ref = $1", [outRef]))[0].document_id}`);
    if (pdf.status() !== 200 || (await pdf.body()).subarray(0, 4).toString() !== "%PDF") fail("generated letter download failed");
    await page.getByTestId("letter-state").getByText(/Dispatched/).waitFor();
    await shot(page, "outward-dispatched");

    // Both letters show on the linked case.
    await page.goto(`${BASE}/pcp/applications/${linkedCase}`);
    const chips = page.locator(".case-governance");
    await chips.getByText(inRef).waitFor();
    await chips.getByText(outRef).waitFor();
    log(`${linkedCase} lists ${inRef} and ${outRef}`);
    await shot(page, "case-with-letters");
    await ctx.close();
  }

  // ---------- 5. A committee meeting: agenda item, recommendation, action point as a task ----------
  let meetingRef;
  let actionTitle;
  {
    const { ctx, page } = await as("pcp.secretary", "/pcp/council");
    await page.getByRole("button", { name: "New meeting" }).click();
    const m = modal(page, "New meeting");
    await m.locator("#meeting-committee").click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: /^Inspection Committee$/ }).click();
    if (!/Inspection Committee meeting \d+ of \d{4}/.test(await m.locator("#meeting-title").inputValue())) fail("meeting title did not follow the committee");
    await m.getByRole("button", { name: "Create meeting" }).click();
    log("meeting:", await toast(page, /Inspection Committee meeting ICM-\d{4}-\d{2} created/));
    await page.waitForURL(/\/pcp\/council\/ICM-\d{4}-\d{2}$/);
    meetingRef = page.url().split("/").pop();
    await page.getByTestId("committee-members").waitFor();
    if (await page.getByRole("button", { name: "Build agenda from ready cases" }).count()) fail("a committee meeting offers the council's Build agenda");

    await page.getByRole("button", { name: "Add agenda item" }).click();
    const a = modal(page, "Add agenda item");
    await a.getByText("Court case", { exact: true }).click();
    await a.getByRole("button", { name: /Fill demo values/ }).click();
    await a.locator("#item-ref").click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: courtRef }).click();
    await a.getByRole("button", { name: "Add to the agenda" }).click();
    log("agenda:", await toast(page, new RegExp(`Added to ${meetingRef} as item 1`)));

    await page.getByRole("button", { name: "Start session" }).click();
    await popconfirm(page, "Start session");
    log("session:", await toast(page, /is in session/));

    await page.locator(`[data-item="${courtRef}"]`).getByRole("button", { name: "Record recommendation" }).click();
    const r = modal(page, "Record the committee's recommendation");
    await r.getByRole("button", { name: /Fill demo values/ }).click();
    await r.getByRole("button", { name: "Record recommendation" }).click();
    log("recommendation:", await toast(page, /Recommendation recorded/));
    await page.locator(`[data-item="${courtRef}"] .item-resolution`).waitFor();
    // A committee cannot record a council decision.
    if (await page.locator(`[data-item="${courtRef}"]`).getByRole("button", { name: "Record decision" }).count()) fail("a committee item offers Record decision");

    await page.getByRole("button", { name: "Add action point" }).click();
    const ap = modal(page, "Add action point");
    await ap.getByRole("button", { name: /Fill demo values/ }).click();
    actionTitle = await ap.locator("#action-title").inputValue();
    await ap.getByRole("button", { name: "Assign the action point" }).click();
    log("action point:", await toast(page, /Action point assigned to Usman Farooq/));
    await page.getByTestId("action-points").getByText(actionTitle).waitFor();
    await shot(page, "committee-in-session");

    await page.getByRole("button", { name: "Close meeting and file minutes" }).click();
    await popconfirm(page, "Close and file minutes");
    log("close:", await toast(page, /closed\. Minutes filed/));
    const href = await page.locator("#minutes-link").getAttribute("href");
    const res = await ctx.request.get(`${BASE}${href}`);
    const body = await res.body();
    if (res.status() !== 200 || body.subarray(0, 4).toString() !== "%PDF") fail("committee minutes download failed");
    writeFileSync(path.join(OUT, `minutes-${meetingRef}.pdf`), body);
    log(`minutes ${href} (${body.length} bytes)`);
    await shot(page, "committee-closed");
    await ctx.close();
  }
  {
    const { ctx, page } = await as("pcp.officer", "/pcp");
    const tasks = page.getByTestId("work-tasks");
    await tasks.getByText(actionTitle).waitFor();
    log("action point is on the owner's work list");
    await tasks.getByText(actionTitle).click();
    await page.waitForURL(new RegExp(`/pcp/council/${meetingRef}`));
    const id = (await q("select id from committee_actions where title = $1", [actionTitle]))[0].id;
    await page.locator(`[data-action="${id}"]`).waitFor();
    await page.getByTestId("action-points").locator("tr", { has: page.locator(`[data-action="${id}"]`) }).getByRole("button", { name: "Mark done" }).click();
    const dm = modal(page, "Mark the action point done");
    await dm.getByRole("button", { name: /Fill demo values/ }).click();
    await dm.getByRole("button", { name: "Mark done" }).click();
    log("owner:", await toast(page, /Action point done/));
    const [t] = await q("select status, note from committee_actions where id = $1", [id]);
    if (t.status !== "DONE") fail("action point not done");
    await shot(page, "action-point-done");
    await ctx.close();
  }

  // ---------- 6. Exports, role checks, reminders, audit ----------
  {
    const { ctx } = await as("pcp.legal", "/pcp/litigation");
    for (const [url, kind] of [
      ["/api/governance/export?what=litigation&format=xlsx", "PK"],
      ["/api/governance/export?what=litigation&format=pdf", "%PDF"],
      ["/api/governance/export?what=correspondence&dir=IN&format=xlsx", "PK"],
      ["/api/governance/export?what=correspondence&dir=OUT&format=pdf", "%PDF"],
    ]) {
      const res = await ctx.request.get(`${BASE}${url}`);
      const b = await res.body();
      if (res.status() !== 200 || !b.subarray(0, 4).toString().startsWith(kind)) fail(`export failed: ${url} (${res.status()})`);
    }
    log("ledger and registers export to Excel and PDF");
    await ctx.close();
  }
  {
    const { ctx, page } = await as("pcp.accounts", "/pcp");
    await page.goto(`${BASE}/pcp/litigation`);
    if (new URL(page.url()).pathname === "/pcp/litigation") fail(`the accounts officer opened the ledger (${page.url()})`);
    const up = await ctx.request.post(`${BASE}/api/governance/upload`, { multipart: { target: "court", ref: courtRef, docType: "Petition", file: { name: "x.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") } } });
    if (up.status() !== 403) fail(`a non-legal user could file a court paper (HTTP ${up.status()})`);
    log("accounts officer: no ledger, no court papers");
    await ctx.close();
  }
  {
    // Each hearing reminder is sent once: the unique notice key makes the scheduler idempotent.
    const hearings = await q("select h.id from court_hearings h join court_cases c on c.id = h.court_case_id where c.ref = $1 and h.status = 'SCHEDULED'", [courtRef]);
    const notices = await q("select key from governance_notices where key like any($1)", [hearings.map((h) => `hearing:${h.id}:%`)]);
    const mails = await q("select count(*)::int as n from messages where entity = 'court_case' and entity_ref = $1", [courtRef]);
    const legal = await q("select count(*)::int as n from notifications where audience = 'role:pcp_legal' and link = $1", [`/pcp/litigation/${courtRef}`]);
    if (notices.length !== hearings.length || mails[0].n !== hearings.length || legal[0].n !== hearings.length) fail(`reminders: ${notices.length} keys, ${mails[0].n} counsel emails, ${legal[0].n} alerts for ${hearings.length} hearings`);
    log(`hearing reminders: ${hearings.length} hearing(s) within 7 days, one in-app alert and one counsel email each`);
    const actions = (await q("select action from audit_log where entity_id in ($1, $2, $3, $4) order by id", [courtRef, inRef, outRef, meetingRef])).map((r) => r.action);
    for (const a of ["litigation.case.created", "litigation.hearing.added", "litigation.hearing.reminder", "litigation.order.recorded", "litigation.document.filed", "litigation.stay.lifted", "correspondence.registered", "correspondence.document.filed", "correspondence.actioned", "correspondence.generated", "correspondence.dispatched", "council.meeting.created", "committee.item.added", "committee.item.resolved", "committee.action.created", "committee.action.updated", "council.meeting.closed"])
      if (!actions.includes(a)) fail(`audit log is missing ${a}`);
    log("audit log has every step:", [...new Set(actions)].join(", "));
    const chain = JSON.parse(execSync("npm run -s audit:verify", { encoding: "utf8" }).trim().split("\n").pop());
    if (!chain.ok) fail(`audit chain broken at row ${chain.brokenAt}`);
    log(`audit chain verifies (${chain.total} rows)`);
  }

  console.log(`\nPASS: governance module end to end. Screenshots in ${OUT}`);
} catch (e) {
  console.error("\nFAIL:", e.message);
  const toasts = current ? await current.locator(".ant-message-notice").allInnerTexts().catch(() => []) : [];
  if (toasts.length) console.error("Messages on screen:", toasts.join(" | "));
  if (current) await current.screenshot({ path: path.join(OUT, "FAIL.png"), fullPage: true }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  await browser.close();
  await client.end();
}
