# Build notes: conventions for every module

Read this before changing code. The requirements come from PCP's working guide,
`/home/sohaib/Downloads/PCP_Digitisation_updated.pdf` (read the sections for your module).

## Stack and rules
- Next.js 16 (App Router, `src/proxy.ts` is the middleware), React 19, Ant Design 6, Drizzle ORM on PostgreSQL, Keycloak for sign-in.
  Read `node_modules/next/dist/docs/` before using a Next.js API you are unsure about (this Next version differs from older ones).
- Everything is a demo with fictional data. Payments, NADRA, HEC, bank, SMS and email are **simulated**, never real.

## Where things go
- **Schema:** your module's tables are in `src/db/modules/<module>.ts` (already created; extend them there). Core tables are in `src/db/schema.ts`; change core only when unavoidable, additively, and say so in your report. Apply with `npx drizzle-kit push --force`.
- **Seed:** `scripts/seed/<module>.ts` (default export, runs after the core seed; return a one-line summary). Re-seed with `npm run seed`.
- **Server actions:** `src/app/actions/<module>.ts`, `"use server"`, return `{ ok, message, level? }` (see `ActionResult` in `src/app/actions/faculty.ts`).
- **Pages:** placeholders already exist for every route in the navigation; replace them. Navigation is already wired in `src/app/institution/layout.tsx` and `src/app/pcp/layout.tsx`; do not restructure it.
- **Roles and permissions:** `src/lib/roles.ts` already has every role and permission from the guide. Use `requirePermission(...)`, `requireInstitution(...)`, `requireUser(kind)` from `src/lib/session.ts`. An institution user must only ever see their own institution.

## Shared services (use them, do not re-implement)
- `notify(exec, audience, title, body, link)` in `src/lib/util.ts`: in-app alert **and** simulated email to every user of the audience (`inst:<PCP-UNI-ID>`, `role:<role>`, `user:<username>`). Every message is stored in `messages` and shown under Messages.
- `sendSms`, `sendEmail` in `src/lib/messages.ts` for one-off messages (e.g. to an applicant who is not a user yet).
- `audit(exec, {...})` in `src/lib/audit.ts`: call it for every create, change, decision and download.
- `renderLetter({...})` and `fileDocument(exec, {...})` in `src/lib/letters.ts`: every letter, receipt, certificate or card is a PDF with a QR code, filed as a versioned document.
- `createChallan`, `confirmPayment`, `outstandingDues` in `src/lib/payments.ts`: fees, receipts, dues.
- `useOtp()` in `src/components/OtpConfirm.tsx` + `requireOtp(username, purpose, code)` in `src/lib/otp.ts`: **every decision and every payment** needs a one-time code (the demo dialog fills it in).
- UI pieces in `src/components/common.tsx`: `PageTitle` (with `eyebrow`), `StatCard`, `StatusDot`/`Pill`/`StatusTag`, `Person`, `KV`, `fmtDate`, `timeAgo`. Demo helpers in `src/components/demo-helpers.tsx`: `FillDemo` (autofill a form), `SamplePdfButton` (attach a generated PDF). Follow the look of existing screens (`InstitutionDashboard.tsx`, `PcpApplicationView.tsx`): cards, tables with `styles={{ body: { padding: 0 } }}`, sentence-case labels.
- Copy: plain, specific English. Buttons say exactly what happens. Errors say what went wrong and how to fix it. No em-dash asides.

## Your development copy
You work in a git worktree. Run `scripts/agent-env.sh <port> <database>` once (port and database are in your brief).
It links `node_modules`, writes `.env.local`, creates and seeds your own database, and starts `next dev` on your port.
- Sign in quickly as any demo user: open `http://localhost:<port>/login` and click **Enter as …**, or POST a form to `/api/demo/switch` with `username` and `next`.
- Keycloak is shared by everyone. Do not disable or delete existing demo users, and do not run `./demo.sh reset`. If your flow creates Keycloak users, give them unique usernames.
- Do not run `e2e/demo-flow.mjs` (it disables shared users). Write your own test in `e2e/modules/<module>.mjs` with playwright-core (Chrome at `/usr/bin/google-chrome`, headless), run it against your port, and look at the screenshots it takes.
- Before you finish: `npx tsc --noEmit` is clean, your test passes, and you have committed your work on your branch with clear messages.
