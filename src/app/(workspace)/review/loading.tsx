import { Card } from "@/components/ui/card";

/** Placeholder in the shape of the queue: header, then submission and rubric side by side from xl up. */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-10 pb-24" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div>
        <div className="h-4 w-16 rounded bg-raised" />
        <div className="mt-4 h-10 w-64 rounded-lg bg-raised" />
        <div className="mt-4 h-4 w-full max-w-[560px] rounded bg-raised" />
      </div>
      <div className="space-y-4">
        <div className="h-4 w-40 rounded bg-raised" />
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_500px]">
          <Card className="h-[420px]" />
          <Card className="h-[560px]" />
        </div>
      </div>
    </div>
  );
}
