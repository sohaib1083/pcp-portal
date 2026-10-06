// Narrated walkthrough film of the PCP Digital Portal.
// 1. node e2e/film/film.mjs --export      → narration.json (the script, one sentence per line)
// 2. python3 e2e/film/tts.py              → clips/*.mp3 + clips/durations.json (voice)
// 3. ./demo.sh reset && node e2e/film/film.mjs  → frames/ + timeline.json (paced screen recording, captions drawn in-page)
// 4. python3 e2e/film/build.py            → pcp-walkthrough.mp4, captions.vtt, transcript.json
// Output goes to $FILM_OUT (default e2e/film/out).
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const OUT = process.env.FILM_OUT ?? path.join(DIR, "out");
const BASE = process.env.BASE ?? "http://localhost:8088";
const W = 1600;
const H = 900;
const GAP = 380; // pause after each sentence, ms

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page, ctx, cdp;
let ref = null;
let cert = null;
const mouse = { x: W / 2, y: H / 2 };
let caption = "";

const PERSONAS = {
  "ruh.poc": ["Prof. Ayesha Khan", "Institution focal person · Riverside University"],
  "nhc.poc": ["Dr. Tariq Mehmood", "Institution focal person · Northern Hills College"],
  "pcp.officer": ["Usman Farooq", "PCP Officer"],
  "pcp.inspector": ["Dr. Kamran Javed", "PCP Inspector · Punjab"],
  "pcp.secretary": ["Dr. Nadia Hussain", "PCP Secretary · Council"],
  "pcp.admin": ["Super Admin", "PCP Super Admin"],
};

// ---------- In-page overlay: cursor, captions, lower-third ----------
const OVERLAY = `(() => {
  if (window.__film) return;
  const install = () => {
    if (window.__film || !document.body) return;
    const st = document.createElement("style");
    st.textContent = \`
      .dg-fab, .dg-panel { display: none !important; }
      #film-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; width: 26px; height: 26px; transform: translate(-3px, -2px); filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
      #film-ring { position: fixed; z-index: 2147483646; pointer-events: none; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; border: 3px solid #c8a24a; opacity: 0; }
      #film-ring.on { animation: filmring .55s ease-out; }
      @keyframes filmring { from { opacity: .95; transform: scale(.35); } to { opacity: 0; transform: scale(1.25); } }
      #film-cap { position: fixed; left: 50%; bottom: 30px; transform: translateX(-50%); z-index: 2147483645; pointer-events: none; max-width: 1180px; width: max-content;
        background: rgba(7, 26, 19, .88); color: #fff; font: 600 23px/1.42 Inter, "Inter", system-ui, sans-serif; letter-spacing: -.005em; text-align: center;
        padding: 12px 24px 13px; border-radius: 14px; box-shadow: 0 10px 30px rgba(0,0,0,.25); transition: opacity .18s; }
      #film-cap:empty { opacity: 0; padding: 0; }
      #film-lt { position: fixed; left: 28px; bottom: 112px; z-index: 2147483645; pointer-events: none; display: flex; gap: 14px; align-items: center;
        background: #fff; border-radius: 14px; padding: 12px 18px 12px 12px; box-shadow: 0 16px 40px rgba(10, 40, 30, .28); border-left: 5px solid #c8a24a;
        font-family: Inter, system-ui, sans-serif; opacity: 0; transform: translateY(10px); transition: opacity .35s, transform .35s; }
      #film-lt.on { opacity: 1; transform: none; }
      #film-lt .av { width: 46px; height: 46px; border-radius: 50%; background: #0b6e4f; color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 17px; }
      #film-lt .k { font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #8a6a1c; }
      #film-lt .n { font-size: 19px; font-weight: 700; color: #0f1f1a; line-height: 1.2; }
      #film-lt .r { font-size: 14px; color: #5b6b64; }
    \`;
    document.head.appendChild(st);
    const cur = document.createElement("div");
    cur.id = "film-cursor";
    cur.innerHTML = '<svg viewBox="0 0 26 26" width="26" height="26"><path d="M3 2l18 10.5-7.6 1.6L17.6 22l-3.4 1.6-4.3-8-6 5.3z" fill="#fff" stroke="#0a3d2e" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const ring = document.createElement("div");
    ring.id = "film-ring";
    const cap = document.createElement("div");
    cap.id = "film-cap";
    const lt = document.createElement("div");
    lt.id = "film-lt";
    document.body.append(cur, ring, cap, lt);
    const pos = (x, y) => { cur.style.transform = "translate(" + (x - 3) + "px," + (y - 2) + "px)"; };
    addEventListener("mousemove", (e) => pos(e.clientX, e.clientY), true);
    addEventListener("mousedown", (e) => { ring.style.left = e.clientX + "px"; ring.style.top = e.clientY + "px"; ring.classList.remove("on"); void ring.offsetWidth; ring.classList.add("on"); }, true);
    let ltTimer;
    window.__film = {
      pos,
      caption: (t) => { cap.textContent = t || ""; },
      lower: (k, n, r, ini) => {
        lt.innerHTML = '<div class="av">' + ini + '</div><div><div class="k">' + k + '</div><div class="n">' + n + '</div><div class="r">' + r + "</div></div>";
        lt.classList.add("on"); clearTimeout(ltTimer); ltTimer = setTimeout(() => lt.classList.remove("on"), 4200);
      },
    };
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
})();`;

