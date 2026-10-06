# PCP Digital Portal (demo)

A working demo of the Pharmacy Council of Pakistan digitalization system. It covers institution onboarding, faculty and student registries, the NOC workflow with inspections and council decisions, certificates with QR verification, a document tree per institution, dashboards and a tamper-evident audit log.

**All institutions, people, CNICs and payments are fictional. No SMS is sent.**

## Run it

```bash
./demo.sh up      # starts PostgreSQL, Keycloak, Nginx (Docker) and the app; seeds on first run
```

Open **http://localhost:8088**. Every demo account uses the password `Demo@1234`, and the sign-in page lists them.

| Command | What it does |
| --- | --- |
| `./demo.sh up` | Start everything |
| `./demo.sh reset` | Reset the demo data **and** Keycloak (users, tenants) |
| `./demo.sh share` | Put the demo online through a free Cloudflare quick tunnel and print a public HTTPS link (no account needed) |
| `./demo.sh unshare` | Stop sharing and return to localhost |
| `./demo.sh test` | Replay the whole story in headless Chrome through real Keycloak logins (run `reset` first) |
| `./demo.sh tour` | Play the story the way a presenter would, through the presenter guide, and save a screenshot per beat to `e2e/tour/` (run `reset` first) |
| `./demo.sh down` | Stop everything |

Requires Docker, Node 20+ and three free ports: 8088 (Nginx), 5433 (PostgreSQL) and 3150 (app).

## Sharing it online (free)

`./demo.sh share` starts a [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) and prints a link such as `https://some-words.trycloudflare.com`. Send `<link>/login` to council members: they can pick a persona and click through the whole story, on a laptop or a phone.

- **It runs from this machine.** The link works only while the machine is awake, connected and the demo is running. Stop the machine from sleeping during a review window.
- **The link changes** every time you run `share`. Run it once and leave it running for the review period.
- **While sharing, use the public link here too.** Sign-in is configured for the public address. `./demo.sh unshare` switches back to localhost.
- **What is reachable:** only the portal and the `pcp` sign-in realm. Keycloak's master realm and admin console answer only on localhost, and PostgreSQL is not exposed. All data is fictional.
- **Resetting:** visitors can change data (the Super Admin persona can disable accounts). `./demo.sh reset` restores the clean story and keeps the public link working.
- **Always-on alternative:** the same Docker setup fits Oracle Cloud's Always Free tier (an Ampere A1 VM with up to 4 cores and 24 GB). That needs an Oracle account.

## Presenting

The demo build (`DEMO_MODE=1` in `.env.local`) adds presenter tools. None of them exist in a production build.

- **Presenter guide.** The floating "Presenter guide" button (bottom right, or **Start the guided demo** on the sign-in page) walks through the 17-step story in four acts. Each step names who to be, what to click and what to say. One button switches persona and opens the right page.
- **One-click personas.** The sign-in page offers **Enter as …** for every demo account. It still signs in through Keycloak, using the password grant on a separate demo-only client (`pcp-demo`), so a disabled account is refused. **Sign in with Keycloak** shows the real sign-in page, now in the portal's own theme.
- **Fill demo values** and **Attach sample PDF** buttons on the forms, so nothing needs typing during a pitch.

Before presenting, run `./demo.sh reset`, then open the guide and restart from step 1.

### The narrated film

`e2e/film/` records a narrated walkthrough (about 6½ minutes, 1600×900, captions drawn on screen, Microsoft neural voice via `edge-tts`):

```bash
export FILM_OUT=e2e/film/out
node e2e/film/film.mjs --export     # narration script → narration.json
python3 e2e/film/tts.py             # voice, one clip per sentence (VOICE=en-GB-RyanNeural)
./demo.sh reset && node e2e/film/film.mjs   # paced screen recording
python3 e2e/film/build.py           # → pcp-walkthrough.mp4, captions.vtt, transcript.json
./demo.sh reset                     # the recording changes the data
```

Edit the sentences in `film.mjs` to change the narration; each sentence carries the action that plays while it is spoken.

## Roles

| Role | Account(s) | Can do |
| --- | --- | --- |
| Institution POC | `ruh.poc`, `nhc.poc`, … (one per institution) | Everything for their own institution: faculty, students, applications, fees, deficiency responses |
| PCP Officer | `pcp.officer` | Scrutiny, deficiencies, duplicate checks, scheduling inspections, forwarding to council |
| PCP Inspector | `pcp.inspector` (Punjab), `pcp.inspector2` (KP) | Only the inspections assigned to them |
| PCP Secretary | `pcp.secretary` | Council decisions and certificates |
| PCP Super Admin | `pcp.admin` | Onboards institutions, creates and disables users, resets passwords, reads the audit log. Makes no case decisions |

There is no self-registration. Only the Super Admin creates accounts.

### Route protection

`src/proxy.ts` is Next.js 16's name for middleware. It runs on every request:

- **Signed-out users** are sent to `/login`, and return to the page they asked for after signing in.
- **Each kind of user stays in their own area.** Institution POCs cannot open `/pcp`, and PCP users cannot open `/institution`.
- **Protected pages are never cached,** so pressing Back after sign-out lands on sign-in.
- **A disabled user is locked out on their next request,** even if they still have a session.

## Adding a tenant (a new institution)

