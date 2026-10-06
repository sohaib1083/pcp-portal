// Service-level clock, shown to both sides of a case (guide section 14). Pure; safe in client components.
import { STAGE_LABELS } from "./workflow";

export type Clock = { stage: string; daysLeft: number; overdue: boolean; text: string; tone: "good" | "warn" | "bad" };

export function slaClock(status: string, dueAt: string | null | undefined, now = Date.now()): Clock | null {
  if (!dueAt || !STAGE_LABELS[status]) return null;
  const ms = new Date(dueAt).getTime() - now;
  const days = ms >= 0 ? Math.ceil(ms / 86400000) : -Math.ceil(-ms / 86400000);
  const stage = STAGE_LABELS[status];
  if (days < 0) return { stage, daysLeft: days, overdue: true, text: `${-days} day${days === -1 ? "" : "s"} overdue`, tone: "bad" };
  if (days === 0) return { stage, daysLeft: 0, overdue: false, text: "due today", tone: "warn" };
  return { stage, daysLeft: days, overdue: false, text: `${days} day${days === 1 ? "" : "s"} left`, tone: days <= 3 ? "warn" : "good" };
}
