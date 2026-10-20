"use client";

import Link from "next/link";
import { useMemo } from "react";
import { expectancy } from "@atc/engine";

import { useT } from "@/i18n/provider";
import { formatMoney, formatNumber } from "@/lib/format";
import { useJournal, useSettings } from "@/lib/store";
import { cx } from "./ui";

/**
 * "Is this actually paying for anything?"
 *
 * The journal page has had the full statistics table since the beginning, and
 * it is the page nobody opens. Expectancy belongs where the trading decision
 * is made, because its only use is to settle the argument the trader is having
 * with themselves before the next click: this method, at this size, earns this
 * much per trade — or it does not, and the honest answer is that there is not
 * enough data to say yet.
 *
 * Money, not R. R is the correct unit for sizing and a useless one for
 * motivation; nobody buys lunch with 0.3R.
 */
export function ExpectancyStrip({ className }: { className?: string }) {
  const t = useT("trading");
  const { settings, loaded: settingsLoaded } = useSettings();
  const { entries, loaded: journalLoaded } = useJournal();

  const oneR = (settings.accountBalance * settings.riskPercent) / 100;

  const reading = useMemo(
    // `getTimezoneOffset` is minutes *behind* UTC, so Bangkok reports -420 for
    // UTC+7. Negated here so the engine receives the offset in the direction
    // its name promises.
    () => expectancy(entries, oneR, -new Date().getTimezoneOffset()),
    [entries, oneR],
  );

  if (!settingsLoaded || !journalLoaded) return null;

  // Nothing recorded yet. An expectancy card reading "$0.00 per trade" on a
  // fresh install is not a zero result, it is an absence of results, and
  // showing it as a figure invites the trader to read it as the former.
  if (reading.confidence === "none") return null;

  const positive = reading.perTradeMoney > 0;
  const thin = reading.confidence === "thin";

  return (
    <Link
      href="/journal"
      className={cx(
        "card block p-3.5 transition-colors hover:border-[var(--color-border-strong)]",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[12.5px] font-semibold text-[var(--color-muted)]">
          {t("expectancy.title")}
        </h2>
        <span className="text-[11px] text-[var(--color-faint)]">
          {t("expectancy.sample", { trades: reading.trades })}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className={cx(
            "num text-[20px] font-semibold tracking-tight",
            thin
              ? "text-[var(--color-muted)]"
              : positive
                ? "text-[var(--color-long)]"
                : "text-[var(--color-short)]",
          )}
        >
          {positive ? "+" : ""}
          {formatMoney(reading.perTradeMoney, settings.currency)}
        </span>
        <span className="text-[11.5px] text-[var(--color-faint)]">{t("expectancy.perTrade")}</span>
      </div>

      {/* Per day actually traded, which is the number the question was really
          about. Suppressed on a thin sample rather than shown greyed out: a
          daily income figure is the single most tempting number on this screen
          to believe, and four trades cannot support one. */}
      {thin ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--color-wait)]">
          {t("expectancy.thin", { needed: reading.tradesNeeded })}
        </p>
      ) : (
        <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
          {t("expectancy.perDay", {
            money: formatMoney(reading.perDayMoney, settings.currency),
            days: reading.tradingDays,
          })}
        </p>
      )}

      <dl className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--color-border)] pt-2.5 text-[11px] text-[var(--color-faint)]">
        <div className="flex gap-1.5">
          <dt>{t("expectancy.winRate")}</dt>
          <dd className="num font-medium text-[var(--color-muted)]">{reading.winRate}%</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>{t("expectancy.profitFactor")}</dt>
          <dd className="num font-medium text-[var(--color-muted)]">
            {Number.isFinite(reading.profitFactor) ? formatNumber(reading.profitFactor, 2) : "∞"}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt>{t("expectancy.totalR")}</dt>
          <dd
            className={cx(
              "num font-medium",
              reading.totalR > 0
                ? "text-[var(--color-long)]"
                : reading.totalR < 0
                  ? "text-[var(--color-short)]"
                  : "text-[var(--color-muted)]",
            )}
          >
            {reading.totalR > 0 ? "+" : ""}
            {reading.totalR}R
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt>{t("expectancy.oneR")}</dt>
          <dd className="num font-medium text-[var(--color-muted)]">
            {formatMoney(oneR, settings.currency)}
          </dd>
        </div>
      </dl>
    </Link>
  );
}
