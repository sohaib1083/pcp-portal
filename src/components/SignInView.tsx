"use client";
import Link from "next/link";
import { Button } from "antd";
import { KeyOutlined, SafetyCertificateOutlined, SearchOutlined, UserAddOutlined } from "@ant-design/icons";
import { loginAction } from "@/app/actions/auth";
import { PublicFrame } from "./PublicHome";

/**
 * The sign-in page when one-click persona entry is off (a hosted POC, or production): every user signs in
 * with the username and password PCP gave them. The form itself is Keycloak's, in the PCP theme.
 */
export default function SignInView({ next }: { next: string }) {
  return (
    <PublicFrame title="Sign in" sub="Pharmacy Council of Pakistan · institutions, PCP staff, provincial councils, faculty, students and pharmacists.">
      <div className="signin-grid">
        <div className="signin-card">
          <span className="signin-icon">
            <KeyOutlined />
          </span>
          <h2>Sign in to the PCP Digital Portal</h2>
          <p>Use the username and password you were given. PCP officers and provincial council officers then enter a one-time code.</p>
          <form action={loginAction}>
            <input type="hidden" name="next" value={next} />
            <Button htmlType="submit" type="primary" size="large" block icon={<KeyOutlined />}>
              Sign in
            </Button>
          </form>
          <p className="muted" style={{ fontSize: 12.5, margin: "14px 0 0" }}>
            Forgot your password? Your institution&apos;s Head of institution or the PCP Super administrator can reset it.
          </p>
        </div>
        <div className="signin-side">
          <Link href="/register" className="signin-link">
            <UserAddOutlined />
            <span>
              <b>Register your institution</b>
              <small>New institutions apply here; PCP approves them and issues the Institution ID.</small>
            </span>
          </Link>
          <Link href="/verify" className="signin-link">
            <SearchOutlined />
            <span>
              <b>Verify a certificate or a pharmacist</b>
              <small>Public check, no sign-in needed.</small>
            </span>
          </Link>
          <Link href="/privacy" className="signin-link">
            <SafetyCertificateOutlined />
            <span>
              <b>Privacy notice</b>
              <small>What the portal holds and who can see it.</small>
            </span>
          </Link>
        </div>
      </div>
    </PublicFrame>
  );
}
