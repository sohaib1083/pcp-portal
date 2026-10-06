import Link from "next/link";
import { Logo } from "@/components/common";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "var(--bg)" }}>
      <div style={{ maxWidth: 520, textAlign: "center", background: "#fff", border: "1px solid var(--line)", borderRadius: 20, padding: "36px 32px", boxShadow: "var(--shadow-md)" }}>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <Logo size={48} variant="dark" />
        </div>
        <div className="mono" style={{ marginTop: 18, fontSize: 13, color: "var(--faint)" }}>
          404
        </div>
        <h1 data-testid="not-found" style={{ margin: "6px 0 8px", fontSize: 24, letterSpacing: "-0.02em" }}>
          Nothing here for your account
        </h1>
        <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>
          The page does not exist, or it belongs to another institution. Each institution sees only its own records, so PCP answers the same way in both cases.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 22 }}>
          <Link href="/home" style={{ background: "var(--brand)", color: "#fff", padding: "9px 16px", borderRadius: 8, fontWeight: 600 }}>
            Back to my dashboard
          </Link>
          <Link href="/" style={{ border: "1px solid var(--line)", color: "var(--ink)", padding: "9px 16px", borderRadius: 8, fontWeight: 500 }}>
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
