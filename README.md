# PCP Digital Portal

A working proof of concept of the Pharmacy Council of Pakistan's digitisation system. It covers every section of PCP's working guide "PCP digitisation" and the additions in PCP's October 2026 request for proposal. The page `/coverage` lists each requirement with the screen and the account that does it.

**All institutions, people, CNICs and payments are fictional.** Bank and Raast payments, the bank statement, NADRA, HEC, SMS and email are simulated: one-time codes appear on screen and every message is stored under Messages.

## What it does

- **Institution onboarding** with email and mobile codes, a checklist, PCP review and the Institution ID (`PCP-UNI-000123`). Campuses are child records.
- **NOC, accreditation and renewal as case files** for Pharm.D, Pharmacy Technician, MS/MPhil and PhD:
  - the campus is picked first, and faculty are linked by Faculty ID;
  - rule checks name the item and the rule, and Pay stays locked until they pass;
  - the case moves through scrutiny, deficiencies, technical review, inspection and Council, and ends in a decision letter and a QR certificate;
  - renewal alerts go out at 180, 120, 90, 60 and 30 days.
- **One person, one Faculty ID**: a duplicate check on CNIC, registration number and name, "Did you mean ...?", change requests, and a simulated NADRA check.
- **Students**: IDs, lifecycle, the annual return with year lock and correction requests, bulk upload with row-by-row errors, a simulated degree check, student logins and requests, and QR-checked certificates.
- **Pharmacist register** across the five provincial councils, with a public check and a registration card. Provincial councils see only their own province and validate updates first.
- **Inspections**:
  - an automated team suggestion that respects the same-province rule and declared conflicts;
  - a tablet checklist with scores that keeps working without a connection;
  - deficiencies handled as tasks, and stand-alone visits.
- **Council and committees**: agenda, members register, attendance, quorum and recusals, decisions with one-time codes, and appeals.
- **Court case ledger** with stay orders that block decisions; inward and outward **correspondence** registers.
- **Payments**: challans with PSID and Raast QR, receipts, bank reconciliation by the Accounts officer, and dues that block submission.
- **Reports**: drill-down to the list behind every figure, Excel/PDF/CSV export, a read-only data feed, measures of success, and an early-warning list.
- **Administration**:
  - roles from the guide and the RFP (6 institution roles, 10 PCP roles, provincial council, faculty, student, pharmacist);
  - a one-time code at sign-in for officers, a 30-minute idle sign-out, and a quarterly access review;
  - Super Admin overrides with an audit trail, retention rules, and a privacy notice;
  - a hash-chained audit log covering views, downloads and changes.
- **English and Urdu** on public screens, and **service levels** with a clock on every stage, reminders and escalation.

## Run it locally

```bash
./demo.sh up      # PostgreSQL, Keycloak and Nginx in Docker, then the app; seeds on first run
```

Open **http://localhost:8088**. Every local demo account uses the password `Demo@1234`.

| Command | What it does |
| --- | --- |
| `./demo.sh up` | Start everything |
| `./demo.sh reset` | Reset the demo data and Keycloak (users, institutions) |
| `./demo.sh test` | Run the main walkthrough in headless Chrome through real Keycloak sign-ins |
| `./demo.sh down` | Stop everything |

Requires Docker, Node 20+ and free ports 8088 (Nginx), 5433 (PostgreSQL) and 3150 (app).

## Presenter mode and POC mode

| | Presenter mode (local default) | POC mode (hosted) |
| --- | --- | --- |
| Sign-in page | Lists every persona with one-click **Enter as …** | A plain **Sign in** page; everyone uses their own username and password |
| Passwords | `Demo@1234` for all | One per account, derived from `POC_PASSWORD_SEED` |
| Presenter guide, `/coverage` **Try it** | On | Off (`/coverage` names the account for each line) |
| Simulated codes on screen, **Fill demo values** | On | On |

POC mode is `QUICK_LOGIN=off` plus a `POC_PASSWORD_SEED`. A one-click switch that lets anyone become any user belongs only in a presentation you run yourself; never put it on a shared link.

## Deploy (Azure)

