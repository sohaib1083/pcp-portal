"use client";
// A short user guide on each screen (guide section 14): a "How this screen works" link that opens
// a drawer with 3 to 5 plain steps. Usage, e.g. in PageTitle's `extra`:
//   <ScreenGuide title="Council meetings" steps={["Create a meeting ...", "Build the agenda ...", "..."]} />
// In a step, **bold** marks a button or label the reader should look for.
import { useState } from "react";
import { Alert, Button, Drawer } from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";

function rich(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <b key={i}>{part.slice(2, -2)}</b> : <span key={i}>{part}</span>));
}

export default function ScreenGuide({ title, intro, steps, note, label = "How this screen works" }: { title: string; intro?: string; steps: string[]; note?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="link" size="small" icon={<QuestionCircleOutlined />} onClick={() => setOpen(true)} className="pcp-screen-guide-link" style={{ paddingInline: 4 }}>
        {label}
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={
          <span>
            <QuestionCircleOutlined style={{ color: "var(--brand)", marginRight: 8 }} />
            {title}
          </span>
        }
        size={420}
        destroyOnHidden
      >
        {intro ? <p className="muted" style={{ marginTop: 0, fontSize: 13.5, lineHeight: 1.55 }}>{intro}</p> : null}
        <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 14 }}>
          {steps.map((s, i) => (
            <li key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{ flex: "none", width: 26, height: 26, borderRadius: "50%", background: "var(--brand-50)", color: "var(--brand)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12.5 }}>{i + 1}</span>
              <span style={{ fontSize: 14, lineHeight: 1.55, paddingTop: 2 }}>{rich(s)}</span>
            </li>
          ))}
        </ol>
        {note ? <Alert type="info" showIcon style={{ marginTop: 20 }} title={note} /> : null}
      </Drawer>
    </>
  );
}
