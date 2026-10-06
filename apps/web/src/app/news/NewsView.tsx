"use client";

import { useState } from "react";
import type { NewsImpact } from "@atc/news";

import { NewsPanel } from "@/components/NewsPanel";
import { TopBar } from "@/components/TopBar";
import { Disclaimer, SectionTitle, cx } from "@/components/ui";
import { useT } from "@/i18n/provider";

const IMPACT_CHOICES: NewsImpact[] = [1, 2, 3];

/**
 * The calendar page. Two controls only — which market, and how weak a release
 * is still worth showing — because the point of the screen is the rows, not
 * the filtering.
 *
 * The "how to read this" card is first on purpose. The user's complaint about
 * other screens was that they showed a verdict without the reasoning behind
 * it, and an impact rating with no explanation of what it measures would be
 * exactly that mistake again.
 */
export function NewsView({ symbols }: { symbols: string[] }) {
  const t = useT("news");
  const tc = useT("common");
  const [symbol, setSymbol] = useState(symbols[0] ?? "XAUUSD");
  const [minImpact, setMinImpact] = useState<NewsImpact>(2);

  return (
    <>
      <TopBar title={t("pageTitle")} subtitle={t("pageSubtitle")} />

      <main className="space-y-4 p-4">
        <section className="card p-4">
          <SectionTitle title={t("howTitle")} />
          <ol className="space-y-2">
            {([1, 2, 3, 4] as const).map((n) => (
              <li key={n} className="flex gap-2.5 text-[12.5px] leading-relaxed">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-3)] text-[10px] font-semibold text-[var(--color-muted)]"
                >
                  {n}
                </span>
                <span className="min-w-0 text-[var(--color-text)]/90">{t(`how${n}`)}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="card p-4">
          <div className="text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
            {t("pickSymbol")}
          </div>
          <div className="scroll-x mt-2 flex gap-2">
            {symbols.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSymbol(s)}
                aria-pressed={s === symbol}
                className={cx(
                  "num shrink-0 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium",
                  s === symbol
                    ? "border-[var(--color-limit)] bg-[var(--color-surface-3)] text-[var(--color-text)]"
                    : "border-[var(--color-border)] text-[var(--color-muted)]",
                )}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="mt-4 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
            {t("filterLabel")}
          </div>
          <div className="mt-2 flex gap-2">
            {IMPACT_CHOICES.map((impact) => (
              <button
                key={impact}
                type="button"
                onClick={() => setMinImpact(impact)}
                aria-pressed={impact === minImpact}
                className={cx(
                  "shrink-0 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium",
                  impact === minImpact
                    ? "border-[var(--color-limit)] bg-[var(--color-surface-3)] text-[var(--color-text)]"
                    : "border-[var(--color-border)] text-[var(--color-muted)]",
                )}
              >
                <span aria-hidden className="mr-1.5">
                  {"★".repeat(impact)}
                </span>
                {impact === 1 ? t("filterAll") : t(`impact.${impact === 3 ? "high" : "medium"}`)}
              </button>
            ))}
          </div>
        </section>

        {/* Remounted per symbol/filter so the panel refetches cleanly instead
            of showing one market's rows under another's heading. */}
        <NewsPanel key={`${symbol}:${minImpact}`} symbol={symbol} minImpact={minImpact} />

        <Disclaimer text={tc("disclaimer")} />
      </main>
    </>
  );
}
