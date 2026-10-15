import Link from "next/link";
import { PublicFrame } from "./PublicHome";
import { COVERAGE, STATUS_HELP, STATUS_LABEL, type CoverageStatus, type TryIt } from "@/lib/coverage";
import { MORE_PERSONAS, PERSONAS, personaFor } from "@/lib/demo-story";

const ORDER: CoverageStatus[] = ["built", "simulated", "golive", "rollout"];

/** "Try it": a plain form POST to the demo switch, so it works without JavaScript and lands on the right screen. */
function Try({ t, quick }: { t?: TryIt; quick: boolean }) {
  if (!t) return null;
  if ("open" in t)
    return (
      <Link className="cov-btn" href={t.open}>
        Open
        <small>public page, no sign-in</small>
      </Link>
    );
  const p = personaFor(t.as);
  if (!quick)
    return (
      <Link className="cov-btn" href={`/login?next=${encodeURIComponent(t.to)}`} title={`Sign in as ${t.as}, then this opens ${t.to}`}>
        Sign in
        <small>
          as <span className="mono">{t.as}</span>
        </small>
      </Link>
    );
  return (
    <form method="post" action="/api/demo/switch">
      <input type="hidden" name="username" value={t.as} />
      <input type="hidden" name="next" value={t.to} />
      <button type="submit" className="cov-btn" title={`Signs you in as ${p?.name ?? t.as} and opens ${t.to}`}>
        Try it
        <small>as {p?.role ?? t.as}</small>
      </button>
    </form>
  );
}

export default function CoverageView({ quick, signedIn }: { quick: boolean; signedIn: boolean }) {
  const all = COVERAGE.flatMap((s) => s.items);
  const count = (s: CoverageStatus) => all.filter((i) => i.status === s).length;
  const people = [...PERSONAS, ...MORE_PERSONAS];
  return (
    <PublicFrame
      signedIn={signedIn}
      title="The working guide, built"
      sub={`Every point of PCP's working guide "PCP digitisation", sections 1 to 14, and the additions in the October 2026 RFP, with the screen that does it${quick ? ". Try it signs you in as the right person and opens that screen." : " and the account to sign in with."}`}
    >
      <div className="cov-summary">
        <div className="cov-card">
          <div className="cov-eyebrow">{all.length} points from the guide</div>
          <div className="cov-counts">
            {ORDER.map((s) => (
              <div key={s} className="cov-count">
                <span className={`cov-pill cov-${s}`}>{STATUS_LABEL[s]}</span>
                <b>{count(s)}</b>
                <span>{STATUS_HELP[s]}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="cov-card cov-howto">
          <div className="cov-eyebrow">How to try it</div>
          {quick ? (
            <p>
              Press <b>Try it</b> on any line. No password is needed. To sign in yourself, open <Link href="/login">the sign-in page</Link>; every demo user&apos;s password is <code>Demo@1234</code>.
            </p>
          ) : (
            <p>
              Each line names the account that does that step. Press <b>Sign in</b>, use that account&apos;s password from the credentials sheet you received, and the screen opens. The POC guide walks through the flow in order.
            </p>
          )}
          <p>
            <b>Simulated here:</b> bank and Raast payments, the bank statement, NADRA, the university and HEC degree check, SMS and email. Messages are stored under Messages instead of being sent. All people, CNICs and institutions are fictional.
          </p>
          <p>This is one shared demo: what you change, other visitors see.</p>
        </div>
      </div>

      <nav className="cov-jump" aria-label="Sections">
        {COVERAGE.map((s) => (
          <a key={s.n} href={`#s${s.n}`}>
            <b>{s.n}</b> {s.title}
          </a>
        ))}
        <a href="#people">
          <b>+</b> Demo users
        </a>
      </nav>

      {COVERAGE.map((s) => {
        const done = s.items.filter((i) => i.status === "built" || i.status === "simulated").length;
        return (
          <section key={s.n} id={`s${s.n}`} className="cov-sec">
            <header className="cov-sec-h">
              <span className="cov-n">{s.n}</span>
              <h2>{s.title}</h2>
              <span className="cov-sec-meta">
                {done} of {s.items.length} working
              </span>
            </header>
            {s.items.map((i) => (
              <div key={i.req} className="cov-row">
                <div className="cov-req">
                  <b>{i.req}</b>
                  <span>{i.how}</span>
                </div>
                <span className={`cov-pill cov-${i.status}`}>{STATUS_LABEL[i.status]}</span>
                <div className="cov-try">
                  <Try t={i.try} quick={quick} />
                </div>
              </div>
            ))}
          </section>
        );
      })}

      <section id="people" className="cov-sec">
        <header className="cov-sec-h">
          <span className="cov-n">+</span>
          <h2>Demo users</h2>
          <span className="cov-sec-meta">password Demo@1234</span>
        </header>
        {people.map((p) => (
          <div key={p.username} className="cov-row">
            <div className="cov-req">
              <b>
                {p.name}, {p.role}
              </b>
              <span>
                {p.org}. {p.blurb}.
              </span>
            </div>
            <span className="cov-user mono">{p.username}</span>
            <div className="cov-try">
              <Try t={{ as: p.username, to: "/home" }} quick={quick} />
            </div>
          </div>
        ))}
      </section>
    </PublicFrame>
  );
}