const ensureOverlay = () => page.evaluate(OVERLAY).catch(() => undefined);
const syncOverlay = async () => {
  await ensureOverlay();
  await page.evaluate(([t, x, y]) => { window.__film?.caption(t); window.__film?.pos(x, y); }, [caption, mouse.x, mouse.y]).catch(() => undefined);
};

// ---------- Motion helpers ----------
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
async function glideTo(x, y, ms = 650) {
  const sx = mouse.x;
  const sy = mouse.y;
  const steps = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const k = ease(i / steps);
    mouse.x = sx + (x - sx) * k;
    mouse.y = sy + (y - sy) * k;
    await page.mouse.move(mouse.x, mouse.y);
    await sleep(16);
  }
}
async function scrollBy(dy, ms = 900) {
  await page.evaluate((d) => window.scrollBy({ top: d, behavior: "smooth" }), dy);
  await sleep(ms);
}
async function scrollTop() {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await sleep(800);
}
/** Bring an element into the clear area (below the header, above the captions). */
async function reveal(loc, margin = 110) {
  await loc.first().waitFor({ state: "visible", timeout: 20000 });
  const b = await loc.first().boundingBox();
  if (!b) return;
  if (b.y < 72 || b.y + Math.min(b.height, 300) > H - 170) {
    await page.evaluate((d) => window.scrollBy({ top: d, behavior: "smooth" }), b.y - margin);
    await sleep(850);
  }
}
async function point(loc, ms = 650) {
  await reveal(loc);
  await sleep(220); // let opening popovers and drawers finish animating before aiming
  const b = await loc.first().boundingBox();
  await glideTo(b.x + Math.min(b.width / 2, 160), b.y + b.height / 2, ms);
}
async function tap(loc, ms = 650) {
  await point(loc, ms);
  await sleep(140);
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
}
async function toast(re) {
  await page.locator(".ant-message-notice", { hasText: re }).first().waitFor({ timeout: 20000 });
}
const settle = async () => {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await syncOverlay();
};
async function go(p) {
  await page.goto(BASE + p);
  await settle();
}

