import { axes, FONT } from "@/components/site/type";
import { cx } from "@/components/ui/cx";

/*
 * Who can move a campaign's money, drawn: the funder's wallet, the escrow
 * contract, the contributors' wallets, and the two keys that cannot pay
 * anyone. Shared by the home page and /custody; `you` words it for the
 * funder reading /custody, otherwise for anyone.
 */

/** Dashes running from one box to the next: the direction money can move. Static under reduced motion. */
function Flow({ label, vertical = false }: { label: string; vertical?: boolean }) {
  const strip = (
    <div className="h-1 w-full overflow-hidden">
      <div
        aria-hidden="true"
        className="h-1 w-[200%] animate-marquee"
        style={{ animationDuration: "6s", animationDirection: "reverse", background: "repeating-linear-gradient(90deg,#fdda24 0 10px,transparent 10px 20px)" }}
      />
    </div>
  );
  return (
    <div className={cx("relative flex items-center justify-center", vertical ? "h-20 w-full" : "min-w-[9.5rem] flex-1")}>
      {vertical ? <div className="w-20 rotate-90">{strip}</div> : strip}
      {/* Between lg and xl the gap is narrow: a long label breaks onto two lines rather than run over a box. */}
      <span className="absolute max-w-full whitespace-nowrap rounded-full bg-canvas text-center lg:whitespace-normal xl:whitespace-nowrap px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/65">{label}</span>
    </div>
  );
}

function Node({ kicker, title, body, tone = "dark" }: { kicker: string; title: string; body: string; tone?: "dark" | "yellow" }) {
  return (
    <div className={cx("w-full rounded-[26px] p-6 lg:min-w-0 lg:max-w-[17rem] lg:flex-[1_1_17rem]", tone === "yellow" ? "bg-accent text-black" : "border border-white/10 bg-[#111] text-white")}>
      <p className={cx("font-mono text-[10.5px] uppercase tracking-[0.18em]", tone === "yellow" ? "text-black/65" : "text-white/55")}>{kicker}</p>
      <p className={`mt-2 text-[1.7rem] leading-none lg:text-[1.5rem] xl:text-[1.7rem] ${FONT}`} style={{ fontVariationSettings: axes(88, 850) }}>
        {title}
      </p>
      <p className={cx("mt-3 text-sm leading-relaxed", tone === "yellow" ? "text-black/75" : "text-white/65")}>{body}</p>
    </div>
  );
}

function Both({ label }: { label: string }) {
  return (
    <div className="flex lg:flex-1">
      <span className="contents lg:hidden">
        <Flow label={label} vertical />
      </span>
      <span className="hidden lg:contents">
        <Flow label={label} />
      </span>
    </div>
  );
}

export function MoneyFlow({ you = false, className }: { you?: boolean; className?: string }) {
  return (
    <figure className={className} aria-label="How the budget moves">
      <div className="flex flex-col items-stretch lg:flex-row">
        <Node
          kicker="Funder"
          title={you ? "Your wallet" : "The team's wallet"}
          body={you ? "Deploys and funds the escrow. Signs every release." : "Deploys and funds the escrow, and signs every release: the final approval."}
        />
        <Both label="Fund" />
        <Node tone="yellow" kicker="Trustless Work escrow" title="The contract" body="Holds the budget. Its balance is read from the chain, not from our database." />
        <Both label={you ? "Release, you sign" : "Release, funder signs"} />
        <Node kicker="Contributors" title="Their wallets" body="Paid one release per approved post, to the wallet the release names." />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-[26px] border border-dashed border-white/20 p-6">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-white/55">Proofwork keys</p>
          <p className="mt-2 text-white/75">Add a payout line for a passed post and write each decision to Stellar.</p>
          <p className="mt-2 font-semibold text-white">Cannot release, withdraw or move any amount.</p>
        </div>
        <div className="rounded-[26px] border border-dashed border-white/20 p-6">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-white/55">Dispute resolver</p>
          <p className="mt-2 text-white/75">{you ? "After you close, signs the return of what is left." : "After the funder closes, signs the return of what is left."}</p>
          <p className="mt-2 font-semibold text-white">{you ? "Only to your wallet." : "Only to the funder's wallet."}</p>
        </div>
      </div>
    </figure>
  );
}
