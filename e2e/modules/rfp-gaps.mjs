// End-to-end test of the RFP gap module (Oct 2026 RFP):
//   1. automated inspection team suggestion (4.1.1): excludes the same-province and the conflicted inspectors,
//      explains each choice, and the coordinator schedules with it (after a swap)
//   2. super administrator overrides (4.1.2): a non-admin has no override panel; the admin extends a deadline
//      with a one-time code, and it shows on the case timeline, in the audit Overrides tab and to the
//      institution (without the reason); an administrative hold stops the officer until it is released;
//      the database access log lists who viewed the case
//   3. the Council and committee members register (Annexure-III): contact masked for a non-manager, a member
//      added, attendance and quorum at a council meeting, a recusal flagged on an agenda item, no decision
//      without a quorum on that item, and the recusal recorded in the minutes
// Run from the repository root against a dev server on BASE (default http://localhost:3206):
//   node e2e/modules/rfp-gaps.mjs            re-seeds the database first (npm run seed)
//   SKIP_SEED=1 node e2e/modules/rfp-gaps.mjs
import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const BASE = process.env.BASE ?? "http://localhost:3206";
const T = 30000;
const OUT = process.env.SHOTS ?? path.resolve("e2e/screenshots/rfp-gaps");
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

const dbUrl = process.env.DATABASE_URL ?? /^DATABASE_URL=(.*)$/m.exec(readFileSync(".env.local", "utf8"))?.[1];
const db = new pg.Client({ connectionString: dbUrl });
await db.connect();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });

/** Sign in as a demo user through the demo switch (POST /api/demo/switch), landing on `next`. */
async function as(username, next) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  ctx.setDefaultTimeout(T);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  page error:", e.message));
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

