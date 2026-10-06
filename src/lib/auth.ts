import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Keycloak from "next-auth/providers/keycloak";
import { DEMO_PASSWORD, isDemoAccount, quickLoginEnabled } from "./demo";

declare module "next-auth" {
  interface Session {
    user: {
      username: string;
      name: string;
      email?: string | null;
      roles: string[];
      institutionCode: string | null;
    };
    idToken?: string;
  }
}

type AppToken = { username?: string; roles?: string[]; groups?: string[]; idToken?: string };
type DemoUser = { id: string; name: string; email: string | null; username: string; roles: string[]; groups: string[]; idToken: string };

/**
 * Demo-only persona switcher. It still signs in through Keycloak (password grant on the separate
 * "pcp-demo" client), so Keycloak remains the authority: a disabled account or an account that
 * must change its password is refused there. Only the seeded demo usernames are accepted.
 */
const demoPersona = Credentials({
  id: "demo",
  name: "Demo persona",
  credentials: { username: {} },
  async authorize(c) {
    const username = String(c?.username ?? "");
    if (!quickLoginEnabled() || !isDemoAccount(username)) return null;
    const res = await fetch(`${process.env.AUTH_KEYCLOAK_ISSUER}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: process.env.KEYCLOAK_DEMO_CLIENT_ID!,
        client_secret: process.env.KEYCLOAK_DEMO_CLIENT_SECRET!,
        username,
        password: DEMO_PASSWORD,
        scope: "openid profile email",
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const { id_token } = (await res.json()) as { id_token?: string };
    if (!id_token) return null;
    const claims = JSON.parse(Buffer.from(id_token.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const user: DemoUser = {
      id: String(claims.sub),
      name: String(claims.name ?? claims.preferred_username ?? username),
      email: (claims.email as string) ?? null,
      username: String(claims.preferred_username ?? username),
      roles: Array.isArray(claims.roles) ? (claims.roles as string[]) : [],
      groups: Array.isArray(claims.groups) ? (claims.groups as string[]) : [],
      idToken: id_token,
    };
    return user;
  },
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Keycloak({
      clientId: process.env.AUTH_KEYCLOAK_ID,
      clientSecret: process.env.AUTH_KEYCLOAK_SECRET,
      issuer: process.env.AUTH_KEYCLOAK_ISSUER,
    }),
    ...(quickLoginEnabled() ? [demoPersona] : []),
  ],
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, account, profile, user }) {
      if (account?.provider === "demo" && user) {
        const u = user as unknown as DemoUser;
        token.username = u.username;
        token.roles = u.roles;
        token.groups = u.groups;
        token.idToken = u.idToken;
        token.name = u.name;
      } else if (account && profile) {
        const p = profile as Record<string, unknown>;
        token.username = (p.preferred_username as string) ?? token.sub;
        token.roles = Array.isArray(p.roles) ? (p.roles as string[]) : [];
        token.groups = Array.isArray(p.groups) ? (p.groups as string[]) : [];
        token.idToken = account.id_token;
      }
      return token;
    },
    async session({ session, token }) {
      const t = token as AppToken;
      const groups = t.groups ?? [];
      session.user = {
        username: t.username ?? "",
        name: session.user?.name ?? t.username ?? "",
        email: session.user?.email,
        roles: t.roles ?? [],
        institutionCode: groups.find((g) => g.startsWith("PCP-UNI-")) ?? null,
      } as typeof session.user;
      session.idToken = t.idToken;
      return session;
    },
  },
});
