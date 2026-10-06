// Every "Try it" on /coverage lands where it says: signed in as that person, on that screen, without an error.
//   BASE=http://localhost:8088 node e2e/coverage-links.mjs
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:8088";
const src = readFileSync(new URL("../src/lib/coverage.ts", import.meta.url), "utf8");
const pairs = new Set();
for (const m of src.matchAll(/try: \{ as: "([^"]+)", to: "([^"]+)" \}/g)) pairs.add(`as ${m[1]} ${m[2]}`);
for (const m of src.matchAll(/try: \{ open: "([^"]+)" \}/g)) pairs.add(`open - ${m[1]}`);

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const failures = [];

// The page itself
await page.goto(`${BASE}/coverage`, { waitUntil: "networkidle" });
const tries = await page.locator(".cov-try form, .cov-try a").count();
console.log(`/coverage: ${tries} Try it buttons`);

for (const p of [...pairs].sort()) {
  const [kind, who, to] = p.split(" ");
  errors.length = 0;
  let res;
  if (kind === "open") {
    res = await page.goto(`${BASE}${to}`, { waitUntil: "networkidle" });
  } else {
    // The same form POST the button sends
    await page.goto(`${BASE}/coverage`, { waitUntil: "domcontentloaded" });
    const btn = page.locator(`.cov-try form:has(input[value="${who}"]):has(input[name="next"][value="${to}"]) button`).first();
    [res] = await Promise.all([page.waitForNavigation({ waitUntil: "networkidle" }), btn.click()]);
  }
  const url = new URL(page.url());
  const body = await page.locator("body").innerText();
  const bad =
    url.pathname !== to ? `landed on ${url.pathname}${url.search}` :
    (res && res.status() >= 400) ? `HTTP ${res.status()}` :
    /Application error|Something went wrong|Internal Server Error|This page could not be found/i.test(body) ? "error text on the page" :
    errors.length ? `page error: ${errors[0].slice(0, 120)}` : null;
  console.log(`${bad ? "FAIL" : "ok  "} ${kind === "open" ? "public" : who.padEnd(17)} ${to}${bad ? `  <- ${bad}` : ""}`);
  if (bad) failures.push(`${who} ${to}: ${bad}`);
}
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED of ${pairs.size}` : `\nALL ${pairs.size} LINKS OK`);
process.exit(failures.length ? 1 : 0);
