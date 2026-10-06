// Server-side switches for the demo build. Never enable DEMO_MODE in production.
import { PERSONAS } from "./demo-story";

export const DEMO_PASSWORD = "Demo@1234";

const OTHER_POCS = ["rbu.poc", "ccp.poc", "bvu.poc", "gmi.poc", "fru.poc", "scu.poc"];

export function quickLoginEnabled() {
  return process.env.DEMO_MODE === "1" && !!process.env.KEYCLOAK_DEMO_CLIENT_ID && !!process.env.KEYCLOAK_DEMO_CLIENT_SECRET;
}

export function isDemoAccount(username: string) {
  return PERSONAS.some((p) => p.username === username) || OTHER_POCS.includes(username);
}
