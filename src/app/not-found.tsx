import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Logo } from "@/components/ui/logo";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-[18px]">
      <Card className="w-full max-w-[460px] p-8 text-center">
        <Link href="/" className="inline-flex min-h-11 items-center rounded-sm" aria-label="Proofwork home">
          <Logo />
        </Link>
        <p className="mt-6 font-mono text-[12px] font-medium tracking-[0.14em] text-muted">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">Nothing here.</h1>
        <p className="mt-2 text-sm leading-normal text-text-2">
          The link may be mistyped, or the campaign or decision it points to doesn&apos;t exist.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/explore" className={buttonClasses("primary")}>
            Open campaigns
          </Link>
          <Link href="/" className={buttonClasses("secondary")}>
            Home
          </Link>
        </div>
      </Card>
    </main>
  );
}
