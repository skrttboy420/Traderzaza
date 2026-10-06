"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import { NewsRiskStrip } from "@/components/NewsPanel";
import { SetupCard } from "@/components/SetupCard";
import { TopBar } from "@/components/TopBar";
import { Badge, Bullets, SectionTitle, cx } from "@/components/ui";
import { SCANNER_VISUAL } from "@/components/visual";
import { useLocale, useT } from "@/i18n/provider";
import { formatAgo } from "@/lib/format";
import { symbolHref } from "@/lib/setup";
import type { SignalData } from "@/lib/signal";
import { useSettings } from "@/lib/store";

/**
 * The signal screen (user request #10): only the markets actually calling a
 * trade, each with a button through to the full analysis.
 *
 * Grouped by readiness rather than shown as one flat list, because "enter now"
 * and "set a resting order at a zone price has not reached" are different
 * actions, and a flat list sorted by score would mix them.
 */
export function SignalView({ data }: { data: SignalData }) {
  const t = useT("trading");
  const tc = useT("common");
  const { locale } = useLocale();
  const { settings } = useSettings();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showBlocked, setShowBlocked] = useState(false);

  const rescan = () => startTransition(() => router.refresh());

  // Only the markets that produced a signal get a news strip. A blocked market
  // is already not actionable, so warning about its news would be noise.
  const signalSymbols = useMemo(() => {
    const seen = new Set<string>();
    for (const tier of data.tiers) {
      for (const setup of tier.setups) seen.add(setup.symbol);
    }
    return [...seen];
  }, [data.tiers]);

  return (
    <>
      <TopBar title={t("signal.title")} subtitle={t("signal.subtitle")} />

      <main className="space-y-4 p-4">
        <section className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className={cx(
                "h-9 px-3",
                data.total > 0
                  ? "border-[var(--color-long)]/50 bg-[var(--color-long-soft)] text-[var(--color-long)]"
                  : "border-[var(--color-border)] text-[var(--color-muted)]",
              )}
            >
              {t("signal.count", { count: data.total })}
            </Badge>
            <DataStatusBadge status={data.weakestStatus} compact />
          </div>
          <button
            type="button"
            onClick={rescan}
            disabled={pending}
            className="tap rounded-lg border border-[var(--color-border)] px-3 text-[12.5px] text-[var(--color-muted)] hover:border-[var(--color-border-strong)] disabled:opacity-50"
          >
            {pending ? t("signal.scanning") : t("signal.refresh")}
          </button>
        </section>

        <p className="-mt-2 text-[11px] text-[var(--color-faint)]">
          {tc("dataQuality.lastUpdate")}: {formatAgo(data.scannedAt, locale)}
        </p>

        {/* A high-impact release minutes away outranks any signal on this page,
            so the risk strips sit above the list, not under it. Each strip
            renders nothing at all unless that market really has news close. */}
        <div className="space-y-2">
          {signalSymbols.map((symbol) => (
            <NewsRiskStrip key={symbol} symbol={symbol} />
          ))}
        </div>

        {data.total === 0 ? (
          <section className="card p-5">
            <SectionTitle title={t("signal.none.title")} />
            <p className="text-[12.5px] leading-relaxed text-[var(--color-muted)]">
              {t("signal.none.body")}
            </p>
          </section>
        ) : (
          data.tiers
            .filter((tier) => tier.setups.length > 0)
            .map((tier) => {
              const visual = SCANNER_VISUAL[tier.state];
              return (
                <section key={tier.state}>
                  <SectionTitle
                    title={t(`scannerState.${tier.state}`)}
                    subtitle={t(`signal.tierHint.${tier.state}`)}
                    right={
                      <Badge
                        glyph={visual.glyph}
                        className={cx(visual.text, visual.bg, visual.border, "shrink-0")}
                      >
                        <span className="num">{tier.setups.length}</span>
                      </Badge>
                    }
                  />
                  <ul className="space-y-2.5">
                    {tier.setups.map((setup) => (
                      <li key={setup.id}>
                        <SetupCard
                          setup={setup}
                          showConfidence={settings.showAiConfidence}
                          cta={t("signal.viewFull")}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
        )}

        {/* Why the markets that did not make the list did not make it. Shown
            expanded when there is no signal at all (it is the only content the
            page has to offer), collapsed otherwise so it never competes with a
            live signal for attention. */}
        {data.blocked.length > 0 ? (
          <section>
            <button
              type="button"
              onClick={() => setShowBlocked((open) => !open)}
              aria-expanded={showBlocked || data.total === 0}
              className="mb-2 flex w-full items-center justify-between gap-2 text-left"
            >
              <span className="text-[13px] font-medium text-[var(--color-muted)]">
                {t("signal.none.blockedTitle")}
                <span className="num ml-1.5 text-[var(--color-faint)]">{data.blocked.length}</span>
              </span>
              <span aria-hidden className="text-[11px] text-[var(--color-faint)]">
                {showBlocked || data.total === 0 ? "▴" : "▾"}
              </span>
            </button>

            {showBlocked || data.total === 0 ? (
              <ul className="space-y-2">
                {data.blocked.map((market) => {
                  const visual = SCANNER_VISUAL[market.state];
                  return (
                    <li key={market.symbol}>
                      <Link
                        href={symbolHref(market.symbol)}
                        className="card block p-3.5 transition-colors hover:border-[var(--color-border-strong)]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[14px] font-semibold tracking-tight">
                            {market.symbol}
                          </span>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {market.quality !== null ? (
                              <span className="num text-[11px] text-[var(--color-faint)]">
                                {t("signal.none.quality")} {market.quality}
                              </span>
                            ) : null}
                            <Badge
                              glyph={visual.glyph}
                              className={cx(visual.text, visual.bg, visual.border)}
                            >
                              {t(`scannerState.${market.state}`)}
                            </Badge>
                          </div>
                        </div>
                        {market.reasons.length > 0 ? (
                          <div className="mt-2.5 border-t border-[var(--color-border)] pt-2.5">
                            <Bullets items={market.reasons} glyph="✕" tone="text-[var(--color-short)]" />
                          </div>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        ) : null}

        {data.failed.length > 0 ? (
          <section className="card border-l-2 border-l-[var(--color-short)] p-4">
            <SectionTitle title={tc("state.error")} />
            <ul className="space-y-1">
              {data.failed.map((f) => (
                <li key={f.symbol} className="text-[12px] text-[var(--color-muted)]">
                  <span className="font-medium">{f.symbol}</span>: {f.reason}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="px-1 py-4 text-center text-[11px] leading-relaxed text-[var(--color-faint)]">
          {tc("disclaimer")}
        </p>
      </main>
    </>
  );
}
