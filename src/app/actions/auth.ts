"use server";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { auth, signIn, signOut } from "@/lib/auth";

const safeNext = (next: string, fallback = "/home") => (next.startsWith("/") && !next.startsWith("//") ? next : fallback);

export async function loginAction(formData: FormData) {
  const username = String(formData.get("username") ?? "");
  const redirectTo = safeNext(String(formData.get("next") ?? ""));
  await signIn("keycloak", { redirectTo }, username ? { login_hint: username, prompt: "login" } : { prompt: "login" });
}

/** Demo only: one-click sign-in as a demo persona (Keycloak password grant on the demo client). */
export async function quickSignInAction(formData: FormData) {
  const username = String(formData.get("username") ?? "");
  const redirectTo = safeNext(String(formData.get("next") ?? ""));
  try {
    await signIn("demo", { username, redirectTo });
  } catch (e) {
    // A successful sign-in throws Next's redirect; only Auth.js errors land here.
    if (e instanceof AuthError) redirect(`/login?error=quick&u=${encodeURIComponent(username)}`);
    throw e;
  }
}

/** Ends the app session and the Keycloak session (federated logout). */
export async function logoutAction() {
  const session = await auth();
  const idToken = session?.idToken;
  await signOut({ redirect: false });
  const url = new URL(`${process.env.AUTH_KEYCLOAK_ISSUER}/protocol/openid-connect/logout`);
  if (idToken) url.searchParams.set("id_token_hint", idToken);
  url.searchParams.set("post_logout_redirect_uri", `${process.env.PUBLIC_BASE_URL ?? "http://localhost:8088"}/`);
  redirect(url.toString());
}
