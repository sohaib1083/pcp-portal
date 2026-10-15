// Server-side switches for the demo build. Never enable DEMO_MODE in production.
import { MORE_PERSONAS, PERSONAS } from "./demo-story";

export const DEMO_PASSWORD = "Demo@1234";

const OTHER_POCS = ["rbu.poc", "ccp.poc", "bvu.poc", "gmi.poc", "fru.poc", "scu.poc"];

/**
 * One-click persona entry and the presenter guide: for live presentations only.
 * A hosted POC sets QUICK_LOGIN=off, so everyone signs in with their own username and password.
 */
export function quickLoginEnabled() {
  return process.env.DEMO_MODE === "1" && process.env.QUICK_LOGIN !== "off" && !!process.env.KEYCLOAK_DEMO_CLIENT_ID && !!process.env.KEYCLOAK_DEMO_CLIENT_SECRET;
}

export function isDemoAccount(username: string) {
  return [...PERSONAS, ...MORE_PERSONAS].some((p) => p.username === username) || OTHER_POCS.includes(username) || username === "student.rbu" || username === "pharm.sana";
}
