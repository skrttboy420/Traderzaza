"use client";

import Link from "next/link";
import type { Asset, DataStatus, Setup, TrendState } from "@atc/types";

import { DataStatusBadge } from "@/components/DataStatusBadge";
import { TopBar } from "@/components/TopBar";
import { Badge, Disclaimer, SectionTitle, cx } from "@/components/ui";
import { QUALITY_VISUAL, SCANNER_VISUAL } from "@/components/visual";
import { useT } from "@/i18n/provider";
import { formatPrice } from "@/lib/format";
import { symbolHref } from "@/lib/setup";

export interface MarketRow {
  symbol: string;
  asset: Asset;
  price: number;
  htfTrend: TrendState;
  best: Setup | null;
  dataStatus: DataStatus;
  setupCount: number;
}

export interface MarketsData {
  rows: MarketRow[];
  failed: { symbol: string; reason: string }[];
}

function trendTone(trend: TrendState): string {
  if (trend.includes("bull")) return "text-[var(--color-long)]";
  if (trend.includes("bear")) return "text-[var(--color-short)]";
  return "text-[var(--color-muted)]";
}

/** §31: the whole watchlist at a glance — price, HTF bias, best setup, data quality. */
export function MarketsView({ data }: { data: MarketsData }) {
  const t = useT("trading");
  const tc = useT("common");

  return (
    <>
      <TopBar title={t("markets.title")} />

      <main className="space-y-4 p-4">
        <SectionTitle title={t("markets.title")} subtitle={t("dashboard.subtitle")} />

        <ul className="space-y-2.5">
          {data.rows.map((row) => {
            const visual = row.best ? SCANNER_VISUAL[row.best.scannerState] : SCANNER_VISUAL.WATCHLIST;
            const grade = row.best ? QUALITY_VISUAL[row.best.quality.grade] : null;

            return (
              <li key={row.symbol}>
                <Link
                  href={symbolHref(row.symbol)}
                  className="card block p-3.5 transition-colors hover:border-[var(--color-border-strong)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[15px] font-semibold tracking-tight">
                          {row.symbol}
                        </span>
                        <span className="truncate text-[11.5px] text-[var(--color-faint)]">
                          {row.asset.display}
                        </span>
                      </div>
                      <p className="num mt-1 text-[17px] font-semibold">
                        {formatPrice(row.price, row.asset)}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      {grade && row.best ? (
                        <Badge
                          glyph={grade.glyph}
                          className={cx(grade.text, grade.bg, grade.border)}
                          title={t("quality.notProbability")}
                        >
                          <span className="num">{row.best.quality.score}</span>
                        </Badge>
                      ) : null}
                      <div className="mt-1.5">
                        <DataStatusBadge status={row.dataStatus} compact />
                      </div>
                    </div>
                  </div>

                  <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-[var(--color-border)] pt-3">
                    <div className="min-w-0">
                      <dt className="text-[10.5px] uppercase tracking-wide text-[var(--color-faint)]">
                        {t("markets.bias")}
                      </dt>
                      <dd className={cx("mt-0.5 truncate text-[12px] font-medium", trendTone(row.htfTrend))}>
                        {t(`trend.${row.htfTrend}`)}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[10.5px] uppercase tracking-wide text-[var(--color-faint)]">
                        {t("markets.best")}
                      </dt>
                      <dd className={cx("mt-0.5 truncate text-[12px] font-medium", visual.text)}>
                        <span aria-hidden className="mr-1 text-[9px]">
                          {visual.glyph}
                        </span>
                        {row.best ? t(`scannerState.${row.best.scannerState}`) : t("scannerState.NO_TRADE")}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[10.5px] uppercase tracking-wide text-[var(--color-faint)]">
                        {t("setups.title")}
                      </dt>
                      <dd className="num mt-0.5 truncate text-[12px] font-medium">{row.setupCount}</dd>
                    </div>
                  </dl>
                </Link>
              </li>
            );
          })}
        </ul>

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