1. Sign in as `pcp.admin` and open **Users & institutions → Onboard institution**.
2. Enter the institution details and its POC's name, email and username.
3. The system then:
   - generates the next PCP ID (e.g. `PCP-UNI-000109`)
   - creates the institution's group in Keycloak, which scopes all its data
   - creates the POC account with a temporary password, shown once
4. Share the temporary password securely. At first sign-in, Keycloak makes the POC set their own password.
5. The POC sees only their institution. They add faculty and start a NOC application.

**Changing the POC:** Disable the current one (history is kept), then **Add POC** for that institution. Only one POC per institution can be active.

All tenants share one database. Every row carries the institution's ID, and the institution's Keycloak group is what scopes each query, so one institution can never read another's data.

## The demo story

| # | Sign in as | Do this | What it shows |
| --- | --- | --- | --- |
| 1 | `ruh.poc` | **Applications → New NOC application → Pharmacy Technician**. Enter: campus, intake 60, 4 classrooms, 3 labs, 800 books. Save, then upload the 3 required documents | The automatic checks from PCP's draft; the faculty check fails (3 of 4) |
| 2 | `ruh.poc` | **Faculty → Add** with CNIC `35202-7654321-2` | Blocked: this person is active at another institution, which is not named |
| 3 | `ruh.poc` | **Faculty → Add** “Dr. Mohammad Ali Khan” with a new CNIC, father “Abdul Ghafoor Khan” | Saved but flagged: it matches “Dr. Muhammad Ali Khan” |
| 4 | `ruh.poc` | **Generate challan → Simulate bank confirmation** | PSID and Raast QR (demo) |
| 5 | `pcp.officer` | **Data verification → Different people: clear flag** | Duplicates are resolved side by side |
| 6 | `ruh.poc` | **Re-run** the checks, then **Submit** | Submission works only when every check passes and the fee is paid |
| 7 | `pcp.officer` | **Start scrutiny → Raise deficiency** | A formal deficiency with a deadline and required evidence |
| 8 | `ruh.poc` | Respond with a note and upload evidence | The institution's side of a deficiency |
| 9 | `pcp.officer` | **Accept**, then schedule an inspection with **Dr. Zainab Qureshi (KP)** | Blocked as a conflict of interest; pick Dr. Kamran Javed (Punjab) instead |
| 10 | `pcp.inspector` | **Inspections → Open checklist → Submit** | The report PDF lands in the institution's folder |
| 11 | `pcp.officer` | **Forward to council** | — |
| 12 | `pcp.secretary` | **Approved → Issue NOC certificate** | A signed PDF with a QR code |
| 13 | anyone | Open `/verify/certificate/<no>` | Public verification; a fake number fails |
| 14 | `nhc.poc` | Open RUH's application URL | 404: each institution sees only its own data |
| 15 | `pcp.admin` | **Onboard institution**, then **Disable** a POC | A new tenant in seconds; a disabled user is locked out |
| 16 | `pcp.admin` | **Audit log** | Every action is hash-chained, and the log shows “Chain intact” |

## How it is built

```
Browser ─▶ Nginx :8088 ─┬─▶ Next.js (proxy + screens + server actions + API)  :3150 on the host
                        └─▶ Keycloak /auth (logins, roles, groups = tenants, MFA-ready)
Next.js ─▶ PostgreSQL :5433 (Drizzle ORM)       Next.js ─▶ Keycloak Admin API (service account)
Files   ─▶ ./storage/institutions/<PCP-UNI-ID>/<folder>/v<n>-<file>
```

| Part | Where |
| --- | --- |
| Route protection | `src/proxy.ts` |
| Roles and permission matrix | `src/lib/roles.ts` |
| User and tenant management (Keycloak Admin API) | `src/lib/keycloak-admin.ts`, `src/app/actions/admin.ts` |
| Database schema (the one-active-institution rule is a partial unique index) | `src/db/schema.ts` |
| NOC workflow state machine | `src/lib/workflow.ts` |
| Automatic checks, versioned rules, fees | `src/lib/rules.ts` |
| Hash-chained audit log (`npm run audit:verify`) | `src/lib/audit.ts` |
| Keycloak realm generator | `scripts/gen-realm.mjs` → `docker/keycloak/realm-pcp.json` |
| Keycloak sign-in theme | `docker/keycloak/themes/pcp/` |
| Presenter story and personas | `src/lib/demo-story.ts`, `src/components/DemoGuide.tsx` |
| Seed data / end-to-end test | `scripts/seed.ts` / `e2e/demo-flow.mjs` |

## What is mocked in the demo

| Feature | Demo | Production |
| --- | --- | --- |
| CNIC check | Format check and uniqueness | NADRA Verisys (Nishan Pakistan) |
| Fee payment | Generated PSID, demo Raast QR, a “simulate bank confirmation” button | Sponsor bank PSID (1Link) and Raast P2M callbacks |
| E-signature | Marked “demo” on the PDF | A NIFT certificate |
| Notifications | In-app, stored in the database | Plus email; SMS or WhatsApp only for urgent items |
| Temporary passwords | Shown once to the Super Admin | Emailed through Keycloak's “set password” link |
| Inspector app | Responsive web checklist | ODK Collect (offline, geotagged photos) |
| Hosting | Your machine | Accredited cloud in Pakistan |

Keycloak admin console: http://localhost:8088/auth/admin (user `admin`, password `admin`).
