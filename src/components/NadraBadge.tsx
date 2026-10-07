"use client";
// The NADRA CNIC check on a record (guide section 14): a status badge and, for those allowed, a
// "Check CNIC with NADRA" button. The check is SIMULATED and says so.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Tooltip } from "antd";
import { SafetyCertificateOutlined } from "@ant-design/icons";
import { checkCnicNow } from "@/app/actions/identity";
import { badgeFor, type IdentityBadge, type IdentityEntity } from "@/lib/identity-shared";
import { StatusDot } from "./common";

const SHORT: Record<string, string> = { MATCH: "NADRA verified", NAME_MISMATCH: "Name differs at NADRA", NOT_FOUND: "Not found at NADRA", NONE: "NADRA not checked" };

/** The badge. `short` drops the date and NADRA's spelling, for table cells. */
export function NadraStatus({ badge, short = false }: { badge: IdentityBadge | null | undefined; short?: boolean }) {
  const b = badgeFor(badge);
  return (
    <span data-testid="nadra-badge" data-status={badge?.status ?? "NONE"} style={{ whiteSpace: short ? "nowrap" : undefined }}>
      <StatusDot tone={b.tone} title={b.title}>
        {short ? `${SHORT[badge?.status ?? "NONE"]}${badge?.reviewStatus === "RESOLVED" && badge.status !== "MATCH" ? " · resolved" : ""}` : b.label}
      </StatusDot>
    </span>
  );
}

/** Badge plus the check button. `onChecked` lets a parent update its own copy of the badge. */
export default function NadraBadge({
  entityType,
  entityId,
  badge,
  canCheck,
  onChecked,
}: {
  entityType: IdentityEntity;
  entityId: number;
  badge: IdentityBadge | null | undefined;
  canCheck: boolean;
  onChecked?: (b: IdentityBadge) => void;
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [current, setCurrent] = useState(badge ?? null);
  const [busy, setBusy] = useState(false);
  const shown = current && badge && new Date(badge.checkedAt) > new Date(current.checkedAt) ? badge : current;

  const run = async () => {
    setBusy(true);
    try {
      const r = await checkCnicNow(entityType, entityId);
      message[r.ok ? (r.level === "warning" ? "warning" : "success") : "error"](r.message, 6);
      if (r.badge) {
        setCurrent(r.badge);
        onChecked?.(r.badge);
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <NadraStatus badge={shown} />
      {canCheck ? (
        <Tooltip title="Simulated NADRA check: no real NADRA system is called in this demo.">
          <Button size="small" icon={<SafetyCertificateOutlined />} loading={busy} onClick={run} data-testid="nadra-check">
            {busy ? "Checking with NADRA…" : "Check CNIC with NADRA"}
          </Button>
        </Tooltip>
      ) : null}
      <span className="faint" style={{ fontSize: 11.5 }}>Simulated NADRA check</span>
    </span>
  );
}