/** Wait for a toast matching `re` (or any error toast), fail on an unexpected one, then for buttons to settle. */
const toast = async (page, re, { expectError = false } = {}) => {
  const el = page.locator(".ant-message-notice", { hasText: re }).first();
  await el.waitFor({ timeout: T });
  const text = (await el.innerText()).trim();
  await page.waitForFunction(() => !document.querySelector(".ant-btn-loading"), null, { timeout: T });
  await page.waitForTimeout(400);
  if (!expectError && (await el.locator(".anticon-close-circle").count())) fail(`unexpected error: ${text}`);
  return text;
};
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${String(step).padStart(2, "0")}-${name}.png`), fullPage: true });
const otp = async (page) => {
  const m = page.locator(".ant-modal", { hasText: "Confirm with a one-time code" });
  await m.waitFor();
  const code = await m.locator("#otp-code").inputValue();
  if (!/^\d{6}$/.test(code)) fail(`one-time code not filled in (${code})`);
  await m.getByRole("button", { name: "Confirm" }).click();
  return code;
};

try {
  // ---------- 1. Automated inspection team suggestion (RFP 4.1.1) ----------
  const CASE = "PGA-2026-0001"; // Riverside (Khyber Pakhtunkhwa), PhD Pharmacology, in technical review
  {
    const { ctx, page } = await as("pcp.technical", `/pcp/applications/${CASE}`);
    await page.locator(".ant-card", { hasText: "Your next step" }).getByRole("button", { name: /Fill demo values/ }).first().click();
    await page.getByRole("button", { name: /Record review: ready for inspection/ }).click();
    log("technical officer:", await toast(page, /Technical review recorded/));
    await ctx.close();
  }
  let used;
  {
    const { ctx, page } = await as("pcp.coordinator", `/pcp/applications/${CASE}`);
    await page.getByRole("button", { name: "Suggest a team" }).click();
    const box = page.getByTestId("team-suggestion");
    await box.waitFor();
    const team = await box.locator(".suggested-member").evaluateAll((els) => els.map((e) => ({ u: e.getAttribute("data-username"), role: e.getAttribute("data-role"), why: e.querySelector(".suggested-why")?.textContent ?? "" })));
    const excluded = await box.locator(".excluded-member").evaluateAll((els) => els.map((e) => ({ u: e.getAttribute("data-username"), text: e.textContent ?? "" })));
    log("suggested:", team.map((t) => `${t.u} (${t.role}): ${t.why}`).join(" | "));
    log("not suggested:", excluded.map((e) => e.text.trim()).join(" | "));
    if (team.length !== 3) fail(`expected lead + 2 members from the inspection.team rule, got ${team.length}`);
    if (team[0].role !== "LEAD") fail("first suggested member is not the lead");
    for (const u of ["pcp.inspector2", "pcp.inspector7", "pcp.inspector5"]) if (team.some((t) => t.u === u)) fail(`${u} must not be suggested`);
    const ex = (u) => excluded.find((e) => e.u === u)?.text ?? "";
    if (!/same province as RUH/.test(ex("pcp.inspector2"))) fail(`Zainab (KP) not excluded for same province: ${ex("pcp.inspector2")}`);
    if (!/same province as RUH/.test(ex("pcp.inspector7"))) fail("the second KP inspector is not excluded");
    if (!/declared conflict with RUH/.test(ex("pcp.inspector5"))) fail(`the conflicted inspector is not excluded: ${ex("pcp.inspector5")}`);
    if (!team.every((t) => /\d+ open visits? · .*no conflicts$/.test(t.why))) fail("each suggestion says why (province, open visits, no conflicts)");
    if (team[0].u !== "pcp.inspector" || !/led \d+ inspections?/.test(team[0].why)) fail(`the lead should be the experienced eligible inspector (got ${team[0].u})`);
    const proposed = (await page.getByTestId("suggested-date").innerText()).trim();
    if (!/Proposed visit: \w{3},? \d{1,2} \w{3} \d{4}/.test(proposed) || !/notice/.test(proposed)) fail(`no proposed date: ${proposed}`);
    log("date:", proposed.replace(/\s+/g, " "));
    await shot(page, "team-suggestion");

    // Swap the second member for an alternate, then use the team.
    const before = team[2].u;
    await box.locator(".suggested-member").nth(2).locator(".swap-member").click();
    const alt = page.locator(".ant-select-dropdown:visible .ant-select-item-option:not(.ant-select-item-option-disabled)").first();
    await alt.waitFor();
    await alt.click();
    await page.waitForTimeout(300);
    const after = await box.locator(".suggested-member").nth(2).getAttribute("data-username");
    if (!after || after === before) fail("swap did not change the member");
    log(`swapped ${before} for ${after}`);
    await box.getByRole("button", { name: /Use this team/ }).click();
    await toast(page, /Team and date filled in/);
    used = { lead: team[0].u, members: [team[1].u, after] };
    await page.locator(".ant-card", { hasText: "Your next step" }).getByRole("button", { name: /Fill demo values/ }).click();
    await shot(page, "team-filled");
    await page.getByRole("button", { name: "Schedule and notify" }).click();
    const msg = await toast(page, /Inspection scheduled|Conflict of interest/);
    if (!/Inspection scheduled/.test(msg)) fail(msg);
    log("coordinator:", msg);
    await page.getByTestId("pcp-inspection-team").waitFor();
    await shot(page, "team-scheduled");
    await ctx.close();
  }
  {
    const [insp] = await q("select i.id, i.inspector, i.scheduled_for::text as d from inspections i join applications a on a.id = i.application_id where a.ref = $1 and i.status = 'SCHEDULED'", [CASE]);
    const members = (await q("select username from inspection_team where inspection_id = $1 and role = 'MEMBER' order by username", [insp.id])).map((r) => r.username);
    if (insp.inspector !== used.lead || members.join(",") !== [...used.members].sort().join(",")) fail(`booked team ${insp.inspector} + ${members} differs from ${JSON.stringify(used)}`);
    const [a] = await q("select details from audit_log where action = 'inspection.scheduled' and entity_id = $1 order by id desc limit 1", [CASE]);
    if (a.details.suggestion !== "changed by the coordinator" || a.details.conflictCheck !== "passed") fail(`audit does not record the suggestion: ${JSON.stringify(a.details)}`);
    const sug = await q("select count(*)::int n from audit_log where action = 'inspection.team.suggested' and entity_id = $1", [CASE]);
    if (!sug[0].n) fail("suggestion not audited");
    log(`booked on ${insp.d}: lead ${insp.inspector}, members ${members.join(", ")}; audit: suggestion ${a.details.suggestion}, conflict check ${a.details.conflictCheck}`);
  }

  // ---------- 2. Super administrator overrides (RFP 4.1.2) ----------
  const OCASE = "NOC-2026-0002"; // Clifton College (Sindh), deficiency raised: the institution holds the clock
  {
    const { ctx, page } = await as("pcp.officer", `/pcp/applications/${OCASE}`);
    await page.getByText("Your next step").waitFor();
    if (await page.getByTestId("override-panel").count()) fail("a case officer sees the override panel");
    if (await page.getByText("Super administrator override").count()) fail("override text visible to a case officer");
    log("pcp.officer: no override panel on", OCASE);
    await ctx.close();
  }
  let ovr;
  {
    const [{ due }] = await q("select stage_due_at::text as due from applications where ref = $1", [OCASE]);
    const { ctx, page } = await as("pcp.admin", `/pcp/applications/${OCASE}`);
    const panel = page.getByTestId("override-panel");
    await panel.waitFor();
    await shot(page, "override-panel");
    await panel.locator(".override-kind").getByText("Extend deadline").click();
    await panel.locator(".override-until").waitFor();
    // Apply is refused without a reason.
    if (await panel.getByRole("button", { name: /Apply override/ }).isEnabled()) fail("override can be applied without a reason");
    await panel.getByRole("button", { name: /Fill demo values/ }).click();
    await panel.getByRole("button", { name: /Apply override/ }).click();
    const code = await otp(page);
    const msg = await toast(page, /Override OVR-\d{4}-\d{4} applied/);
    ovr = /OVR-\d{4}-\d{4}/.exec(msg)[0];
    log(`admin (code ${code}):`, msg);
    const [{ due: after }] = await q("select stage_due_at::text as due from applications where ref = $1", [OCASE]);
    if (!(after > due)) fail(`deadline not extended (${due} -> ${after})`);
    const tl = page.locator(`.timeline-override[data-override="${ovr}"]`);
    await tl.waitFor();
    const tlText = (await tl.innerText()).replace(/\s+/g, " ");
    if (!/Super administrator override: deadline extended/.test(tlText) || !/Reason:/.test(tlText)) fail(`timeline event wrong: ${tlText}`);
    log("case timeline:", tlText.slice(0, 140));
    await page.getByTestId("override-history").getByText(ovr).waitFor();
    await shot(page, "override-applied");

    // The audit log: the Overrides tab and the database access log.
    await page.goto(`${BASE}/pcp/audit`);
    await page.getByTestId("tab-overrides").click();
    const row = page.getByTestId("overrides-table").locator("tr", { hasText: ovr });
    await row.waitFor();
    const rowText = (await row.innerText()).replace(/\s+/g, " ");
    if (!/NOC-2026-0002/.test(rowText) || !/Deadline extended/.test(rowText) || !/OTP verified/.test(rowText)) fail(`overrides tab row: ${rowText}`);
    log("audit Overrides tab:", rowText.slice(0, 160));
    await shot(page, "audit-overrides");
    await page.getByTestId("tab-access").click();
    const access = page.getByTestId("access-log");
    await access.waitFor();
    await access.locator(".access-person").click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "(pcp.officer)" }).first().click();
    await access.locator("tr", { hasText: OCASE }).first().waitFor();
    const accText = (await access.locator("tr", { hasText: OCASE }).first().innerText()).replace(/\s+/g, " ");
    if (!/Usman Farooq/.test(accText) || !/Viewed/.test(accText)) fail(`access log row: ${accText}`);
    log("database access log (pcp.officer):", accText.slice(0, 120));
    await shot(page, "audit-access-log");

    // Administrative hold: the officer cannot act until the hold is released.
    await page.goto(`${BASE}/pcp/applications/ACC-2026-0001`);
    await panel.waitFor();
    await panel.locator(".override-kind").getByText("Place on hold").click();
    await panel.getByRole("button", { name: /Fill demo values/ }).click();
    await panel.getByRole("button", { name: /Apply override/ }).click();
    await otp(page);
    log("hold:", await toast(page, /Override OVR-\d{4}-\d{4} applied: placed on administrative hold/));
    await page.getByTestId("hold-clock").waitFor();
    await ctx.close();
  }
  {
    const { ctx, page } = await as("pcp.officer", "/pcp/applications/ACC-2026-0001");
    await page.getByText("With: On administrative hold").waitFor();
    if (await page.getByRole("button", { name: /Start scrutiny/ }).count()) fail("officer can start scrutiny on a held case");
    log("officer on the held case: no step offered, banner says on administrative hold");
    await shot(page, "hold-officer");
    await ctx.close();
  }
  {
    const { ctx, page } = await as("pcp.admin", "/pcp/applications/ACC-2026-0001");
    const panel = page.getByTestId("override-panel");
    await panel.locator(".override-kind").getByText("Release hold").click();
    await panel.getByRole("button", { name: /Fill demo values/ }).click();
    await panel.getByRole("button", { name: /Apply override/ }).click();
    await otp(page);
    log("release:", await toast(page, /administrative hold released/));
    await ctx.close();
  }
  {
    const { ctx, page } = await as("pcp.officer", "/pcp/applications/ACC-2026-0001");
    await page.getByRole("button", { name: /Start scrutiny/ }).waitFor();
    log("after release the officer can start scrutiny again");
    await ctx.close();
  }
  {
    const { ctx, page } = await as("ccp.poc", `/institution/applications/${OCASE}`);
    const ev = page.getByText("PCP extended the time limit for deficiency response");
    await ev.first().waitFor();
    if (await page.getByText("flooding").count()) fail("the institution sees the override's internal reason");
    const [n] = await q("select count(*)::int n from notifications where audience = 'inst:PCP-UNI-000104' and title = $1", [`Update on ${OCASE}`]);
    if (!n.n) fail("institution not notified");
    log("institution timeline shows the extension (not the reason) and it was notified");
    await shot(page, "override-institution");
    await ctx.close();
  }
  {
    const acts = (await q("select action from audit_log where action like 'override.%' order by id")).map((r) => r.action);
    for (const a of ["override.deadline.extended", "override.hold.placed", "override.hold.released"]) if (!acts.includes(a)) fail(`audit log is missing ${a}`);
    const decided = await q("select count(*)::int n from audit_log where action = 'council.decision' and actor = 'pcp.admin'");
    if (decided[0].n) fail("an override recorded a council decision");
    log("audit has", [...new Set(acts)].join(", "), "and no council decision by the admin");
  }

  // ---------- 3. Council and committee members register (Annexure-III) ----------
  {
    const { ctx, page } = await as("pcp.officer", "/pcp/council?tab=members");
    const reg = page.getByTestId("members-register");
    await reg.waitFor();
    if (await page.getByRole("button", { name: "Add member" }).count()) fail("read-only role sees Add member");
    const contact = await reg.locator(".member-contact").first().innerText();
    if (!/•/.test(contact)) fail(`contact not masked for a non-manager: ${contact}`);
    log("pcp.officer: register read-only, contact masked:", contact.replace(/\s+/g, " "));
    await ctx.close();
  }
  {
    const { ctx, page } = await as("pcp.secretary", "/pcp/council?tab=members");
    const reg = page.getByTestId("members-register");
    await reg.waitFor();
    const council = await q("select count(distinct member_id)::int n from committee_seats where committee = 'Council' and status = 'ACTIVE'");
    if (council[0].n < 12) fail(`expected about 12 Council members, got ${council[0].n}`);
    const contact = await reg.locator(".member-contact").first().innerText();
    if (/•/.test(contact)) fail("contact masked for the Secretary");
    await reg.locator('[data-member="MBR-0007"]').waitFor();
    const kakar = (await reg.locator("tr", { has: page.locator('[data-member="MBR-0007"]') }).innerText()).replace(/\s+/g, " ");
    if (!/Government of Balochistan/.test(kakar) || !/BVU/.test(kakar)) fail(`register row: ${kakar}`);
    log(`register: ${council[0].n} serving Council members; MBR-0007 →`, kakar.slice(0, 120));
    await shot(page, "members-register");
    await page.getByRole("button", { name: "Add member" }).click();
    const modal = page.locator(".ant-modal", { hasText: "Add a member to the register" });
    await modal.getByRole("button", { name: /Fill demo values/ }).click();
    await modal.getByRole("button", { name: "Add member" }).click();
    log("secretary:", await toast(page, /added to the register as MBR-\d{4}/));

    // A council meeting: attendance, quorum, a recusal on an agenda item.
    await page.goto(`${BASE}/pcp/council/CM-2026-07`);
    await page.getByRole("button", { name: "Build agenda from ready cases" }).click();
    await toast(page, /Added|Nothing new/);
    const item = page.locator('[data-item="NOC-2026-0005"]');
    await item.waitFor();
    const rec = (await item.getByTestId("recusal").innerText()).replace(/\s+/g, " ");
    if (!/Recused: Prof\. Dr\. Abdul Wahab Kakar/.test(rec) || !/BVU/.test(rec)) fail(`recusal flag: ${rec}`);
    log("agenda item NOC-2026-0005:", rec);
    const quorum = (await page.getByTestId("quorum").innerText()).trim();
    if (!/6 of 11 voting members needed/.test(quorum)) fail(`quorum: ${quorum}`);
    log("before the session:", quorum);
    await shot(page, "meeting-planned-attendance");
    await page.getByRole("button", { name: "Start session" }).click();
    await page.locator(".ant-popconfirm").getByRole("button", { name: "Start session" }).click();
    log("session:", await toast(page, /is in session\. 11 of 11 voting members present; quorum 6 met/));
    // Five members leave: 6 present, but Kakar is recused on NOC-2026-0005, so that item has no quorum.
    const mark = async (ref, present) => {
      await page.locator(`.attendee[data-member="${ref}"]`).locator(".attendance-mark").getByText(present ? "Present" : "Absent").click();
      await page.locator(`.attendee[data-member="${ref}"][data-present="${present}"]`).waitFor();
      await page.waitForFunction(() => !document.querySelector(".attendance-mark .ant-radio-button-wrapper-disabled"), null, { timeout: T });
    };
    await page.locator('.attendee[data-present="true"]').first().waitFor();
    for (const ref of ["MBR-0002", "MBR-0005", "MBR-0006", "MBR-0008", "MBR-0009"]) await mark(ref, false);
    const q2 = (await page.getByTestId("quorum").innerText()).trim();
    if (!/Quorum met: 6 of 11 voting present, 6 needed/.test(q2)) fail(`quorum after absences: ${q2}`);
    const itemQ = (await item.getByTestId("recusal").innerText()).replace(/\s+/g, " ");
    if (!/5 members present after the recusal; 6 needed \(no quorum on this item\)/.test(itemQ)) fail(`item quorum: ${itemQ}`);
    log("after 5 absences:", q2, "· item:", itemQ.split("Voting on this item: ")[1]);
    await shot(page, "meeting-no-quorum-on-item");
    await item.getByRole("button", { name: "Record decision" }).click();
    const modal2 = page.locator(".ant-modal", { hasText: "Record the council decision" });
    await modal2.getByRole("button", { name: /Fill demo values/ }).click();
    await modal2.getByRole("button", { name: "Continue to one-time code" }).click();
    await otp(page);
    log("refused:", await toast(page, /No quorum on this item/, { expectError: true }));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    if ((await q("select ci.decision from council_items ci join applications a on a.id = ci.application_id where a.ref = 'NOC-2026-0005' and ci.decision is not null")).length) fail("a decision was recorded without a quorum");
    // One member returns: the item has its quorum.
    await mark("MBR-0009", true);
    await item.getByRole("button", { name: "Record decision" }).click();
    await modal2.getByRole("button", { name: /Fill demo values/ }).click();
    await modal2.getByRole("button", { name: "Continue to one-time code" }).click();
    await otp(page);
    log("decision:", await toast(page, /NOC-2026-0005: approved/));
    await page.getByRole("button", { name: "Close meeting and file minutes" }).click();
    await page.locator(".ant-popconfirm").getByRole("button", { name: "Close and file minutes" }).click();
    log("close:", await toast(page, /closed\. Minutes filed/));
    await page.locator('[data-item="NOC-2026-0005"]').getByTestId("recusal").waitFor();
    await shot(page, "meeting-closed");
    const href = await page.locator("#minutes-link").getAttribute("href");
    const res = await ctx.request.get(`${BASE}${href}`);
    const pdf = await res.body();
    if (pdf.subarray(0, 4).toString() !== "%PDF") fail("minutes are not a PDF");
    const file = path.join(OUT, "minutes-CM-2026-07.pdf");
    writeFileSync(file, pdf);
    if (existsSync("/usr/bin/pdftotext")) {
      const text = execSync(`/usr/bin/pdftotext -layout ${JSON.stringify(file)} -`, { encoding: "utf8" }).replace(/\s+/g, " ");
      if (!/Recused: Abdul Wahab Kakar \(conflict with BVU\)/.test(text)) fail("the minutes do not record the recusal");
      if (!/7 of 11 voting members present; quorum 6/.test(text)) fail("the minutes do not record the attendance and quorum");
      log("minutes:", /Attendance: [^.]*\./.exec(text)?.[0], "· Recused: Abdul Wahab Kakar (conflict with BVU)");
    }
    const [r] = await q("select r.reason, r.present from item_recusals r join council_items ci on ci.id = r.item_id join applications a on a.id = ci.application_id where a.ref = 'NOC-2026-0005'");
    if (!r || !/conflict with BVU/.test(r.reason)) fail("recusal not recorded on the item");
    const [d] = await q("select details from audit_log where action = 'council.item.decided' and entity_id = 'CM-2026-07' order by id desc limit 1");
    if (!d.details.recused?.length) fail("decision audit does not name the recusal");
    log("recusal recorded on the item and in the decision's audit entry");
    await ctx.close();
  }

  const chain = JSON.parse(execSync("npm run -s audit:verify", { encoding: "utf8" }).trim().split("\n").pop());
  if (!chain.ok) fail(`audit chain broken at row ${chain.brokenAt}`);
  log(`audit chain verifies (${chain.total} rows)`);
  console.log(`\nPASS: RFP gaps module end to end. Screenshots in ${OUT}`);
} catch (e) {
  console.error("\nFAIL:", e.message);
  process.exitCode = 1;
} finally {
  await db.end();
  await browser.close();
}
