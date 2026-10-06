"use client";
// Session timeout on shared office computers (guide section 12): after 30 minutes without activity the
// user is signed out, with a one-minute warning first. Activity in any open tab of the portal counts.
import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "antd";
import { ClockCircleOutlined } from "@ant-design/icons";
import { logoutAction } from "@/app/actions/auth";

const IDLE_MS = 30 * 60 * 1000;
const WARN_MS = 60 * 1000;
const KEY = "pcp.lastActivity";
const EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "wheel"] as const;

function read(key: string) {
  try {
    return Number(window.localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}
function write(key: string, v: number) {
  try {
    window.localStorage.setItem(key, String(v));
  } catch {
    /* private window: this tab still times out on its own */
  }
}

export default function IdleTimeout() {
  const [left, setLeft] = useState<number | null>(null);
  const last = useRef(0);
  const warning = useRef(false);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    // Demo build only: a shorter limit for rehearsals and tests (localStorage "pcp.idleTimeoutMs").
    const override = process.env.NEXT_PUBLIC_DEMO_MODE === "1" ? read("pcp.idleTimeoutMs") : 0;
    const idle = override >= 15_000 ? override : IDLE_MS;
    last.current = Date.now();
    write(KEY, last.current);

    const activity = () => {
      if (warning.current) return; // once warned, only "Stay signed in" keeps the session
      const now = Date.now();
      if (now - last.current > 5_000) {
        last.current = now;
        write(KEY, now);
      }
    };
    for (const e of EVENTS) window.addEventListener(e, activity, { passive: true });

    const tick = window.setInterval(() => {
      last.current = Math.max(last.current, read(KEY));
      const remaining = idle - (Date.now() - last.current);
      if (remaining <= 0) {
        window.clearInterval(tick);
        form.current?.requestSubmit();
      } else if (remaining <= WARN_MS) {
        warning.current = true;
        setLeft(Math.ceil(remaining / 1000));
      } else if (warning.current) {
        warning.current = false; // activity in another tab
        setLeft(null);
      }
    }, 1000);

    return () => {
      window.clearInterval(tick);
      for (const e of EVENTS) window.removeEventListener(e, activity);
    };
  }, []);

  const stay = () => {
    last.current = Date.now();
    write(KEY, last.current);
    warning.current = false;
    setLeft(null);
  };

  return (
    <>
      <form ref={form} action={logoutAction} style={{ display: "none" }} />
      <Modal
        open={left !== null}
        closable={false}
        keyboard={false}
        mask={{ closable: false }}
        title={
          <span>
            <ClockCircleOutlined style={{ color: "#a15c00", marginRight: 8 }} />
            Are you still there?
          </span>
        }
        footer={[
          <Button key="out" onClick={() => form.current?.requestSubmit()}>
            Sign out now
          </Button>,
          <Button key="stay" type="primary" onClick={stay}>
            Stay signed in
          </Button>,
        ]}
      >
        <p style={{ marginTop: 0 }}>
          There has been no activity for a while. To protect records on shared office computers, you will be signed out in{" "}
          <b className="tnum" data-testid="idle-seconds">{left}</b> seconds.
        </p>
      </Modal>
    </>
  );
}
