"use client";
// Language scope for the public screens: English (left to right) or Urdu (right to left, Nastaliq).
// The page reads the `pcp_lang` cookie on the server and passes `lang`; the toggle rewrites the cookie.
import { createContext, useContext, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfigProvider } from "antd";
import { TranslationOutlined } from "@ant-design/icons";
import { LANG_COOKIE, translator, type Lang } from "@/lib/i18n";
import { urduFont } from "@/lib/fonts";
import "./public-i18n.css";

const LangContext = createContext<Lang | null>(null);

/** The language of the surrounding public page. `enabled` is false on pages that are English only. */
export function useLang() {
  const lang = useContext(LangContext);
  return { lang: lang ?? "en", t: translator(lang ?? "en"), enabled: lang !== null, rtl: lang === "ur" };
}

const URDU_STACK = "var(--font-inter), var(--font-urdu), system-ui, -apple-system, 'Segoe UI', sans-serif";

export function LangScope({ lang, className, style, children }: { lang: Lang; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  const rtl = lang === "ur";
  return (
    <LangContext.Provider value={lang}>
      <ConfigProvider direction={rtl ? "rtl" : "ltr"} theme={rtl ? { token: { fontFamily: URDU_STACK, fontSize: 15 } } : undefined}>
        <div lang={lang} dir={rtl ? "rtl" : "ltr"} className={[urduFont.variable, rtl ? "lang-ur" : "lang-en", className].filter(Boolean).join(" ")} style={style}>
          {children}
        </div>
      </ConfigProvider>
    </LangContext.Provider>
  );
}

/** Header button: English ⇄ اردو. Remembers the choice for a year. */
export function LangToggle() {
  const { lang, t } = useLang();
  const router = useRouter();
  const [pending, start] = useTransition();
  const next: Lang = lang === "ur" ? "en" : "ur";
  return (
    <Button
      ghost
      data-testid="lang-toggle"
      className="pub-lang-toggle"
      loading={pending}
      icon={<TranslationOutlined />}
      aria-label={t("lang.switchLabel")}
      title={t("lang.switchLabel")}
      onClick={() => {
        document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
        start(() => router.refresh());
      }}
    >
      <span lang={next} className={next === "ur" ? "ur-text" : undefined}>
        {t("lang.switch")}
      </span>
    </Button>
  );
}
