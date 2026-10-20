import type { ReactNode } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";

/** Workspace page heading: eyebrow, title, one line of context and an optional action on the right. */
export function PageHeader({ eyebrow = "Workspace", title, description, action }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0 max-w-[760px]">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-3 text-[clamp(28px,3.2vw,40px)] font-semibold leading-[1.05] tracking-[-0.04em] [overflow-wrap:anywhere]">{title}</h1>
        {description ? <div className="mt-3 text-[15px] leading-normal text-text-2">{description}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-3">{action}</div> : null}
    </header>
  );
}