`deploy/deploy-azure.sh` runs the whole portal on one small Azure VM. The container is the all-in-one image in `deploy/hf`: PostgreSQL, Keycloak, the compiled app and Nginx, behind Caddy for HTTPS. The app ships compiled, with no source code or source maps in the image.

```bash
az login
LOCATION=southindia SIZE=Standard_B2als_v2 deploy/deploy-azure.sh first   # VM, IP, firewall, build, start
deploy/deploy-azure.sh update        # ship the current code
deploy/deploy-azure.sh credentials   # write every account's POC password to deploy/poc-credentials.json
deploy/deploy-azure.sh reset         # restart from clean demo data
deploy/deploy-azure.sh stop|start    # pause the VM between reviews
```

- **Settings:** stored in `deploy/.azure.env` (git-ignored): the address (`PUBLIC_HOST`, e.g. `pcp-<ip>.sslip.io`), `QUICK_LOGIN=off` and the password seed. The Azure name redirects to `PUBLIC_HOST`.
- **Resets:** the demo data resets whenever the container restarts.
- **Admin console:** Keycloak's master realm and admin console are never public.

## Tests

End-to-end tests drive headless Chrome through real Keycloak sign-ins (playwright-core, Chrome at `/usr/bin/google-chrome`). Re-seed (`npm run seed`) between suites, and set `BASE` to the app's address.

| Test | Covers |
| --- | --- |
| `e2e/demo-flow.mjs` | The main NOC story, tenant isolation, offline inspection, audit chain |
| `e2e/poc-flow.mjs` | The POC guide's flow, each step by its own role-holder with their own password; takes the guide's screenshots |
| `e2e/poc-smoke.mjs` | POC mode: no one-click entry, the shared password refused, each key account lands in its own area |
| `e2e/coverage-links.mjs` | Every `/coverage` line opens the right screen as the right person |
| `e2e/modules/*.mjs` | One suite per module: onboarding, cases, registry, students, pharmacists, council, governance, accounts, people, PG, gaps, RFP gaps, workflow |
| `e2e/security-sweep.mjs` | Every page and API route refuses signed-out and other-tenant access |

`npx tsc --noEmit` must stay clean.

## How it is built

```
Browser ─▶ Nginx ─┬─▶ Next.js 16 (proxy, screens, server actions, API)
                  └─▶ Keycloak /auth (sign-in, roles, institution groups = tenants)
Next.js ─▶ PostgreSQL (Drizzle ORM)        Next.js ─▶ Keycloak Admin API (service account)
Files   ─▶ STORAGE_DIR/institutions/<PCP-UNI-ID>/<folder>/v<n>-<file>  (versioned, SHA-256)
```

| Part | Where |
| --- | --- |
| Route protection (Next.js 16 middleware) | `src/proxy.ts` |
| Roles and permissions | `src/lib/roles.ts` |
| Case workflow, stages and transitions | `src/lib/workflow.ts` |
| Rule checks, versioned reference rules, fees | `src/lib/rules.ts`, `/pcp/rules` |
| Database schema | `src/db/schema.ts` and `src/db/modules/*.ts` |
| Letters, certificates, receipts (PDF + QR) | `src/lib/letters.ts`, `src/lib/certificate.ts` |
| Hash-chained audit log (`npm run audit:verify`) | `src/lib/audit.ts` |
| Scheduler: renewal alerts, service levels, reminders, retention | `src/lib/scheduler.ts` |
| Requirement coverage page | `src/lib/coverage.ts`, `/coverage` |
| Keycloak realm (roles, demo users) and theme | `scripts/gen-realm.mjs`, `docker/keycloak/themes/pcp/` |
| Seed data | `scripts/seed.ts`, `scripts/seed/*.ts` |
| Conventions for contributors | `docs/BUILD-NOTES.md` |

## What production would add

| Here | In production |
| --- | --- |
| Simulated NADRA, HEC, bank and Raast, SMS, email | The real services, under PCP's agreements |
| Signature marked as demo on PDFs | A licensed signing certificate (for example NIFT) |
| One small VM; data resets on restart | PCP's chosen cloud or the National Data Centre, daily backups (`deploy/backup.sh`, with a restore test) and a recovery site |
| Disk encryption from the cloud provider | Plus field-level encryption of CNIC, mobile and email |
