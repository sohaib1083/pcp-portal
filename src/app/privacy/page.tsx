import PrivacyNotice from "@/components/PrivacyNotice";
import { PublicFrame } from "@/components/PublicHome";
import { getLang } from "@/lib/i18n-server";
import { translator } from "@/lib/i18n";
import { retentionPolicy } from "@/lib/retention";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata = { title: "Privacy notice · PCP Digital Portal" };

/** Public privacy notice (guide section 14), English and Urdu. A draft until the Council approves it. */
export default async function PrivacyPage() {
  const lang = await getLang();
  const t = translator(lang);
  const [{ value, version }, user] = await Promise.all([retentionPolicy(), getUser()]);
  return (
    <PublicFrame lang={lang} signedIn={!!user} title={t("privacy.title")} sub={t("privacy.sub")}>
      <PrivacyNotice retention={{ ...value, version }} prepared="6 Oct 2026" />
    </PublicFrame>
  );
}
