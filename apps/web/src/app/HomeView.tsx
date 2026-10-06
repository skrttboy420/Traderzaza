"use client";

import Link from "next/link";
import { useMemo } from "react";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import { NewsRiskStrip } from "@/components/NewsPanel";
import { SetupCard } from "@/components/SetupCard";
import { TopBar } from "@/components/TopBar";
import { Badge, Disclaimer, Empty, SectionTitle, cx } from "@/components/ui";
import { SCANNER_ORDER, SCANNER_VISUAL } from "@/components/visual";
import { useLocale, useT } from "@/i18n/provider";
import { formatAgo } from "@/lib/format";
import type { HomeData } from "@/lib/home";
import { SIGNAL_STATES } from "@/lib/signal";
import { useSettings } from "@/lib/store";
import { symbolHref } from "@/lib/setup";

/**
 * §81: the app opens straight onto "here are the best opportunities right now".
 * No question has to be asked first.
 *
 * §32: ordering comes from the engine (readiness -> quality -> R:R -> HTF
 * agreement). AI confidence is displayed but never sorts this list.
 */
export function HomeView({ data }: { data: HomeData }) {
  const t = useT("trading");
  const tc = useT("common");
  const { locale } = useLocale();
  const { settings } = useSettings();

  const top = useMemo(
    () => data.opportunities.filter(({ setup }) => setup.status !== "INVALIDATED"),
    [data.opportunities],
  );

  return (
    <>
      <TopBar />

      <main className="space-y-4 p-4">
        <section>
          <SectionTitle
            title={t("dashboard.title")}
            subtitle={t("dashboard.subtitle")}
            right={<DataStatusBadge status={data.weakestStatus} compact />}
          />

          <div className="scroll-x -mx-1 flex gap-1.5 px-1 pb-1">
            {SCANNER_ORDER.map((state) => {
              const visual = SCANNER_VISUAL[state];
              const count = data.counts[state] ?? 0;
              // The three actionable states now have a screen of their own, so
              // tapping "entry now" goes to the signals page rather than to the
              // full list where it has to be found again.
              const href = (SIGNAL_STATES as readonly string[]).includes(state) ? "/signal" : "/setups";
              return (
                <Link key={state} href={href} className="shrink-0">
                  <Badge
                    glyph={visual.glyph}
                    className={cx(
                      visual.text,
                      visual.bg,
                      visual.border,
                      count === 0 && "opacity-45",
                      "h-9 px-2.5",
                    )}
                  >
                    {t(`scannerState.${state}`)} <span className="num ml-0.5">{count}</span>
                  </Badge>
                </Link>
              );
            })}
          </div>

          <p className="mt-1.5 text-[11px] text-[var(--color-faint)]">
            {tc("dataQuality.lastUpdate")}: {formatAgo(data.scannedAt, locale)}
          </p>
        </section>

        {top.length === 0 ? (
          <Empty title={t("dashboard.noOpportunities")} hint={t("setups.invalidatedKept")} />
        ) : (
          <ul className="space-y-2.5">
            {top.map(({ setup, rank }) => (
              <li key={setup.id}>
                <SetupCard setup={setup} rank={rank} showConfidence={settings.showAiConfidence} />
              </li>
            ))}
          </ul>
        )}

        {/* One strip per watchlist market, and only when a high-impact release
            is actually close. On a clear day this renders nothing at all. */}
        <div className="space-y-2">
          {data.scans.map((scan) => (
            <NewsRiskStrip key={scan.symbol} symbol={scan.symbol} />
          ))}
        </div>

        <section>
          <SectionTitle title={t("markets.title")} right={<Link href="/markets" className="text-[12px] text-[var(--color-limit)]">{tc("actions.viewDetail")}</Link>} />
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {data.scans.map((scan) => {
              const best = scan.best;
              const visual = best ? SCANNER_VISUAL[best.scannerState] : SCANNER_VISUAL.WATCHLIST;
              return (
                <li key={scan.symbol}>
                  <Link
                    href={symbolHref(scan.symbol)}
                    className="card block p-3 transition-colors hover:border-[var(--color-border-strong)]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-semibold">{scan.symbol}</span>
                      <span aria-hidden className={cx("text-[10px]", visual.text)}>
                        {visual.glyph}
                      </span>
                    </div>
                    <p className={cx("mt-1 truncate text-[11px]", visual.text)}>
                      {best ? t(`scannerState.${best.scannerState}`) : t("scannerState.NO_TRADE")}
                    </p>
                    <p className="num mt-0.5 text-[10.5px] text-[var(--color-faint)]">
                      {tc(`dataQuality.${scan.dataStatus.quality}`)}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

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

        <Disclaimer text={tc("disclaimer")} />
      </main>
    </>
  );
}
