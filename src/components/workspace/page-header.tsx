import type { ReactNode } from "react";
import { ax, Label, RiseWords } from "./kit";

/** Workspace page heading: a mono label, a display-face title that rises in, one line of context and an optional action on the right. */
export function PageHeader({ eyebrow = "Workspace", title, description, action }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
      <div className="min-w-0 max-w-[820px]">
        <Label>{eyebrow}</Label>
        <h1
          className="mt-3 font-display text-[clamp(2.6rem,6vw,4.75rem)] leading-[0.9] [overflow-wrap:anywhere]"
          style={{ fontVariationSettings: ax(82, 850) }}
        >
          {typeof title === "string" ? <RiseWords text={title} /> : title}
        </h1>
        {description ? <div className="mt-4 max-w-[640px] text-[15px] leading-relaxed text-white/60">{description}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-3">{action}</div> : null}
    </header>
  );
}