/** Switch persona (demo switch endpoint = Keycloak password grant), then show a lower-third. */
async function become(username, p) {
  await page.evaluate(
    ([base, u, n]) => {
      const f = document.createElement("form");
      f.method = "post";
      f.action = base + "/api/demo/switch";
      for (const [k, v] of [["username", u], ["next", n]]) {
        const i = document.createElement("input");
        i.type = "hidden";
        i.name = k;
        i.value = v;
        f.appendChild(i);
      }
      document.body.appendChild(f);
      f.submit();
    },
    [BASE, username, p],
  );
  await page.waitForURL((u) => u.pathname === p.split("?")[0], { timeout: 30000 });
  await settle();
  const [n, r] = PERSONAS[username];
  const ini = n.replace(/^(Dr|Prof)\.\s+/, "").split(" ").map((w) => w[0]).filter(Boolean);
  await page.evaluate(([n, r, i]) => window.__film?.lower("Now signed in", n, r, i), [n, r, (ini[0] + (ini.length > 1 ? ini[ini.length - 1] : "")).toUpperCase()]);
}

const LOGO = `<svg width="64" height="64" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#fff"/><path d="M20 6.5l10.5 4v8.7c0 6.9-4.5 12.1-10.5 14.3-6-2.2-10.5-7.4-10.5-14.3v-8.7l10.5-4z" fill="#0b6e4f"/><g transform="rotate(-40 20 20)"><rect x="13" y="16.6" width="14" height="6.8" rx="3.4" fill="#fff"/><rect x="20" y="16.6" width="7" height="6.8" rx="3.4" fill="#c8a24a"/><rect x="20" y="16.6" width="3.4" height="6.8" fill="#c8a24a"/></g></svg>`;
async function card(kicker, title, sub) {
  await page.setContent(`<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&display=swap"><style>
    html,body{margin:0;height:100%}
    body{font-family:Inter,system-ui,sans-serif;color:#fff;background:radial-gradient(900px 500px at 85% 0%,rgba(200,162,74,.22),transparent 60%),radial-gradient(800px 500px at 0% 110%,rgba(13,132,96,.55),transparent 60%),linear-gradient(135deg,#0a3d2e,#0b5a41 65%,#0b6e4f);display:flex;align-items:center}
    .w{padding:0 150px;max-width:1300px}
    .k{color:#e3c97f;font-weight:600;letter-spacing:.14em;text-transform:uppercase;font-size:20px;margin:34px 0 14px}
    h1{font-size:76px;line-height:1.04;letter-spacing:-.035em;margin:0;font-weight:800;max-width:17ch}
    p{font-size:26px;color:rgba(255,255,255,.75);margin:22px 0 0;max-width:46ch;line-height:1.45}
    .f{position:fixed;left:150px;bottom:40px;font-size:15px;color:rgba(255,255,255,.55)}
  </style></head><body><div class="w">${LOGO}<div class="k">${kicker}</div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ""}</div><div class="f">PCP Digital Portal · working demo with fictional institutions, people and payments</div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await syncOverlay();
}

// ---------- The script: [caption text, action] per sentence ----------
const S = (say, act) => ({ say, act });
const CHAPTERS = [];
const chapter = (title) => ({ chapter: title });

const SCRIPT = [
  chapter("Introduction"),
  S("This is the PCP Digital Portal: one online system for pharmacy education in Pakistan.", async () => {
    await card("Pharmacy Council of Pakistan", "The NOC journey, from application to verified certificate", "One institution, one application, every role in the portal.");
  }),
  S("In the next few minutes, we follow a single application from the day an institution applies to the moment anyone can verify its certificate."),
  S("The public front door lets anyone search the registry of institutions.", async () => {
    await go("/");
    await point(page.locator(".pub-search input"), 900);
  }),
  S("Below it are the four e-services PCP has promised, on one platform: accreditation, student and faculty verification, and online fee challans.", async () => {
    await scrollBy(640, 1200);
    await glideTo(520, 430, 900);
  }),
  S("Every NOC follows the same tracked path, from application to a certificate anyone can check.", async () => {
    await scrollBy(420, 1100);
    await glideTo(900, 380, 900);
  }),
  S("Each role sees a different portal. Sign-in runs on Keycloak single sign-on, so roles and institution scope come from one place.", async () => {
    await go("/login");
    await glideTo(800, 420, 900);
  }),
  S("We start as Professor Ayesha Khan, the focal person for Riverside University.", async () => {
    await tap(page.locator('[data-username="ruh.poc"]').getByRole("button", { name: /Sign in with Keycloak/ }), 900);
    await page.waitForURL(/\/auth\/realms\/pcp\//);
    await settle();
  }),
  S("Her account was created by the PCP Super Admin. There is no self-registration.", async () => {
    await tap(page.locator("#password"));
    await page.locator("#password").pressSequentially("Demo@1234", { delay: 70 });
    await tap(page.locator("#kc-login"));
    await page.waitForURL(/\/institution/, { timeout: 30000 });
    await settle();
  }),

  chapter("Act I · The institution applies"),
  S("Act one. The institution applies.", async () => {
    await card("Act I", "The institution applies", "Riverside University starts a NOC for a new Pharmacy Technician program.");
  }),
  S("Ayesha sees only her own institution: its programs, approved intake and the accreditation renewal countdown.", async () => {
    await go("/institution");
    await point(page.locator(".ant-card", { hasText: "Programs" }).first(), 900);
  }),
  S("The action list tells her what is due before it becomes overdue.", async () => {
    await point(page.locator(".ant-card", { hasText: "Action required" }).first(), 800);
  }),
  S("She starts a NOC for a new Pharmacy Technician program.", async () => {
    await tap(page.locator(".pcp-sider").getByText("Applications", { exact: true }));
    await settle();
    await point(page.getByRole("button", { name: /New NOC application/ }));
    await page.getByRole("button", { name: /New NOC application/ }).hover();
    await tap(page.getByText("New Pharmacy Technician NOC application"));
    await page.waitForURL(/\/institution\/applications\/NOC-/);
    await settle();
    ref = page.url().split("/").pop();
  }),
  S("Campus, intake, classrooms, labs and library go in once, and are reused for every later application.", async () => {
    await tap(page.getByRole("button", { name: "Fill demo values" }).first());
    await sleep(500);
    await tap(page.getByRole("button", { name: "Save and run checks" }));
    await toast(/Saved/);
    await settle();
  }),
  S("The three required documents are attached, and each one is versioned and fingerprinted.", async () => {
    for (let i = 0; i < 3; i++) {
      await tap(page.getByRole("button", { name: /Attach sample PDF/ }).first(), 500);
      await toast(/Uploaded v1/);
      await settle();
      await sleep(500);
    }
  }),
  S("The automatic checks come straight from PCP rules. One fails: sixty students need four technician faculty, and Riverside has three.", async () => {
    await page.reload();
    await settle();
    await reveal(page.locator(".ant-card", { hasText: "Faculty count" }).last(), 90);
    await point(page.getByText(/active faculty linked/).first(), 900);
  }),
  S("So she adds a teacher.", async () => {
    await scrollTop();
    await tap(page.locator(".pcp-sider").getByText("Faculty", { exact: true }));
    await settle();
    await tap(page.getByRole("button", { name: "Add faculty member" }));
    await sleep(500);
  }),
  S("This CNIC is already active at another college. The portal blocks it, and does not reveal which college.", async () => {
    await tap(page.getByRole("button", { name: "Try: active elsewhere" }));
    await sleep(400);
    await tap(page.locator(".ant-drawer").getByRole("button", { name: "Save and run checks" }));
    await page.locator(".ant-drawer .ant-alert-error").waitFor();
    await point(page.locator(".ant-drawer .ant-alert-error"), 700);
  }),
  S("Next, a new CNIC with a familiar name.", async () => {
    await tap(page.getByRole("button", { name: "Try: near-duplicate" }));
  }),
  S("Mohammad Ali Khan matches an existing Muhammad Ali Khan once spellings are normalised. The record is saved, but flagged for PCP to review.", async () => {
    await tap(page.locator(".ant-drawer").getByRole("button", { name: "Save and run checks" }));
    await page.locator(".ant-drawer .ant-alert-warning").last().waitFor();
    await point(page.locator(".ant-drawer .ant-alert-warning").last(), 700);
  }),
  S("Now the fee. The portal issues a PSID challan and a Raast QR code that any banking app can pay, with no merchant fee.", async () => {
    await page.keyboard.press("Escape");
    await go(`/institution/applications/${ref}`);
    await tap(page.getByRole("button", { name: /Generate challan/ }));
    await toast(/PSID/);
    await settle();
    await reveal(page.locator(".ant-card", { hasText: "Simulate bank confirmation" }).last(), 90);
    await point(page.locator('img[alt="Raast QR (demo)"]'), 700);
  }),
  S("Here we simulate the bank's confirmation. In production it arrives automatically.", async () => {
    await tap(page.getByRole("button", { name: /Simulate bank confirmation/ }));
  await tap(page.locator(".ant-modal").getByRole("button", { name: "Confirm" }), 500);
    await toast(/Payment confirmed/);
  }),

  chapter("Act II · PCP processes the case"),
  S("Act two. PCP processes the case.", async () => {
    await card("Act II", "PCP processes the case", "Duplicate review, scrutiny, a formal deficiency, and an inspection with a conflict-of-interest guard.");
  }),
  S("Usman Farooq, a PCP officer, reviews the flagged pair side by side, with the differences highlighted.", async () => {
    await go("/login");
    await become("pcp.officer", "/pcp/verification");
    const flag = page.locator(".ant-card").filter({ hasText: "Dr. Mohammad Ali Khan" }).filter({ has: page.getByRole("button", { name: /Different people/ }) });
    await point(flag, 900);
  }),
  S("He compares the two records and marks them as different people, which clears the flag.", async () => {
    const flag = page.locator(".ant-card").filter({ hasText: "Dr. Mohammad Ali Khan" }).filter({ has: page.getByRole("button", { name: /Different people/ }) });
    await tap(flag.getByRole("button", { name: /Different people/ }));
    await toast(/flag is cleared/i);
  }),
  S("Back at Riverside, every check now passes and the fee is paid, so submission unlocks.", async () => {
    await become("ruh.poc", `/institution/applications/${ref}`);
    await tap(page.getByRole("button", { name: "Re-run" }));
    await toast(/Checks re-run/);
    await settle();
  }),
  S("PCP never receives an incomplete file.", async () => {
    await tap(page.getByRole("button", { name: /Submit application/ }));
    await toast(/Submitted/);
    await settle();
    await scrollTop();
  }),
  S("From now on, Riverside can always see who holds its file.", async () => {
    await point(page.locator(".pcp-court"), 900);
  }),
  S("The officer starts scrutiny, and the case is assigned to him by name.", async () => {
    await become("pcp.officer", `/pcp/applications/${ref}`);
    await tap(page.getByRole("button", { name: /Start scrutiny/ }));
    await toast(/Scrutiny started/);
    await settle();
  }),
  S("He raises a formal deficiency, with an ID, a deadline and the exact evidence required.", async () => {
    await tap(page.getByRole("button", { name: "Fill demo values" }).first());
    await sleep(600);
    await tap(page.getByRole("button", { name: "Raise deficiency", exact: true }));
    await toast(/Deficiency raised/);
  }),
  S("Riverside sees the deficiency, its deadline, and who raised it.", async () => {
    await become("ruh.poc", `/institution/applications/${ref}`);
    await point(page.locator(".ant-card", { hasText: "Deficiencies raised by PCP" }), 800);
  }),
  S("It replies with a note and the evidence. Nothing travels by letter.", async () => {
    const box = page.locator(".ant-card", { hasText: "Deficiencies raised by PCP" });
    await tap(box.getByRole("button", { name: "Fill demo values" }));
    await tap(box.getByRole("button", { name: /Attach sample PDF/ }));
    await toast(/Evidence uploaded/);
    await settle();
    await tap(page.getByRole("button", { name: "Submit response" }));
    await toast(/Response submitted/);
  }),
  S("The officer accepts the evidence and schedules an inspection.", async () => {
    await become("pcp.officer", `/pcp/applications/${ref}`);
    await tap(page.getByRole("button", { name: "Accept" }));
    await toast(/accepted/);
    await settle();
  }),
  S("He picks Doctor Zainab Qureshi, an inspector from Khyber Pakhtunkhwa, which is Riverside's own province.", async () => {
    await tap(page.locator(".pcp-inspector-select"));
    await tap(page.locator(".ant-select-item-option", { hasText: "Zainab" }), 500);
  }),
  S("The system refuses. The conflict-of-interest rule is enforced, not left to memory.", async () => {
    await tap(page.getByRole("button", { name: "Schedule and notify" }));
    await toast(/Conflict of interest/);
    await point(page.locator(".ant-alert-error", { hasText: "Conflict of interest" }), 700);
  }),
  S("An inspector from Punjab is booked instead.", async () => {
    await tap(page.locator(".pcp-inspector-select"));
    await tap(page.locator(".ant-select-item-option", { hasText: "Kamran" }), 500);
    await tap(page.getByRole("button", { name: "Schedule and notify" }));
    await toast(/Inspection scheduled/);
  }),
  S("Doctor Kamran Javed sees only the inspections assigned to him, which also suits a third-party inspection firm.", async () => {
    await become("pcp.inspector", "/pcp/inspections");
    await point(page.getByRole("button", { name: "Open checklist" }).first(), 900);
  }),
  S("On site, he records each criterion on a tablet. In production this works offline, with geotagged photos.", async () => {
    await tap(page.locator("tr", { hasText: ref }).getByRole("button", { name: "Open checklist" }));
    await page.waitForURL(/\/pcp\/inspections\/\d+/);
    await settle();
    await tap(page.getByRole("button", { name: "Fill demo values" }));
    await scrollBy(380, 1000);
  }),
  S("Submitting files the inspection report in Riverside's document folder.", async () => {
    await tap(page.getByRole("button", { name: "Submit inspection report" }));
    await page.waitForURL(new RegExp(`/pcp/applications/${ref}`));
    await settle();
  }),
  S("The report now sits in the case file.", async () => {
    await become("pcp.officer", `/pcp/applications/${ref}`);
    await point(page.locator(".ant-card", { hasText: "Inspection report" }).first(), 900);
  }),
  S("The officer recommends approval and forwards the case to the council. Whoever processes a case never decides it.", async () => {
    await tap(page.getByRole("button", { name: "Fill demo values" }).first());
    await sleep(400);
    await tap(page.getByRole("button", { name: "Forward to council agenda" }));
    await toast(/Forwarded/);
  }),

  chapter("Act III · Decision and trust"),
  S("Act three. Decision and trust.", async () => {
    await card("Act III", "Decision and trust", "The council decides, the certificate is issued, and anyone can verify it.");
  }),
  S("Doctor Nadia Hussain, the council secretary, records the decision: approved, with a condition.", async () => {
    await go("/login");
    await become("pcp.secretary", `/pcp/applications/${ref}`);
    await tap(page.getByRole("button", { name: "Fill demo values" }).first());
    await sleep(400);
    await tap(page.getByRole("button", { name: /Approved$/ }));
    await toast(/approved/);
    await settle();
  }),
  S("She issues the certificate, and the workflow track is complete.", async () => {
    await tap(page.getByRole("button", { name: /Issue NOC certificate/ }));
    const el = page.locator(".ant-message-notice", { hasText: /Certificate NOC-/ }).first();
    await el.waitFor({ timeout: 20000 });
    cert = /NOC-TECH-\d{4}-\d{4}/.exec(await el.innerText())?.[0];
    await settle();
    await scrollTop();
    await point(page.locator(".pcp-track"), 900);
  }),
  S("The NOC carries a QR code and a digital fingerprint of the signed PDF.", async () => {
    await tap(page.getByRole("button", { name: "View / print certificate" }));
    await page.waitForURL(/\/certificate\//);
    await settle();
    await point(page.locator('img[alt="Verification QR code"]'), 900);
  }),
  S("Anyone who scans that code, whether a student, an employer or HEC, sees that it is genuine and valid, without signing in.", async () => {
    await go(`/verify/certificate/${cert}`);
    await point(page.getByTestId("verify-result"), 900);
  }),
  S("A forged number fails at once.", async () => {
    await go("/verify/certificate/NOC-TECH-2026-9999");
    await point(page.getByTestId("verify-result"), 700);
  }),
  S("And institutions never see each other. When Northern Hills College opens Riverside's case, the portal simply answers: not found.", async () => {
    await become("nhc.poc", "/institution");
    await sleep(1200);
    await go(`/institution/applications/${ref}`);
    await point(page.getByTestId("not-found"), 900);
  }),

  chapter("Act IV · Oversight"),
  S("Act four. Oversight.", async () => {
    await card("Act IV", "Oversight", "Live figures for PCP leadership, accounts in one step, and a log that cannot be quietly rewritten.");
  }),
  S("For PCP leadership, the executive dashboard is live from the registry.", async () => {
    await go("/login");
    await become("pcp.admin", "/pcp");
    await glideTo(700, 260, 900);
  }),
  S("The case pipeline shows how many cases sit at each stage, and who holds them.", async () => {
    await point(page.locator(".ant-card", { hasText: "Case pipeline" }), 900);
  }),
  S("Risk signals, enrolment against approved intake and renewals falling due are all on one screen.", async () => {
    await scrollBy(520, 1200);
    await glideTo(900, 420, 800);
  }),
  S("Only the Super Admin creates accounts.", async () => {
    await go("/pcp/admin");
    await glideTo(1300, 120, 800);
  }),
  S("Onboarding a new institution is one step: a PCP ID, a secure group and a focal person's account.", async () => {
    await tap(page.getByRole("button", { name: "Onboard institution" }));
    await sleep(500);
    await tap(page.getByRole("button", { name: "Fill demo values" }));
    await sleep(500);
    await tap(page.locator(".ant-drawer").getByRole("button", { name: "Onboard institution" }));
    await toast(/onboarded as/);
    await page.locator(".ant-modal").waitFor();
  }),
  S("The temporary password is shown once, and must be changed at first sign-in.", async () => {
    await point(page.locator(".ant-modal").getByText(/^Pcp-/), 800);
  }),
  S("Disabling an account signs that person out everywhere at once, and keeps their history.", async () => {
    await tap(page.locator(".ant-modal").getByRole("button", { name: "OK" }));
    await sleep(400);
    await tap(page.locator("tr", { hasText: "nhc.poc" }).getByRole("button", { name: "Disable" }));
    await sleep(450);
    await tap(page.locator(".ant-popconfirm").getByRole("button", { name: "OK" }), 500);
    await toast(/disabled/);
  }),
  S("Every action in this story is in the audit log, and each entry is chained to the one before it.", async () => {
    await go("/pcp/audit");
    await point(page.locator("table tbody tr").first(), 900);
  }),
  S("Editing any past entry, even directly in the database, breaks the chain, and this check fails.", async () => {
    await point(page.getByText(/Chain intact/).first(), 800);
  }),

  chapter("Close"),
  S("One registry, one workflow, and records PCP can stand behind.", async () => {
    await card("PCP Digital Portal", "One registry. One workflow. Records PCP can stand behind.", "Data entered once, rules enforced automatically, outcomes anyone can verify.");
  }),
  S("That is the PCP Digital Portal."),
];

// ---------- Export mode: the narration only ----------
const lines = SCRIPT.filter((s) => s.say).map((s, i) => ({ id: i, text: s.say }));
if (process.argv.includes("--export")) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "narration.json"), JSON.stringify(lines, null, 2));
  console.log(`narration.json: ${lines.length} sentences`);
  process.exit(0);
}

// ---------- Film mode ----------
const clips = JSON.parse(fs.readFileSync(path.join(OUT, "clips", "durations.json"), "utf8"));
if (clips.length !== lines.length || clips.some((c, i) => c.text !== lines[i].text)) throw new Error("clips/durations.json does not match the script; re-run --export and tts.py");

const framesDir = path.join(OUT, "frames");
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });
const frames = [];
const timeline = { sentences: [], captions: [], chapters: [] };

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
ctx = await browser.newContext({ viewport: { width: W, height: H } });
await ctx.addInitScript(OVERLAY);
page = await ctx.newPage();
page.on("domcontentloaded", () => syncOverlay());
cdp = await ctx.newCDPSession(page);
cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
  const file = `f${String(frames.length).padStart(6, "0")}.jpg`;
  fs.writeFileSync(path.join(framesDir, file), Buffer.from(data, "base64"));
  frames.push({ file, t: metadata.timestamp });
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
});
const startCast = () => cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: W, maxHeight: H, everyNthFrame: 1 }).catch(() => undefined);
page.on("framenavigated", (f) => {
  if (f === page.mainFrame()) startCast();
});

await page.goto(BASE + "/");
await page.evaluate(() => {
  try {
    localStorage.setItem("pcp-guide-open", "0");
  } catch {}
});
await page.setContent("<html><body style='margin:0;background:#0a3d2e'></body></html>");
await startCast();
await sleep(600);
const T0 = frames[0]?.t ?? Date.now() / 1000;
const now = () => Date.now() / 1000 - T0;

let n = 0;
try {
  for (const item of SCRIPT) {
    if (item.chapter) {
      timeline.chapters.push({ title: item.chapter, start: now() });
      continue;
    }
    const clip = clips[n];
    const start = now();
    timeline.sentences.push({ id: n, start, dur: clip.dur, text: item.say });
    // Captions: long sentences split at a natural break into two timed chunks
    const chunks = splitCaption(item.say);
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const captioner = (async () => {
      let t = 0;
      for (const c of chunks) {
        caption = c;
        await page.evaluate((x) => window.__film?.caption(x), c).catch(() => undefined);
        const d = (clip.dur * c.length) / total;
        timeline.captions.push({ start: start + t, end: start + t + d, text: c });
        t += d;
        await sleep(d * 1000);
      }
    })();
    const action = item.act ? item.act() : Promise.resolve();
    await Promise.all([captioner, action, sleep(clip.dur * 1000 + GAP)]);
    caption = "";
    await page.evaluate(() => window.__film?.caption("")).catch(() => undefined);
    console.log(`[${n + 1}/${lines.length}] ${now().toFixed(1)}s  ${item.say.slice(0, 70)}`);
    n++;
  }
  await sleep(1500);
  timeline.end = now();
  timeline.ref = ref;
  timeline.cert = cert;
  fs.writeFileSync(path.join(OUT, "frames.json"), JSON.stringify({ T0, frames }, null, 0));
  fs.writeFileSync(path.join(OUT, "timeline.json"), JSON.stringify(timeline, null, 2));
  console.log(`\nFILM RECORDED: ${frames.length} frames, ${timeline.end.toFixed(1)}s, ${ref} → ${cert}`);
} catch (e) {
  await page.screenshot({ path: path.join(OUT, "FAILED.png") }).catch(() => undefined);
  console.error(`FAILED at sentence ${n + 1}:`, e);
  process.exitCode = 1;
} finally {
  await cdp.send("Page.stopScreencast").catch(() => undefined);
  await browser.close();
}

function splitCaption(text) {
  if (text.length <= 92) return [text];
  // Prefer a sentence break, then a comma or colon, nearest the middle
  const mid = text.length / 2;
  let best = -1;
  for (const re of [/\. /g, /[,:] /g]) {
    for (const m of text.matchAll(re)) if (best < 0 || Math.abs(m.index - mid) < Math.abs(best - mid)) best = m.index;
    if (best > 20 && best < text.length - 20) break;
    best = -1;
  }
  if (best < 0) {
    best = text.lastIndexOf(" ", mid);
    return [text.slice(0, best), text.slice(best + 1)];
  }
  return [text.slice(0, best + 1), text.slice(best + 2)];
}
