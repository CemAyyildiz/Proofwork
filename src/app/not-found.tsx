import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { axes, FONT } from "@/components/site/type";

/** A missing bounty or decision: said big, with the one way on. */
export default function NotFound() {
  const words = ["Nothing", "here."];
  return (
    <main className="flex min-h-screen flex-col justify-center bg-canvas px-5 pb-24 pt-32 text-white sm:px-6">
      <div className="mx-auto w-full max-w-6xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/55">404 · not found</p>
        <h1 className={`mt-4 text-[clamp(4.2rem,15vw,12rem)] leading-[0.82] ${FONT}`} style={{ fontVariationSettings: axes(68, 900) }}>
          {words.map((w, i) => (
            <span key={w} className="-mb-[0.1em] mr-[0.2em] inline-block overflow-y-clip -mt-[0.12em] pt-[0.12em] pb-[0.14em] align-top">
              <span className="inline-block animate-rise" style={{ animationDelay: `${80 + i * 90}ms` }}>
                {i === 1 ? (
                  <>
                    here<span className="text-accent">.</span>
                  </>
                ) : (
                  w
                )}
              </span>
            </span>
          ))}
        </h1>
        <p className="mt-6 max-w-md text-[17px] leading-relaxed text-white/65">
          The link may be mistyped, or the bounty or decision it points to doesn&apos;t exist.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link
            href="/explore"
            className="group inline-flex items-center gap-2 rounded-full bg-accent px-7 py-4 font-semibold text-black transition-transform hover:scale-[1.03]"
          >
            Find a bounty <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
          </Link>
          <Link href="/" className="inline-flex min-h-11 items-center rounded-sm font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
