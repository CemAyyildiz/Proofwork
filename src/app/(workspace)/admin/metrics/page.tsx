import Link from "next/link";
import { notFound } from "next/navigation";
import { SignedOut } from "@/components/signed-out";
import { amount } from "@/components/site/amount";
import { buttonClasses } from "@/components/ui/button";
import { Figure, Section } from "@/components/workspace/admin-kit";
import { PageHeader } from "@/components/workspace/page-header";
import { publicEnv } from "@/config/public-env";
import { db } from "@/db/client";
import { currentUser } from "@/lib/current-user";
import { isAppError } from "@/lib/errors";
import { formatTimestamp } from "@/lib/format";
import { campaignPath, countryName, metricsOverview, profileCompletion, SUMMARY_FIGURES, type MetricsOverview, type WeekRow } from "@/services/metrics";

export const dynamic = "force-dynamic";

/**
 * Operator metrics: how many wallets use Proofwork and what they did, counted
 * from this deployment's own tables. Read-only; no page view is tracked.
 */
export default async function MetricsPage() {
  const user = await currentUser();
  if (!user) return <SignedOut />;
  const now = new Date();
  let o: MetricsOverview;
  try {
    o = await metricsOverview(user, db, now);
  } catch (e) {
    // Not the operator: the same page as a wrong URL.
    if (isAppError(e) && e.code === "FORBIDDEN") notFound();
    throw e;
  }
  const [hero, ...rest] = SUMMARY_FIGURES;

  return (
    <div className="space-y-12">
      <PageHeader
        eyebrow="Operator"
        title="Metrics"
        description={`Counted from this deployment's database on ${publicEnv.networkName}, at ${formatTimestamp(o.generatedAt)}. No page views are tracked.`}
        action={
          <a href="/api/admin/metrics" download className={buttonClasses("secondary", "sm")}>
            Download CSV
          </a>
        }
      />

      <div className="space-y-8">
        <div className="flex flex-wrap items-end gap-x-16 gap-y-8">
          {hero ? <Figure hero value={o.summary[hero.key]} label={hero.label} /> : null}
          <dl className="grid grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-3 sm:gap-x-12 xl:grid-cols-5">
            {rest.map((f) => (
              <Figure key={f.key} value={f.key === "usdcPaid" ? amount(o.summary.usdcPaid) : o.summary[f.key]} label={f.label} />
            ))}
          </dl>
        </div>
        <details className="max-w-[760px] text-[13.5px] text-white/60">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-white/75 hover:text-text">How each figure is counted</summary>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2">
            {SUMMARY_FIGURES.map((f) => (
              <div key={f.key} className="contents">
                <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/70">{f.label}</dt>
                <dd>{f.definition}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>

      <Section id="weekly" title="Weekly" description="Per ISO week (Monday, UTC): distinct wallets that signed in, and wallets signing in for the first time.">
        {o.weeks.length === 0 ? <Empty>No sign-ins yet.</Empty> : <WeeklyChart weeks={o.weeks} />}
      </Section>

      <Section id="campaigns" title="Campaigns" count={o.campaigns.length} description="Every campaign, newest first. Paid and USDC paid count released payouts with their release transaction.">
        {o.campaigns.length === 0 ? <Empty>No campaigns yet.</Empty> : <CampaignTable rows={o.campaigns} />}
      </Section>

      <Section
        id="profiles"
        title="Profiles"
        description="Profile completion is the share of users with a display name. Countries count users by the country on their profile; a user without one is counted as not given."
      >
        <dl className="grid grid-cols-2 gap-x-8 sm:max-w-md sm:gap-x-12">
          <Figure value={profileCompletion(o)} label="% with a display name" />
          <Figure value={o.withDisplayName} label="with a display name" />
        </dl>
        {o.countries.length === 0 ? <Empty>No users yet.</Empty> : <CountryTable rows={o.countries} />}
      </Section>
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="rounded-[22px] border border-dashed border-white/12 px-5 py-8 text-sm text-white/60">{children}</p>;
}

const panel = "relative overflow-x-auto rounded-[24px] border border-white/[0.07] bg-[#0d0d0d]";
const th = "whitespace-nowrap px-4 py-3 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-white/60 first:pl-6 last:pr-6";
const thNum = `${th} text-right`;
const td = "whitespace-nowrap px-4 py-3 first:pl-6 last:pr-6";
const tdNum = `${td} text-right font-mono tabular-nums`;

const SERIES = [
  { key: "signedIn", label: "Signed in", color: "var(--color-accent)" },
  { key: "newWallets", label: "New wallets", color: "var(--color-muted)" },
] as const;

const STEP = 28;
const BAR = 9;
const GAP = 2;
const PLOT_H = 160;
const TOP = 12;
const LEFT = 36;
const BOTTOM = 26;

/** Grouped bars, one pair per week, on one count axis. Each week's hover title carries both counts; the table below has every value. */
function WeeklyChart({ weeks }: { weeks: WeekRow[] }) {
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.signedIn, w.newWallets)));
  const width = LEFT + weeks.length * STEP + 8;
  const height = TOP + PLOT_H + BOTTOM;
  const base = TOP + PLOT_H;
  const every = Math.max(1, Math.ceil(weeks.length / 12));
  const y = (n: number) => base - (n / max) * PLOT_H;

  return (
    <div className="space-y-4">
      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-white/70">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
      <div className={`${panel} p-4`}>
        <svg
          role="img"
          aria-label={`Weekly sign-ins, ${weeks.length} weeks from ${weeks[0]?.label ?? ""}`}
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          className="block max-w-none font-mono"
        >
          <line x1={LEFT} x2={width - 8} y1={TOP} y2={TOP} stroke="var(--color-line-strong)" strokeDasharray="2 4" />
          <line x1={LEFT} x2={width - 8} y1={base} y2={base} stroke="var(--color-line-strong)" />
          <text x={LEFT - 8} y={TOP + 4} textAnchor="end" fontSize="10" fill="var(--color-muted)">
            {max}
          </text>
          <text x={LEFT - 8} y={base + 4} textAnchor="end" fontSize="10" fill="var(--color-muted)">
            0
          </text>
          {weeks.map((w, i) => {
            const x0 = LEFT + i * STEP + (STEP - (2 * BAR + GAP)) / 2;
            return (
              <g key={w.start}>
                <title>{`${w.label} (from ${w.start}): ${w.signedIn} signed in, ${w.newWallets} new`}</title>
                {/* The hit area is the whole column, wider and taller than the bars. */}
                <rect x={LEFT + i * STEP} y={TOP} width={STEP} height={PLOT_H} fill="transparent" />
                {SERIES.map((s, j) => {
                  const n = w[s.key];
                  if (n === 0) return null;
                  const top = y(n);
                  return <rect key={s.key} x={x0 + j * (BAR + GAP)} y={top} width={BAR} height={base - top} rx={2} fill={s.color} />;
                })}
                {i % every === 0 ? (
                  <text x={LEFT + i * STEP + STEP / 2} y={base + 17} textAnchor="middle" fontSize="10" fill="var(--color-muted)">
                    {w.label.slice(5)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <details className="text-[13.5px]">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-white/75 hover:text-text">Show as a table</summary>
        <div className={`${panel} mt-2`}>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th scope="col" className={th}>Week</th>
                <th scope="col" className={th}>From</th>
                <th scope="col" className={thNum}>Signed in</th>
                <th scope="col" className={thNum}>New wallets</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.start} className="border-t border-line">
                  <td className={`${td} font-mono`}>{w.label}</td>
                  <td className={`${td} font-mono text-white/60`}>{w.start}</td>
                  <td className={tdNum}>{w.signedIn}</td>
                  <td className={tdNum}>{w.newWallets}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function CampaignTable({ rows }: { rows: MetricsOverview["campaigns"] }) {
  return (
    <div className={panel}>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th scope="col" className={th}>Campaign</th>
            <th scope="col" className={thNum}>Submissions</th>
            <th scope="col" className={thNum}>Approved</th>
            <th scope="col" className={thNum}>Paid</th>
            <th scope="col" className={thNum}>USDC paid</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.slug} className="border-t border-line">
              <td className="min-w-[14rem] px-4 py-3 pl-6">
                <Link href={campaignPath(c.slug)} className="font-semibold underline decoration-white/25 underline-offset-4 [overflow-wrap:anywhere] hover:decoration-accent">
                  {c.title}
                </Link>
                <p className="mt-0.5 font-mono text-[11.5px] text-white/60 [overflow-wrap:anywhere]">{c.slug}</p>
              </td>
              <td className={tdNum}>{c.submissions}</td>
              <td className={tdNum}>{c.approved}</td>
              <td className={tdNum}>{c.paid}</td>
              <td className={tdNum}>{amount(c.usdcPaid)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CountryTable({ rows }: { rows: MetricsOverview["countries"] }) {
  return (
    <div className={`${panel} max-w-xl`}>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th scope="col" className={th}>Country</th>
            <th scope="col" className={thNum}>Users</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.country ?? "none"} className="border-t border-line">
              <td className={`${td} ${r.country === null ? "text-white/60" : ""}`}>
                {countryName(r.country)}
                {r.country ? <span className="ml-2 font-mono text-[11px] text-white/45">{r.country}</span> : null}
              </td>
              <td className={tdNum}>{r.users}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
