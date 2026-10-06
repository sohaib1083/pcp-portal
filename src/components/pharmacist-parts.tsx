"use client";
// Small pieces shared by the PCP register screens and the pharmacist's own portal.
import { translator, type Lang } from "@/lib/i18n";
import { CATEGORY_SHORT, STATUS_LABELS, STATUS_TONE, isCouncil, validityLapsed } from "@/lib/register";
import { StatusDot, fmtDate } from "./common";

/** Registration status as a coloured dot. An "active" entry whose validity has ended says so. */
export function RegStatus({ status, validUntil }: { status: string; validUntil?: string | null }) {
  if (status === "ACTIVE" && validityLapsed(validUntil)) return <StatusDot tone="warn">Active · validity ended</StatusDot>;
  return <StatusDot tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABELS[status] ?? status}</StatusDot>;
}

export function CategoryText({ category }: { category: string }) {
  return <span>{CATEGORY_SHORT[category] ?? category}</span>;
}

/** The same plain-words sentence the public check shows. */
export function statusSentence(p: { status: string; validUntil: string | null; council: string }, lang: Lang = "en") {
  const t = translator(lang);
  const council = isCouncil(p.council) ? t(`council.${p.council}`) : p.council;
  const date = p.validUntil ? fmtDate(p.validUntil) : "";
  if (p.status === "ACTIVE" && validityLapsed(p.validUntil)) return t("ph.say.LAPSED", { council, date });
  if (p.status === "ACTIVE") return p.validUntil ? t("ph.say.ACTIVE", { council, date }) : t("ph.say.ACTIVE_OPEN", { council });
  if (p.status === "DORMANT" || p.status === "SUSPENDED" || p.status === "CANCELLED") return t(`ph.say.${p.status}`, { council, date });
  return "";
}

export const STATUS_BANNER: Record<string, { bg: string; bd: string; fg: string }> = {
  good: { bg: "#e9f7ef", bd: "#c9ecd8", fg: "#0d7a3d" },
  warn: { bg: "#fff7e6", bd: "#ffe1a8", fg: "#a15c00" },
  bad: { bg: "#fff1f0", bd: "#ffccc7", fg: "#b4141f" },
  neutral: { bg: "#f2f4f3", bd: "#e1e6e3", fg: "#55625c" },
};

export function bannerTone(status: string, validUntil: string | null) {
  if (status === "ACTIVE" && validityLapsed(validUntil)) return STATUS_BANNER.warn;
  return STATUS_BANNER[STATUS_TONE[status] ?? "neutral"];
}
