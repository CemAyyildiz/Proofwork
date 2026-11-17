/** Placeholder in the shape of the queue: heading, the counter, then the paper submission beside the rubric from xl up. */
export default function Loading() {
  return (
    <div className="space-y-10 pb-24" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="animate-pulse">
        <div className="h-3 w-16 rounded-full bg-white/10" />
        <div className="mt-4 h-16 w-[min(520px,80%)] rounded-2xl bg-white/[0.07]" />
        <div className="mt-5 h-4 w-full max-w-[560px] rounded-full bg-white/[0.06]" />
      </div>
      <div className="space-y-5">
        <div className="h-12 w-40 animate-pulse rounded-xl bg-white/[0.07]" />
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]">
          <div className="h-[460px] animate-pulse rounded-[30px] bg-paper/10" />
          <div className="rounded-[30px] border border-white/[0.07] bg-[#0d0d0d] p-7">
            <div className="h-20 w-36 animate-pulse rounded-xl bg-white/[0.07]" />
            <div className="mt-5 grid grid-cols-6 gap-1.5">
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className="h-3 animate-pulse rounded-full bg-white/10" style={{ animationDelay: `${i * 90}ms` }} />
              ))}
            </div>
            <div className="mt-7 grid gap-2">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-[20px] bg-white/[0.04]" style={{ animationDelay: `${i * 90}ms` }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
