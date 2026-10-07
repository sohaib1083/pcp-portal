"use client";
// Public privacy notice (guide section 14: "Data protection and privacy policy approved by the Council before the
// public search goes live"). English and Urdu; clearly a draft until the Council approves it.
import Link from "next/link";
import { Button } from "antd";
import {
  AuditOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  DatabaseOutlined,
  EditOutlined,
  EyeOutlined,
  FileProtectOutlined,
  LockOutlined,
  MailOutlined,
  SearchOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import type { I18nKey } from "@/lib/i18n";
import { useLang } from "./PublicLang";

export type PrivacyRetention = { draftApplicationDays: number; onboardingDraftDays: number; expiredCodeDays: number; unpaidChallanDays: number; version: number | null };

const SECTIONS: { id: string; h: I18nKey }[] = [
  { id: "holds", h: "privacy.holds.h" },
  { id: "public", h: "privacy.public.h" },
  { id: "access", h: "privacy.access.h" },
  { id: "keep", h: "privacy.keep.h" },
  { id: "security", h: "privacy.security.h" },
  { id: "correct", h: "privacy.correct.h" },
  { id: "contact", h: "privacy.contact.h" },
];

function Section({ id, h, icon, children }: { id: string; h: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="privacy-section">
      <h2>
        <span className="privacy-icon">{icon}</span>
        {h}
      </h2>
      {children}
    </section>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="privacy-list">
      {items.map((x) => (
        <li key={x}>{x}</li>
      ))}
    </ul>
  );
}

export default function PrivacyNotice({ retention, prepared }: { retention: PrivacyRetention; prepared: string }) {
  const { t } = useLang();
  return (
    <div className="privacy-wrap" data-testid="privacy-notice">
      <style>{`
        .privacy-wrap { display: grid; grid-template-columns: minmax(0, 1fr) 240px; gap: 20px; align-items: start; }
        .privacy-main { background: #fff; border: 1px solid var(--line); border-radius: 20px; box-shadow: var(--shadow-md); padding: 8px 28px 24px; min-width: 0; }
        .privacy-toc { position: sticky; top: 16px; background: #fff; border: 1px solid var(--line); border-radius: 16px; padding: 16px; font-size: 13.5px; }
        .privacy-toc a { display: block; padding: 5px 0; color: var(--ink-2); }
        .privacy-toc a:hover { color: var(--brand); }
        .privacy-draft { display: flex; gap: 12px; align-items: flex-start; margin: 18px 0 4px; padding: 14px 16px; border-radius: 14px; background: #fff7e6; border: 1px solid #ffe1a8; color: #6b4300; }
        .privacy-draft b { display: block; font-size: 15px; color: #a15c00; }
        .privacy-section { padding: 18px 0 6px; border-top: 1px solid var(--line-2); }
        .privacy-section:first-of-type { border-top: 0; }
        .privacy-section h2 { display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 680; margin: 0 0 10px; letter-spacing: -0.01em; }
        .privacy-icon { width: 32px; height: 32px; border-radius: 10px; display: inline-grid; place-items: center; background: var(--brand-50); color: var(--brand); font-size: 15px; flex: none; }
        .privacy-list { margin: 0; padding-inline-start: 20px; display: grid; gap: 6px; font-size: 14.5px; line-height: 1.6; color: var(--ink-2); }
        .privacy-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap: 12px; }
        .privacy-box { border-radius: 14px; padding: 14px 16px; font-size: 14px; line-height: 1.6; }
        .privacy-box h3 { display: flex; gap: 8px; align-items: center; margin: 0 0 8px; font-size: 14.5px; font-weight: 650; }
        .privacy-section p { margin: 8px 0 0; font-size: 14.5px; line-height: 1.6; color: var(--ink-2); }
        .lang-ur .privacy-list, .lang-ur .privacy-section p, .lang-ur .privacy-box { line-height: 2; }
        @media (max-width: 900px) {
          .privacy-wrap { grid-template-columns: minmax(0, 1fr); }
          .privacy-toc { display: none; }
          .privacy-main { padding: 4px 16px 18px; border-radius: 16px; }
        }
      `}</style>
      <div className="privacy-main">
        <div className="privacy-draft" data-testid="privacy-draft">
          <FileProtectOutlined style={{ fontSize: 22, marginTop: 2 }} />
          <div>
            <b>{t("privacy.draft")}</b>
            {t("privacy.draftBody")}
            <div style={{ fontSize: 12.5, marginTop: 4, opacity: 0.85 }}>
              <bdi>{t("privacy.version", { date: prepared })}</bdi>
            </div>
          </div>
        </div>

        <Section id="holds" h={t("privacy.holds.h")} icon={<DatabaseOutlined />}>
          <List items={[t("privacy.holds.inst"), t("privacy.holds.faculty"), t("privacy.holds.students"), t("privacy.holds.pharmacists"), t("privacy.holds.system")]} />
          <p>{t("privacy.holds.nadra")}</p>
        </Section>

        <Section id="public" h={t("privacy.public.h")} icon={<EyeOutlined />}>
          <div className="privacy-cols">
            <div className="privacy-box" style={{ background: "#f3fbf6", border: "1px solid #c9ecd8" }}>
              <h3 style={{ color: "#0d7a3d" }}>
                <CheckCircleFilled /> {t("privacy.public.shows")}
              </h3>
              <List items={[t("privacy.public.inst"), t("privacy.public.ph"), t("privacy.public.cert")]} />
            </div>
            <div className="privacy-box" style={{ background: "#fff6f5", border: "1px solid #ffccc7" }} data-testid="privacy-never">
              <h3 style={{ color: "#b4141f" }}>
                <CloseCircleFilled /> {t("privacy.public.never")}
              </h3>
              <div>{t("privacy.public.neverList")}</div>
            </div>
          </div>
          <p>{t("privacy.public.nobrowse")}</p>
          <div style={{ marginTop: 10 }}>
            <Link href="/verify">
              <Button icon={<SearchOutlined />}>{t("privacy.public.try")}</Button>
            </Link>
          </div>
        </Section>

        <Section id="access" h={t("privacy.access.h")} icon={<TeamOutlined />}>
          <List items={[t("privacy.access.inst"), t("privacy.access.officer"), t("privacy.access.cnic"), t("privacy.access.self"), t("privacy.access.feed"), t("privacy.access.review")]} />
        </Section>

        <Section id="keep" h={t("privacy.keep.h")} icon={<ClockCircleOutlined />}>
          <List
            items={[
              t("privacy.keep.records"),
              t("privacy.keep.drafts", { n: retention.draftApplicationDays }),
              t("privacy.keep.onboarding", { n: retention.onboardingDraftDays }),
              t("privacy.keep.codes", { n: retention.expiredCodeDays }),
              t("privacy.keep.challans", { n: retention.unpaidChallanDays }),
            ]}
          />
          <p data-testid="privacy-retention-rule">
            {t("privacy.keep.rule", { rule: `retention.policy, ${retention.version ? t("privacy.keep.version", { v: retention.version }) : t("privacy.keep.default")}` })}
          </p>
        </Section>

        <Section id="security" h={t("privacy.security.h")} icon={<LockOutlined />}>
          <List items={[t("privacy.security.transit"), t("privacy.security.backup"), t("privacy.security.otp"), t("privacy.security.audit")]} />
        </Section>

        <Section id="correct" h={t("privacy.correct.h")} icon={<EditOutlined />}>
          <List items={[t("privacy.correct.inst"), t("privacy.correct.person"), t("privacy.correct.pharmacist")]} />
          <div style={{ marginTop: 12 }}>
            <Link href="/help">
              <Button type="primary" icon={<EditOutlined />}>
                {t("privacy.correct.cta")}
              </Button>
            </Link>
          </div>
        </Section>

        <Section id="contact" h={t("privacy.contact.h")} icon={<MailOutlined />}>
          <p style={{ marginTop: 0 }}>{t("privacy.contact.body")}</p>
          <div style={{ marginTop: 12 }}>
            <Link href="/help">
              <Button icon={<AuditOutlined />}>{t("privacy.contact.help")}</Button>
            </Link>
          </div>
        </Section>
      </div>

      <nav className="privacy-toc" aria-label={t("privacy.onThisPage")}>
        <div className="faint" style={{ fontSize: 11.5, fontWeight: 650, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>{t("privacy.onThisPage")}</div>
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`}>
            {t(s.h)}
          </a>
        ))}
      </nav>
    </div>
  );
}
