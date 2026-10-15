// Per-user passwords for a hosted POC: derived from a secret seed, so the same account keeps the same password
// across restarts (the realm is re-imported on every start) and the credentials sheet can be printed locally.
// Used by scripts/gen-realm.mjs (when POC_PASSWORD_SEED is set) and scripts/poc-credentials.mjs.
import { createHmac } from "node:crypto";

const WORDS = ["Indus", "Ravi", "Chenab", "Hunza", "Swat", "Kaghan", "Neelum", "Margalla", "Khyber", "Bolan", "Thar", "Deosai", "Karakoram", "Hingol", "Kalash", "Shandur"];
const CHARS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/l/I

/** For example "Hunza47-k9Tq". */
export function pocPassword(seed, username) {
  const h = createHmac("sha256", seed).update(`pcp-poc:${username}`).digest();
  const word = WORDS[h[0] % WORDS.length];
  const digits = String(10 + (h[1] % 90));
  const tail = Array.from(h.subarray(2, 6), (b) => CHARS[b % CHARS.length]).join("");
  return `${word}${digits}-${tail}`;
}
