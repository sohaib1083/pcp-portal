import { PageTitle } from "./common";

/** Temporary page for a route whose module is being built. */
export default function Placeholder({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <PageTitle eyebrow="Being built" title={title} sub={sub} />
      <div className="pcp-stat" style={{ display: "block", color: "var(--muted)" }}>This screen is part of the current build and will appear here shortly.</div>
    </>
  );
}
