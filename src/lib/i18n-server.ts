import { cookies } from "next/headers";
import { LANG_COOKIE, parseLang, type Lang } from "./i18n";

/** The visitor's chosen language for public screens (set by the header toggle). */
export async function getLang(): Promise<Lang> {
  return parseLang((await cookies()).get(LANG_COOKIE)?.value);
}
