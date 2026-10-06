"use client";
// Presenter guide (demo build only): walks the presenter through the story, switches persona in one
// click and opens the right page. Progress is a per-browser convenience kept in localStorage.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { App, Button, Tooltip } from "antd";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CheckOutlined,
  CompassOutlined,
  MessageOutlined,
  MinusOutlined,
  OrderedListOutlined,
  ReloadOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { ACTS, STORY, personaFor } from "@/lib/demo-story";
import { Avatar } from "./common";

type Ctx = { user: { username: string; name: string } | null; ref: string | null; status: string | null; cert: string | null };

const KEY_STEP = "pcp-guide-step";
const KEY_OPEN = "pcp-guide-open";
const load = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const save = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

function Rich({ text, onPath }: { text: string; onPath: (p: string) => void }) {
  const { message } = App.useApp();
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**")) return <b key={i}>{p.slice(2, -2)}</b>;
        if (p.startsWith("`")) {
          const v = p.slice(1, -1);
          return (
            <Tooltip key={i} title={v.startsWith("/") ? "Open" : "Click to copy"}>
              <span
                className="dg-chip"
                onClick={() => {
                  if (v.startsWith("/")) return onPath(v);
                  navigator.clipboard?.writeText(v).then(() => message.success(`Copied ${v}`), () => undefined);
                }}
              >
                {v}
              </span>
            </Tooltip>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

export default function DemoGuide() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(false);
  const [i, setI] = useState(0);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const s = Number(load(KEY_STEP));
    if (Number.isFinite(s) && s >= 0 && s < STORY.length) setI(s);
    setOpen(load(KEY_OPEN) === "1");
    const onOpen = () => {
      setOpen(true);
      save(KEY_OPEN, "1");
    };
    window.addEventListener("pcp-guide-open", onOpen);
    return () => window.removeEventListener("pcp-guide-open", onOpen);
  }, []);

  const refresh = useCallback(() => {
    fetch("/api/demo/context", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setCtx(j))
      .catch(() => undefined);
  }, []);
  useEffect(refresh, [pathname, refresh]);

  const go = (n: number) => {
    const v = Math.max(0, Math.min(STORY.length - 1, n));
    setI(v);
    save(KEY_STEP, String(v));
    setList(false);
  };
  const toggle = (v: boolean) => {
    setOpen(v);
    save(KEY_OPEN, v ? "1" : "0");
  };

  const step = STORY[i];
  const persona = personaFor(step.as);
  const target = useMemo(() => {
    if (step.path.includes("{ref}") && !ctx?.ref) return step.fallback ?? "/home";
    if (step.path.includes("{cert}") && !ctx?.cert) return step.fallback ?? "/verify";
    return step.path.replace("{ref}", ctx?.ref ?? "").replace("{cert}", ctx?.cert ?? "");
  }, [step, ctx]);
  const needSwitch = step.as !== "public" && ctx?.user?.username !== step.as;
  const here = !needSwitch && pathname === target;

  if (pathname?.startsWith("/certificate/")) return null;

  if (!open)
    return (
      <button className="dg-fab no-print" onClick={() => toggle(true)} aria-label="Open the presenter guide">
        <CompassOutlined style={{ fontSize: 16, color: "#c8a24a" }} />
        Presenter guide
        <span style={{ opacity: 0.7, fontWeight: 500 }}>
          · {i + 1}/{STORY.length}
        </span>
      </button>
    );

  return (
    <div className="dg-panel no-print" role="dialog" aria-label="Presenter guide" data-target={target}>
      <div className="dg-head">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 650 }}>
            <CompassOutlined style={{ color: "#c8a24a" }} /> Presenter guide
          </div>
          <div style={{ display: "flex", gap: 2 }}>
            <Tooltip title={list ? "Back to the step" : "All steps"}>
              <Button type="text" size="small" icon={<OrderedListOutlined />} onClick={() => setList(!list)} style={{ color: "#fff" }} />
            </Tooltip>
            <Tooltip title="Minimise">
              <Button type="text" size="small" icon={<MinusOutlined />} onClick={() => toggle(false)} style={{ color: "#fff" }} />
            </Tooltip>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.65)", marginTop: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Act {step.act} · step {i + 1} of {STORY.length}
        </div>
        <div style={{ fontSize: 17, fontWeight: 650, marginTop: 2, letterSpacing: "-0.01em" }}>{list ? "The story" : step.title}</div>
        <div className="dg-progress">
          <div style={{ width: `${((i + 1) / STORY.length) * 100}%` }} />
        </div>
      </div>

      {list ? (
        <div className="dg-body">
          {ACTS.map((act) => (
            <div key={act} style={{ marginBottom: 10 }}>
              <div className="pcp-eyebrow" style={{ margin: "4px 8px 4px" }}>
                Act {act}
              </div>
              <ul className="dg-steps-list">
                {STORY.map((s, n) =>
                  s.act !== act ? null : (
                    <li key={n} className={n === i ? "active" : n < i ? "done" : ""} onClick={() => go(n)}>
                      <span className="dg-n">{n < i ? <CheckOutlined /> : n + 1}</span>
                      <span style={{ flex: 1 }}>
                        <span style={{ display: "block", fontWeight: 500 }}>{s.title}</span>
                        <span className="faint" style={{ fontSize: 12 }}>
                          {s.as === "public" ? "Public page" : personaFor(s.as)?.name}
                        </span>
                      </span>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
          <div className="faint" style={{ fontSize: 12, padding: "6px 8px 0", lineHeight: 1.5 }}>
            Before presenting, run <code>./demo.sh reset</code> so the story starts from clean data, then restart from step 1.
            <div style={{ marginTop: 8 }}>
              <Button size="small" icon={<ReloadOutlined />} onClick={() => go(0)}>
                Restart from step 1
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="dg-body">
          <div className="dg-persona">
            {persona ? <Avatar name={persona.name} size={36} /> : <Avatar name="Public" size={36} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, color: "var(--faint)" }}>{step.as === "public" ? "Anyone, no sign-in" : "Sign in as"}</div>
              <div style={{ fontWeight: 600 }}>{persona ? persona.name : "Public visitor"}</div>
              {persona ? (
                <div className="muted" style={{ fontSize: 12 }}>
                  {persona.role} · <span className="mono">{persona.username}</span>
                </div>
              ) : null}
            </div>
            {step.as !== "public" ? (
              needSwitch ? (
                <span style={{ fontSize: 11.5, color: "#a15c00", background: "#fff7e6", border: "1px solid #ffe1a8", padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>Switch needed</span>
              ) : (
                <span style={{ fontSize: 11.5, color: "#0d7a3d", background: "#e9f7ef", border: "1px solid #c9ecd8", padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>
                  <CheckOutlined /> Signed in
                </span>
              )
            ) : null}
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Do</div>
          <ol className="dg-do">
            {step.do.map((line, n) => (
              <li key={n}>
                <Rich text={line} onPath={(p) => router.push(p)} />
              </li>
            ))}
          </ol>
          <div className="dg-talk">
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 650, marginBottom: 4 }}>
              <MessageOutlined /> Say
            </div>
            {step.say}
          </div>
          {ctx?.ref ? (
            <div className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>
              Story application: <span className="mono">{ctx.ref}</span>
              {ctx.cert ? (
                <>
                  {" "}
                  · certificate <span className="mono">{ctx.cert}</span>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      <div className="dg-foot">
        <Button icon={<ArrowLeftOutlined />} disabled={i === 0} onClick={() => go(i - 1)} aria-label="Previous step" />
        {needSwitch && !list ? (
          <form ref={formRef} method="post" action="/api/demo/switch" style={{ flex: 1 }}>
            <input type="hidden" name="username" value={step.as} />
            <input type="hidden" name="next" value={target} />
            <Button htmlType="submit" type="primary" block icon={<SwapOutlined />} loading={!ctx}>
              Switch to {step.as === "pcp.admin" ? "Admin" : persona?.name.replace(/^(Dr|Prof)\.\s+/, "").split(" ")[0]} &amp; open
            </Button>
          </form>
        ) : (
          <Button type="primary" style={{ flex: 1 }} disabled={list} loading={!ctx} onClick={() => router.push(target)} icon={here ? <CheckOutlined /> : <ArrowRightOutlined />} iconPlacement={here ? "start" : "end"}>
            {here ? "You're on this page" : "Open the page"}
          </Button>
        )}
        <Button onClick={() => go(i + 1)} disabled={i === STORY.length - 1} icon={<ArrowRightOutlined />} iconPlacement="end">
          Next
        </Button>
      </div>
    </div>
  );
}
