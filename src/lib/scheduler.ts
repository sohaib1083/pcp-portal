// Daily jobs: renewal alerts and service-level reminders/escalations. Started once per server process from
// src/instrumentation.ts, and also run (at most every few minutes) when the PCP dashboard loads.
// Both jobs are idempotent, so running them more often than daily never sends a message twice.
import { runRenewalAlerts } from "./renewals";
import { runSlaChecks } from "./sla";

const DAY = 24 * 3600 * 1000;
const g = globalThis as unknown as { __pcpScheduler?: ReturnType<typeof setInterval>; __pcpJobsAt?: number; __pcpJobsRunning?: Promise<unknown> | null };

export async function runDailyJobs() {
  const renewals = await runRenewalAlerts();
  const sla = await runSlaChecks();
  g.__pcpJobsAt = Date.now();
  return { renewals, sla };
}

/** Cheap to call on every dashboard load: runs only when the last run is older than `maxAgeMs`. */
export async function runJobsIfStale(maxAgeMs = 5 * 60 * 1000) {
  if (g.__pcpJobsRunning || Date.now() - (g.__pcpJobsAt ?? 0) < maxAgeMs) return;
  g.__pcpJobsRunning = runDailyJobs()
    .catch((e) => console.error("[scheduler] daily jobs failed", e))
    .finally(() => {
      g.__pcpJobsRunning = null;
    });
  await g.__pcpJobsRunning;
}

export function startScheduler() {
  if (g.__pcpScheduler) return;
  const tick = () => runJobsIfStale(0).then(() => console.log("[scheduler] renewal alerts and service-level checks done"));
  setTimeout(tick, 15_000);
  g.__pcpScheduler = setInterval(tick, DAY);
}
